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