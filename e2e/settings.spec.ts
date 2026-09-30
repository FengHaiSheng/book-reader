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
