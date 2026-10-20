import type Database from 'better-sqlite3'
import { appError } from '@shared/errors'
import type { Bookmark, BookmarkInput } from '@shared/types'

const COLUMNS = `id, book_id AS bookId, chapter_id AS chapterId, cfi, excerpt, label,
  percent, created_at AS createdAt`

/** 页首摘录最多留这么长：列表一行放得下就够了，回跳兜底也不需要更长 */
const MAX_EXCERPT = 120
const MAX_LABEL = 60

export function listBookmarks(db: Database.Database, bookId: string): Bookmark[] {
  return db
    .prepare(`SELECT ${COLUMNS} FROM bookmarks WHERE book_id = ? ORDER BY created_at DESC`)
    .all(bookId) as Bookmark[]
}

export function findBookmarkAt(
  db: Database.Database,
  bookId: string,
  cfi: string
): Bookmark | null {
  const row = db
    .prepare(`SELECT ${COLUMNS} FROM bookmarks WHERE book_id = ? AND cfi = ?`)
    .get(bookId, cfi)
  return (row as Bookmark | undefined) ?? null
}

export function getBookmark(db: Database.Database, id: number): Bookmark | null {
  const row = db.prepare(`SELECT ${COLUMNS} FROM bookmarks WHERE id = ?`).get(id)
  return (row as Bookmark | undefined) ?? null
}

/**
 * 加书签。
 *
 * 同一页（同一 CFI）只允许一条 —— 唯一键在库层，这里先查一次是为了能明确回一句
 * 「这一页已经有书签了」，而不是让用户看到一次 SQLITE_CONSTRAINT。
 * 返回 `created: false` 表示命中了既有行，界面据此把按钮改成「取消本页书签」。
 */
export function addBookmark(
  db: Database.Database,
  input: BookmarkInput,
  now: number
): { bookmark: Bookmark; created: boolean } {
  const cfi = input.cfi.trim()
  if (cfi === '') throw appError('DB_ERROR', '没有可标记的位置')

  const existing = findBookmarkAt(db, input.bookId, cfi)
  if (existing) return { bookmark: existing, created: false }

  const info = db
    .prepare(
      `INSERT INTO bookmarks (book_id, chapter_id, cfi, excerpt, label, percent, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.bookId,
      input.chapterId,
      cfi,
      normalizeExcerpt(input.excerpt),
      normalizeLabel(input.label),
      clampPercent(input.percent),
      now
    )

  const created = getBookmark(db, Number(info.lastInsertRowid))
  if (!created) throw appError('DB_ERROR', '书签写入后读不回来')
  return { bookmark: created, created: true }
}

export function removeBookmark(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM bookmarks WHERE id = ?').run(id)
}

function normalizeExcerpt(excerpt: string): string {
  return excerpt.replace(/\s+/gu, ' ').trim().slice(0, MAX_EXCERPT)
}

function normalizeLabel(label: string | null | undefined): string | null {
  if (typeof label !== 'string') return null
  const trimmed = label.trim().slice(0, MAX_LABEL)
  return trimmed === '' ? null : trimmed
}

function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0
  return Math.min(1, Math.max(0, percent))
}
