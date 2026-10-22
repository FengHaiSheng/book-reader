import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { htmlzFiles, writeHtmlz } from '../fixtures/make-htmlz'
import { launchAppWithUserData } from './helpers'

test('导入 TXT：按标题分章、可搜索、重复导入去重、删除后不留文件', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-txt-'))
  const txtPath = join(userDataDir, 'novel.txt')
  writeFileSync(
    txtPath,
    ['书名页', '第一章 河边', '河边的月色很好。', '第二章 夏夜', '夏夜里他读完了量子纠缠。'].join('\n')
  )

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()

  const imported = await win.evaluate(
    (file) => (window as any).api.library.importPath(file),
    txtPath
  )
  expect(imported.status).toBe('imported')
  // TXT 没有标题元数据，用文件名兜底
  expect(imported.title).toBe('novel')
  const bookId = imported.bookId as string

  const chapters = await win.evaluate((id) => (window as any).api.library.chapters(id), bookId)
  expect(chapters.map((c: { title: string }) => c.title)).toEqual([
    '前言',
    '第一章 河边',
    '第二章 夏夜'
  ])
  expect(chapters[0].href).toBe('chapters/00001.html')

  const hits = await win.evaluate(
    (id) => (window as any).api.library.search(id, '量子纠缠', 5),
    bookId
  )
  expect(hits.length).toBeGreaterThan(0)

  // 生成的章节走 epub:// 读回，路径形状受协议层保护
  const chapter = await win.evaluate(async (id: string) => {
    const res = await fetch(`epub://${id}/chapters/00001.html`)
    return { status: res.status, text: await res.text() }
  }, bookId)
  expect(chapter.status).toBe(200)
  expect(chapter.text).toContain('书名页')

  const again = await win.evaluate(
    (file) => (window as any).api.library.importPath(file),
    txtPath
  )
  expect(again.status).toBe('duplicate')

  await win.reload()
  await win.getByRole('button', { name: '列表' }).click()
  await win.getByRole('button', { name: '打开' }).click()
  // 没有进度时从第一章打开，这里第一章是标题前留下的「前言」
  await expect(win.locator('.reader__chapter')).toHaveText('前言')

  await win.evaluate((id) => (window as any).api.library.remove(id), bookId)
  expect(await win.evaluate(() => (window as any).api.library.list())).toHaveLength(0)

  await app.close()
  expect(readdirSync(join(userDataDir, 'library'))).toEqual([])
})

test('导入 HTMLZ：元数据、分章、图片复制到 media/ 且能读回', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-htmlz-'))
  const htmlzPath = join(userDataDir, 'collection.htmlz')
  await writeHtmlz(htmlzPath, htmlzFiles())

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()

  const imported = await win.evaluate(
    (file) => (window as any).api.library.importPath(file),
    htmlzPath
  )
  expect(imported.status).toBe('imported')
  expect(imported.title).toBe('河边的两章')
  const bookId = imported.bookId as string

  const books = await win.evaluate(() => (window as any).api.library.list())
  expect(books[0].author).toBe('测试作者')
  expect(books[0].coverPath).toContain('cover.jpg')

  const chapters = await win.evaluate((id) => (window as any).api.library.chapters(id), bookId)
  expect(chapters.map((c: { title: string }) => c.title)).toEqual(['第一章 河边', '第二章 夏夜'])

  const hits = await win.evaluate(
    (id) => (window as any).api.library.search(id, '量子纠缠', 5),
    bookId
  )
  expect(hits.length).toBeGreaterThan(0)

  const html = await win.evaluate(async (id: string) => {
    const res = await fetch(`epub://${id}/chapters/00001.html`)
    return res.text()
  }, bookId)
  // 图片链接被改写成相对 media/ 的路径
  expect(html).toContain('src="../media/flow.png"')

  const image = await win.evaluate(async (id: string) => {
    const res = await fetch(`epub://${id}/media/flow.png`)
    return { status: res.status, type: res.headers.get('content-type') ?? '' }
  }, bookId)
  expect(image.status).toBe(200)
  expect(image.type).toContain('image/png')

  await app.close()
})
