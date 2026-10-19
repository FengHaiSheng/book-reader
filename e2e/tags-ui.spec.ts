import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { coverBookFiles, novelFiles, writeEpub } from '../fixtures/make-epub'
import { launchAppWithUserData } from './helpers'

test('标签：网格卡片与列表的指派、侧栏筛选、管理模态框改名与删除', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-tags-ui-'))
  const novel = join(userDataDir, 'novel.epub')
  const other = join(userDataDir, 'other.epub')
  await writeEpub(novel, novelFiles())
  await writeEpub(other, coverBookFiles())

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()

  await win.evaluate(
    (paths: string[]) => (window as any).api.library.importPaths(paths),
    [novel, other]
  )
  await win.reload()

  await expect(win.locator('.sidebar__hint')).toHaveText('还没有标签')

  const closeModal = win.getByRole('button', { name: '关闭', exact: true })

  // 管理模态框里建一个标签
  await win.getByRole('button', { name: '标签', exact: true }).click()
  await expect(win.locator('.modal__title')).toHaveText('标签')
  await win.locator('.tag-manager__new input').fill('待读')
  await win.getByRole('button', { name: '新建' }).click()
  const managed = win.locator('.tag-manager__row')
  await expect(managed).toHaveCount(1)
  await expect(win.locator('.tag-item')).toHaveCount(2) // 「全部」+「待读」

  // 平时是一行字，点一下才变成输入框；Esc 放弃不落库
  await managed.locator('.tag-manager__name').click()
  await win.locator('.tag-manager__rename').fill('临时')
  await win.keyboard.press('Escape')
  await expect(managed.locator('.tag-manager__name')).toHaveText('待读')

  // 回车提交改名，改完回到「一行字」
  await managed.locator('.tag-manager__name').click()
  await win.locator('.tag-manager__rename').fill('想读')
  await win.keyboard.press('Enter')
  await expect(managed.locator('.tag-manager__name')).toHaveText('想读')
  await managed.locator('.tag-manager__name').click()
  await win.locator('.tag-manager__rename').fill('待读')
  await win.keyboard.press('Enter')
  await expect(managed.locator('.tag-manager__name')).toHaveText('待读')

  await closeModal.click()
  await expect(win.locator('.modal')).toHaveCount(0)

  // 网格卡片上就能指派：chip 当场出现在卡面上
  const firstCard = win.locator('.book-grid__cell').first()
  await firstCard.getByRole('button', { name: '＋标签' }).click()
  await expect(win.locator('.modal__title')).toContainText('的标签')
  await win.locator('.tag-picker__row input[type=checkbox]').first().check()
  await expect(firstCard.locator('.tag-chip')).toHaveText('待读')
  await closeModal.click()

  await expect(win.locator('.tag-item', { hasText: '待读' }).locator('.tag-item__count')).toHaveText('1')

  // 列表视图里 chip 与指派入口都在
  await win.getByRole('button', { name: '列表' }).click()
  await expect(win.locator('.book-list__item')).toHaveCount(2)
  const firstRow = win.locator('.book-list__item').first()
  await expect(firstRow.locator('.tag-chip')).toHaveText('待读')

  // 取消指派再打上：指派不要求关掉模态框，Esc 也能关
  await firstRow.getByRole('button', { name: '＋标签' }).click()
  await win.locator('.tag-picker__row input[type=checkbox]').first().uncheck()
  await expect(firstRow.locator('.tag-chip')).toHaveCount(0)
  await win.locator('.tag-picker__row input[type=checkbox]').first().check()
  await expect(firstRow.locator('.tag-chip')).toHaveText('待读')
  await win.keyboard.press('Escape')
  await expect(win.locator('.modal')).toHaveCount(0)

  // 侧栏筛选
  await win.locator('.tag-item', { hasText: '待读' }).click()
  await expect(win.locator('.book-list__item')).toHaveCount(1)

  // 在筛选态下删掉标签：筛选要退回「全部」，书一本都不能少
  // 删除是两次点击（先「删除」再「确定删除」），不走原生 confirm
  await win.getByRole('button', { name: '标签', exact: true }).click()
  const row = win.locator('.tag-manager__row')
  await row.hover()
  await row.getByRole('button', { name: '删除', exact: true }).click()
  await row.getByRole('button', { name: '确定删除', exact: true }).click()

  // 筛选退回「全部」会让模态框跟着收起（见 LibraryPage 的 effect）
  await expect(win.locator('.modal')).toHaveCount(0)
  await expect(win.locator('.tag-item')).toHaveCount(1) // 只剩「全部」
  await expect(win.locator('.book-list__item')).toHaveCount(2)
  expect(await win.evaluate(() => (window as any).api.library.list())).toHaveLength(2)

  await app.close()
})
