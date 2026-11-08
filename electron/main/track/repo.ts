import type Database from 'better-sqlite3'
import { APP_ERROR_CODES, appError } from '@shared/errors'
import type { TrackGapPayload, TrackNodeInput } from '@shared/track'
import type { AiUsage, ProviderId } from '@shared/types'

export type TrackStatus = 'active' | 'archived'
export type TrackBookSource = 'ai' | 'user'
export type TrackAiTask = 'build' | 'gap'

export type TrackRow = {
  id: string
  goalText: string
  title: string
  status: TrackStatus
  promptVersion: string
  createdAt: number
  updatedAt: number
}

export type TrackLinkInput = {
  nodeId: string
  bookId: string
  source: TrackBookSource
}

export type TrackNodeBookView = {
  bookId: string
  title: string
  author: string | null
  source: TrackBookSource
  createdAt: number
}

export type TrackNodeView = {
  id: string
  trackId: string
  parentId: string | null
  title: string
  summary: string
  sortOrder: number
  depth: number
  createdAt: number
  updatedAt: number
  books: TrackNodeBookView[]
}

export type TrackAiResultKey = {
  trackId: string
  task: TrackAiTask
  scopeKey: string
  promptVersion: string
  provider: ProviderId
  model: string
}

export type StoredTrackResult<T> = {
  payload: T
  inputTokens: number
  outputTokens: number
  createdAt: number
}

/** 最新一条问缺。scopeKey 留给界面对照信号指纹。 */
export type StoredGap = {
  payload: TrackGapPayload
  scopeKey: string
  promptVersion: string
  provider: ProviderId
  model: string
  inputTokens: number
  outputTokens: number
  createdAt: number
}

type LinkRow = {
  nodeId: string
  bookId: string
  source: TrackBookSource
  createdAt: number
}

const TRACK_COLUMNS = `id, goal_text AS goalText, title, status, prompt_version AS promptVersion,
  created_at AS createdAt, updated_at AS updatedAt`

/**
 * 当前正在用的脉络。没有则 null。
 * 若历史上漏出多条 active，取最近更新的一条；真正收口在 replaceActiveTrack。
 */
export function getActiveTrack(db: Database.Database): TrackRow | null {
  const row = db
    .prepare(
      `SELECT ${TRACK_COLUMNS} FROM tracks
       WHERE status = 'active'
       ORDER BY updated_at DESC, id DESC
       LIMIT 1`
    )
    .get() as TrackRow | undefined
  return row ?? null
}

/**
 * 归档全部 active，再插入一条新的 active，并写入节点与挂载。
 * 同一时刻只留一行 active：应用层归档，不加部分唯一索引。
 */
export function replaceActiveTrack(
  db: Database.Database,
  input: {
    id: string
    goalText: string
    title: string
    nodes: TrackNodeInput[]
    links: TrackLinkInput[]
    promptVersion: string
  },
  now: number
): void {
  const id = requireText(input.id, '脉络 id 不能为空')
  const goalText = requireText(input.goalText, '目标不能为空')
  const title = requireText(input.title, '脉络标题不能为空')
  const promptVersion = requireText(input.promptVersion, '提示词版本不能为空')
  assertNodes(input.nodes)
  const links = mergeLinks(nodeIdSet(input.nodes), [], input.links, now)

  runWrite(db, () => {
    db.prepare(`UPDATE tracks SET status = 'archived', updated_at = ? WHERE status = 'active'`).run(now)
    db.prepare(
      `INSERT INTO tracks (id, goal_text, title, status, prompt_version, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?, ?)`
    ).run(id, goalText, title, promptVersion, now, now)
    insertNodes(db, id, input.nodes, now, new Map())
    insertLinks(db, id, links)
  })
}

/** 与换树同一笔写入的目标字段。缺省时只刷新 updated_at。 */
export type TrackRebuildGoal = {
  goalText: string
  title: string
  promptVersion: string
}

/**
 * 换成新骨架。
 *
 * keepUserLinksByNodeId 为真时，新树里仍然存在的 node_id 留下原来的挂载
 *（含用户手改）；对不上的挂载丢掉。传入的 links 只补充还没有的书，
 * 不会把已有的 user 挂载改回 ai。
 * 为假时丢掉该脉络的全部旧挂载，只写入 links。
 * 传入 goal 时，目标、标题、提示词版本和树在同一事务里更新。
 */
export function rebuildActiveTree(
  db: Database.Database,
  trackId: string,
  nodes: TrackNodeInput[],
  links: TrackLinkInput[],
  keepUserLinksByNodeId: boolean,
  now: number,
  goal?: TrackRebuildGoal
): void {
  assertNodes(nodes)
  const nodeIds = nodeIdSet(nodes)
  for (const link of links) assertLinkNode(link, nodeIds)

  runWrite(db, () => {
    const track = db.prepare('SELECT status FROM tracks WHERE id = ?').get(trackId) as
      | { status: string }
      | undefined
    if (!track) throw appError('DB_ERROR', '找不到这条脉络')
    if (track.status !== 'active') throw appError('DB_ERROR', '只能调整正在使用的脉络')

    const preserved = keepUserLinksByNodeId ? readLinks(db, trackId) : []
    const previous = db
      .prepare('SELECT id, created_at AS createdAt FROM track_nodes WHERE track_id = ?')
      .all(trackId) as { id: string; createdAt: number }[]
    const createdAtById = new Map(previous.map((row) => [row.id, row.createdAt]))
    const merged = mergeLinks(nodeIds, preserved, links, now)

    db.prepare('DELETE FROM track_node_books WHERE track_id = ?').run(trackId)
    db.prepare('DELETE FROM track_nodes WHERE track_id = ?').run(trackId)
    insertNodes(db, trackId, nodes, now, createdAtById)
    if (goal) {
      const goalText = requireText(goal.goalText, '目标不能为空')
      const title = requireText(goal.title, '脉络标题不能为空')
      const promptVersion = requireText(goal.promptVersion, '提示词版本不能为空')
      db.prepare(
        `UPDATE tracks SET goal_text = ?, title = ?, prompt_version = ?, updated_at = ?
         WHERE id = ? AND status = 'active'`
      ).run(goalText, title, promptVersion, now, trackId)
    }
    insertLinks(db, trackId, merged)
    if (!goal) db.prepare('UPDATE tracks SET updated_at = ? WHERE id = ?').run(now, trackId)
  })
}

/** 把某节点的挂书设成这份列表，来源一律记成用户手改。 */
export function setNodeBooks(
  db: Database.Database,
  trackId: string,
  nodeId: string,
  bookIds: string[],
  now: number
): void {
  const node = db
    .prepare('SELECT id FROM track_nodes WHERE id = ? AND track_id = ?')
    .get(nodeId, trackId)
  if (!node) throw appError('DB_ERROR', '找不到节点')

  const unique: string[] = []
  const seen = new Set<string>()
  for (const bookId of bookIds) {
    const id = bookId.trim()
    if (id === '' || seen.has(id)) continue
    seen.add(id)
    unique.push(id)
  }

  runWrite(db, () => {
    db.prepare('DELETE FROM track_node_books WHERE track_id = ? AND node_id = ?').run(trackId, nodeId)
    const insert = db.prepare(
      `INSERT INTO track_node_books (track_id, node_id, book_id, source, created_at)
       VALUES (?, ?, ?, 'user', ?)`
    )
    for (const bookId of unique) insert.run(trackId, nodeId, bookId, now)
    db.prepare('UPDATE track_nodes SET updated_at = ? WHERE id = ?').run(now, nodeId)
    db.prepare('UPDATE tracks SET updated_at = ? WHERE id = ?').run(now, trackId)
  })
}

export function renameNode(
  db: Database.Database,
  nodeId: string,
  title: string,
  summary: string,
  now: number
): void {
  const nextTitle = title.trim()
  if (nextTitle === '') throw appError('DB_ERROR', '节点标题不能为空')
  // 值没变时 SQLite 的 changes 可能是 0，不能靠它判断节点在不在
  const existing = db.prepare('SELECT id FROM track_nodes WHERE id = ?').get(nodeId)
  if (!existing) throw appError('DB_ERROR', '找不到节点')
  db.prepare('UPDATE track_nodes SET title = ?, summary = ?, updated_at = ? WHERE id = ?').run(
    nextTitle,
    cleanText(summary),
    now,
    nodeId
  )
  db.prepare(
    `UPDATE tracks SET updated_at = ?
     WHERE id = (SELECT track_id FROM track_nodes WHERE id = ?)`
  ).run(now, nodeId)
}

export function listNodesWithBooks(db: Database.Database, trackId: string): TrackNodeView[] {
  const nodes = db
    .prepare(
      `SELECT id, track_id AS trackId, parent_id AS parentId, title, summary,
              sort_order AS sortOrder, depth, created_at AS createdAt, updated_at AS updatedAt
       FROM track_nodes
       WHERE track_id = ?
       ORDER BY sort_order, id`
    )
    .all(trackId) as Omit<TrackNodeView, 'books'>[]

  const books = db
    .prepare(
      `SELECT l.node_id AS nodeId, l.book_id AS bookId, l.source AS source,
              l.created_at AS createdAt, books.title AS title, books.author AS author
       FROM track_node_books l
       JOIN books ON books.id = l.book_id
       WHERE l.track_id = ?
       ORDER BY l.created_at, l.rowid`
    )
    .all(trackId) as (TrackNodeBookView & { nodeId: string })[]

  const byNode = new Map<string, TrackNodeBookView[]>()
  for (const book of books) {
    const source = asSource(book.source)
    if (!source) continue
    const list = byNode.get(book.nodeId) ?? []
    list.push({
      bookId: book.bookId,
      title: book.title,
      author: book.author,
      source,
      createdAt: book.createdAt
    })
    byNode.set(book.nodeId, list)
  }

  return nodes.map((node) => ({ ...node, books: byNode.get(node.id) ?? [] }))
}

/**
 * 命中唯一键即复用。键含 prompt_version 与 model：改提示词或换模型都另起一行。
 * 同一键再次写入是刷新（用户强制重问走新的 scope_key，不覆盖旧报告）。
 */
export function saveTrackAiResult<T>(
  db: Database.Database,
  key: TrackAiResultKey,
  payload: T,
  usage: AiUsage,
  now: number
): void {
  db.prepare(
    `INSERT INTO track_ai_results
       (track_id, task, scope_key, prompt_version, provider, model, payload,
        input_tokens, output_tokens, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (track_id, task, scope_key, prompt_version, model)
     DO UPDATE SET payload = excluded.payload,
                   provider = excluded.provider,
                   input_tokens = excluded.input_tokens,
                   output_tokens = excluded.output_tokens,
                   created_at = excluded.created_at`
  ).run(
    key.trackId,
    key.task,
    key.scopeKey,
    key.promptVersion,
    key.provider,
    key.model,
    JSON.stringify(payload),
    usage.inputTokens,
    usage.outputTokens,
    now
  )
}

export function getTrackAiResult<T>(
  db: Database.Database,
  key: TrackAiResultKey
): StoredTrackResult<T> | null {
  const row = db
    .prepare(
      `SELECT payload, input_tokens AS inputTokens, output_tokens AS outputTokens,
              created_at AS createdAt
       FROM track_ai_results
       WHERE track_id = ? AND task = ? AND scope_key = ? AND prompt_version = ? AND model = ?`
    )
    .get(key.trackId, key.task, key.scopeKey, key.promptVersion, key.model) as
    | (StoredTrackResult<string> & { payload: string })
    | undefined
  if (!row) return null
  const payload = parseJson<T>(row.payload)
  if (payload === null) return null
  return { payload, inputTokens: row.inputTokens, outputTokens: row.outputTokens, createdAt: row.createdAt }
}

/** 界面默认展示最新一条问缺，不区分追问还是首次。坏掉的 payload 当没有。 */
export function latestGapResult(db: Database.Database, trackId: string): StoredGap | null {
  const row = db
    .prepare(
      `SELECT payload, scope_key AS scopeKey, prompt_version AS promptVersion, provider, model,
              input_tokens AS inputTokens, output_tokens AS outputTokens, created_at AS createdAt
       FROM track_ai_results
       WHERE track_id = ? AND task = 'gap'
       ORDER BY created_at DESC, id DESC
       LIMIT 1`
    )
    .get(trackId) as (Omit<StoredGap, 'payload'> & { payload: string }) | undefined
  if (!row) return null
  const payload = parseJson<TrackGapPayload>(row.payload)
  if (payload === null) return null
  return {
    payload,
    scopeKey: row.scopeKey,
    promptVersion: row.promptVersion,
    provider: row.provider,
    model: row.model,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    createdAt: row.createdAt
  }
}

function insertNodes(
  db: Database.Database,
  trackId: string,
  nodes: TrackNodeInput[],
  now: number,
  createdAtById: Map<string, number>
): void {
  const insert = db.prepare(
    `INSERT INTO track_nodes
       (id, track_id, parent_id, title, summary, sort_order, depth, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  for (const node of nodes) {
    insert.run(
      node.id,
      trackId,
      node.parentId ? node.parentId : null,
      node.title.trim(),
      cleanText(node.summary),
      node.sortOrder,
      node.depth,
      createdAtById.get(node.id) ?? now,
      now
    )
  }
}

function insertLinks(db: Database.Database, trackId: string, links: LinkRow[]): void {
  const insert = db.prepare(
    `INSERT INTO track_node_books (track_id, node_id, book_id, source, created_at)
     VALUES (?, ?, ?, ?, ?)`
  )
  for (const link of links) {
    insert.run(trackId, link.nodeId, link.bookId, link.source, link.createdAt)
  }
}

function readLinks(db: Database.Database, trackId: string): LinkRow[] {
  const rows = db
    .prepare(
      `SELECT node_id AS nodeId, book_id AS bookId, source, created_at AS createdAt
       FROM track_node_books
       WHERE track_id = ?
       ORDER BY created_at, rowid`
    )
    .all(trackId) as { nodeId: string; bookId: string; source: string; createdAt: number }[]
  const links: LinkRow[] = []
  for (const row of rows) {
    const source = asSource(row.source)
    if (!source) continue
    links.push({ ...row, source })
  }
  return links
}

/**
 * 旧挂载先占位。新挂载只补还没有的书；同一本书已经是 user 时，不接受 ai 把它改回去。
 */
function mergeLinks(
  nodeIds: Set<string>,
  preserved: LinkRow[],
  incoming: TrackLinkInput[],
  now: number
): LinkRow[] {
  const merged = new Map<string, LinkRow>()
  for (const row of preserved) {
    if (!nodeIds.has(row.nodeId)) continue
    merged.set(linkKey(row.nodeId, row.bookId), row)
  }
  for (const link of incoming) {
    assertLinkNode(link, nodeIds)
    const source = asSource(link.source)
    if (!source) throw appError('DB_ERROR', '挂载来源无效')
    const bookId = link.bookId.trim()
    if (bookId === '') throw appError('DB_ERROR', '挂载缺少书籍')
    const key = linkKey(link.nodeId, bookId)
    const prev = merged.get(key)
    if (prev?.source === 'user' && source !== 'user') continue
    merged.set(key, {
      nodeId: link.nodeId,
      bookId,
      source,
      createdAt: prev?.createdAt ?? now
    })
  }
  return [...merged.values()]
}

function assertNodes(nodes: TrackNodeInput[]): void {
  const seen = new Set<string>()
  for (const node of nodes) {
    if (node.id.trim() === '') throw appError('DB_ERROR', '节点 id 不能为空')
    if (seen.has(node.id)) throw appError('DB_ERROR', '节点 id 重复')
    seen.add(node.id)
    if (node.title.trim() === '') throw appError('DB_ERROR', '节点标题不能为空')
  }
}

function assertLinkNode(link: TrackLinkInput, nodeIds: Set<string>): void {
  if (!nodeIds.has(link.nodeId)) throw appError('DB_ERROR', '挂载指向了不存在的节点')
}

function nodeIdSet(nodes: TrackNodeInput[]): Set<string> {
  return new Set(nodes.map((node) => node.id))
}

function linkKey(nodeId: string, bookId: string): string {
  return `${nodeId}\0${bookId}`
}

function asSource(value: string): TrackBookSource | null {
  return value === 'ai' || value === 'user' ? value : null
}

function requireText(value: string, message: string): string {
  const text = cleanText(value)
  if (text === '') throw appError('DB_ERROR', message)
  return text
}

function cleanText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function runWrite(db: Database.Database, fn: () => void): void {
  const run = db.transaction(fn)
  try {
    run()
  } catch (error) {
    if (isThrownAppError(error)) throw error
    if (sqliteMessage(error).includes('track_nodes.id')) {
      throw appError('DB_ERROR', '节点 id 与已有脉络冲突')
    }
    if (sqliteMessage(error).includes('tracks.id')) {
      throw appError('DB_ERROR', '脉络 id 已存在')
    }
    if (sqliteCode(error).includes('FOREIGNKEY')) {
      throw appError('DB_ERROR', '挂载的书不在书库里')
    }
    throw error
  }
}

function parseJson<T>(raw: string): T | null {
  try {
    const parsed = JSON.parse(raw) as T
    return parsed === null ? null : parsed
  } catch {
    return null
  }
}

function isThrownAppError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error) || !('message' in error)) {
    return false
  }
  const code = (error as { code: unknown }).code
  return (
    typeof code === 'string' &&
    (APP_ERROR_CODES as readonly string[]).includes(code) &&
    typeof (error as { message: unknown }).message === 'string'
  )
}

function sqliteCode(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('code' in error)) return ''
  return String((error as { code: unknown }).code)
}

function sqliteMessage(error: unknown): string {
  return error instanceof Error ? error.message : ''
}
