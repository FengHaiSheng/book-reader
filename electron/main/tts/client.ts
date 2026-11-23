import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { TtsApi, TtsHealth, TtsSynthesizeResult } from '@shared/types'
import {
  DEFAULT_SPK_ID,
  TTS_CACHE_LIMIT_BYTES,
  normalizeEndpoint,
  normalizeTtsRequest,
  openApiHasInference,
  parseHealthPayload,
  pcm16ToWav,
  pickCacheVictims,
  ttsCacheKey,
  type NormalizedTtsRequest
} from './format'

/** 同一句的并发请求只打一次服务：朗读与预合成很容易同时要同一句 */
const inflight = new Map<string, Promise<Uint8Array>>()
let pruning = false

function cacheDir(): string {
  return join(app.getPath('userData'), 'tts-cache')
}

function cacheFile(key: string): string {
  return join(cacheDir(), `${key}.audio`)
}

async function readCache(key: string): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await readFile(cacheFile(key)))
  } catch {
    return null
  }
}

async function writeCache(key: string, bytes: Uint8Array): Promise<void> {
  await mkdir(cacheDir(), { recursive: true })
  const target = cacheFile(key)
  const temp = `${target}.${randomUUID()}.tmp`
  try {
    await writeFile(temp, bytes)
    await rename(temp, target)
  } catch (error) {
    await unlink(temp).catch(() => undefined)
    throw error
  }
  // 不阻塞这句的返回：缓存清理由后台自己跑
  void pruneCache()
}

/**
 * 缓存超过上限时按 mtime 删最旧的。失败不影响朗读，最多占点磁盘。
 * 不缓存错误、不缓存预合成失败：下一次读到同一句会重新请求。
 */
async function pruneCache(): Promise<void> {
  if (pruning) return
  pruning = true
  try {
    const names = await readdir(cacheDir()).catch(() => [] as string[])
    const entries: { name: string; size: number; mtimeMs: number }[] = []
    for (const name of names) {
      if (!name.endsWith('.audio')) continue
      try {
        const info = await stat(join(cacheDir(), name))
        if (info.isFile()) entries.push({ name, size: info.size, mtimeMs: info.mtimeMs })
      } catch {
        // 文件刚好被另一个清理流程删掉
      }
    }
    for (const name of pickCacheVictims(entries, TTS_CACHE_LIMIT_BYTES)) {
      await unlink(join(cacheDir(), name)).catch(() => undefined)
    }
  } finally {
    pruning = false
  }
}

async function requestAudio(request: NormalizedTtsRequest): Promise<Uint8Array> {
  return request.api === 'cosyvoice'
    ? requestCosyVoiceAudio(request)
    : requestSimpleAudio(request)
}

/** 通用协议：POST /tts，返回 WAV */
async function requestSimpleAudio(request: NormalizedTtsRequest): Promise<Uint8Array> {
  let response: Response
  try {
    response = await fetch(`${request.endpoint}/tts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: request.text,
        voice: request.voice,
        speed: request.rate
      }),
      signal: AbortSignal.timeout(60_000)
    })
  } catch (error) {
    throw new Error(readableFetchError(error, request.endpoint))
  }

  if (!response.ok) throw new Error(`朗读服务返回 HTTP ${response.status}。`)
  const type = (response.headers.get('content-type') ?? '').toLowerCase()
  if (type !== '' && !type.startsWith('audio/') && !type.includes('octet-stream')) {
    throw new Error('朗读服务没有返回音频（Content-Type 不是 audio/*）。')
  }

  const audio = new Uint8Array(await response.arrayBuffer())
  if (audio.byteLength < 64) throw new Error('朗读服务返回的音频是空的。')
  return audio
}

/**
 * 官方 CosyVoice FastAPI：`POST /inference_sft`，表单两个字段，回裸 PCM。
 *
 * 官方服务没有采样率、没有 WAV 头，也不接受语速 —— 采样率由客户端补，
 * 语速交给播放端的 playbackRate（见 `HttpSpeechEngine`）。
 */
async function requestCosyVoiceAudio(request: NormalizedTtsRequest): Promise<Uint8Array> {
  const body = new URLSearchParams({
    tts_text: request.text,
    spk_id: request.voice || DEFAULT_SPK_ID
  })

  let response: Response
  try {
    response = await fetch(`${request.endpoint}/inference_sft`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(60_000)
    })
  } catch (error) {
    throw new Error(readableFetchError(error, request.endpoint))
  }

  if (!response.ok) {
    // FastAPI 的 422 会带 detail，直接丢掉的话用户只看到「HTTP 422」无从下手
    const detail = await readErrorDetail(response)
    throw new Error(
      `CosyVoice 返回 HTTP ${response.status}${detail === '' ? '' : `：${detail}`}`
    )
  }

  const pcm = new Uint8Array(await response.arrayBuffer())
  if (pcm.byteLength < 64) throw new Error('CosyVoice 返回的音频是空的。')
  return pcm16ToWav(pcm, request.sampleRate)
}

/** 尽量从错误响应里捞出可读的一句话，别把整页 HTML 甩给用户 */
async function readErrorDetail(response: Response): Promise<string> {
  const text = await response.text().catch(() => '')
  if (text === '') return ''
  try {
    const payload = JSON.parse(text) as { detail?: unknown }
    if (typeof payload.detail === 'string') return payload.detail.slice(0, 200)
    if (Array.isArray(payload.detail)) {
      const first = payload.detail[0] as { msg?: unknown } | undefined
      if (typeof first?.msg === 'string') return first.msg.slice(0, 200)
    }
  } catch {
    // 不是 JSON，按文本截一段
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, 200)
}

/**
 * 探活同时充当音色列表：面板切到自建服务时就知道该显示哪些声音。
 *
 * 官方 FastAPI 没有 `/health`，音色（spk_id）也不在接口里暴露，
 * 只能看 `/openapi.json` 里有没有推理路由；音色由用户手填。
 */
export async function ttsHealth(endpoint: unknown, api: unknown): Promise<TtsHealth> {
  const base = normalizeEndpoint(endpoint)
  if (!base) {
    return { ok: false, voices: [], error: '朗读服务地址不合法，需要 http(s) 地址。' }
  }
  const mode: TtsApi = api === 'cosyvoice' ? 'cosyvoice' : 'simple'
  return mode === 'cosyvoice' ? cosyVoiceHealth(base) : simpleHealth(base)
}

async function simpleHealth(base: string): Promise<TtsHealth> {
  try {
    const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(4000) })
    if (!response.ok) {
      return { ok: false, voices: [], error: `朗读服务返回 HTTP ${response.status}。` }
    }
    const payload = await response.json().catch(() => null)
    const voices = parseHealthPayload(payload)
    if (voices === null) {
      return { ok: false, voices: [], error: '朗读服务的 /health 不是预期格式。' }
    }
    return { ok: true, voices, error: null }
  } catch (error) {
    return { ok: false, voices: [], error: readableFetchError(error, base) }
  }
}

async function cosyVoiceHealth(base: string): Promise<TtsHealth> {
  try {
    const response = await fetch(`${base}/openapi.json`, {
      signal: AbortSignal.timeout(4000)
    })
    if (!response.ok) {
      return { ok: false, voices: [], error: `朗读服务返回 HTTP ${response.status}。` }
    }
    const payload = await response.json().catch(() => null)
    if (!openApiHasInference(payload)) {
      return {
        ok: false,
        voices: [],
        error: '这个地址不像 CosyVoice 官方 FastAPI：/openapi.json 里没有 /inference_* 接口。'
      }
    }
    return { ok: true, voices: [], error: null }
  } catch (error) {
    return { ok: false, voices: [], error: readableFetchError(error, base) }
  }
}

/**
 * 合成一句。命中磁盘缓存直接回传；未命中时按缓存键合并并发请求，
 * 让「当前句」和「预合成」不会把同一句话算两遍。
 */
export async function synthesizeTts(value: unknown): Promise<TtsSynthesizeResult> {
  const request = normalizeTtsRequest(value)
  if (!request) return { ok: false, error: '朗读请求不合法。' }

  const key = ttsCacheKey(request)
  const cached = await readCache(key)
  if (cached) return { ok: true, audio: cached, cached: true }

  let pending = inflight.get(key)
  if (!pending) {
    pending = requestAudio(request)
      .then(async (audio) => {
        // 写缓存失败（磁盘满、目录只读）不该连朗读一起失败
        await writeCache(key, audio).catch(() => undefined)
        return audio
      })
      .finally(() => {
        inflight.delete(key)
      })
    inflight.set(key, pending)
  }

  try {
    const audio = await pending
    return { ok: true, audio, cached: false }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '朗读失败。' }
  }
}

function readableFetchError(error: unknown, endpoint: string): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return `朗读服务超时（${endpoint}）。`
    }
    if (/ECONNREFUSED|ENOTFOUND|fetch failed|network/i.test(error.message)) {
      return `连不上朗读服务 ${endpoint}，确认它已经启动。`
    }
    return error.message
  }
  return '朗读服务请求失败。'
}
