import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { novelFiles, writeEpub } from '../fixtures/make-epub'
import { launchAppWithUserData } from './helpers'

/**
 * 把系统朗读换成一个确定性桩：真的调用语音合成会让 e2e 依赖这台电脑装了哪些声音，
 * 而且没人能断言读到第几个字。这里只验证「界面把正文交给了语音引擎」这一条链路。
 */
async function installSpeechStub(app: Awaited<ReturnType<typeof launchAppWithUserData>>): Promise<void> {
  const win = await app.firstWindow()
  await win.addInitScript(() => {
    const spoken: string[] = []
    const scope = window as unknown as { __spoken: string[] }
    scope.__spoken = spoken

    class FakeUtterance {
      text: string
      voice: unknown = null
      rate = 1
      pitch = 1
      lang = ''
      onstart: (() => void) | null = null
      onend: (() => void) | null = null
      onerror: ((event: { error: string }) => void) | null = null
      constructor(text: string) {
        this.text = text
      }
    }

    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      value: FakeUtterance,
      configurable: true
    })
    Object.defineProperty(window, 'speechSynthesis', {
      value: {
        speaking: false,
        paused: false,
        pending: false,
        getVoices: () => [
          { voiceURI: 'test-voice', name: '测试语音', lang: 'zh-CN', default: true }
        ],
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        cancel: () => undefined,
        pause: () => undefined,
        resume: () => undefined,
        // 不自动 onend：测试要能稳定停在第一句上；onstart 要发，翻页与高亮才走得到
        speak: (utterance: FakeUtterance) => {
          spoken.push(utterance.text)
          utterance.onstart?.()
        }
      },
      configurable: true
    })
  })
}

test('朗读：从当前页开始、标出正在读的句子，并记住声音与语速', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-speech-'))
  const epubPath = join(userDataDir, 'novel.epub')
  await writeEpub(epubPath, novelFiles())

  const app = await launchAppWithUserData(userDataDir)
  await installSpeechStub(app)
  const win = await app.firstWindow()

  await win.evaluate((file) => (window as any).api.library.importPath(file), epubPath)
  // 导入走 API，书架不会自己刷新
  await win.reload()

  await win.getByRole('button', { name: '列表' }).click()
  await win.getByRole('button', { name: '打开' }).click()
  await win.waitForFunction(() => {
    const frame = document.querySelector('iframe.reader__view') as HTMLIFrameElement | null
    return frame?.contentDocument?.getElementById('reader-theme') != null
  })

  await win.getByRole('button', { name: '朗读' }).click()

  // 正文真的交给了语音引擎，而不是只改了个按钮文案
  await expect
    .poll(() => win.evaluate(() => (window as any).__spoken?.[0] ?? ''))
    .toContain('月色沉入河底')

  // 正在读的那一句用独立注册名标出来，不影响用户的四色标注
  await expect
    .poll(() =>
      win.evaluate(() => {
        const frame = document.querySelector('iframe.reader__view') as HTMLIFrameElement
        const css = (frame.contentWindow as any)?.CSS
        return Boolean(css?.highlights?.has('read-aloud'))
      })
    )
    .toBe(true)

  // 暂停 / 继续 / 停止三档都能走通
  await win.getByRole('button', { name: '暂停' }).click()
  await expect(win.getByRole('button', { name: '继续' })).toBeVisible()
  await win.getByRole('button', { name: '继续' }).click()
  await expect(win.getByRole('button', { name: '暂停' })).toBeVisible()
  await win.getByRole('button', { name: '停止' }).click()
  await expect(win.getByRole('button', { name: '朗读' })).toBeVisible()

  // 声音面板里的选择落到偏好里，下次打开还是它
  await win.getByRole('button', { name: '声音' }).click()
  await win.locator('#tts-voice').selectOption('test-voice')
  // range 控件不能用 fill；聚焦后按四次右箭头，1.0 → 1.4
  const rate = win.locator('#tts-rate')
  await rate.focus()
  for (let step = 0; step < 4; step += 1) await rate.press('ArrowRight')
  await expect
    .poll(async () => (await win.evaluate(() => (window as any).api.settings.getPrefs())).ttsVoice)
    .toBe('test-voice')
  await expect
    .poll(async () => (await win.evaluate(() => (window as any).api.settings.getPrefs())).ttsRate)
    .toBe(1.4)

  await app.close()
})
