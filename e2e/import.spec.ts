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

test('非 epub 文件被挡在门口', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-import-txt-'))
  const txtPath = join(userDataDir, 'note.txt')
  writeFileSync(txtPath, '这不是一本书')

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()
  await expect(
    win.evaluate((file) => (window as any).api.library.importPath(file), txtPath)
  ).rejects.toThrow(/不是 epub 文件/)
  await app.close()
})
