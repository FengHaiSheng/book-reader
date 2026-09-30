import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication } from 'playwright'

/**
 * 每次启动都用一个全新的临时 userData 目录，保证测试之间互不污染，
 * 也保证不会碰到开发者本机的真实书库。
 */
export async function launchApp(): Promise<ElectronApplication> {
  return launchAppWithUserData(mkdtempSync(join(tmpdir(), 'book-read-e2e-')))
}

/** 指定目录启动，用于验证「重启后仍然存在」这类需要跨进程持久化的行为 */
export async function launchAppWithUserData(userDataDir: string): Promise<ElectronApplication> {
  return electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    env: { ...process.env, NODE_ENV: 'test' }
  })
}
