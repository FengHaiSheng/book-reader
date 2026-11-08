import { createHash, randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { PROVIDER_AI, modelOf } from '@shared/ai'
import { appError, toAppError } from '@shared/errors'
import {
  TRACK_PROMPT_VERSION,
  normalizeTrackTree,
  type TrackGapPayload,
  type TrackNodeInput
} from '@shared/track'
import type { AiUsage, ProviderId } from '@shared/types'
import { parseLooseJson } from '../ai/loose-json'
import type { ChatMessage } from '../ai/params'
import { isJsonModeRejection } from '../ai/retry'
import { markUnavailable, unavailableCaps } from '../ai/repo'
import { loadLibrarySummary, type LibrarySummary } from './library-summary'
import {
  gapMessages,
  mountMessages,
  skeletonMessages,
  type GapPromptNode,
  type PreviousTrackNode
} from './prompts'
import {
  getActiveTrack,
  getTrackAiResult,
  listNodesWithBooks,
  rebuildActiveTree,
  replaceActiveTrack,
  saveTrackAiResult,
  type TrackNodeView
} from './repo'
import { computeTrackSignals, type TrackSignalsResult } from './signals'
import {
  applyMountSuggestions,
  parseMountSuggestions,
  uncategorizedBookIds,
  validateGapPayload,
  type MountSuggestion
} from './validate-mount'

/**
 * 与 ai/tasks.ts 的 askJson 同一条路：先按声明带 jsonMode，被拒就记能力表并去掉参数重跑一次，
 * 再用 parseLooseJson。短期写在这里，避免为脉络去改阅读器那份任务。
 *
 * 节点 id 是全局主键，归档脉络的节点还占着。模型给的短 id 一律换成 randomUUID。
 * 重生时，模型原样带回、且仍属于当前脉络的 id 留下，这样同 id 的旧挂载（含用户手改）还能对上。
 * 被丢掉的旧 id 也不会被新 uuid 碰运气撞上，避免挂载贴错节点。
 */

const JSON_NOT_DECLARED = '当前模型不支持结构化输出，已改为提示词约束 + 本地解析。'
const JSON_REJECTED =
  '服务商不接受结构化输出参数（已记下，这家之后不再带该参数），本次改为提示词约束 + 本地解析。'
const JSON_PARSE_HINT = '若下面是模型原文，说明这次没能解析成结构。'

/** 能力树和问缺比章节小结长，2048 容易把 JSON 截断。 */
const TRACK_MAX_OUTPUT = 4096
const TRACK_TEMPERATURE = 0.2

const ZERO: AiUsage = { inputTokens: 0, outputTokens: 0 }

export type TrackChat = (options: {
  providerId: ProviderId
  model: string
  input: {
    messages: readonly ChatMessage[]
    maxTokens: number
    temperature: number
    json: boolean
    stream: false
  }
  signal: AbortSignal
}) => Promise<{ content: string; usage: AiUsage | null }>

export type TrackBuildProgress = { phase: 1 | 2; label: string }

export type TrackBuildInput = {
  goalText: string
  rebuild: boolean
  providerId: ProviderId
  model: string
  signal: AbortSignal
  onProgress: (progress: TrackBuildProgress) => void
  /** 测试注入。缺省走 ai/provider 的 chat。 */
  chat?: TrackChat
}

export type TrackBuildPayload = {
  goalText: string
  nodes: TrackNodeInput[]
  mountedBookIds: string[]
  uncategorizedBookIds: string[]
  note: string | null
}

export type TrackBuildResult = {
  trackId: string
  uncategorizedBookIds: string[]
  usage: AiUsage
  note: string | null
}

export type TrackGapInput = {
  question?: string
  forceRefresh?: boolean
  providerId: ProviderId
  model: string
  signal: AbortSignal
  chat?: TrackChat
}

export type TrackGapResult = {
  payload: TrackGapPayload
  cached: boolean
  usage: AiUsage
  fingerprint: string
}

type Structured<T> = {
  raw: string
  payload: T | null
  usage: AiUsage
  note: string | null
}

/**
 * 新节点换成 uuid，并改写 parentId。
 * preserveIds 里、且这次模型仍输出了的 id 保持不变。
 */
export function remapTrackNodeIds(
  nodes: readonly TrackNodeInput[],
  preserveIds: ReadonlySet<string>
): TrackNodeInput[] {
  const map = new Map<string, string>()
  const used = new Set<string>()
  for (const node of nodes) {
    if (!preserveIds.has(node.id) || used.has(node.id)) continue
    used.add(node.id)
    map.set(node.id, node.id)
  }
  for (const node of nodes) {
    if (map.has(node.id)) continue
    let next = randomUUID()
    while (used.has(next) || preserveIds.has(next)) next = randomUUID()
    used.add(next)
    map.set(node.id, next)
  }
  return nodes.map((node) => ({
    ...node,
    id: mappedId(map, node.id),
    parentId: node.parentId === null ? null : mappedId(map, node.parentId)
  }))
}

/** 规范化目标 + 全书库 id 的 sha256。id 排序后哈希，与展示顺序无关。 */
export function trackBuildScopeKey(goalText: string, bookIds: readonly string[]): string {
  const goal = goalText.trim().replace(/\s+/g, ' ')
  const hash = createHash('sha256').update([...bookIds].sort().join('\n'), 'utf8').digest('hex')
  return `${goal}\n${hash}`
}

/**
 * 无追问时键就是信号指纹。有追问则另起一行。
 * forceRefresh 再加时间戳，写入新行，不覆盖旧报告。
 */
export function trackGapScopeKey(
  fingerprint: string,
  question: string | undefined,
  forceRefresh: boolean,
  now: number
): string {
  const normalized = (question ?? '').trim().replace(/\s+/g, ' ')
  let key = normalized === '' ? fingerprint : `${fingerprint}\n${normalized}`
  if (forceRefresh) key = `${key}\n${now}`
  return key
}

export async function runTrackBuild(
  db: Database.Database,
  input: TrackBuildInput
): Promise<TrackBuildResult> {
  const goal = input.goalText.trim()
  if (goal === '') throw appError('DB_ERROR', '请先写下学习目标')

  const active = input.rebuild ? requireActiveTrack(db) : null
  const previous = active ? previousNodes(db, active.id) : undefined
  const preserveIds = new Set(previous?.map((node) => node.id) ?? [])
  const library = loadLibrarySummary(db)
  const chat = await resolveChat(input.chat)
  const call = {
    providerId: input.providerId,
    model: input.model,
    signal: input.signal,
    chat
  }

  input.onProgress({ phase: 1, label: '正在生成能力骨架' })
  const skeleton = await askJson(db, call, skeletonMessages({
    goalText: goal,
    books: library.books,
    previousNodes: previous
  }), (value) => {
    const tree = treeOrError(value)
    return 'nodes' in tree ? tree.nodes : null
  })
  if (!skeleton.payload) {
    const reason = treeOrError(parseLooseJson(skeleton.raw))
    failBuild('error' in reason ? reason.error : '模型没有返回可用的脉络树', skeleton.raw)
  }

  const nodes = remapTrackNodeIds(skeleton.payload, preserveIds)
  input.onProgress({ phase: 2, label: '正在建议挂书' })
  const mounted = await askJson(
    db,
    call,
    mountMessages({ goalText: goal, nodes, books: library.books }),
    (value) => parseMountSuggestions(value)
  )
  const applied = settleMounts(skeleton, mounted, nodes, library)

  const now = Date.now()
  const trackId = active ? active.id : randomUUID()
  const title = trackTitle(goal)
  const links = applied.links
  if (active) {
    rebuildActiveTree(db, active.id, nodes, links, true, now)
    db.prepare(
      `UPDATE tracks SET goal_text = ?, title = ?, prompt_version = ?, updated_at = ?
       WHERE id = ? AND status = 'active'`
    ).run(goal, title, TRACK_PROMPT_VERSION, now, active.id)
  } else {
    replaceActiveTrack(
      db,
      { id: trackId, goalText: goal, title, nodes, links, promptVersion: TRACK_PROMPT_VERSION },
      now
    )
  }

  const payload: TrackBuildPayload = {
    goalText: goal,
    nodes,
    mountedBookIds: applied.mountedBookIds,
    uncategorizedBookIds: applied.uncategorizedBookIds,
    note: applied.note
  }
  saveTrackAiResult(
    db,
    {
      trackId,
      task: 'build',
      scopeKey: trackBuildScopeKey(goal, library.rankedIds),
      promptVersion: TRACK_PROMPT_VERSION,
      provider: input.providerId,
      model: input.model
    },
    payload,
    applied.usage,
    now
  )

  return {
    trackId,
    uncategorizedBookIds: applied.uncategorizedBookIds,
    usage: applied.usage,
    note: applied.note
  }
}

export async function runTrackGap(
  db: Database.Database,
  input: TrackGapInput
): Promise<TrackGapResult> {
  const track = getActiveTrack(db)
  if (!track) throw appError('DB_ERROR', '还没有学习脉络，请先生成')

  const tree = listNodesWithBooks(db, track.id)
  const signals = computeTrackSignals(db, track.id)
  const now = Date.now()
  const scopeKey = trackGapScopeKey(signals.fingerprint, input.question, input.forceRefresh === true, now)
  const key = {
    trackId: track.id,
    task: 'gap' as const,
    scopeKey,
    promptVersion: TRACK_PROMPT_VERSION,
    provider: input.providerId,
    model: input.model
  }
  const cached = getTrackAiResult<TrackGapPayload>(db, key)
  if (cached) {
    return {
      payload: cached.payload,
      cached: true,
      usage: { inputTokens: cached.inputTokens, outputTokens: cached.outputTokens },
      fingerprint: signals.fingerprint
    }
  }

  const nodeIds = new Set(tree.map((node) => node.id))
  const chat = await resolveChat(input.chat)
  const asked = await askJson(
    db,
    { providerId: input.providerId, model: input.model, signal: input.signal, chat },
    gapMessages({
      goalText: track.goalText,
      nodes: gapNodes(tree, signals),
      question: input.question
    }),
    (value) => validateGapPayload(value, nodeIds)
  )

  const payload = asked.payload
    ? { ...asked.payload, note: composeNote(asked.note, asked.payload.note) }
    : fallbackGap(asked.raw, asked.note)
  const usage = asked.usage
  saveTrackAiResult(db, key, payload, usage, now)
  return { payload, cached: false, usage, fingerprint: signals.fingerprint }
}

function requireActiveTrack(db: Database.Database): NonNullable<ReturnType<typeof getActiveTrack>> {
  const track = getActiveTrack(db)
  if (!track) throw appError('DB_ERROR', '还没有脉络，无法重生')
  return track
}

function previousNodes(db: Database.Database, trackId: string): PreviousTrackNode[] {
  return listNodesWithBooks(db, trackId).map((node) => ({
    id: node.id,
    parentId: node.parentId,
    title: node.title,
    summary: node.summary,
    depth: node.depth,
    sortOrder: node.sortOrder,
    userEdited: node.books.some((book) => book.source === 'user')
  }))
}

function settleMounts(
  skeleton: Structured<TrackNodeInput[]>,
  mounted: Structured<MountSuggestion[]>,
  nodes: readonly TrackNodeInput[],
  library: LibrarySummary
): {
  links: ReturnType<typeof applyMountSuggestions>['links']
  mountedBookIds: string[]
  uncategorizedBookIds: string[]
  note: string | null
  usage: AiUsage
} {
  const nodeIds = new Set(nodes.map((node) => node.id))
  const libraryIds = new Set(library.rankedIds)
  const parsed = mounted.payload
  const applied = applyMountSuggestions(parsed ?? [], nodeIds, libraryIds)
  return {
    links: applied.links,
    mountedBookIds: applied.mountedBookIds,
    uncategorizedBookIds: uncategorizedBookIds(library.rankedIds, new Set(applied.mountedBookIds)),
    note: composeNote(
      library.note,
      skeleton.note,
      mounted.note,
      parsed === null ? '挂载建议没能解析，书都留在未归类' : null
    ),
    usage: addUsage(skeleton.usage, mounted.usage)
  }
}

function gapNodes(tree: readonly TrackNodeView[], signals: TrackSignalsResult): GapPromptNode[] {
  const byId = new Map(signals.nodes.map((row) => [row.nodeId, row]))
  return tree.map((node) => {
    const signal = byId.get(node.id)
    const empty = node.books.length === 0
    return {
      id: node.id,
      title: node.title,
      summary: node.summary,
      depth: node.depth,
      bookTitles: node.books.map((book) => book.title),
      bookCount: signal?.bookCount ?? node.books.length,
      progressAvg: signal?.progressAvg ?? 0,
      unreadRatio: signal?.unreadRatio ?? (empty ? 1 : 0),
      sediment: signal?.sediment ?? 0,
      strength: signal?.strength ?? (empty ? 'empty' : 'weak')
    }
  })
}

function fallbackGap(raw: string, note: string | null): TrackGapPayload {
  return {
    overall: '',
    gaps: [],
    nextSteps: [],
    rawText: raw,
    note: composeNote(note, '模型没有按要求返回问缺结构，已保留原文')
  }
}

function treeOrError(value: unknown): { nodes: TrackNodeInput[] } | { error: string } {
  if (value === null || value === undefined) return { error: '模型没有返回可用的脉络树' }
  const normalized = normalizeTrackTree(value)
  if ('error' in normalized) return normalized
  if (normalized.nodes.length === 0) return { error: '模型没有给出任何节点' }
  return normalized
}

function failBuild(reason: string, raw: string): never {
  const excerpt = reason === '模型没有返回可用的脉络树' ? oneLine(raw, 180) : ''
  const message = excerpt ? `没能保存脉络：${reason}。模型原文：${excerpt}` : `没能保存脉络：${reason}`
  throw appError('AI_UNSUPPORTED', message, { detail: raw.slice(0, 4000), action: 'retry' })
}

function trackTitle(goal: string): string {
  const line = goal.split('\n')[0]?.trim().replace(/\s+/g, ' ') ?? ''
  const text = line === '' ? goal.replace(/\s+/g, ' ') : line
  return text.length <= 40 ? text : `${text.slice(0, 40)}…`
}

function mappedId(map: ReadonlyMap<string, string>, id: string): string {
  const next = map.get(id)
  if (!next) throw appError('DB_ERROR', '节点 id 映射失败')
  return next
}

async function resolveChat(chat: TrackChat | undefined): Promise<TrackChat> {
  if (chat) return chat
  const { chat: real } = await import('../ai/provider')
  return (options) =>
    real({
      providerId: options.providerId,
      model: options.model,
      input: {
        messages: [...options.input.messages],
        maxTokens: options.input.maxTokens,
        temperature: options.input.temperature,
        json: options.input.json,
        stream: false
      },
      signal: options.signal
    })
}

async function askJson<T>(
  db: Database.Database,
  call: { providerId: ProviderId; model: string; signal: AbortSignal; chat: TrackChat },
  messages: ChatMessage[],
  validate: (value: unknown) => T | null
): Promise<Structured<T>> {
  const declared =
    PROVIDER_AI[call.providerId].jsonMode && modelOf(call.providerId, call.model)?.jsonMode === true
  const wantedJson = declared && !unavailableCaps(db, call.providerId).includes('jsonMode')

  const ask = (json: boolean) =>
    call.chat({
      providerId: call.providerId,
      model: call.model,
      input: {
        messages,
        maxTokens: TRACK_MAX_OUTPUT,
        temperature: TRACK_TEMPERATURE,
        json,
        stream: false
      },
      signal: call.signal
    })

  let usedJson = wantedJson
  let result: { content: string; usage: AiUsage | null }
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
    usage: usageOf(result.usage),
    note: jsonNote(usedJson, declared, payload !== null)
  }
}

function jsonNote(usedJson: boolean, declared: boolean, parsed: boolean): string | null {
  if (usedJson) return parsed ? null : JSON_PARSE_HINT
  const reason = declared ? JSON_REJECTED : JSON_NOT_DECLARED
  return parsed ? reason : composeNote(reason, JSON_PARSE_HINT)
}

function addUsage(left: AiUsage, right: AiUsage): AiUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens
  }
}

function usageOf(usage: AiUsage | null | undefined): AiUsage {
  if (!usage) return ZERO
  return {
    inputTokens: finiteToken(usage.inputTokens),
    outputTokens: finiteToken(usage.outputTokens)
  }
}

function finiteToken(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}

function composeNote(...parts: (string | null | undefined)[]): string | null {
  const kept: string[] = []
  for (const part of parts) {
    if (typeof part !== 'string' || part.trim() === '' || kept.includes(part)) continue
    kept.push(part)
  }
  return kept.length === 0 ? null : kept.join(' ')
}

function oneLine(value: string, max: number): string {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length <= max ? text : `${text.slice(0, max)}…`
}
