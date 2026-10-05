import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { coverBookFiles, novelFiles, writeEpub } from '../fixtures/make-epub'
import { launchAppWithUserData } from './helpers'

test('标签：侧栏筛选、列表显示、指派浮层、管理面板改名与删除', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-tags-ui-'))
  const novel = join(userDataDir, 'novel.epub')
  const other = join(userDataDir, 'other.epub')
  await writeEpub(novel, novelFiles())
  await writeEpub(other, coverBookFiles())

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()

  const outcomes = await win.evaluate(
    (paths: string[]) => (window as any).api.library.importPaths(paths),
    [novel, other]
  )
  const firstBook = outcomes[0].bookId as string
  await win.reload()

  await expect(win.locator('.sidebar__hint')).toHaveText('还没有标签')

  // 通过管理面板建一个标签
  await win.getByRole('button', { name: '标签', exact: true }).click()
  await win.locator('.tag-manager__new input').fill('待读')
  await win.getByRole('button', { name: '新建' }).click()
  await expect(win.locator('.tag-manager__row')).toHaveCount(1)
  await expect(win.locator('.tag-item')).toHaveCount(2) // 「全部」+ 「待读」

  // 指派给第一本书
  await win.getByRole('button', { name: '列表' }).click()
  await expect(win.locator('.book-list__item')).toHaveCount(2)
  await win.locator('.book-list__item').first().getByRole('button', { name: '＋标签' }).click()
  await win.locator('.tag-picker__row input[type=checkbox]').first().check()
  await expect(win.locator('.book-list__item').first().locator('.tag-chip')).toHaveText('待读')

  await expect(win.locator('.tag-item', { hasText: '待读' }).locator('.tag-item__count')).toHaveText('1')

  // 取消指派
  await win.locator('.book-list__item').first().getByRole('button', { name: '＋标签' }).click()
  await win.locator('.tag-picker__row input[type=checkbox]').first().uncheck()
  await expect(win.locator('.book-list__item').first().locator('.tag-chip')).toHaveCount(0)

  // 重新打上，再验侧栏筛选
  await win.locator('.book-list__item').first().getByRole('button', { name: '＋标签' }).click()
  await win.locator('.tag-picker__row input[type=checkbox]').first().check()
  await win.getByRole('button', { name: '收起' }).click()

  await win.locator('.tag-item', { hasText: '待读' }).click()
  await expect(win.locator('.book-list__item')).toHaveCount(1)

  // 在筛选态下删掉标签：筛选要退回「全部」，书一本都不能少
  await win.locator('.tag-manager__row').waitFor({ state: 'detached' }).catch(() => undefined)
  win.on('dialog', (dialog) => void dialog.accept())
  await win.getByRole('button', { name: '标签', exact: true }).click()
  await win.locator('.tag-manager__row').getByRole('button', { name: '删除' }).click()

  await expect(win.locator('.tag-item')).toHaveCount(1) // 只剩「全部」
  await expect(win.locator('.book-list__item')).toHaveCount(2)
  expect(await win.evaluate(() => (window as any).api.library.list())).toHaveLength(2)

  await app.close()
})
