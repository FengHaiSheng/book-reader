import type { TtsVoice } from '@shared/types'
import { pickVoice, speechErrorMessage, speechSupported } from '../speech'
import { clampRate, type SpeechEngine, type TtsSpeakHandlers, type TtsSpeakOptions } from './types'

/**
 * 系统语音（Web Speech API）。
 *
 * 合成与播放都由 Chromium 接管，没有可缓存的音频字节；预合成因此是空操作。
 * 每次 speak 都拿一个新的 token，cancel 之后旧 utterance 补发的 onend / onerror 全部丢弃。
 */
export class SystemSpeechEngine implements SpeechEngine {
  readonly id = 'system' as const
  private token = 0

  get available(): boolean {
    return speechSupported()
  }

  async listVoices(): Promise<TtsVoice[]> {
    const api = window.speechSynthesis
    if (!api) return []

    const read = (): TtsVoice[] =>
      api.getVoices().map((voice) => ({
        id: voice.voiceURI,
        name: voice.name,
        lang: voice.lang
      }))

    const now = read()
    if (now.length > 0) return now

    // macOS 上 getVoices 常常第一次是空数组，等 voiceschanged 或超时
    return new Promise((resolve) => {
      let settled = false
      const finish = (): void => {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        api.removeEventListener('voiceschanged', onChange)
        resolve(read())
      }
      const onChange = (): void => {
        if (api.getVoices().length > 0) finish()
      }
      const timer = window.setTimeout(finish, 1500)
      api.addEventListener('voiceschanged', onChange)
    })
  }

  speak(text: string, options: TtsSpeakOptions, handlers: TtsSpeakHandlers): void {
    const api = window.speechSynthesis
    if (!api) {
      handlers.onerror('当前环境没有系统朗读能力。')
      return
    }

    const token = ++this.token
    const utterance = new SpeechSynthesisUtterance(text)
    const voice = pickVoice(api.getVoices(), options.voice)
    if (voice) utterance.voice = voice
    utterance.rate = clampRate(options.rate)
    utterance.pitch = 1
    utterance.lang = voice?.lang ?? 'zh-CN'

    utterance.onstart = (): void => {
      if (token === this.token) handlers.onstart?.()
    }
    utterance.onend = (): void => {
      if (token !== this.token) return
      // 先让 token 失效，handlers.onend 往往会立刻开始下一句
      this.token += 1
      handlers.onend()
    }
    utterance.onerror = (event): void => {
      if (token !== this.token) return
      if (event.error === 'canceled' || event.error === 'interrupted') return
      this.token += 1
      handlers.onerror(speechErrorMessage(event.error))
    }

    api.speak(utterance)
  }

  prefetch(): void {
    // Web Speech 不暴露音频，没有可预合成的东西
  }

  pause(): void {
    window.speechSynthesis?.pause()
  }

  resume(): void {
    window.speechSynthesis?.resume()
  }

  cancel(): void {
    this.token += 1
    window.speechSynthesis?.cancel()
  }

  destroy(): void {
    this.cancel()
  }
}
