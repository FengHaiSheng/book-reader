import { expect, test } from '@playwright/test'
import { launchApp } from './helpers'

/**
 * 学习脉络空态：侧栏能进，目标输入和「生成脉络」都在。
 * 不点生成，避免走进确认框和模型调用。
 */
test('侧栏可进脉络空态，含目标输入与生成脉络', async () => {
  const app = await launchApp()
  try {
    const win = await app.firstWindow()
    const nav = win.getByRole('navigation', { name: '主导航' })

    await expect(nav.getByRole('button', { name: '脉络' })).toBeVisible()
    await nav.getByRole('button', { name: '脉络' }).click()

    await expect(win.getByRole('heading', { name: '学习脉络' })).toBeVisible()
    await expect(win.getByLabel('学习目标')).toBeVisible()
    await expect(win.getByRole('button', { name: '生成脉络' })).toBeVisible()
    await expect(win.locator('.track-empty__note')).toContainText('不推荐外链')
  } finally {
    await app.close()
  }
})
