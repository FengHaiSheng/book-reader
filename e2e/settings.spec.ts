import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import { launchApp, launchAppWithUserData } from './helpers'

/** close 容错：进程可能已在本体内被关闭或提前退出，避免 finally 覆盖真实失败原因 */
async function closeQuietly(app: ElectronApplication | undefined): Promise<void> {
  try {
    await app?.close()
  } catch {
    // 忽略关闭阶段错误
  }
}

test('设置写入后重启进程仍然存在', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-settings-'))

  const first = await launchAppWithUserData(userDataDir)
  try {
    const firstWin = await first.firstWindow()
    await firstWin.evaluate(() => (window as any).api.settings.set('prefs', '{"charsPerLine":42}'))
  } finally {
    await first.close()
  }

  const second = await launchAppWithUserData(userDataDir)
  try {
    const secondWin = await second.firstWindow()
    const value = await secondWin.evaluate(async () => {
      const all = await (window as any).api.settings.getAll()
      return all.prefs
    })
    expect(value).toBe('{"charsPerLine":42}')
  } finally {
    await second.close()
  }
})

test('设置页能改每行字数并落库，且密钥以脱敏形态展示', async () => {
  let app: ElectronApplication | undefined
  try {
    app = await launchApp()
    const win = await app.firstWindow()

    await win.getByRole('button', { name: '设置' }).click()
    await win.getByLabel('每行字数').fill('40')

    const stored = await win.evaluate(async () => {
      const all = await (window as any).api.settings.getAll()
      return JSON.parse(all.prefs).charsPerLine
    })
    expect(stored).toBe(40)

    await win.evaluate(() => (window as any).api.secrets.set('deepseek', 'sk-testtesttesttest3f7a'))
    await win.getByRole('button', { name: '暗色' }).click()
    await win.reload()
    await expect
      .poll(() => win.evaluate(() => document.documentElement.dataset.theme))
      .toBe('dark')
    await win.getByRole('button', { name: '设置' }).click()
    await expect(win.getByText('sk-••••••••3f7a')).toBeVisible()
  } finally {
    await closeQuietly(app)
  }
})

/**
 * 统计这一组要经得起两件容易搞错的事：① 一天没读过时不能摆一排「0 分钟」（看起来像坏了）；
 * ② 年历是五十三列，格子数必须够铺满一年，别因为少一天就整月错位。
 */
test('设置页有阅读统计：空态不摆 0，年历铺满一年，记上之后数字上升', async () => {
  const app = await launchApp()
  try {
    const win = await app.firstWindow()
    await win.getByRole('button', { name: '设置' }).click()

    const group = win.locator('.settings__group:has-text("阅读统计")')
    await expect(group).toBeVisible()
    // 还没有任何记录：先给一句话，而不是三个 0
    await expect(group.locator('.settings__hint').first()).toContainText('还没有数据')
    // 一列一周、周一起头：53 周 × 7 = 371 格
    expect(await win.locator('.stats__cell').count()).toBeGreaterThan(300)
    // 口径要写在界面上，否则「读着读着停表了」会被当成 bug
    await expect(group).toContainText('连续 5 分钟内有操作')

    // 记一笔（走真实 IPC 与 sqlite），「今日」应当变成 10 分钟
    await win.evaluate(() => (window as any).api.reading.addSeconds(600))
    await win.reload()
    await win.getByRole('button', { name: '设置' }).click()
    await expect(win.locator('.stats__num').first()).toHaveText('10 分钟')
  } finally {
    await closeQuietly(app)
  }
})
