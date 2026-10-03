import { PROVIDER_AI, clampTemperature, modelOf } from '@shared/ai'
import type { ProviderId } from '@shared/types'

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export type ChatBodyInput = {
  messages: readonly ChatMessage[]
  maxTokens: number
  temperature?: number
  json?: boolean
  stream?: boolean
}

export type ChatBody = {
  model: string
  messages: ChatMessage[]
  max_tokens: number
  temperature?: number
  response_format?: { type: 'json_object' }
  stream?: boolean
  stream_options?: { include_usage: boolean }
}

/**
 * 唯一的参数映射点。
 *
 * 四家都接受 `max_tokens`，差异在**取值上限**与**温度区间**，以及不支持的模型
 * 必须把 `response_format` 整字段去掉（不是设成 null——有的网关会因此报 400）。
 */
export function buildChatBody(
  providerId: ProviderId,
  modelId: string,
  input: ChatBodyInput
): ChatBody {
  const caps = PROVIDER_AI[providerId]
  const model = modelOf(providerId, modelId)
  if (!model) throw new Error(`这个服务商没有模型「${modelId}」，请到设置里重新选择`)

  const body: ChatBody = {
    model: model.id,
    messages: [...input.messages],
    max_tokens: Math.max(1, Math.min(input.maxTokens, caps.maxOutputTokens))
  }

  if (input.temperature !== undefined) {
    body.temperature = clampTemperature(providerId, input.temperature)
  }

  // 模型自己声明不支持 jsonMode 时也要去掉，不能只看 provider 级
  if (input.json && caps.jsonMode && model.jsonMode) {
    body.response_format = { type: 'json_object' }
  }

  if (input.stream) {
    body.stream = true
    // 带用量是「每条回答下方显示 token 用量」的前提；不支持这个字段的服务商
    // 会忽略它，返回值里 usage 为 null，面板显示「用量未返回」，不编数字。
    body.stream_options = { include_usage: true }
  }

  return body
}

export type EmbedBatch = { model: string; input: string[] }

export function buildEmbedBody(providerId: ProviderId, texts: readonly string[]): EmbedBatch[] {
  const caps = PROVIDER_AI[providerId]
  if (!caps.embed || !caps.embedModel) {
    throw new Error('当前服务商不提供向量能力，不能建立向量索引')
  }
  const size = caps.embedBatch ?? 16
  const batches: EmbedBatch[] = []
  for (let i = 0; i < texts.length; i += size) {
    batches.push({ model: caps.embedModel, input: texts.slice(i, i + size) })
  }
  return batches
}