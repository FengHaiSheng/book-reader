import type Database from 'better-sqlite3'
import { appError } from '@shared/errors'
import { HIGHLIGHT_COLORS, normalizeColor, type HighlightColor } from '@shared/highlights'
import type { BookTag, Tag } from '@shared/types'

const MAX_NAME = 24

/**
 * 一次取回全书库的「书 → 标签」，给 listBooks 用。
 *
 * 写成一次查询而不是每本书查一次：书架默认就能有几百本，N+1 会在这里变成
 * 几百条 SQL，而标签本来就不多。
 */
export function tagsByBook(db: Database.Database): Map<string, BookTag[]> {
  const rows = db
    .prepare(
      `SELECT bt.book_id AS bookId, t.id AS id, t.name AS name, t.color AS color
       FROM book_tags bt
       JOIN tags t ON t.id = bt.tag_id
       ORDER BY t.name COLLATE NOCASE`
    )
    .all() as { bookId: string; id: number; name: string; color: string }[]

  const map = new Map<string, BookTag[]>()
  for (const row of rows) {
    const list = map.get(row.bookId) ?? []
    list.push({ id: row.id, name: row.name, color: normalizeColor(row.color) })
    map.set(row.bookId, list)
  }
  return map
}

export function listTags(db: Database.Database): Tag[] {
  const rows = db
    .prepare(
      `SELECT t.id AS id, t.name AS name, t.color AS color,
              COUNT(bt.book_id) AS bookCount
       FROM tags t
       LEFT JOIN book_tags bt ON bt.tag_id = t.id
       GROUP BY t.id
       ORDER BY t.name COLLATE NOCASE`
    )
    .all() as { id: number; name: string; color: string; bookCount: number }[]

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    color: normalizeColor(row.color),
    bookCount: row.bookCount
  }))
}

export function createTag(db: Database.Database, name: string): Tag {
  const trimmed = cleanName(name)
  if (db.prepare('SELECT id FROM tags WHERE name = ?').get(trimmed)) {
    throw appError('DB_ERROR', `已经有叫「${trimmed}」的标签了`)
  }
  const color = nextColor(db)
  const info = db.prepare('INSERT INTO tags (name, color) VALUES (?, ?)').run(trimmed, color)
  return { id: Number(info.lastInsertRowid), name: trimmed, color, bookCount: 0 }
}

export function renameTag(db: Database.Database, id: number, name: string): Tag {
  const trimmed = cleanName(name)
  if (db.prepare('SELECT id FROM tags WHERE name = ? AND id <> ?').get(trimmed, id)) {
    throw appError('DB_ERROR', `已经有叫「${trimmed}」的标签了`)
  }
  const info = db.prepare('UPDATE tags SET name = ? WHERE id = ?').run(trimmed, id)
  if (info.changes === 0) throw appError('DB_ERROR', '这个标签已经不存在了')

  const row = db
    .prepare(
      `SELECT t.id AS id, t.name AS name, t.color AS color,
              COUNT(bt.book_id) AS bookCount
       FROM tags t
       LEFT JOIN book_tags bt ON bt.tag_id = t.id
       WHERE t.id = ?
       GROUP BY t.id`
    )
    .get(id) as { id: number; name: string; color: string; bookCount: number }

  return {
    id: row.id,
    name: row.name,
    color: normalizeColor(row.color),
    bookCount: row.bookCount
  }
}

/**
 * 删标签只脱掉书上的标签，一本书都不动。
 * `book_tags` 的 ON DELETE CASCADE 需要 `foreign_keys = ON`——计划 01 的 db.ts 已经打开。
 */
export function deleteTag(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM tags WHERE id = ?').run(id)
}

export function assignTag(db: Database.Database, bookId: string, tagId: number, on: boolean): void {
  if (on) {
    db.prepare('INSERT OR IGNORE INTO book_tags (book_id, tag_id) VALUES (?, ?)').run(bookId, tagId)
    return
  }
  db.prepare('DELETE FROM book_tags WHERE book_id = ? AND tag_id = ?').run(bookId, tagId)
}

function cleanName(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) throw appError('DB_ERROR', '标签名不能为空')
  if (trimmed.length > MAX_NAME) throw appError('DB_ERROR', `标签名最多 ${MAX_NAME} 个字`)
  return trimmed
}

/** 按已有标签数轮流取色，让新标签一眼能和旧标签分开 */
function nextColor(db: Database.Database): HighlightColor {
  const row = db.prepare('SELECT COUNT(*) AS n FROM tags').get() as { n: number }
  return HIGHLIGHT_COLORS[row.n % HIGHLIGHT_COLORS.length]!
}