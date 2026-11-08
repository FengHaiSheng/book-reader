import type Database from 'better-sqlite3'
import type { BookStatus, BookSummary } from '@shared/types'
import { TRACK_LIBRARY_TOP_N } from '@shared/track'
import { listBooks } from '../library/repo'

/** 目录只取前几条有正文的章节标题，帮模型挂书，不送正文。 */
export const TRACK_SUMMARY_CHAPTERS = 5

/** SQLite 默认最多 999 个绑定变量，留出余量再拆查询。 */
const SQL_IN_CHUNK = 400

export type RankableBook = {
  id: string
  status: BookStatus
  tags: readonly (string | { name: string })[]
  lastOpenedAt: number | null
  addedAt: number
}

/** 送给模型的一本书。percent 是 0–1，与 reading_progress.percent 一致。 */
export type TrackLibraryBook = {
  id: string
  title: string
  author: string | null
  tags: string[]
  status: BookStatus
  percent: number
  chapterTitles: string[]
}

export type LibrarySummary = {
  /** 截断后的前 N 本，只这些进提示词 */
  books: TrackLibraryBook[]
  /** 全书库按同一顺序的 id，用来算未归类，含没送进提示词的书 */
  rankedIds: string[]
  total: number
  /** 截断时含「本次只参考了 N 本」；没截断为 null */
  note: string | null
}

/**
 * 在读 > 有标签 > 最近打开。
 * 没打开过的排在所有打开过的后面，再按加入时间从新到旧；仍相同则按 id。
 * 不改入参数组。
 */
export function rankLibraryBooks<T extends RankableBook>(
  books: readonly T[],
  limit = TRACK_LIBRARY_TOP_N
): { books: T[]; rankedIds: string[]; total: number; note: string | null } {
  const sorted = [...books].sort(compareLibraryBooks)
  const total = sorted.length
  const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0
  const kept = sorted.slice(0, cap)
  const note =
    total > kept.length ? `书库共 ${total} 本，本次只参考了 ${kept.length} 本` : null
  return { books: kept, rankedIds: sorted.map((book) => book.id), total, note }
}

/** 全库摘要。进度沿用 listBooks 的 0–1；目录标题按章节顺序最多 TRACK_SUMMARY_CHAPTERS 条。 */
export function loadLibrarySummary(db: Database.Database): LibrarySummary {
  const ranked = rankLibraryBooks(listBooks(db))
  const titles = loadChapterTitles(
    db,
    ranked.books.map((book) => book.id)
  )
  return {
    books: ranked.books.map((book) => toTrackBook(book, titles.get(book.id) ?? [])),
    rankedIds: ranked.rankedIds,
    total: ranked.total,
    note: ranked.note
  }
}

function compareLibraryBooks(a: RankableBook, b: RankableBook): number {
  const reading = rankReading(a) - rankReading(b)
  if (reading !== 0) return reading
  const tags = rankTags(a) - rankTags(b)
  if (tags !== 0) return tags
  const opened = openedAt(b) - openedAt(a)
  if (opened !== 0) return opened
  const added = b.addedAt - a.addedAt
  if (added !== 0) return added
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

function rankReading(book: RankableBook): number {
  return book.status === 'reading' ? 0 : 1
}

function rankTags(book: RankableBook): number {
  return book.tags.length > 0 ? 0 : 1
}

function openedAt(book: RankableBook): number {
  return book.lastOpenedAt ?? Number.NEGATIVE_INFINITY
}

function toTrackBook(book: BookSummary, chapterTitles: string[]): TrackLibraryBook {
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    tags: book.tags.map((tag) => tag.name).filter((name) => name.trim() !== ''),
    status: book.status,
    percent: clamp01(book.percent),
    chapterTitles
  }
}

function loadChapterTitles(db: Database.Database, bookIds: readonly string[]): Map<string, string[]> {
  const titles = new Map<string, string[]>()
  if (bookIds.length === 0) return titles
  for (let index = 0; index < bookIds.length; index += SQL_IN_CHUNK) {
    const chunk = bookIds.slice(index, index + SQL_IN_CHUNK)
    const placeholders = chunk.map(() => '?').join(', ')
    const rows = db
      .prepare(
        `SELECT book_id AS bookId, title
         FROM chapters
         WHERE book_id IN (${placeholders}) AND href <> '' AND TRIM(title) <> ''
         ORDER BY order_index, id`
      )
      .all(...chunk) as { bookId: string; title: unknown }[]
    for (const row of rows) {
      if (typeof row.title !== 'string') continue
      const title = row.title.trim()
      if (title === '') continue
      const list = titles.get(row.bookId) ?? []
      if (list.length >= TRACK_SUMMARY_CHAPTERS) continue
      list.push(title)
      titles.set(row.bookId, list)
    }
  }
  return titles
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}
