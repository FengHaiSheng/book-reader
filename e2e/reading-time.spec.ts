import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { longBookFiles, writeEpub } from '../fixtures/make-epub'
import { aiCallCount, installAiStub, launchAppWithUserData } from './helpers'

async function openFirstBook(win: import('playwright').Page): Promise<void> {
  await win.getByRole('button', { name: '列表' }).click()
  await win.getByRole('button', { name: '打开' }).click()
}

async function waitForChapterLoaded(win: import('playwright').Page): Promise<void> {
  await win.waitForFunction(() => {
    const frame = document.querySelector('iframe.reader__view') as HTMLIFrameElement | null
    return frame?.contentDocument?.getElementById('reader-theme') != null
  })
}

/** 今日累计秒数，直接问主进程（读到的是真实 sqlite 里的数） */
async function todaySeconds(win: import('playwright').Page): Promise<number> {
  return win.evaluate(async () => (await (window as any).api.reading.stats()).today as number)
}

/**
 * 读一段、退出、结算。
 *
 * 退出时 `exit()` 会补一次 flush，所以「返回书架」之后库里就应该有数了 ——
 * 上报是异步 IPC，用 poll 等它落库，不等固定时长。
 */
async function readAndLeave(win: import('playwright').Page, ms: number): Promise<void> {
  await openFirstBook(win)
  await expect(win.locator('.reader__chapter')).toHaveText('第一章 河边')
  await waitForChapterLoaded(win)
  // 按键既是翻页也是「有操作」的信号（超过 5 分钟不动会停表）
  await win.keyboard.press('ArrowRight')
  await win.waitForTimeout(ms)
  await win.getByRole('button', { name: '返回书架' }).click()
  await expect(win.locator('.reader')).toBeHidden()
}

test('阅读时长：退出时结算，两段阅读累加而不是覆盖，全程零 AI 调用', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-time-'))
  const epubPath = join(userDataDir, 'long.epub')
  await writeEpub(epubPath, longBookFiles())

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()
  // 计时口径要「有焦点」：把窗口提到前面，避免后台窗口把这段时间白记成 0
  await win.bringToFront()
  // 装上桩：任何一次 chat / embeddings 都会被记数，「零 AI」才有证据
  await installAiStub(app)

  await win.evaluate(async (file) => (window as any).api.library.importPath(file), epubPath)
  await win.reload()

  // 两段各读 3 秒就够：结算用的是「上次心跳到现在」的实际间隔，不依赖 5 秒心跳正好走过
  await readAndLeave(win, 3000)
  await expect.poll(() => todaySeconds(win)).toBeGreaterThanOrEqual(2)
  const first = await todaySeconds(win)

  await readAndLeave(win, 3000)
  // 累加写：第二段记进去之后，今日是两段之和；若写成覆盖，这里只会是第二段那 3 秒
  await expect.poll(() => todaySeconds(win)).toBeGreaterThanOrEqual(first + 2)

  // 零 AI 证据：这条通道一个字都没发给模型
  const calls = await aiCallCount(app)
  expect(calls.chat).toBe(0)
  expect(calls.embed).toBe(0)

  await app.close()
})
