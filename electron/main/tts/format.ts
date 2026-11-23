import { createHash } from 'node:crypto'
import type { TtsApi, TtsSynthesizeRequest, TtsVoice } from '@shared/types'

/** 朗读缓存上限。24 kHz / 16 bit 单声道约 2.9 MB/分钟，200 MB 够听十几个小时 */
export const TTS_CACHE_LIMIT_BYTES = 200 * 1024 * 1024

/** 一句最多多长。上层断句在 120 字以内，这里只防御异常输入 */
export const TTS_MAX_TEXT_CHARS = 400

export type NormalizedTtsRequest = {
  endpoint: string
  api: TtsApi
  sampleRate: number
  text: string
  voice: string
  rate: number
}

/** 官方 CosyVoice2/3 是 24 kHz，CosyVoice1 是 22.05 kHz */
export const DEFAULT_TTS_SAMPLE_RATE = 24000

/** 官方 /inference_sft 的默认说话人；CosyVoice2 的 spk2info 里一定有它 */
export const DEFAULT_SPK_ID = '中文女'

/**
 * 只接受 http(s) 根地址。去掉尾部斜杠，否则会拼出 `//tts`。
 * 返回 null 表示用户填的地址不可用 —— 界面应提示，而不是偷偷回落到默认地址。
 */
export function normalizeEndpoint(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.length > 300) return null
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return trimmed.replace(/\/+$/, '')
  } catch {
    return null
  }
}

export function normalizeTtsRequest(value: unknown): NormalizedTtsRequest | null {
  if (typeof value !== 'object' || value === null) return null
  const request = value as Partial<TtsSynthesizeRequest>
  const endpoint = normalizeEndpoint(request.endpoint)
  const text = typeof request.text === 'string' ? request.text.trim() : ''
  if (!endpoint || text === '' || text.length > TTS_MAX_TEXT_CHARS) return null
  const voice = typeof request.voice === 'string' ? request.voice.trim().slice(0, 100) : ''
  const rate =
    typeof request.rate === 'number' && Number.isFinite(request.rate)
      ? Math.min(2, Math.max(0.5, request.rate))
      : 1
  const api: TtsApi = request.api === 'cosyvoice' ? 'cosyvoice' : 'simple'
  const sampleRate =
    typeof request.sampleRate === 'number' && Number.isFinite(request.sampleRate)
      ? Math.min(48000, Math.max(16000, Math.round(request.sampleRate)))
      : DEFAULT_TTS_SAMPLE_RATE
  return { endpoint, api, sampleRate, text, voice, rate }
}

/**
 * 缓存键要含 endpoint、接口形态、音色、语速与原文：换服务、换模型或换声音后，
 * 同一句话必须重新合成，不能拿上一个模型的音频顶替。
 * simple 模式忽略采样率，因此键里固定为 0 —— 改采样率不会白扔已有缓存。
 */
export function ttsCacheKey(request: NormalizedTtsRequest): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        request.endpoint,
        request.api,
        request.api === 'cosyvoice' ? request.sampleRate : 0,
        request.voice,
        request.rate,
        request.text
      ])
    )
    .digest('hex')
}

/** 前 12 个字节是不是 RIFF....WAVE */
export function isWav(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 12) return false
  return (
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x41 && // A
    bytes[10] === 0x56 && // V
    bytes[11] === 0x45 // E
  )
}

/**
 * 官方 CosyVoice 的 `/inference_sft` 直接回裸 PCM（16 bit 单声道小端），
 * 既没有 WAV 头也没有采样率。Web Audio 需要容器，这里补一个 44 字节的 WAV 头。
 * 服务若已经回了完整 WAV（有的封装会加），原样透传。
 */
export function pcm16ToWav(pcm: Uint8Array, sampleRate: number): Uint8Array {
  if (isWav(pcm)) return pcm

  // 半个 16 bit 样本没有意义，丢掉尾部多余的 1 字节，否则 data 长度会变成奇数
  const dataLength = pcm.byteLength - (pcm.byteLength % 2)
  const out = new Uint8Array(44 + dataLength)
  const view = new DataView(out.buffer)
  const writeAscii = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) {
      out[offset + index] = text.charCodeAt(index)
    }
  }

  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true) // fmt 块长度
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // 单声道
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // 字节率 = 采样率 × 声道数 × 位深/8
  view.setUint16(32, 2, true) // 块对齐
  view.setUint16(34, 16, true) // 位深
  writeAscii(36, 'data')
  view.setUint32(40, dataLength, true)
  out.set(pcm.subarray(0, dataLength), 44)
  return out
}

/**
 * 官方 FastAPI 的 `/openapi.json` 里是否真的有推理接口。
 * 直接探 /health 行不通 —— 官方服务没有这个路由；看 OpenAPI 才能区分
 * 「端口上跑的是别的东西」和「CosyVoice 还没启动完」。
 */
export function openApiHasInference(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const paths = (value as { paths?: unknown }).paths
  if (typeof paths !== 'object' || paths === null) return false
  return Object.keys(paths).some((path) => path.startsWith('/inference'))
}

/**
 * 归一化 /health 里的音色。允许三种写法，方便用户用现成的 FastAPI 包装：
 * - `["xiaochun"]`
 * - `[{ "id": "xiaochun", "name": "晓春", "lang": "zh-CN" }]`
 * - `{ "voices": [...] }`
 */
export function normalizeTtsVoices(value: unknown): TtsVoice[] {
  if (!Array.isArray(value)) return []
  const voices: TtsVoice[] = []
  for (const entry of value) {
    if (typeof entry === 'string') {
      const id = entry.trim().slice(0, 100)
      if (id) voices.push({ id, name: id, lang: '' })
      continue
    }
    if (typeof entry !== 'object' || entry === null) continue
    const item = entry as { id?: unknown; name?: unknown; lang?: unknown; voice?: unknown }
    const id =
      typeof item.id === 'string' ? item.id : typeof item.voice === 'string' ? item.voice : ''
    const clean = id.trim().slice(0, 100)
    if (clean === '') continue
    voices.push({
      id: clean,
      name:
        typeof item.name === 'string' && item.name.trim() !== ''
          ? item.name.trim().slice(0, 100)
          : clean,
      lang: typeof item.lang === 'string' ? item.lang.trim().slice(0, 30) : ''
    })
  }
  return voices.slice(0, 200)
}

export function parseHealthPayload(value: unknown): TtsVoice[] | null {
  if (Array.isArray(value)) return normalizeTtsVoices(value)
  if (typeof value !== 'object' || value === null) return null
  const payload = value as { ok?: unknown; voices?: unknown }
  if (payload.ok === false) return null
  return normalizeTtsVoices(payload.voices)
}

export type CacheEntry = {
  name: string
  size: number
  mtimeMs: number
}

/** 超过上限时按最久未修改优先删，返回要删除的文件名 */
export function pickCacheVictims(entries: readonly CacheEntry[], limit: number): string[] {
  let total = entries.reduce((sum, entry) => sum + entry.size, 0)
  if (total <= limit) return []
  const victims: string[] = []
  for (const entry of [...entries].sort((a, b) => a.mtimeMs - b.mtimeMs)) {
    if (total <= limit) break
    victims.push(entry.name)
    total -= entry.size
  }
  return victims
}
