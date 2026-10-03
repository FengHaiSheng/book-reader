import { PROVIDER_AI } from '@shared/ai'
import { appError, type AppError } from '@shared/errors'
import type { ProviderId } from '@shared/types'
import { getKey } from '../secrets'
import { buildChatBody, buildEmbedBody, type ChatBodyInput, type ChatMessage } from './params'
import { RETRY_DELAY_MS, classifyError, shouldRetry, sleep } from './retry'
import { SseDecoder, deltaOf, type Usage } from './sse'

export type ChatDelta = { text: string }
export type ChatResult = { content: string; usage: Usage | null }

export type ChatOptions = {
  providerId: ProviderId
  model: string
  input: ChatBodyInput
  /** 每来一段正文就回调一次 */
  onDelta?: (delta: ChatDelta) => void
  signal?: AbortSignal
  /** 测试连接时用：拿到第一段就断开 */
  stopAfterFirstDelta?: boolean
}

/** 单次 chat 的原始请求体形状（只列用到的字段） */
type RawFrame = {
  choices?: { delta?: { content?: string }; message?: { content?: string } }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null
  error?: { message?: string }
}

export async function chat(options: ChatOptions): Promise<ChatResult> {
  const caps = PROVIDER_AI[options.providerId]
  const key = getKey(options.providerId)
  if (!key) {
    throw appError('AI_AUTH', '还没有为这个服务商填写 API Key，请到设置里填写', {
      action: 'openSettings'
    })
  }

  const body = buildChatBody(options.providerId, options.model, {
    ...options.input,
    stream: options.input.stream ?? caps.stream
  })

  if (!options.input.stream) {
    // 只有真正要走流式时才置 stream —— buildChatBody 里已经按 caps 处理过，
    // 这里再走一遍非流式路径是为了「provider 声明的 stream 为 false」的情况。
    delete body.stream
    delete body.stream_options
  }

  let attempt = 0
  for (;;) {
    try {
      const response = await fetch(`${caps.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`
        },
        body: JSON.stringify(body),
        signal: options.signal
      })

      if (!response.ok) {
        throw classifyError(response.status, await safeText(response))
      }

      if (body.stream) {
        return await readStream(response, options)
      }
      return await readOnce(response)
    } catch (error) {
      const normalized = normalize(error, options.signal)
      if (normalized.action === 'retry' && shouldRetry(normalized, attempt)) {
        attempt += 1
        await sleep(RETRY_DELAY_MS)
        continue
      }
      throw normalized
    }
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return ''
  }
}

function normalize(error: unknown, signal?: AbortSignal): AppError {
  if (signal?.aborted) {
    return appError('UNKNOWN', '已中断', { action: 'none' })
  }
  if (isAppError(error)) return error
  // fetch 的网络层失败与超时都走这里：拿不到 status
  return classifyError(null, error instanceof Error ? error.message : '')
}

function isAppError(error: unknown): error is AppError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'message' in error &&
    typeof (error as AppError).message === 'string'
  )
}

async function readStream(response: Response, options: ChatOptions): Promise<ChatResult> {
  const decoder = new SseDecoder()
  const reader = response.body?.getReader()
  if (!reader) throw appError('AI_UNSUPPORTED', '模型服务没有返回流式内容')

  const textDecoder = new TextDecoder()
  let content = ''
  let usage: Usage | null = null

  for (;;) {
    const { value, done } = await reader.read()
    if (done) break

    for (const event of decoder.push(textDecoder.decode(value, { stream: true }))) {
      if (event.done) continue
      const parsed = deltaOf(event.raw)
      if (parsed.usage) usage = parsed.usage
      if (!parsed.text) continue
      content += parsed.text
      options.onDelta?.({ text: parsed.text })
      if (options.stopAfterFirstDelta) {
        await reader.cancel().catch(() => undefined)
        return { content, usage }
      }
    }
  }

  for (const event of decoder.flush()) {
    if (event.done) continue
    const parsed = deltaOf(event.raw)
    if (parsed.usage) usage = parsed.usage
    if (parsed.text) {
      content += parsed.text
      options.onDelta?.({ text: parsed.text })
    }
  }

  return { content, usage }
}

async function readOnce(response: Response): Promise<ChatResult> {
  const raw = (await response.json()) as RawFrame
  const content = raw.choices?.[0]?.message?.content ?? ''
  return {
    content,
    usage: raw.usage
      ? {
          inputTokens: raw.usage.prompt_tokens ?? 0,
          outputTokens: raw.usage.completion_tokens ?? 0
        }
      : null
  }
}

/**
 * 填 key 时的验活：只发 1 个 token。
 *
 * 失败必须原样暴露：把一个 401 吞成「保存成功」是最坏的做法——用户会一直到
 * 提问时才发现问题。
 */
export async function testConnection(
  providerId: ProviderId,
  model: string
): Promise<{ ok: true; providerId: ProviderId; model: string }> {
  await chat({
    providerId,
    model,
    input: {
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 1,
      temperature: 0,
      stream: true
    },
    stopAfterFirstDelta: true
  })
  return { ok: true, providerId, model }
}

export type EmbedResult = { vectors: number[][]; inputTokens: number }

/**
 * 计算 embedding。分批请求，每批之间检查 signal，保证可中断。
 */
export async function embed(
  providerId: ProviderId,
  texts: readonly string[],
  signal?: AbortSignal
): Promise<EmbedResult> {
  const caps = PROVIDER_AI[providerId]
  const key = getKey(providerId)
  if (!key) {
    throw appError('AI_AUTH', '还没有为这个服务商填写 API Key，请到设置里填写', {
      action: 'openSettings'
    })
  }

  const batches = buildEmbedBody(providerId, texts)
  const vectors: number[][] = []
  let inputTokens = 0

  for (const batch of batches) {
    if (signal?.aborted) throw appError('UNKNOWN', '已中断', { action: 'none' })
    let attempt = 0
    for (;;) {
      try {
        const response = await fetch(`${caps.baseURL}/embeddings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify(batch),
          signal
        })
        if (!response.ok) throw classifyError(response.status, await safeText(response))

        const payload = (await response.json()) as {
          data?: { embedding: number[] }[]
          usage?: { total_tokens?: number }
        }
        for (const item of payload.data ?? []) vectors.push(item.embedding)
        inputTokens += payload.usage?.total_tokens ?? 0
        break
      } catch (error) {
        const normalized = normalize(error, signal)
        if (normalized.action === 'retry' && shouldRetry(normalized, attempt)) {
          attempt += 1
          await sleep(RETRY_DELAY_MS)
          continue
        }
        throw normalized
      }
    }
  }

  return { vectors, inputTokens }
}

export type { ChatMessage }