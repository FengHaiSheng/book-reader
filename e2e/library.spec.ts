import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { coverBookFiles, novelFiles, writeEpub } from '../fixtures/make-epub'
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