import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { writePdf } from '../fixtures/make-pdf'
import { launchAppWithUserData } from './helpers'

/** 每页第一行是重复页眉（应被剔除），第二行是该页独有正文 */
function samplePages(count: number): string[][] {
  return Array.from({ length: count }, (_, index) => [
    'Running header',
    `Alpha content ${String.fromCharCode(65 + index)}`
  ])
}

test('导入 PDF：抽文字重排、按页分章、可搜索、阅读器能打开', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-pdf-'))
  const pdfPath = join(userDataDir, 'manual.pdf')
  writePdf(pdfPath, samplePages(12))

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()

  const imported = await win.evaluate(
    (file) => (window as any).api.library.importPath(file),
    pdfPath
  )
  expect(imported.status).toBe('imported')
  // PDF 没有标题元数据时用文件名兜底
  expect(imported.title).toBe('manual')
  const bookId = imported.bookId as string

  const chapters = await win.evaluate(
    (id) => (window as any).api.library.chapters(id),
    bookId
  )
  expect(chapters.map((chapter: { title: string }) => chapter.title)).toEqual([
    '第 1–10 页',
    '第 11–12 页'
  ])
  expect(chapters[0].href).toBe('pdf/00001.html')

  // 页眉不该进正文，页面独有的句子要能搜到
  const hits = await win.evaluate(
    (id) => (window as any).api.library.search(id, 'Alpha', 20),
    bookId
  )
  expect(hits.length).toBeGreaterThan(0)
  expect(hits[0].text).toContain('Alpha content')
  expect(hits.some((hit: { text: string }) => hit.text.includes('Running header'))).toBe(false)

  // 重复导入同一文件应当被 sha256 去重
  const again = await win.evaluate(
    (file) => (window as any).api.library.importPath(file),
    pdfPath
  )
  expect(again.status).toBe('duplicate')

  await win.reload()
  await win.getByRole('button', { name: '列表' }).click()
  await win.getByRole('button', { name: '打开' }).click()
  await expect(win.locator('.reader__chapter')).toHaveText('第 1–10 页')

  // 生成的章节 HTML 走 epub:// 协议读回，真正渲染进 iframe 才算打通
  await win.waitForFunction(() => {
    const frame = document.querySelector('iframe.reader__view') as HTMLIFrameElement | null
    return frame?.contentDocument?.getElementById('reader-theme') != null
  })
  const text = await win.evaluate(() => {
    const frame = document.querySelector('iframe.reader__view') as HTMLIFrameElement
    return frame.contentDocument?.body.textContent ?? ''
  })
  expect(text).toContain('Alpha content A')
  expect(text).not.toContain('Running header')

  await app.close()
})
