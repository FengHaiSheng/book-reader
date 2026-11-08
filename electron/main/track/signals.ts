import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { sedimentScore, signalsFingerprintSource } from '@shared/track'
import { listNodesWithBooks } from './repo'

/**
 * `reading_progress.percent` 是 0–1，与阅读器保存一致：
 * `electron/main/reader/repo.ts` 在 `percent >= 0.99` 时把书标成 finished。
 * 不要按 0–100 来平均。
 *
 * 未读：没有 progress 行，或 percent < 0.005（约等于 0 的误差）。
 * 缺行在均值里按 0 计；未读的微小进度仍用夹到 [0, 1] 后的原值。
 *
 * 角标 strength 不进指纹，只给界面：
 * - empty：0 本书
 * - weak：有书，且 progressAvg < 0.2 或 sediment < 3
 * - ok：有书，且平均进度 ≥ 0.2、沉淀 ≥ 3
 *
 * 0.2 = 平均还没读到两成。
 * 3 = 一处带批注的划线（highlight×1 + note×2）。光有划线、或完全没有笔记，都算沉淀低。
 * 批注计数与 `normalizeNote` 一致：null、空串、纯空白都不算。
 * AI 笔记按 `highlight_ai_notes` 行数计，一本多条就多条。
 */
export const UNREAD_PERCENT = 0.005
export const WEAK_PROGRESS_AVG = 0.2
export const WEAK_SEDIMENT = 3

/** SQLite 默认最多 999 个绑定变量，留出余量再拆查询。 */
const SQL_IN_CHUNK = 400

export type TrackSignalStrength = 'empty' | 'weak' | 'ok'

export type TrackSignalRow = {
  nodeId: string
  bookCount: number
  /** 无书时 0 */
  progressAvg: number
  /** 无书时 1 */
  unreadRatio: number
  sediment: number
  strength: TrackSignalStrength
}

export type TrackSignalsResult = {
  nodes: TrackSignalRow[]
  fingerprintSource: string
  /** sha256 hex of fingerprintSource */
  fingerprint: string
}

/** 一本书已经查好的进度和沉淀原料。percent 为 null 表示没有 progress 行。 */
export type BookSignalMetrics = {
  percent: number | null
  highlight: number
  note: number
  aiNote: number
}

export type TrackNodeBooks = {
  nodeId: string
  bookIds: readonly string[]
}

type MetricRow = {
  bookId: string
  percent: unknown
  highlight: unknown
  note: unknown
  aiNote: unknown
}

/**
 * 节点挂书 + 书指标 → 每节点信号与指纹。
 * 同一节点里重复的 bookId 只计一次。同一本书挂在多个节点上，每个节点各算一份。
 * 指标 map 里没有的书：当作未读、没有划线。
 */
export function aggregateTrackSignals(
  nodes: readonly TrackNodeBooks[],
  metricsByBookId: ReadonlyMap<string, BookSignalMetrics>
): TrackSignalsResult {
  const rows = nodes.map((node) => signalRow(node, metricsByBookId))
  const fingerprintSource = signalsFingerprintSource(
    rows.map((row) => ({
      id: row.nodeId,
      bookCount: row.bookCount,
      progressAvg: row.progressAvg,
      unreadRatio: row.unreadRatio,
      sediment: row.sediment
    }))
  )
  return {
    nodes: rows,
    fingerprintSource,
    fingerprint: createHash('sha256').update(fingerprintSource).digest('hex')
  }
}

/** 读出这些书的进度 / 划线 / 批注 / AI 笔记。空列表不查库。 */
export function loadBookSignalMetrics(
  db: Database.Database,
  bookIds: readonly string[]
): Map<string, BookSignalMetrics> {
  const ids = uniqueIds(bookIds)
  const metrics = new Map<string, BookSignalMetrics>()
  for (let offset = 0; offset < ids.length; offset += SQL_IN_CHUNK) {
    const chunk = ids.slice(offset, offset + SQL_IN_CHUNK)
    const placeholders = chunk.map(() => '?').join(', ')
    const rows = db.prepare(bookMetricsSql(placeholders)).all(...chunk) as MetricRow[]
    for (const row of rows) {
      metrics.set(row.bookId, {
        percent: asPercent(row.percent),
        highlight: asCount(row.highlight),
        note: asCount(row.note),
        aiNote: asCount(row.aiNote)
      })
    }
  }
  return metrics
}

export function computeTrackSignals(db: Database.Database, trackId: string): TrackSignalsResult {
  const views = listNodesWithBooks(db, trackId)
  const bookIds = views.flatMap((node) => node.books.map((book) => book.bookId))
  return aggregateTrackSignals(
    views.map((node) => ({
      nodeId: node.id,
      bookIds: node.books.map((book) => book.bookId)
    })),
    loadBookSignalMetrics(db, bookIds)
  )
}

function signalRow(
  node: TrackNodeBooks,
  metricsByBookId: ReadonlyMap<string, BookSignalMetrics>
): TrackSignalRow {
  const bookIds = uniqueIds(node.bookIds)
  if (bookIds.length === 0) {
    return {
      nodeId: node.nodeId,
      bookCount: 0,
      progressAvg: 0,
      unreadRatio: 1,
      sediment: 0,
      strength: 'empty'
    }
  }

  let progressSum = 0
  let unread = 0
  let highlight = 0
  let note = 0
  let aiNote = 0
  for (const bookId of bookIds) {
    const metrics = metricsByBookId.get(bookId)
    const progress = clampedPercent(metrics?.percent ?? null)
    progressSum += progress.value
    if (progress.unread) unread += 1
    highlight += asCount(metrics?.highlight)
    note += asCount(metrics?.note)
    aiNote += asCount(metrics?.aiNote)
  }

  const bookCount = bookIds.length
  const progressAvg = progressSum / bookCount
  const unreadRatio = unread / bookCount
  const sediment = sedimentScore(highlight, note, aiNote)
  return {
    nodeId: node.nodeId,
    bookCount,
    progressAvg,
    unreadRatio,
    sediment,
    strength: strengthOf(bookCount, progressAvg, sediment)
  }
}

function strengthOf(bookCount: number, progressAvg: number, sediment: number): TrackSignalStrength {
  if (bookCount <= 0) return 'empty'
  if (progressAvg < WEAK_PROGRESS_AVG || sediment < WEAK_SEDIMENT) return 'weak'
  return 'ok'
}

function clampedPercent(percent: number | null): { value: number; unread: boolean } {
  if (percent === null || !Number.isFinite(percent)) return { value: 0, unread: true }
  const value = Math.min(1, Math.max(0, percent))
  return { value, unread: value < UNREAD_PERCENT }
}

function uniqueIds(ids: readonly string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []
  for (const raw of ids) {
    const id = raw.trim()
    if (id === '' || seen.has(id)) continue
    seen.add(id)
    unique.push(id)
  }
  return unique
}

function bookMetricsSql(placeholders: string): string {
  return `SELECT b.id AS bookId,
            (SELECT p.percent FROM reading_progress p WHERE p.book_id = b.id) AS percent,
            (SELECT COUNT(*) FROM highlights h WHERE h.book_id = b.id) AS highlight,
            (SELECT COUNT(*) FROM highlights h
              WHERE h.book_id = b.id AND h.note IS NOT NULL AND TRIM(h.note) <> '') AS note,
            (SELECT COUNT(*) FROM highlight_ai_notes n
              JOIN highlights h ON h.id = n.highlight_id
              WHERE h.book_id = b.id) AS aiNote
     FROM books b
     WHERE b.id IN (${placeholders})`
}

function asPercent(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function asCount(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0) return 0
  return n
}
