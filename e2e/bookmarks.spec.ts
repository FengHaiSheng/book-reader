import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { longBookFiles, writeEpub } from '../fixtures/make-epub'
import { launchAppWithUserData } from './helpers'

/** 书架默认是网格视图，切到列表再点「打开」，与既有阅读器用例保持同一条路径 */
async function openFirstBook(win: import('playwright').Page): Promise<void> {
  await win.getByRole('button', { name: '列表' }).click()
  await win.getByRole('button', { name: '打开' }).click()
}

/** 章节文档真正载入（取回 XHTML、加工、注入 #reader-theme 都是异步的） */
async function waitForChapterLoaded(win: import('playwright').Page): Promise<void> {
  await win.waitForFunction(() => {
    const frame = document.querySelector('iframe.reader__view') as HTMLIFrameElement | null
    return frame?.contentDocument?.getElementById('reader-theme') != null
  })
}

/** 从工具条上的「1 / 12」里读出总页数 */
async function readPageCount(win: import('playwright').Page): Promise<number> {
  const text = await win.locator('.reader__page').innerText()
  return Number(text.split('/')[1]!.trim())
}

/**
 * 书签与高亮是两件事：高亮标的是「这段文字」，书签标的是「这个位置」。
 *
 * 定位页签不能用 `getByRole('button', { name: '书签' })` —— 页签的文案「书签」与
 * 写入按钮「加书签」/「取消本页书签」都含这两个字，按名字查会一次命中多个元素。
 */
test('书签：加、判重不增、跳回、删，重启后仍在', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-marks-'))
  const epubPath = join(userDataDir, 'long.epub')
  await writeEpub(epubPath, longBookFiles())

  let app = await launchAppWithUserData(userDataDir)
  let win = await app.firstWindow()

  const bookId = await win.evaluate(
    async (file) => (await (window as any).api.library.importPath(file)).bookId as string,
    epubPath
  )
  await win.reload()
  await openFirstBook(win)
  await expect(win.locator('.reader__chapter')).toHaveText('第一章 河边')
  await waitForChapterLoaded(win)

  // 书签页签初始是空的，写入按钮写着「加书签」
  await win.locator('.toc__tab', { hasText: '书签' }).click()
  await expect(win.locator('.marks__empty')).toBeVisible()
  await expect(win.getByRole('button', { name: '加书签' })).toBeVisible()

  await win.getByRole('button', { name: '加书签' }).click()
  await expect(win.locator('.marks__item')).toHaveCount(1)
  // 当前这一页已有书签：同一个按钮必须换成「取消本页书签」，否则用户会以为点了没反应
  await expect(win.getByRole('button', { name: '取消本页书签' })).toBeVisible()

  // 判重不增：同一页（同一 CFI）再写一次，库层唯一键挡住，只回 created: false
  const marks = await win.evaluate((id) => (window as any).api.bookmarks.list(id), bookId)
  expect(marks).toHaveLength(1)
  const duplicate = await win.evaluate(
    (input) => (window as any).api.bookmarks.add(input),
    {
      bookId,
      chapterId: marks[0].chapterId,
      cfi: marks[0].cfi,
      excerpt: marks[0].excerpt,
      percent: marks[0].percent
    }
  )
  expect(duplicate.created).toBe(false)
  expect(await win.evaluate((id) => (window as any).api.bookmarks.list(id), bookId)).toHaveLength(1)

  // 换到第 2 页再加一条
  await win.locator('.toc__tab', { hasText: '目录' }).click()
  await win.getByRole('button', { name: '下一页' }).click()
  const total = await readPageCount(win)
  await expect(win.locator('.reader__page')).toHaveText(`2 / ${total}`)

  await win.locator('.toc__tab', { hasText: '书签' }).click()
  await win.getByRole('button', { name: '加书签' }).click()
  await expect(win.locator('.marks__item')).toHaveCount(2)

  // 跳回：当前页（第 2 页）那条带 --here，点另一条应该回到第 1 页
  await win.locator('.marks__item:not(.marks__item--here)').click()
  await expect(win.locator('.reader__page')).toHaveText(`1 / ${total}`)
  await expect(win.getByRole('button', { name: '取消本页书签' })).toBeVisible()

  // 删：删的是当前页那一条，列表少一条
  await win.getByRole('button', { name: '取消本页书签' }).click()
  await expect(win.locator('.marks__item')).toHaveCount(1)

  await app.close()

  // 重启：书签存在 sqlite 里，与书一起持久化
  app = await launchAppWithUserData(userDataDir)
  win = await app.firstWindow()
  await openFirstBook(win)
  await expect(win.locator('.reader__chapter')).toHaveText('第一章 河边')
  await win.locator('.toc__tab', { hasText: '书签' }).click()
  await expect(win.locator('.marks__item')).toHaveCount(1)

  await app.close()
})
