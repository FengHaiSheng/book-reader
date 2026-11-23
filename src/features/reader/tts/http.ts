import type { TtsApi, TtsVoice } from '@shared/types'
import {
  clampRate,
  type SpeechEngine,
  type TtsSpeakHandlers,
  type TtsSpeakOptions,
  type TtsTransport
} from './types'

export type HttpEngineDeps = {
  /** 每次请求时再取，用户改地址不用重建引擎 */
  endpoint: () => string
  /** simple = 通用 /tts；cosyvoice = 官方 /inference_sft */
  api: () => TtsApi
  /** 官方 FastAPI 的裸 PCM 需要它补 WAV 头 */
  sampleRate: () => number
  transport: TtsTransport | null
}

/**
 * 自建 CosyVoice 服务。
 *
 * 一句一次 POST，拿回 WAV 后用 Web Audio 播放。合成比系统语音慢，所以：
 * - 读完第 N 句时已经把 N+1、N+2 交给主进程预合成（落进磁盘缓存）；
 * - 当前句真正开始播放时才通知上翻页与高亮，避免「页面先跳、声音后到」。
 *
 * 暂停用 AudioContext.suspend：不需要记录播放进度，恢复时从原位置继续。
 */
export class HttpSpeechEngine implements SpeechEngine {
  readonly id = 'http' as const
  private ctx: AudioContext | null = null
  private source: AudioBufferSourceNode | null = null
  private token = 0
  private paused = false

  constructor(private readonly deps: HttpEngineDeps) {}

  get available(): boolean {
    return this.deps.transport !== null
  }

  async listVoices(): Promise<TtsVoice[]> {
    const transport = this.deps.transport
    if (!transport) throw new Error('自建朗读服务不可用：缺少主进程通道。')
    const health = await transport.health(this.deps.endpoint(), this.deps.api())
    if (!health.ok) throw new Error(health.error ?? '连不上自建朗读服务。')
    return health.voices
  }

  speak(text: string, options: TtsSpeakOptions, handlers: TtsSpeakHandlers): void {
    const transport = this.deps.transport
    if (!transport) {
      handlers.onerror('自建朗读服务不可用：缺少主进程通道。')
      return
    }

    const token = ++this.token
    this.stopSource()
    // AudioContext 必须在用户点击的同一轮里解锁；等合成回来再建可能已经过期
    this.unlock()

    void this.play(
      token,
      transport,
      {
        endpoint: this.deps.endpoint(),
        api: this.deps.api(),
        sampleRate: this.deps.sampleRate(),
        text,
        voice: options.voice,
        rate: clampRate(options.rate)
      },
      handlers
    )
  }

  prefetch(texts: readonly string[], options: TtsSpeakOptions): void {
    const transport = this.deps.transport
    if (!transport) return
    const endpoint = this.deps.endpoint()
    const request = {
      endpoint,
      api: this.deps.api(),
      sampleRate: this.deps.sampleRate(),
      voice: options.voice,
      rate: clampRate(options.rate)
    }
    // 只比当前句多看两句：再远就可能被用户翻章 / 停止，白烧服务端算力。
    // 停止时已在途的请求会跑完（最多两句），结果照样落进磁盘缓存。
    for (const text of texts.slice(0, 2)) {
      void transport.synthesize({ ...request, text }).catch(() => {
        // 预合成失败不打断朗读；真正读到这一句时会再请求一次并如实报错
      })
    }
  }

  pause(): void {
    this.paused = true
    void this.ctx?.suspend()
  }

  resume(): void {
    this.paused = false
    void this.ctx?.resume()
  }

  cancel(): void {
    this.token += 1
    this.paused = false
    this.stopSource()
  }

  destroy(): void {
    this.cancel()
    const ctx = this.ctx
    this.ctx = null
    void ctx?.close()
  }

  private async play(
    token: number,
    transport: TtsTransport,
    request: {
      endpoint: string
      api: TtsApi
      sampleRate: number
      text: string
      voice: string
      rate: number
    },
    handlers: TtsSpeakHandlers
  ): Promise<void> {
    try {
      const result = await transport.synthesize(request)
      if (token !== this.token) return
      if (!result.ok) {
        handlers.onerror(result.error)
        return
      }

      const ctx = this.context()
      if (!ctx) {
        handlers.onerror('当前环境没有可用的音频输出。')
        return
      }

      // decodeAudioData 会接管 ArrayBuffer，先复制：缓存里的字节下一次还要用
      const buffer = await ctx.decodeAudioData(result.audio.slice().buffer)
      if (token !== this.token) return

      const source = ctx.createBufferSource()
      source.buffer = buffer
      // 官方 FastAPI 没有语速参数，只能在播放端变速；通用 /tts 已按 speed 合成过
      source.playbackRate.value = request.api === 'cosyvoice' ? request.rate : 1
      source.connect(ctx.destination)
      this.source = source
      source.onended = (): void => {
        if (token !== this.token) return
        this.source = null
        this.token += 1
        handlers.onend()
      }

      handlers.onstart?.()
      if (this.paused) await ctx.suspend()
      else await ctx.resume()
      if (token !== this.token) return
      source.start()
    } catch (error) {
      if (token !== this.token) return
      handlers.onerror(readableError(error))
    }
  }

  private context(): AudioContext | null {
    if (this.ctx) return this.ctx
    if (typeof window === 'undefined') return null
    this.ctx = new window.AudioContext()
    return this.ctx
  }

  private unlock(): void {
    const ctx = this.context()
    if (ctx && !this.paused && ctx.state === 'suspended') void ctx.resume()
  }

  private stopSource(): void {
    if (!this.source) return
    const source = this.source
    this.source = null
    source.onended = null
    try {
      source.stop()
    } catch {
      // 还没 start 就 stop 会抛，忽略即可
    }
    try {
      source.disconnect()
    } catch {
      // 已经断开
    }
  }
}

function readableError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'EncodingError' || error.name === 'NotSupportedError') {
      return '解码不了朗读服务返回的音频，请让服务输出 WAV。'
    }
    return error.message
  }
  return '朗读失败。'
}
