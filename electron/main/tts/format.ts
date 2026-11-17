import { createHash } from 'node:crypto'
import type { TtsSynthesizeRequest, TtsVoice } from '@shared/types'

/** 朗读缓存上限。24 kHz / 16 bit 单声道约 2.9 MB/分钟，200 MB 够听十几个小时 */
export const TTS_CACHE_LIMIT_BYTES = 200 * 1024 * 1024

/** 一句最多多长。上层断句在 120 字以内，这里只防御异常输入 */
export const TTS_MAX_TEXT_CHARS = 400

export type NormalizedTtsRequest = {
  endpoint: string
  text: string
  voice: string
  rate: number
}

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
  return { endpoint, text, voice, rate }
}

/**
 * 缓存键要含 endpoint、音色、语速与原文：换服务或换声音后，
 * 同一句话必须重新合成，不能拿上一个模型的音频顶替。
 */
export function ttsCacheKey(request: NormalizedTtsRequest): string {
  return createHash('sha256')
    .update(
      JSON.stringify([request.endpoint, request.voice, request.rate, request.text])
    )
    .digest('hex')
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
