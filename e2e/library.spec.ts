import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { aiBookFiles, coverBookFiles, nestedTocFiles, novelFiles, writeEpub } from '../fixtures/make-epub'
import { launchAppWithUserData } from './helpers'

test('网格/列表切换、封面真实渲染、视图选择重启后还在', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-shelf-'))
  const first = join(userDataDir, 'novel.epub')
  const second = join(userDataDir, 'cover.epub')
  await writeEpub(first, novelFiles())
  await writeEpub(second, coverBookFiles())

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()

  await win.evaluate(
    (paths: string[]) => (window as any).api.library.importPaths(paths),
    [first, second]
  )
  await win.reload()

  // 2 本书 + 末尾那个拖放终点
  await expect(win.locator('.book-grid__cell')).toHaveCount(3)
  const covers = win.locator('.book-cover__img')
  await expect(covers).toHaveCount(2)
  expect(await covers.first().getAttribute('src')).toMatch(/^epub:\/\/[0-9a-f-]{36}\/__cover$/)

  // 图真的解码出来了，而不是坏图
  await expect
    .poll(() => covers.first().evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0)

  await win.getByRole('button', { name: '列表' }).click()
  await expect(win.locator('.book-list__item')).toHaveCount(2)
  await expect(win.locator('.book-grid__cell')).toHaveCount(0)

  await win.getByRole('button', { name: '网格' }).click()
  await expect(win.locator('.book-grid__cell')).toHaveCount(3)

  await win.getByRole('button', { name: '列表' }).click()
  await expect(win.locator('.book-list__item')).toHaveCount(2)

  // 换进程重开：视图选择存在 settings 里，必须还在
  await app.close()
  const again = await launchAppWithUserData(userDataDir)
  const win2 = await again.firstWindow()
  await expect(win2.locator('.book-list__item')).toHaveCount(2)
  await again.close()
})

test('书架置顶：最多两本，置顶的排在前面', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-shelf-pin-'))
  const novel = join(userDataDir, 'novel.epub')
  const manual = join(userDataDir, 'manual.epub')
  const long = join(userDataDir, 'long.epub')
  await writeEpub(novel, novelFiles()) // 河边的月亮
  await writeEpub(manual, nestedTocFiles()) // 深入理解定位
  await writeEpub(long, aiBookFiles()) // 很长的一夜

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()

  await win.evaluate(
    (paths: string[]) => (window as any).api.library.importPaths(paths),
    [novel, manual, long]
  )
  await win.reload()

  const card = (title: string) =>
    win.locator('.book-grid__cell', { hasText: title })
  const pin = (title: string) => card(title).getByRole('button', { name: '置顶', exact: true })

  // 依次置顶两本：后置顶的排在更前面
  await card('河边的月亮').hover()
  await pin('河边的月亮').click()
  await expect(win.locator('.book-card__pin')).toHaveCount(1)
  // 卡片会跳到最前面；鼠标移开后悬停菜单必须收起，不能被按钮焦点钉住
  await win.mouse.move(4, 4)
  await expect(card('河边的月亮').locator('.book-card__hover')).toHaveCSS('opacity', '0')
  await card('深入理解定位').hover()
  await pin('深入理解定位').click()
  await expect(win.locator('.book-card__pin')).toHaveCount(2)
  await expect
    .poll(() => win.locator('.book-card__title').allTextContents())
    .toEqual(['深入理解定位', '河边的月亮', '很长的一夜'])

  // 第三本超出上限：不落库，状态行说明原因
  await card('很长的一夜').hover()
  await pin('很长的一夜').click()
  await expect(win.locator('.import__notice')).toContainText('最多置顶 2 本')
  await expect(win.locator('.book-card__pin')).toHaveCount(2)

  // 取消一本后，第三本可以置顶；置顶状态跨重启保留
  await card('河边的月亮').hover()
  await card('河边的月亮')
    .getByRole('button', { name: '取消置顶', exact: true })
    .click()
  await expect(win.locator('.book-card__pin')).toHaveCount(1)
  await card('很长的一夜').hover()
  await pin('很长的一夜').click()
  await expect(win.locator('.book-card__pin')).toHaveCount(2)
  await win.reload()
  await expect(win.locator('.book-card__pin')).toHaveCount(2)

  await app.close()
})

test('一次多本导入：重复的被跳过，状态行说清楚', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-shelf-multi-'))
  const novel = join(userDataDir, 'novel.epub')
  const other = join(userDataDir, 'other.epub')
  await writeEpub(novel, novelFiles())
  await writeEpub(other, coverBookFiles())

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()

  const outcomes = await win.evaluate(
    (paths: string[]) => (window as any).api.library.importPaths(paths),
    [novel, other, novel, join(userDataDir, 'missing.epub')].filter(
      (p) => !p.endsWith('missing.epub')
    )
  )
  expect(outcomes.map((item: { status: string }) => item.status)).toEqual([
    'imported',
    'imported',
    'duplicate'
  ])

  await win.reload()
  await expect(win.locator('.book-grid__cell')).toHaveCount(3)

  await app.close()
})