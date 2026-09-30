import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import { launchAppWithUserData } from './helpers'

/** close 容错：进程可能已在本体内被关闭或提前退出，避免 finally 覆盖真实失败原因 */
async function closeQuietly(app: ElectronApplication | undefined): Promise<void> {
  try {
    await app?.close()
  } catch {
    // 忽略关闭阶段错误
  }
}

test('密钥加密落盘，重启后仍可读，且只以脱敏形态暴露给渲染进程', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-secrets-'))
  const PLAIN = 'sk-testtesttesttest3f7a'

  let first: ElectronApplication | undefined
  let second: ElectronApplication | undefined
  try {
    first = await launchAppWithUserData(userDataDir)
    const firstWin = await first.firstWindow()
    await firstWin.evaluate((key) => (window as any).api.secrets.set('deepseek', key), PLAIN)

    const statusAfterSet = await firstWin.evaluate(() => (window as any).api.secrets.status())
    expect(statusAfterSet.providers.deepseek).toBe('sk-••••••••3f7a')
    expect(JSON.stringify(statusAfterSet)).not.toContain(PLAIN)
    await first.close()

    second = await launchAppWithUserData(userDataDir)
    const secondWin = await second.firstWindow()
    const statusAfterRestart = await secondWin.evaluate(() => (window as any).api.secrets.status())
    expect(statusAfterRestart.providers.deepseek).toBe('sk-••••••••3f7a')
    await second.close()
  } finally {
    await closeQuietly(first)
    await closeQuietly(second)
  }
})

test('磁盘上的 secrets.json 不含明文', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-secrets-plain-'))
  const PLAIN = 'sk-plaintext-must-not-appear-3f7a'

  let app: ElectronApplication | undefined
  try {
    app = await launchAppWithUserData(userDataDir)
    const win = await app.firstWindow()
    await win.evaluate((key) => (window as any).api.secrets.set('kimi', key), PLAIN)
    await app.close()

    const onDisk = readFileSync(join(userDataDir, 'secrets.json'), 'utf8')
    expect(onDisk).not.toContain(PLAIN)
  } finally {
    await closeQuietly(app)
  }
})
