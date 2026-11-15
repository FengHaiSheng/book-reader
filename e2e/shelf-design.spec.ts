import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { nestedTocFiles, novelFiles, writeEpub } from '../fixtures/make-epub'
import { launchAppWithUserData } from './helpers'

test('书库状态筛选、搜索与排序', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-shelf-design-'))
  // 两本书标题不同，搜索才有东西可筛（否则两本同名会一起命中）
  const novel = join(userDataDir, 'novel.epub')
  const manual = join(userDataDir, 'manual.epub')
  await writeEpub(novel, novelFiles()) // 《河边的月亮》
  await writeEpub(manual, nestedTocFiles()) // 《深入理解定位》

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()

  await win.evaluate(
    (paths: string[]) => (window as any).api.library.importPaths(paths),
    [novel, manual]
  )
  await win.reload()

  // 侧栏出现「书库」分区，两本都是未开始，计数对得上
  await expect(win.locator('.sidebar__section', { hasText: '书库' })).toBeVisible()
  await expect(
    win.locator('.side-item', { hasText: '全部' }).locator('.side-item__count')
  ).toHaveText('2')
  const unread = win.locator('.side-item', { hasText: '未开始' })
  await expect(unread.locator('.side-item__count')).toHaveText('2')

  // 点「未开始」：两本都在，网格 2 本 + 拖放终点
  await unread.click()
  await expect(win.locator('.stage__title')).toHaveText('未开始')
  await expect(win.locator('.book-grid__cell')).toHaveCount(3)

  // 搜索「定位」只剩一本
  await win.locator('.search__input').fill('定位')
  await expect(win.locator('.stage__count')).toHaveText('1 本')
  await expect(win.locator('.book-grid__cell')).toHaveCount(2)
  await win.locator('.search__input').fill('')
  await expect(win.locator('.book-grid__cell')).toHaveCount(3)

  // 排序切换不报错，列表仍在
  await win.locator('.sort__select').selectOption('title')
  await expect(win.locator('.book-grid__cell')).toHaveCount(3)
  await win.locator('.sort__select').selectOption('added')
  await expect(win.locator('.book-grid__cell')).toHaveCount(3)
  await win.locator('.sort__select').selectOption('progress')
  await expect(win.locator('.book-grid__cell')).toHaveCount(3)
  await win.locator('.sort__select').selectOption('recent')
  await expect(win.locator('.book-grid__cell')).toHaveCount(3)

  await app.close()
})

test('空书库显示引导与两个导入入口', async () => {
  const app = await launchAppWithUserData(mkdtempSync(join(tmpdir(), 'book-read-shelf-empty-')))
  const win = await app.firstWindow()

  await expect(win.locator('.empty__t')).toHaveText('书架还是空的')
  await expect(win.getByRole('button', { name: '选择文件…' })).toBeVisible()
  await expect(win.getByRole('button', { name: '从文件夹导入' })).toBeVisible()

  await app.close()
})

test('网格悬停 CTA 可点：继续阅读打开书', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-shelf-cta-'))
  const novel = join(userDataDir, 'novel.epub')
  await writeEpub(novel, novelFiles())

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()

  const imported = await win.evaluate(
    (file: string) => (window as any).api.library.importPath(file),
    novel
  )
  await win.evaluate(
    (id: string) =>
      (window as any).api.reader.saveProgress({
        bookId: id,
        cfi: 'epubcfi(/6/2!/4/2/1:0)',
        chapterId: 1,
        percent: 0.4
      }),
    imported.bookId as string
  )
  await win.reload()

  const card = win.locator('.book-grid__cell').first()
  await card.hover()
  const cta = card.getByRole('button', { name: '继续阅读' })
  await expect(cta).toBeVisible()
  await cta.click()
  await expect(win.locator('.reader')).toBeVisible()

  await app.close()
})

test('网格卡片高度一致：有无标签与进度不改变卡片高度', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-shelf-card-height-'))
  const novel = join(userDataDir, 'novel.epub')
  const manual = join(userDataDir, 'manual.epub')
  await writeEpub(novel, novelFiles())
  await writeEpub(manual, nestedTocFiles())

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()

  const imported = await win.evaluate(
    (paths: string[]) => (window as any).api.library.importPaths(paths),
    [novel, manual]
  )
  const bookIds = (imported as { bookId: string }[])
    .filter((item) => item.bookId)
    .map((item) => item.bookId)
  await win.evaluate(
    (id: string) =>
      (window as any).api.reader.saveProgress({
        bookId: id,
        cfi: 'epubcfi(/6/2!/4/2/1:0)',
        chapterId: 1,
        percent: 0.4
      }),
    bookIds[0]
  )
  const tag = await win.evaluate(() => (window as any).api.library.tagCreate('待读'))
  await win.evaluate(
    ({ bookId, tagId }: { bookId: string; tagId: number }) =>
      (window as any).api.library.tagAssign(bookId, tagId, true),
    { bookId: bookIds[0], tagId: tag.id as number }
  )
  await win.reload()

  await expect(win.locator('.book-card')).toHaveCount(2)
  await expect(win.locator('.book-card .tag-chip')).toHaveCount(1)
  await expect(win.locator('.book-card__ring')).toHaveCount(1)
  await expect(win.locator('.book-card__ring-num')).toHaveText('40')
  await expect(win.locator('.book-card__prog')).toHaveCount(0)

  const heights = await win.locator('.book-card').evaluateAll((cards) =>
    cards.map((card) => Math.round(card.getBoundingClientRect().height))
  )
  expect(heights).toHaveLength(2)
  expect(heights[0]).toBe(heights[1])

  await app.close()
})