import type Database from 'better-sqlite3'
import type { ProgressInput, ReaderBook, ReaderChapter, ReaderProgress } from '@shared/types'
import { touchOpened } from '../library/repo'

/**
 * 阅读器打开一本书需要的全部数据。
 *
 * 顺带更新 last_opened_at：书架按它排序，点开一本书就应该在书架上顶。
 */
export function openBook(db: Database.Database, bookId: string, now: number): ReaderBook | null {
  const book = db.prepare('SELECT id, title, author FROM books WHERE id = ?').get(bookId) as
    | { id: string; title: string; author: string | null }
    | undefined
  if (!book) return null

  touchOpened(db, bookId, now)

  return {
    id: book.id,
    title: book.title,
    author: book.author,
    chapters: listReaderChapters(db, bookId),
    progress: readProgress(db, bookId)
  }
}

/** 按 id 升序即「目录先序」：计划 02 的 buildChapters 是先序写入的，父行一定先于子行。 */
export function listReaderChapters(db: Database.Database, bookId: string): ReaderChapter[] {
  return db
    .prepare(
      `SELECT id, parent_id AS parentId, title, href, depth, order_index AS spineIndex
       FROM chapters WHERE book_id = ?
       ORDER BY id`
    )
    .all(bookId) as ReaderChapter[]
}

export function readProgress(db: Database.Database, bookId: string): ReaderProgress | null {
  const row = db
    .prepare(
      `SELECT cfi, chapter_id AS chapterId, percent, updated_at AS updatedAt
       FROM reading_progress WHERE book_id = ?`
    )
    .get(bookId) as ReaderProgress | undefined
  return row ?? null
}

/**
 * 进度是覆盖写的：一本书只留一条，翻页时高频调用也不该让表长大。
 *
 * 同时把 books.status 从 unread 推成 reading；读到 99% 以上记 finished。
 * 已经是 finished 的书不再回退状态——重读一遍不该让它从书架的「读完了」里消失。
 */
export function saveProgress(db: Database.Database, input: ProgressInput, now: number): void {
  db.prepare(
    `INSERT INTO reading_progress (book_id, cfi, chapter_id, percent, updated_at)
     VALUES (@bookId, @cfi, @chapterId, @percent, @now)
     ON CONFLICT(book_id) DO UPDATE SET
       cfi = excluded.cfi,
       chapter_id = excluded.chapter_id,
       percent = excluded.percent,
       updated_at = excluded.updated_at`
  ).run({ ...input, now })

  db.prepare("UPDATE books SET status = ? WHERE id = ? AND status <> 'finished'").run(
    input.percent >= 0.99 ? 'finished' : 'reading',
    input.bookId
  )
}
