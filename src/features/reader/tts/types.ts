import type {
  TtsEngineId,
  TtsHealth,
  TtsSynthesizeRequest,
  TtsSynthesizeResult,
  TtsVoice
} from '@shared/types'

/** 一句的朗读参数。voice 在不同引擎里含义不同：系统语音是 voiceURI，自建服务是音色 id */
export type TtsSpeakOptions = {
  voice: string
  rate: number
}

export type TtsSpeakHandlers = {
  /** 音频真正开始播放。翻页与高亮放在这里，避免合成还没完成页面就先跳走 */
  onstart?: () => void
  /** 正常读完一句 */
  onend: () => void
  /** 失败原因已经是可读中文 */
  onerror: (message: string) => void
}

/**
 * 朗读引擎。
 *
 * 上层只负责「读第几句、翻到哪一页、标哪一句」；怎么出声、能不能预合成、
 * 缓存放在哪，都收在实现里。系统语音与自建 HTTP 服务因此可以互换。
 */
export type SpeechEngine = {
  readonly id: TtsEngineId
  /** 当前环境能不能用。自建服务缺少主进程通道时为 false */
  readonly available: boolean
  listVoices(): Promise<TtsVoice[]>
  /** 读一句。返回前不会阻塞；结束通过 handlers 通知 */
  speak(text: string, options: TtsSpeakOptions, handlers: TtsSpeakHandlers): void
  /**
   * 预合成接下来的句子，只写缓存、不出声。
   * 系统语音是 no-op；HTTP 引擎在后台补齐，读完当前句后下一句通常已经就绪。
   */
  prefetch(texts: readonly string[], options: TtsSpeakOptions): void
  pause(): void
  resume(): void
  /** 停掉当前播放与预合成，之后不再回调任何 handlers */
  cancel(): void
  destroy(): void
}

/** HTTP 引擎需要的最小主进程通道。抽出来是为了让引擎可以单独测试 */
export type TtsTransport = {
  health(endpoint: string): Promise<TtsHealth>
  synthesize(request: TtsSynthesizeRequest): Promise<TtsSynthesizeResult>
}

export function clampRate(rate: number): number {
  return Math.min(2, Math.max(0.5, Number.isFinite(rate) ? rate : 1))
}
