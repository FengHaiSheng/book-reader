import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { novelFiles, writeEpub } from '../fixtures/make-epub'
import { launchAppWithUserData } from './helpers'

test('专注模式：设置时长后隐藏界面，Esc 退出', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-focus-'))
  const epubPath = join(userDataDir, 'novel.epub')
  await writeEpub(epubPath, novelFiles())

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()
  await win.evaluate((file) => (window as any).api.library.importPath(file), epubPath)
  await win.reload()

  await win.getByRole('button', { name: '列表' }).click()
  await win.getByRole('button', { name: '打开' }).click()
  await expect(win.locator('.reader')).toBeVisible()

  // 不真的进系统全屏：全屏会占住开发机屏幕，而且 CI 未必给得起；
  // 这里只验证界面开关、倒计时与 Esc 退出这条链路。`fullscreenchange` 分支
  // 由「退出全屏即退出专注」的同一个 exitFocus 承担，不依赖真实全屏。
  await win.evaluate(() => {
    document.documentElement.requestFullscreen = () => Promise.resolve()
    document.exitFullscreen = () => Promise.resolve()
  })

  await win.getByRole('button', { name: '专注', exact: true }).click()
  await expect(win.getByRole('dialog', { name: '专注阅读' })).toBeVisible()
  await win.getByRole('button', { name: '15 分钟' }).click()
  await expect(win.locator('.focus-set__input')).toHaveValue('15')
  await win.getByRole('button', { name: '开始专注' }).click()

  await expect(win.locator('.reader__bar')).toBeHidden()
  await expect(win.getByRole('navigation', { name: '主导航' })).toHaveCount(0)
  await expect(win.locator('.focus-hud')).toHaveClass(/is-on/)
  await expect(win.locator('.focus-hud__time')).toHaveText(/^15:00$|^14:5\d$/)

  await win.keyboard.press('Escape')
  await expect(win.locator('.reader__bar')).toBeVisible()
  await expect(win.getByRole('navigation', { name: '主导航' })).toBeVisible()
  await expect(win.locator('.focus-hud')).toHaveCount(0)

  await app.close()
})
