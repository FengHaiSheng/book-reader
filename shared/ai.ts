import { PROVIDERS, type ProviderId } from './types'

/** 每个任务的 prompt 都要带版本号：改提示词等于让缓存自动失效，用户不需要理解这件事 */
export const PROMPT_VERSION = 'v1'

export const AI_TASKS = [
  'ask',
  'explain',
  'translate',
  'chapterSummary',
  'bookDigest',
  'terms'
] as const

export type AiTask = (typeof AI_TASKS)[number]

export type ChatModel = {
  id: string
  label: string
  /** 该模型是否接受 response_format: { type: 'json_object' } */
  jsonMode: boolean
  /** 输入侧的上下文窗口（token），用于预算截断 */
  maxContext: number
}

/** 能力表的行。key 必须在 AiCaps 上有同名布尔字段。 */
export const CAPABILITY_LABELS = [
  { key: 'stream', label: '流式输出', fallback: '将改为一次性返回，等待期间面板显示「生成中」' },
  { key: 'embed', label: '向量检索', fallback: '将改为关键词检索 + 当前章节窗口，跨章节召回会变弱' },
  { key: 'jsonMode', label: '结构化输出', fallback: '将改为提示词约束 + 解析容错，仍失败则按纯文本展示' },
  { key: 'vision', label: '图片理解', fallback: '本产品暂不使用图片，无影响' }
] as const

export type CapabilityKey = (typeof CAPABILITY_LABELS)[number]['key']

export type AiCaps = Record<CapabilityKey, boolean> & {
  /** 输出侧上限，参数映射要夹取 max_tokens */
  maxOutputTokens: number
  /** 单次请求允许送出的最大 token；小于模型窗口，留出输出空间 */
  maxInputTokens: number
  embedModel?: string
  embedDim?: number
  /** 一次 embeddings 请求最多带几条；超了要分批，否则 400 */
  embedBatch?: number
}

export type ProviderAi = AiCaps & {
  baseURL: string
  models: readonly ChatModel[]
  /** 温度允许区间，参数映射要夹取 */
  temperatureRange: readonly [number, number]
}

/**
 * 内置能力声明，随版本更新。
 *
 * 运行时**不做探测**：探测请求本身就是花钱的调用，而且探测结果在限流时并不可信。
 * 只有真实调用返回「不支持」时，才把该项写进 settings 的 `ai.caps.<providerId>` 记为不可用。
 */
export const PROVIDER_AI: Record<ProviderId, ProviderAi> = {
  deepseek: {
    baseURL: PROVIDERS.find((p) => p.id === 'deepseek')!.baseURL,
    stream: true,
    embed: false,
    jsonMode: true,
    vision: false,
    maxOutputTokens: 8192,
    maxInputTokens: 64_000,
    temperatureRange: [0, 2],
    models: [
      { id: 'deepseek-chat', label: 'deepseek-chat', jsonMode: true, maxContext: 64_000 },
      { id: 'deepseek-reasoner', label: 'deepseek-reasoner', jsonMode: false, maxContext: 64_000 }
    ]
  },
  qwen: {
    baseURL: PROVIDERS.find((p) => p.id === 'qwen')!.baseURL,
    stream: true,
    embed: true,
    jsonMode: true,
    vision: false,
    maxOutputTokens: 8192,
    maxInputTokens: 120_000,
    embedModel: 'text-embedding-v3',
    embedDim: 1024,
    embedBatch: 10,
    temperatureRange: [0, 2],
    models: [
      { id: 'qwen-plus', label: 'qwen-plus', jsonMode: true, maxContext: 128_000 },
      { id: 'qwen-turbo', label: 'qwen-turbo', jsonMode: true, maxContext: 128_000 },
      { id: 'qwen-max', label: 'qwen-max', jsonMode: true, maxContext: 32_000 }
    ]
  },
  zhipu: {
    baseURL: PROVIDERS.find((p) => p.id === 'zhipu')!.baseURL,
    stream: true,
    embed: true,
    jsonMode: true,
    vision: false,
    maxOutputTokens: 4095,
    maxInputTokens: 120_000,
    embedModel: 'embedding-3',
    embedDim: 2048,
    embedBatch: 64,
    temperatureRange: [0, 1],
    models: [
      { id: 'glm-4-plus', label: 'glm-4-plus', jsonMode: true, maxContext: 128_000 },
      { id: 'glm-4-air', label: 'glm-4-air', jsonMode: true, maxContext: 128_000 }
    ]
  },
  kimi: {
    baseURL: PROVIDERS.find((p) => p.id === 'kimi')!.baseURL,
    stream: true,
    embed: false,
    jsonMode: true,
    vision: false,
    maxOutputTokens: 8192,
    maxInputTokens: 120_000,
    temperatureRange: [0, 1],
    models: [
      { id: 'moonshot-v1-8k', label: 'moonshot-v1-8k', jsonMode: true, maxContext: 8_000 },
      { id: 'moonshot-v1-32k', label: 'moonshot-v1-32k', jsonMode: true, maxContext: 32_000 },
      { id: 'moonshot-v1-128k', label: 'moonshot-v1-128k', jsonMode: true, maxContext: 128_000 }
    ]
  }
}

export function modelsFor(providerId: ProviderId): readonly ChatModel[] {
  return PROVIDER_AI[providerId].models
}

export function modelOf(providerId: ProviderId, modelId: string): ChatModel | null {
  return modelsFor(providerId).find((m) => m.id === modelId) ?? null
}

export function hasCapability(providerId: ProviderId, key: CapabilityKey): boolean {
  return PROVIDER_AI[providerId][key]
}

export function clampTemperature(providerId: ProviderId, value: number): number {
  const [min, max] = PROVIDER_AI[providerId].temperatureRange
  if (Number.isNaN(value)) return min
  return Math.min(max, Math.max(min, value))
}