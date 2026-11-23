import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { missingOpfFiles, nestedTocFiles, novelFiles, writeEpub } from '../fixtures/make-epub'
import { launchAppWithUserData } from './helpers'

test('导入中文小说：落库正确、可检索、重复导入被去重、删书清干净', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-import-'))
  const epubPath = join(userDataDir, 'novel.epub')
  await writeEpub(epubPath, novelFiles())

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()

  const first = await win.evaluate((file) => (window as any).api.library.importPath(file), epubPath)
  expect(first.status).toBe('imported')
  expect(first.title).toBe('河边的月亮')
  const bookId = first.bookId as string

  const books = await win.evaluate(() => (window as any).api.library.list())
  expect(books).toHaveLength(1)
  expect(books[0].chapterCount).toBe(2)
  expect(books[0].totalChars).toBeGreaterThan(30)
  expect(books[0].coverPath).toContain('cover.jpg')

  const chapters = await win.evaluate((id) => (window as any).api.library.chapters(id), bookId)
  expect(chapters.map((c: { title: string }) => c.title)).toEqual(['第一章 河边', '第二章 夏夜'])
  expect(chapters[0].charStart).toBe(0)

  const hits = await win.evaluate(
    (id) => (window as any).api.library.search(id, '量子纠缠', 5),
    bookId
  )
  expect(hits.length).toBeGreaterThan(0)
  expect(hits[0].text).toContain('量子纠缠')

  const again = await win.evaluate((file) => (window as any).api.library.importPath(file), epubPath)
  expect(again.status).toBe('duplicate')
  expect(await win.evaluate(() => (window as any).api.library.list())).toHaveLength(1)

  // 文件内容不同、但书名与作者相同的另一份副本也应被拦下
  const sameTitlePath = join(userDataDir, 'novel-copy.epub')
  const sameTitleFiles = novelFiles()
  // 去掉 ISBN，这条用例才真正走「同名 + 同作者」兜底
  sameTitleFiles['OEBPS/content.opf'] = String(sameTitleFiles['OEBPS/content.opf']).replace(
    /<dc:identifier[^>]*>.*?<\/dc:identifier>/,
    ''
  )
  sameTitleFiles['OEBPS/ch1.xhtml'] = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一章</title></head>
<body><h1>第一章 河边</h1>
<p>这是从另一个来源下载的同一本书，正文措辞略有不同。</p></body></html>`
  await writeEpub(sameTitlePath, sameTitleFiles)

  const sameTitle = await win.evaluate(
    (file) => (window as any).api.library.importPath(file),
    sameTitlePath
  )
  expect(sameTitle.status).toBe('duplicate')
  expect(sameTitle.title).toBe('河边的月亮')
  expect(await win.evaluate(() => (window as any).api.library.list())).toHaveLength(1)

  // 书名与作者都不同、但 ISBN 相同（还带连字符）：ISBN 才是同一本书的权威标识
  const sameIsbnPath = join(userDataDir, 'novel-other-edition.epub')
  const sameIsbnFiles = novelFiles()
  const sameIsbnOpf = String(sameIsbnFiles['OEBPS/content.opf'])
    .replace('<dc:title>河边的月亮</dc:title>', '<dc:title>河边的月亮（新版）</dc:title>')
    .replace('<dc:creator>测试作者</dc:creator>', '<dc:creator>另一位译者</dc:creator>')
    .replace('urn:isbn:9787000000001', 'urn:isbn:978-7-0000-0000-1')
  sameIsbnFiles['OEBPS/content.opf'] = sameIsbnOpf
  await writeEpub(sameIsbnPath, sameIsbnFiles)

  const sameIsbn = await win.evaluate(
    (file) => (window as any).api.library.importPath(file),
    sameIsbnPath
  )
  expect(sameIsbn.status).toBe('duplicate')
  expect(sameIsbn.title).toBe('河边的月亮')
  expect(await win.evaluate(() => (window as any).api.library.list())).toHaveLength(1)

  await win.evaluate((id) => (window as any).api.library.remove(id), bookId)
  expect(await win.evaluate(() => (window as any).api.library.list())).toHaveLength(0)
  expect(
    await win.evaluate((id) => (window as any).api.library.search(id, '量子纠缠', 5), bookId)
  ).toEqual([])

  await app.close()
  expect(readdirSync(join(userDataDir, 'library'))).toEqual([])
})

test('导入多级目录的技术书：层级与兜底章节都对', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-import-nested-'))
  const epubPath = join(userDataDir, 'nested.epub')
  await writeEpub(epubPath, nestedTocFiles())

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()
  const result = await win.evaluate((file) => (window as any).api.library.importPath(file), epubPath)
  expect(result.status).toBe('imported')

  const chapters = await win.evaluate(
    (id) => (window as any).api.library.chapters(id),
    result.bookId
  )
  expect(chapters.map((c: { title: string; depth: number }) => [c.title, c.depth])).toEqual([
    ['第一篇 坐标', 0],
    ['第 1 节 笛卡尔', 1],
    ['第 1 目 极坐标', 2],
    ['附录 术语表', 0]
  ])
  expect(chapters[3].parentId).toBeNull()
  await app.close()
})

test('导入畸形 epub：报可读错误且不留脏数据', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-import-broken-'))
  const epubPath = join(userDataDir, 'broken.epub')
  await writeEpub(epubPath, missingOpfFiles())

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()

  const error = await win.evaluate(async (file) => {
    try {
      await (window as any).api.library.importPath(file)
      return null
    } catch (e) {
      return { message: String(e), code: (e as { code?: string }).code }
    }
  }, epubPath)
  expect(error).not.toBeNull()
  expect(error?.message).toContain('epub')
  expect(error?.message).not.toMatch(/[A-Za-z]{6,}\s[A-Za-z]{4,}/) // 不是英文栈

  expect(await win.evaluate(() => (window as any).api.library.list())).toHaveLength(0)
  expect(readdirSync(join(userDataDir, 'library'))).toEqual([])

  await app.close()
})

test('不支持的格式被挡在门口', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-import-unsupported-'))
  const markdownPath = join(userDataDir, 'note.md')
  writeFileSync(markdownPath, '这不是一本书')

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()
  await expect(
    win.evaluate((file) => (window as any).api.library.importPath(file), markdownPath)
  ).rejects.toThrow(/不是支持的电子书格式/)
  await app.close()
})
