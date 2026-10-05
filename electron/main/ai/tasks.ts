import type Database from 'better-sqlite3'
import { PROVIDER_AI, modelOf } from '@shared/ai'
import { appError, toAppError } from '@shared/errors'
import type {
  AiEstimate,
  AiEstimateRequest,
  AiResultView,
  AiUsage,
  BookDigestPayload,
  ChapterSummaryPayload,
  MindmapNode,
  ProviderId,
  TermsPayload
} from '@shared/types'
import { parseLooseJson } from './loose-json'
import { buildMindmap } from './mindmap'
import type { ChatMessage } from './params'
import { buildMessages } from './prompts'
import { chat, type ChatResult } from './provider'
import { getResult, markUnavailable, saveResult, unavailableCaps, type ResultKey } from './repo'
import { isJsonModeRejection } from './retry'
import { estimateTokens, fitPassages, messagesTokens, slicesOf } from './retrieve'
import { aiSettings, bookTitleOf, chapterTextOf, chapterTitleOf } from './service'

const ZERO: AiUsage = { inputTokens: 0, outputTokens: 0 }
const MAX_OUTPUT = 2048
const SLICE_SIZE = 1200

/**
 * 合成（reduce）那一步的输入是模型上一轮的输出，事先算不准，只能按固定假设填一份占位小结。
 * 这是**假设不是实测**，所以带它的预估必须在 note 里说明。
 */
const EST_SUMMARY_TOKENS = 240

const JSON_NOT_DECLARED = '当前模型不支持结构化输出，已改为提示词约束 + 本地解析。'
const JSON_REJECTED =
  '服务商不接受结构化输出参数（已记下，这家之后不再带该参数），本次改为提示词约束 + 本地解析。'
const JSON_PARSE_HINT = '若下面是模型原文，说明这次没能解析成结构。'

type Term = TermsPayload['terms'][number]
type SummaryTerm = ChapterSummaryPayload['terms'][number]
type PartialSummary = { chapterTitle: string; overview: string; keyPoints: string[] }

/** 每次真实发出去的调用 +1。界面上的「共发起 N 次请求」就是它，不能靠估算 */
type CallContext = { providerId: ProviderId; model: string; signal: AbortSignal }

type Structured<T> = {
  raw: string
  payload: T | null
  usage: AiUsage | null
  note: string | null
}

export type TaskProgress = { done: number; total: number; label: string; running: boolean }

/**
 * 跑一次要求 JSON 输出的结构化调用。
 *
 * 模型没吐合法 JSON 时不抛错：`payload` 为 null、`raw` 是原文，由界面按纯文本展示。
 * 抛错会让用户失去「它到底说了什么」这个信息（硬规则 2）。
 *
 * 声明说支持、服务商却回 400 时，把「不支持」记进能力表并去掉参数重跑一次。
 * **只重跑一次**：第二次再失败说明问题不在 `response_format` 上，继续试是白花钱。
 */
async function askJson<T>(
  db: Database.Database,
  call: CallContext,
  messages: ChatMessage[],
  validate: (value: unknown) => T | null
): Promise<Structured<T>> {
  const declared =
    PROVIDER_AI[call.providerId].jsonMode &&
    modelOf(call.providerId, call.model)?.jsonMode === true
  const wantedJson = declared && !unavailableCaps(db, call.providerId).includes('jsonMode')

  const ask = (json: boolean): Promise<ChatResult> =>
    chat({
      providerId: call.providerId,
      model: call.model,
      input: { messages, maxTokens: MAX_OUTPUT, temperature: 0.2, json, stream: false },
      signal: call.signal
    })

  let usedJson = wantedJson
  let result: ChatResult
  if (!wantedJson) {
    result = await ask(false)
  } else {
    try {
      result = await ask(true)
    } catch (error) {
      const normalized = toAppError(error, '结构化调用失败')
      if (!isJsonModeRejection(normalized, wantedJson)) throw normalized
      markUnavailable(db, call.providerId, 'jsonMode')
      usedJson = false
      result = await ask(false)
    }
  }

  const payload = validate(parseLooseJson(result.content))
  return {
    raw: result.content,
    payload,
    usage: result.usage,
    note: usedJson
      ? null
      : composeNote(declared ? JSON_REJECTED : JSON_NOT_DECLARED, JSON_PARSE_HINT)
  }
}

function addUsage(left: AiUsage | null, right: AiUsage | null): AiUsage | null {
  if (!left) return right
  if (!right) return left
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens
  }
}

function composeNote(...parts: (string | null | undefined)[]): string | null {
  const kept = parts.filter((part): part is string => typeof part === 'string' && part.trim() !== '')
  return kept.length === 0 ? null : kept.join(' ')
}

/**
 * 统一出口。
 *
 * `payload` 为 null 时必然给一句 note —— 不允许出现「没结构、没说明、没原文」的空结果。
 */
function toView<T>(
  raw: string,
  payload: T | null,
  meta: { cached: boolean; usage: AiUsage | null; createdAt: number; note: string | null }
): AiResultView<T> {
  return {
    payload,
    text: payload ? null : raw.trim() === '' ? null : raw,
    cached: meta.cached,
    usage: meta.usage,
    createdAt: meta.createdAt,
    note: payload ? meta.note : (meta.note ?? '模型没有按要求返回 JSON，下面按纯文本展示。')
  }
}

function budgetFor(providerId: ProviderId, model: string, query: string): number {
  const caps = PROVIDER_AI[providerId]
  const window = Math.min(caps.maxInputTokens, modelOf(providerId, model)?.maxContext ?? caps.maxInputTokens)
  return Math.max(400, window - MAX_OUTPUT - 600 - estimateTokens(query))
}

/** 带正文的章节。目录里的分组节点 href 是空串，不能拿去当正文读 */
function bodyChapters(db: Database.Database, bookId: string): { id: number; title: string }[] {
  return db
    .prepare(
      `SELECT id, title FROM chapters WHERE book_id = ? AND href <> '' ORDER BY order_index, id`
    )
    .all(bookId) as { id: number; title: string }[]
}

function baseContext(db: Database.Database, bookId: string, chapterId: number | null) {
  return {
    bookTitle: bookTitleOf(db, bookId),
    chapterTitle: chapterId === null ? null : chapterTitleOf(db, chapterId)
  }
}

/** 结果缓存的键只看服务商与模型：换模型就等于换一份结果，signal 与键无关 */
type CacheCall = { providerId: ProviderId; model: string }

function summaryKey(bookId: string, chapterId: number, call: CacheCall): ResultKey {
  return {
    bookId,
    task: 'chapterSummary',
    scopeKey: `chapter:${chapterId}`,
    provider: call.providerId,
    model: call.model
  }
}

function termsKey(bookId: string, call: CacheCall): ResultKey {
  return { bookId, task: 'terms', scopeKey: 'book', provider: call.providerId, model: call.model }
}

function mindmapKey(bookId: string, call: CacheCall): ResultKey {
  return { bookId, task: 'mindmap', scopeKey: 'book', provider: call.providerId, model: call.model }
}

/**
 * 读某一章已经存好的小结。
 *
 * 全书要点与关键词都靠它省钱：能复用的一律不重算，**用户不会为同一章付两次费**。
 */
function savedSummary(
  db: Database.Database,
  bookId: string,
  chapter: { id: number; title: string },
  call: CacheCall
): { chapterTitle: string; overview: string; keyPoints: string[] } | null {
  const stored = getResult<ChapterSummaryPayload>(db, summaryKey(bookId, chapter.id, call))
  if (!stored) return null
  return { chapterTitle: chapter.title, overview: stored.payload.overview, keyPoints: stored.payload.keyPoints }
}

// ---------- 本章小结 ----------

export async function runChapterSummary(
  db: Database.Database,
  input: { bookId: string; chapterId: number; providerId: ProviderId; model: string; signal: AbortSignal }
): Promise<AiResultView<ChapterSummaryPayload>> {
  const call: CallContext = {
    providerId: input.providerId,
    model: input.model,
    signal: input.signal
  }
  const key = summaryKey(input.bookId, input.chapterId, call)
  const cached = getResult<ChapterSummaryPayload>(db, key)
  if (cached) {
    return toView('', cached.payload, {
      cached: true,
      usage: { inputTokens: cached.inputTokens, outputTokens: cached.outputTokens },
      createdAt: cached.createdAt,
      note: null
    })
  }

  const context = baseContext(db, input.bookId, input.chapterId)
  const chapterText = chapterTextOf(db, input.chapterId)
  if (chapterText.trim() === '') {
    throw appError('AI_UNSUPPORTED', '这一章没有可用的正文，做不了小结')
  }

  const { kept, dropped } = fitPassages(slicesOf(chapterText, SLICE_SIZE), budgetFor(input.providerId, input.model, ''))
  const notes: string[] = []
  let usage: AiUsage | null = null

  // 短章节：一次读完。只有真的超长时才走 map-reduce，别为一章 3 千字发好几次请求
  if (dropped === 0) {
    const only = await askJson<ChapterSummaryPayload>(
      db,
      call,
      buildMessages('chapterSummary', {
        ...context,
        chapterText: kept.map((slice) => slice.text).join('\n\n')
      }),
      asSummary
    )
    usage = only.usage
    notes.push(only.note ?? '')
    return finish(db, key, only.raw, only.payload, usage, composeNote(...notes))
  }

  const partials: PartialSummary[] = []
  let failedRaw = ''
  for (const slice of kept) {
    if (input.signal.aborted) break
    const part = await askJson<ChapterSummaryPayload>(
      db,
      call,
      buildMessages('chapterSummary', { ...context, chapterText: slice.text }),
      asSummary
    )
    usage = addUsage(usage, part.usage)
    notes.push(part.note ?? '')
    if (part.payload) {
      partials.push({
        chapterTitle: `${context.chapterTitle ?? '本章'}（第 ${slice.index} 段）`,
        overview: part.payload.overview,
        keyPoints: part.payload.keyPoints
      })
    } else {
      failedRaw = part.raw
    }
  }

  if (input.signal.aborted) {
    return toView<ChapterSummaryPayload>('', null, {
      cached: false,
      usage,
      createdAt: Date.now(),
      note: '已停下。分段小结没有全部完成，没有写入缓存，下次点「本章小结」会重新开始。'
    })
  }

  if (partials.length === 0) {
    return toView<ChapterSummaryPayload>(failedRaw, null, {
      cached: false,
      usage,
      createdAt: Date.now(),
      note: '这一章的分段小结都没能解析成结构，下面是模型最后一段输出。'
    })
  }

  const reduced = await askJson<ChapterSummaryPayload>(
    db,
    call,
    buildMessages('chapterSummary', { ...context, summaries: partials }),
    asSummary
  )
  usage = addUsage(usage, reduced.usage)
  return finish(
    db,
    key,
    reduced.raw,
    reduced.payload,
    usage,
    composeNote(
      `这一章较长，分 ${kept.length} 段读取后合成，共发起 ${kept.length + 1} 次请求。`,
      dropped > 0 ? `这一章超出当前模型的上下文上限，最后 ${dropped} 段没有送进去。` : '',
      notes.join(' '),
      reduced.note
    )
  )
}

/** 有 payload 才落库：坏结果不该占住唯一键，否则用户再也拿不到好结果 */
function finish<T>(
  db: Database.Database,
  key: ResultKey,
  raw: string,
  payload: T | null,
  usage: AiUsage | null,
  note: string | null
): AiResultView<T> {
  const now = Date.now()
  if (payload) saveResult(db, key, payload, usage ?? ZERO, now)
  return toView(raw, payload, { cached: false, usage, createdAt: now, note })
}

// ---------- 全书要点 ----------

export async function runBookDigest(
  db: Database.Database,
  input: { bookId: string; providerId: ProviderId; model: string; signal: AbortSignal },
  onProgress: (progress: TaskProgress) => void
): Promise<AiResultView<BookDigestPayload>> {
  const call: CallContext = { providerId: input.providerId, model: input.model, signal: input.signal }
  const key: ResultKey = {
    bookId: input.bookId,
    task: 'bookDigest',
    scopeKey: 'book',
    provider: input.providerId,
    model: input.model
  }
  const cached = getResult<BookDigestPayload>(db, key)
  if (cached) {
    return toView('', cached.payload, {
      cached: true,
      usage: { inputTokens: cached.inputTokens, outputTokens: cached.outputTokens },
      createdAt: cached.createdAt,
      note: null
    })
  }

  const chapters = bodyChapters(db, input.bookId)
  if (chapters.length === 0) throw appError('AI_UNSUPPORTED', '这本书还没有可用的章节正文')

  const summaries: PartialSummary[] = []
  const notes: string[] = []
  let usage: AiUsage | null = null
  let calls = 0
  let reused = 0
  /** 有几章因为超出上下文上限只读了前半部分。这个数字必须出现在结果里 */
  let clipped = 0
  let done = 0
  onProgress({ done, total: chapters.length, label: '准备中', running: true })

  for (const chapter of chapters) {
    if (input.signal.aborted) break

    const saved = savedSummary(db, input.bookId, chapter, call)
    if (saved) {
      summaries.push(saved)
      reused += 1
    } else {
      const text = chapterTextOf(db, chapter.id)
      const { kept, dropped } = fitPassages(
        slicesOf(text, SLICE_SIZE),
        // budgetFor 的第三个参数是「正文之外还要占预算的查询内容」。这一章本身就由
        // fitPassages 装进预算，再把它当 query 扣一遍就是重复计算：长章节的预算会被
        // 自己的长度吃掉，直接掉到 400 的下限，结果只剩前半章。与 runChapterSummary 同口径。
        budgetFor(input.providerId, input.model, '')
      )
      if (dropped > 0) clipped += 1
      calls += 1
      const part = await askJson<ChapterSummaryPayload>(
        db,
        call,
        buildMessages('bookDigest', {
          ...baseContext(db, input.bookId, chapter.id),
          chapterText: kept.map((slice) => slice.text).join('\n\n')
        }),
        asSummary
      )
      usage = addUsage(usage, part.usage)
      notes.push(part.note ?? '')
      if (part.payload) {
        summaries.push({
          chapterTitle: chapter.title,
          overview: part.payload.overview,
          keyPoints: part.payload.keyPoints
        })
        // 顺手存成章小结：用户之后点「本章小结」就是缓存命中，不会再花一次钱
        saveResult(db, summaryKey(input.bookId, chapter.id, call), part.payload, part.usage ?? ZERO, Date.now())
      }
    }

    done += 1
    onProgress({ done, total: chapters.length, label: chapter.title, running: true })
  }

  onProgress({ done, total: chapters.length, label: '', running: false })

  if (input.signal.aborted) {
    return toView<BookDigestPayload>('', null, {
      cached: false,
      usage,
      createdAt: Date.now(),
      note: `已停下。已经做好的 ${summaries.length} 章小结都存着，下次点「全书要点」会跳过它们，不会重复花钱。`
    })
  }

  if (summaries.length === 0) {
    return toView<BookDigestPayload>('', null, {
      cached: false,
      usage,
      createdAt: Date.now(),
      note: '各章小结都没能生成，全书要点也就无从归纳。可以稍后再试。'
    })
  }

  calls += 1
  const reduced = await askJson<BookDigestPayload>(
    db,
    call,
    buildMessages('bookDigest', { ...baseContext(db, input.bookId, null), summaries }),
    asDigest
  )
  usage = addUsage(usage, reduced.usage)

  const now = Date.now()
  if (reduced.payload) saveResult(db, key, reduced.payload, usage ?? ZERO, now)
  return toView(
    reduced.raw,
    reduced.payload,
    {
      cached: false,
      usage,
      createdAt: now,
      note: composeNote(
        `逐章读取了 ${chapters.length} 章，本次共发起 ${calls} 次请求。`,
        reused > 0 ? `其中 ${reused} 章直接用了已有小结，没有重复调用。` : '',
        clipped > 0 ? `有 ${clipped} 章因超出上下文上限只读了前半部分。` : '',
        notes.join(' '),
        reduced.note
      )
    }
  )
}

// ---------- 关键词 ----------

export async function runTerms(
  db: Database.Database,
  input: { bookId: string; providerId: ProviderId; model: string; signal: AbortSignal }
): Promise<AiResultView<TermsPayload>> {
  const call: CallContext = { providerId: input.providerId, model: input.model, signal: input.signal }
  const key: ResultKey = {
    bookId: input.bookId,
    task: 'terms',
    scopeKey: 'book',
    provider: input.providerId,
    model: input.model
  }
  const cached = getResult<TermsPayload>(db, key)
  if (cached) {
    return toView('', cached.payload, {
      cached: true,
      usage: { inputTokens: cached.inputTokens, outputTokens: cached.outputTokens },
      createdAt: cached.createdAt,
      note: null
    })
  }

  const summaries: PartialSummary[] = []
  for (const chapter of bodyChapters(db, input.bookId)) {
    const saved = savedSummary(db, input.bookId, chapter, call)
    if (saved) summaries.push(saved)
  }

  // 没有小结就不偷偷替用户开跑全书要点（硬规则 1），直接告诉他先做什么
  if (summaries.length === 0) {
    throw appError(
      'AI_UNSUPPORTED',
      '还没有任何一章的小结。关键词要有依据，先做一次「全书要点」或至少一章的「本章小结」。'
    )
  }

  const outcome = await askJson<TermsPayload>(
    db,
    call,
    buildMessages('terms', { ...baseContext(db, input.bookId, null), summaries }),
    asTerms
  )
  return finish(db, key, outcome.raw, outcome.payload, outcome.usage, outcome.note)
}

// ---------- 思维导图（不调模型） ----------

export function runMindmap(
  db: Database.Database,
  input: { bookId: string; providerId: ProviderId; model: string }
): AiResultView<MindmapNode> {
  const call: CallContext = {
    providerId: input.providerId,
    model: input.model,
    signal: new AbortController().signal
  }
  const key = mindmapKey(input.bookId, call)
  const cached = getResult<MindmapNode>(db, key)
  if (cached) {
    return toView('', cached.payload, {
      cached: true,
      usage: { inputTokens: cached.inputTokens, outputTokens: cached.outputTokens },
      createdAt: cached.createdAt,
      note: null
    })
  }

  const terms = getResult<TermsPayload>(db, {
    bookId: input.bookId,
    task: 'terms',
    scopeKey: 'book',
    provider: input.providerId,
    model: input.model
  })
  if (!terms) {
    throw appError('AI_UNSUPPORTED', '思维导图是把「关键词」按章节重新组织的。先生成一次关键词。')
  }

  const tree = buildMindmap(bookTitleOf(db, input.bookId), terms.payload.terms)
  if (!tree) {
    throw appError('AI_UNSUPPORTED', '这本书没有可用的关键词，先生成一次关键词。')
  }

  const now = Date.now()
  saveResult(db, key, tree, ZERO, now)
  return toView('', tree, {
    cached: false,
    usage: null,
    createdAt: now,
    note: '思维导图由「关键词」的结果组织而成，这一次没有调用模型，也没有产生费用。'
  })
}

// ---------- 花钱之前的预估 ----------

/**
 * 结构化任务的开跑前预估。
 *
 * 口径与 `run*` 系列严格对齐：同一套 `slicesOf` / `fitPassages` / `budgetFor` / `buildMessages`，
 * 同一套缓存判定。哪里算不准（合成那一步的输入取决于模型输出）就按假设填一份占位小结，
 * 并把「这是假设」写进 note——不编一个看起来精确的数字。
 *
 * **不调任何模型**：全程只读库，所以预估本身不产生费用。
 */
export type TaskEstimateRequest = Extract<AiEstimateRequest, { kind: 'task' }>

export function estimateTask(db: Database.Database, request: TaskEstimateRequest): AiEstimate {
  const { providerId, model } = aiSettings(db)
  const call: CacheCall = { providerId, model }
  const maxOutput = Math.min(MAX_OUTPUT, PROVIDER_AI[providerId].maxOutputTokens)

  switch (request.task) {
    case 'chapterSummary':
      return estimateChapterSummary(db, request, call, maxOutput)
    case 'bookDigest':
      return estimateBookDigest(db, request, call, maxOutput)
    case 'terms':
      return estimateTerms(db, request, call, maxOutput)
    case 'mindmap':
      return estimateMindmap(db, request, call)
  }
}

/**
 * 合成那一步的占位小结：内容是假设的，只用来撑起提示词骨架的长度。
 *
 * 用等长中文占位——`estimateTokens` 对中文按 1 字 1 token 计，重复 EST_SUMMARY_TOKENS 次
 * 就等于假设值，而且渲染仍走 `buildMessages`，与真实请求同一条路径。
 */
function placeholderSummary(chapterTitle: string): PartialSummary {
  return { chapterTitle, overview: '约'.repeat(EST_SUMMARY_TOKENS), keyPoints: [] }
}

function estimateChapterSummary(
  db: Database.Database,
  request: TaskEstimateRequest,
  call: CacheCall,
  maxOutput: number
): AiEstimate {
  if (request.chapterId === null) {
    return zeroEstimate('还没有选中具体某一章，先翻到正文里的某一章再做本章小结。')
  }
  if (getResult(db, summaryKey(request.bookId, request.chapterId, call))) {
    return zeroEstimate('这一章已有小结，会直接读缓存，不发起请求、不产生费用。')
  }

  const context = baseContext(db, request.bookId, request.chapterId)
  const chapterText = chapterTextOf(db, request.chapterId)
  if (chapterText.trim() === '') {
    return zeroEstimate('这一章没有可用的正文，做不了小结。')
  }

  const { kept, dropped } = fitPassages(
    slicesOf(chapterText, SLICE_SIZE),
    budgetFor(call.providerId, call.model, '')
  )

  if (dropped === 0) {
    const messages = buildMessages('chapterSummary', {
      ...context,
      chapterText: kept.map((slice) => slice.text).join('\n\n')
    })
    return {
      inputTokens: messagesTokens(messages),
      maxOutputTokens: maxOutput,
      calls: 1,
      note: null
    }
  }

  // 长章节走 map-reduce：map 每段一次（输入可精确算），再合成一次（输入取决于模型输出）
  const mapTokens = kept.reduce(
    (sum, slice) =>
      sum +
      messagesTokens(buildMessages('chapterSummary', { ...context, chapterText: slice.text })),
    0
  )
  const reduceTokens = messagesTokens(
    buildMessages('chapterSummary', {
      ...context,
      summaries: kept.map((slice) => placeholderSummary(`${context.chapterTitle ?? '本章'}（第 ${slice.index} 段）`))
    })
  )
  return {
    inputTokens: mapTokens + reduceTokens,
    maxOutputTokens: maxOutput,
    calls: kept.length + 1,
    note: `这一章较长，要分 ${kept.length} 段读取再合成，共 ${kept.length + 1} 次请求。合成那一次的输入来自前一步的输出，只能按约 ${EST_SUMMARY_TOKENS} token/份估算。`
  }
}

function estimateBookDigest(
  db: Database.Database,
  request: TaskEstimateRequest,
  call: CacheCall,
  maxOutput: number
): AiEstimate {
  const chapters = bodyChapters(db, request.bookId)
  if (chapters.length === 0) return zeroEstimate('这本书还没有可用的章节正文。')

  const summaries: PartialSummary[] = []
  let inputTokens = 0
  let newCalls = 0
  let reused = 0
  let clipped = 0

  for (const chapter of chapters) {
    const saved = savedSummary(db, request.bookId, chapter, call)
    if (saved) {
      summaries.push(saved)
      reused += 1
      continue
    }

    const text = chapterTextOf(db, chapter.id)
    // 与 runBookDigest 同一口径：正文交给 fitPassages，不再当 query 重复扣一次
    const { kept, dropped } = fitPassages(
      slicesOf(text, SLICE_SIZE),
      budgetFor(call.providerId, call.model, '')
    )
    if (dropped > 0) clipped += 1
    newCalls += 1
    inputTokens += messagesTokens(
      buildMessages('bookDigest', {
        ...baseContext(db, request.bookId, chapter.id),
        chapterText: kept.map((slice) => slice.text).join('\n\n')
      })
    )
    summaries.push(placeholderSummary(chapter.title))
  }

  // 最后那次归纳：已有小结的章用真实内容（可精确算），新生成的章只能用占位
  inputTokens += messagesTokens(
    buildMessages('bookDigest', { ...baseContext(db, request.bookId, null), summaries })
  )

  const parts = [
    newCalls === 0
      ? '每一章都已有小结，只会做最后一次归纳，共 1 次请求。'
      : `逐章读取 ${chapters.length} 章，其中 ${reused} 章直接复用已有小结，本次共发起 ${newCalls + 1} 次请求。`,
    newCalls > 0
      ? `本次要新生成 ${newCalls} 章的小结，归纳那一次的输入按约 ${EST_SUMMARY_TOKENS} token/章估算。`
      : '',
    clipped > 0 ? `有 ${clipped} 章因超出上下文上限只读了前半部分。` : ''
  ]
  return {
    inputTokens,
    maxOutputTokens: maxOutput,
    calls: newCalls + 1,
    note: parts.filter((part) => part !== '').join(' ')
  }
}

function estimateTerms(
  db: Database.Database,
  request: TaskEstimateRequest,
  call: CacheCall,
  maxOutput: number
): AiEstimate {
  if (getResult(db, termsKey(request.bookId, call))) {
    return zeroEstimate('关键词已经有结果，会直接读缓存，不发起请求、不产生费用。')
  }

  const summaries: PartialSummary[] = []
  for (const chapter of bodyChapters(db, request.bookId)) {
    const saved = savedSummary(db, request.bookId, chapter, call)
    if (saved) summaries.push(saved)
  }
  if (summaries.length === 0) {
    return zeroEstimate('还没有任何一章的小结。关键词要有依据，先做一次「全书要点」或至少一章的「本章小结」。')
  }

  // 输入全部来自库里已有的小结，这一条是精确值，不需要假设
  const messages = buildMessages('terms', { ...baseContext(db, request.bookId, null), summaries })
  return {
    inputTokens: messagesTokens(messages),
    maxOutputTokens: maxOutput,
    calls: 1,
    note: `用的是已存的 ${summaries.length} 章小结，不需要重新读正文。`
  }
}

function estimateMindmap(db: Database.Database, request: TaskEstimateRequest, call: CacheCall): AiEstimate {
  if (getResult(db, mindmapKey(request.bookId, call))) {
    return zeroEstimate('思维导图已经有结果，会直接读缓存。')
  }
  if (!getResult(db, termsKey(request.bookId, call))) {
    return zeroEstimate('思维导图是把「关键词」按章节重新组织的，先生成一次关键词。')
  }
  return zeroEstimate('思维导图不调用模型，是把已有「关键词」按章节重新组织的，不产生费用。')
}

/** calls 为 0 的预估：不发起任何请求，界面据此不显示 token 数字 */
function zeroEstimate(note: string): AiEstimate {
  return { inputTokens: 0, maxOutputTokens: 0, calls: 0, note }
}

// ---------- 形状校验 ----------

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/** 只留非空字符串。缺字段是模型的问题，不该让整条结果作废 */
function asTextList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item !== '')
}

function asTerm(value: unknown): SummaryTerm | null {
  const row = asRecord(value)
  if (!row) return null
  const term = asText(row.term)
  const gloss = asText(row.gloss)
  return term && gloss ? { term, gloss } : null
}

export function asSummary(value: unknown): ChapterSummaryPayload | null {
  const row = asRecord(value)
  if (!row) return null
  const overview = asText(row.overview)
  const keyPoints = asTextList(row.keyPoints)
  if (!overview || !keyPoints || keyPoints.length === 0) return null
  const terms = Array.isArray(row.terms)
    ? row.terms.map(asTerm).filter((item): item is SummaryTerm => item !== null)
    : []
  return { overview, keyPoints, terms }
}

export function asDigest(value: unknown): BookDigestPayload | null {
  const row = asRecord(value)
  if (!row) return null
  const threads = asTextList(row.threads)
  const args = asTextList(row.arguments)
  const conclusion = asText(row.conclusion)
  if (!threads || !args || !conclusion) return null
  return { threads, arguments: args, conclusion }
}

export function asTerms(value: unknown): TermsPayload | null {
  const row = asRecord(value)
  if (!row || !Array.isArray(row.terms)) return null
  const terms: Term[] = []
  for (const item of row.terms) {
    const entry = asRecord(item)
    if (!entry) continue
    const term = asText(entry.term)
    const gloss = asText(entry.gloss)
    if (!term || !gloss) continue
    terms.push({ term, gloss, where: asText(entry.where) ?? '' })
  }
  return terms.length === 0 ? null : { terms }
}