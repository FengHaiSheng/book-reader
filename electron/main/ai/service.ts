import type Database from 'better-sqlite3'
import { PROVIDER_AI, modelOf } from '@shared/ai'
import { appError, toAppError } from '@shared/errors'
import { PROVIDERS } from '@shared/types'
import type {
  AiChatResult,
  AiDegrade,
  AiStatus,
  AiUsage,
  Citation,
  IndexState,
  ProviderId
} from '@shared/types'
import { searchChunks } from '../library/repo'
import { getKey } from '../secrets'
import { getAll } from '../store/settings'
import { excerptOf, usedCitations } from './citations'
import { isRunning, indexState } from './index-builder'
import { buildMessages } from './prompts'
import { chat } from './provider'
import { unavailableCaps } from './repo'
import { estimateTokens, fitPassages, toPassages, windowFromText, type Passage } from './retrieve'

export const DEFAULT_AI_MODEL: Record<ProviderId, string> = {
  deepseek: 'deepseek-chat',
  qwen: 'qwen-plus',
  zhipu: 'glm-4-plus',
  kimi: 'moonshot-v1-8k'
}

export function aiSettings(db: Database.Database): { providerId: ProviderId; model: string } {
  // 仓库里没有 getSetting，只有批量读取的 getAll；一次读全表再取键，语义一致且少一次查询。
  const settings = getAll(db)
  const providerId = (settings['ai.provider'] ?? 'deepseek') as ProviderId
  const stored = settings['ai.model']
  const fallback = DEFAULT_AI_MODEL[providerId] ?? PROVIDER_AI[providerId].models[0]!.id
  const model = stored && modelOf(providerId, stored) ? stored : fallback
  return { providerId, model }
}

/** 全书级问题的判定词。命中且没有索引时，明说而不是偷偷降级（spec §5.3 方案 C）。 */
const BOOK_LEVEL_HINTS = [
  '全书',
  '整本',
  '整本书',
  '贯穿',
  '总的来说',
  '整体上',
  '作者想表达',
  '主旨',
  '中心思想'
]

export function looksBookLevel(text: string): boolean {
  return BOOK_LEVEL_HINTS.some((hint) => text.includes(hint))
}

type Source = {
  passage: Passage
  chunkId: number
  chapterId: number | null
  chapterTitle: string | null
  headingPath: string
}

export type ChatInput = {
  requestId: string
  bookId: string
  chapterId: number | null
  task: 'ask' | 'explain' | 'translate'
  /** 划词原文 */
  excerpt?: string
  question?: string
  /** 当前章节全文（主进程从 chunks 拼），用于「就这段话问」的窗口 */
  chapterText: string
  scopeKey: string
}

export type ChatHooks = {
  onDelta: (text: string) => void
  signal: AbortSignal
}

/**
 * 划词三件套（问答 / 解释 / 翻译）的完整链路。
 *
 * 顺序是刻意的：**先检索、再截断、最后才建 messages**。反过来做会让
 * 「参考资料」块在预算计算里被算两次，token 估算就对不上了。
 */
export async function runChat(
  db: Database.Database,
  input: ChatInput,
  hooks: ChatHooks
): Promise<AiChatResult> {
  const { providerId, model } = aiSettings(db)
  const caps = PROVIDER_AI[providerId]
  const modelInfo = modelOf(providerId, model)
  if (!modelInfo) throw appError('AI_UNSUPPORTED', '当前模型不在内置清单里，请到设置里重新选择')

  const unavailable = unavailableCaps(db, providerId)
  const degraded: AiDegrade[] = []
  const canEmbed = caps.embed && !unavailable.includes('embed')
  const state = indexState(db, input.bookId)

  if (!canEmbed) {
    degraded.push({
      kind: 'noEmbed',
      message: `${providerIdLabel(providerId)} 不提供向量检索，本次用的是关键词检索 + 当前章节窗口，跨章节召回会变弱。`
    })
  } else if (state.done === 0 && looksBookLevel(`${input.question ?? ''}${input.excerpt ?? ''}`)) {
    degraded.push({
      kind: 'blindIndex',
      message: '这个问题看起来需要跨全书检索，但当前还没有建立向量索引，只用了关键词检索，结果可能不全。'
    })
  }

  const query = (input.question ?? input.excerpt ?? '').trim()
  const hits = query === '' ? [] : searchChunks(db, input.bookId, query, 12)

  const sources: Source[] = toPassages(hits).map((passage, index) => {
    const hit = hits[index]!
    return {
      passage,
      chunkId: hit.chunkId,
      chapterId: hit.chapterId,
      chapterTitle: null,
      headingPath: hit.headingPath
    }
  })

  // 当前章节窗口排在最前：划词提问时它是相关性最高的一段
  const window = windowFromText(input.chapterText, input.excerpt ?? query, 2)
  if (window.trim() !== '') {
    sources.unshift({
      passage: { index: 1, headingPath: '当前章节窗口', text: window },
      chunkId: -1,
      chapterId: input.chapterId,
      chapterTitle: null,
      headingPath: '当前章节窗口'
    })
  }

  // 编号在截断之后才定：被丢掉的段不能占用编号，否则回答里的 [3] 会指向空
  const budget = Math.min(caps.maxInputTokens, modelInfo.maxContext) - 1200 - estimateTokens(query)
  const { kept, dropped } = fitPassages(
    sources.map((source) => source.passage),
    Math.max(200, budget)
  )
  const keptSources = sources.slice(0, kept.length)
  const numbered = keptSources.map((source, index) => ({
    ...source,
    passage: { ...source.passage, index: index + 1 },
    chunkId: source.chunkId
  }))

  if (dropped > 0) {
    degraded.push({
      kind: 'contextTruncated',
      message: `上下文窗口不够，本次只送入了本书 ${numbered.length} 段原文，回答范围受限。`
    })
  }

  const messages = buildMessages(input.task, {
    bookTitle: bookTitleOf(db, input.bookId),
    chapterTitle: chapterTitleOf(db, input.chapterId),
    excerpt: input.excerpt,
    question: input.question,
    passages: numbered.map((source) => source.passage)
  })

  const result = await chat({
    providerId,
    model,
    input: { messages, maxTokens: 2048, temperature: 0.3, stream: caps.stream },
    onDelta: (delta) => hooks.onDelta(delta.text),
    signal: hooks.signal
  })

  const citations: Citation[] = numbered.map((source) => ({
    index: source.passage.index,
    chunkId: source.chunkId,
    chapterId: source.chapterId,
    chapterTitle: chapterTitleOf(db, source.chapterId),
    headingPath: source.headingPath,
    excerpt: excerptOf(source.passage.text)
  }))

  return {
    requestId: input.requestId,
    content: result.content,
    usage: normalizeUsage(result.usage),
    // 只保留回答里真的引用到的：幻觉编号在这里被丢掉
    citations: usedCitations(result.content, citations),
    degraded
  }
}

export function statusOf(db: Database.Database, bookId: string | null): AiStatus {
  const { providerId, model } = aiSettings(db)
  return {
    providerId,
    model,
    configured: hasKey(providerId),
    caps: PROVIDER_AI[providerId],
    unavailable: unavailableCaps(db, providerId),
    // 设置页只关心「这家能不能用」，没有书就没有索引可言，不编一个假的 0/0
    index: bookId === null ? { total: 0, done: 0, running: false } : indexState(db, bookId)
  }
}

export function normalizeUsage(usage: AiUsage | null): AiUsage | null {
  if (!usage) return null
  return {
    inputTokens: Math.max(0, Math.round(usage.inputTokens)),
    outputTokens: Math.max(0, Math.round(usage.outputTokens))
  }
}

export function toReadable(error: unknown, fallback: string): Error {
  // 渲染进程只能拿到 message，抛对象会变成 `[object Object]`
  return new Error(toAppError(error, fallback).message)
}

function providerIdLabel(providerId: ProviderId): string {
  // 降级文案面向用户：要说服务商名（如 DeepSeek），说模型名（deepseek-chat）会让人误读成模型的能力问题。
  return PROVIDERS.find((provider) => provider.id === providerId)?.name ?? providerId
}

function hasKey(providerId: ProviderId): boolean {
  // 静态导入而非延迟 require：打包后 require('../secrets') 的相对路径会被落到
  // out/main 下，运行时解析不到，statusOf 就永远报「没配 key」。secrets 只在主进程
  // 被加载，单测不引入 service.ts，因此这里不必为纯单测环境做隔离。
  return getKey(providerId) !== null
}

export function bookTitleOf(db: Database.Database, bookId: string): string {
  const row = db.prepare('SELECT title FROM books WHERE id = ?').get(bookId) as
    | { title: string }
    | undefined
  return row?.title ?? '这本书'
}

export function chapterTitleOf(db: Database.Database, chapterId: number | null): string | null {
  if (chapterId === null) return null
  const row = db.prepare('SELECT title FROM chapters WHERE id = ?').get(chapterId) as
    | { title: string }
    | undefined
  return row?.title ?? null
}

/** 当前章节的全文，从 chunks 拼出来。AI 路径读的是纯文本，与渲染路径无关（spec §3.1）。 */
export function chapterTextOf(db: Database.Database, chapterId: number): string {
  const rows = db
    .prepare('SELECT text FROM chunks WHERE chapter_id = ? ORDER BY order_index')
    .all(chapterId) as { text: string }[]
  return rows.map((row) => row.text).join('\n\n')
}

export { isRunning }
export type { IndexState }