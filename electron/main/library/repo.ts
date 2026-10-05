import type Database from 'better-sqlite3'
import type {
  BookSummary,
  ChapterRowView,
  ImportOutcome,
  LibraryStats,
  SearchHit
} from '@shared/types'
import { tagsByBook } from './tags'
import { toIndexText, toMatchQuery } from '../epub/bigram'
import type { ChapterRow, ChunkDraft } from '../epub/types'

export type BookInsert = {
  id: string
  title: string
  author: string | null
  publisher: string | null
  language: string | null
  isbn: string | null
  coverPath: string | null
  filePath: string
  fileHash: string
  fileSize: number
  totalChars: number
  chapterCount: number
  addedAt: number
}

export type ChapterInsert = { row: ChapterRow; chunks: ChunkDraft[]; headingPath: string }

export function findByHash(db: Database.Database, hash: string): { id: string; title: string } | null {
  const row = db.prepare('SELECT id, title FROM books WHERE file_hash = ?').get(hash) as
    | { id: string; title: string }
    | undefined
  return row ?? null
}

/** listBooks 的中间形态：先按行取回，再把标签一次贴上去 */
type BookRow = Omit<BookSummary, 'tags'>

export function listBooks(db: Database.Database, tagId: number | null = null): BookSummary[] {
  const rows = db
    .prepare(
      `SELECT id, title, author, cover_path AS coverPath, status,
              chapter_count AS chapterCount, total_chars AS totalChars,
              file_size AS fileSize,
              COALESCE((SELECT percent FROM reading_progress p WHERE p.book_id = books.id), 0) AS percent,
              added_at AS addedAt, last_opened_at AS lastOpenedAt
       FROM books
       WHERE ? IS NULL OR id IN (SELECT book_id FROM book_tags WHERE tag_id = ?)
       ORDER BY COALESCE(last_opened_at, added_at) DESC`
    )
    .all(tagId, tagId) as BookRow[]

  const tags = tagsByBook(db)
  return rows.map((row) => ({ ...row, tags: tags.get(row.id) ?? [] }))
}

/** 侧栏「本地书库」的汇总。空表时 SUM 为 null，必须 COALESCE 回 0。 */
export function libraryStats(db: Database.Database): LibraryStats {
  return db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN status = 'unread' THEN 1 ELSE 0 END), 0) AS unread,
              COALESCE(SUM(CASE WHEN status = 'reading' THEN 1 ELSE 0 END), 0) AS reading,
              COALESCE(SUM(CASE WHEN status = 'finished' THEN 1 ELSE 0 END), 0) AS finished,
              COALESCE(SUM(file_size), 0) AS bytes
       FROM books`
    )
    .get() as LibraryStats
}

export function listChapters(db: Database.Database, bookId: string): ChapterRowView[] {
  return db
    .prepare(
      `SELECT id, parent_id AS parentId, order_index AS orderIndex, title, href, depth,
              char_start AS charStart, char_end AS charEnd
       FROM chapters WHERE book_id = ?
       ORDER BY id`
    )
    .all(bookId) as ChapterRowView[]
}

export function searchChunks(
  db: Database.Database,
  bookId: string,
  query: string,
  limit = 12
): SearchHit[] {
  const match = toMatchQuery(query)
  if (!match) return []
  return db
    .prepare(
      `SELECT c.id AS chunkId, c.chapter_id AS chapterId, c.heading_path AS headingPath,
              c.text AS text, f.score AS score
       FROM (SELECT rowid AS rid, bm25(chunks_fts) AS score FROM chunks_fts WHERE chunks_fts MATCH ?) f
       JOIN chunks c ON c.id = f.rid
       WHERE c.book_id = ?
       ORDER BY f.score
       LIMIT ?`
    )
    .all(match, bookId, limit) as SearchHit[]
}

/**
 * 按 id 批量取回 chunk 的完整信息。
 *
 * 向量检索只给 id 与相似度，正文得回这里取。SQL 的 IN 不保证返回顺序，
 * 所以按传入 ids 的顺序回填——调用方（融合后的名次）就是优先级，不能被打乱。
 */
export function chunksByIds(db: Database.Database, ids: readonly number[]): SearchHit[] {
  if (ids.length === 0) return []
  const placeholders = ids.map(() => '?').join(', ')
  const rows = db
    .prepare(
      `SELECT id AS chunkId, chapter_id AS chapterId, heading_path AS headingPath,
              text AS text, 0 AS score
       FROM chunks WHERE id IN (${placeholders})`
    )
    .all(...ids) as SearchHit[]
  const byId = new Map(rows.map((row) => [row.chunkId, row]))
  return ids.map((id) => byId.get(id)).filter((row): row is SearchHit => row !== undefined)
}

/**
 * 全书落库。调用方保证已在事务里。
 * chapters 必须按 buildChapters 的顺序传入：parentIndex 指向的是同数组下标，父行一定先于子行插入。
 */
export function insertBookGraph(
  db: Database.Database,
  book: BookInsert,
  chapters: ChapterInsert[]
): void {
  db.prepare(
    `INSERT INTO books (id, title, author, publisher, language, isbn, cover_path, file_path,
                        file_hash, file_size, added_at, total_chars, chapter_count, status)
     VALUES (@id, @title, @author, @publisher, @language, @isbn, @coverPath, @filePath,
             @fileHash, @fileSize, @addedAt, @totalChars, @chapterCount, 'unread')`
  ).run(book)

  const insertChapter = db.prepare(
    `INSERT INTO chapters (book_id, parent_id, order_index, title, href, depth, char_start, char_end)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const insertChunk = db.prepare(
    `INSERT INTO chunks (book_id, chapter_id, order_index, text, token_count, heading_path)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
  const insertFts = db.prepare('INSERT INTO chunks_fts (rowid, text_bigram) VALUES (?, ?)')

  const idByIndex: number[] = []
  chapters.forEach((chapter, index) => {
    const parentId = chapter.row.parentIndex === null ? null : (idByIndex[chapter.row.parentIndex] ?? null)
    const info = insertChapter.run(
      book.id,
      parentId,
      chapter.row.orderIndex,
      chapter.row.title,
      chapter.row.entry,
      chapter.row.depth,
      chapter.row.charStart,
      chapter.row.charEnd
    )
    idByIndex[index] = Number(info.lastInsertRowid)

    for (const chunk of chapter.chunks) {
      const chunkInfo = insertChunk.run(
        book.id,
        idByIndex[index],
        chunk.orderIndex,
        chunk.text,
        chunk.tokenCount,
        chapter.headingPath
      )
      insertFts.run(Number(chunkInfo.lastInsertRowid), toIndexText(chunk.text))
    }
  })
}

/** 删书：先清 FTS，再按外键顺序删表，最后删目录。调用方保证已在事务里。 */
export function deleteBookRows(db: Database.Database, bookId: string): void {
  db.prepare(
    'DELETE FROM chunks_fts WHERE rowid IN (SELECT id FROM chunks WHERE book_id = ?)'
  ).run(bookId)
  db.prepare('DELETE FROM ai_messages WHERE book_id = ?').run(bookId)
  db.prepare('DELETE FROM ai_results WHERE book_id = ?').run(bookId)
  db.prepare('DELETE FROM highlights WHERE book_id = ?').run(bookId)
  db.prepare('DELETE FROM book_tags WHERE book_id = ?').run(bookId)
  db.prepare('DELETE FROM reading_progress WHERE book_id = ?').run(bookId)
  db.prepare('DELETE FROM chunks WHERE book_id = ?').run(bookId)
  db.prepare('DELETE FROM chapters WHERE book_id = ?').run(bookId)
  db.prepare('DELETE FROM books WHERE id = ?').run(bookId)
}

export function updateBookStatus(
  db: Database.Database,
  bookId: string,
  status: 'unread' | 'reading' | 'finished'
): void {
  db.prepare('UPDATE books SET status = ? WHERE id = ?').run(status, bookId)
}

export function touchOpened(db: Database.Database, bookId: string, at: number): void {
  db.prepare('UPDATE books SET last_opened_at = ? WHERE id = ?').run(at, bookId)
}

// 供类型推断使用，避免 @shared/types 与仓储各自定义一套形状
export type { ImportOutcome }
