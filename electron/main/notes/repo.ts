import type Database from 'better-sqlite3'
import { appError } from '@shared/errors'
import {
  DEFAULT_HIGHLIGHT_COLOR,
  MAX_HIGHLIGHT_CHARS,
  normalizeColor,
  normalizeNote,
  normalizeSpan
} from '@shared/highlights'
import type {
  Highlight,
  HighlightAiNote,
  HighlightContext,
  HighlightInput,
  HighlightPatch,
  HighlightWithBook,
  PinAiToHighlightInput,
  PinAiToHighlightResult
} from '@shared/types'
import { sliceContext } from './context'
import { chooseHighlightForPin } from './pin'

const COLUMNS = `h.id, h.book_id AS bookId, h.chapter_id AS chapterId,
  h.start_cfi AS startCfi, h.end_cfi AS endCfi, h.text, h.note, h.color,
  h.created_at AS createdAt, h.updated_at AS updatedAt`

const AI_NOTE_COLUMNS = `id, highlight_id AS highlightId, content, source, created_at AS createdAt`

export function listAiNotesForHighlight(
  db: Database.Database,
  highlightId: number
): HighlightAiNote[] {
  return db
    .prepare(
      `SELECT ${AI_NOTE_COLUMNS} FROM highlight_ai_notes
       WHERE highlight_id = ? ORDER BY created_at, id`
    )
    .all(highlightId) as HighlightAiNote[]
}

export function listAiNotesForHighlights(
  db: Database.Database,
  highlightIds: readonly number[]
): HighlightAiNote[] {
  if (highlightIds.length === 0) return []
  const placeholders = highlightIds.map(() => '?').join(',')
  return db
    .prepare(
      `SELECT ${AI_NOTE_COLUMNS} FROM highlight_ai_notes
       WHERE highlight_id IN (${placeholders})
       ORDER BY highlight_id, created_at, id`
    )
    .all(...highlightIds) as HighlightAiNote[]
}

function attachAiNotes<T extends { id: number }>(
  db: Database.Database,
  rows: T[]
): (T & { aiNotes: HighlightAiNote[] })[] {
  const notes = listAiNotesForHighlights(
    db,
    rows.map((row) => row.id)
  )
  const byId = new Map<number, HighlightAiNote[]>()
  for (const note of notes) {
    const list = byId.get(note.highlightId) ?? []
    list.push(note)
    byId.set(note.highlightId, list)
  }
  return rows.map((row) => ({ ...row, aiNotes: byId.get(row.id) ?? [] }))
}

/** 阅读器只要本章的：一章一个 iframe，注册别章的 Range 没有意义 */
export function listChapterHighlights(
  db: Database.Database,
  bookId: string,
  chapterId: number
): Highlight[] {
  const rows = db
    .prepare(
      `SELECT ${COLUMNS} FROM highlights h WHERE h.book_id = ? AND h.chapter_id = ? ORDER BY h.id`
    )
    .all(bookId, chapterId) as Omit<Highlight, 'aiNotes'>[]
  return attachAiNotes(db, rows)
}

export function getHighlight(db: Database.Database, id: number): Highlight | null {
  const row = db.prepare(`SELECT ${COLUMNS} FROM highlights h WHERE h.id = ?`).get(id) as
    | Omit<Highlight, 'aiNotes'>
    | undefined
  if (!row) return null
  return attachAiNotes(db, [row])[0]!
}

export function createHighlight(
  db: Database.Database,
  input: HighlightInput,
  now: number
): Highlight {
  // 上限在渲染进程也已经拦过一次，这里是第二道锁：
  // IPC 是可以被直接调用的，边界校验不能只放在界面里。
  const text = normalizeSpan(input.text).slice(0, MAX_HIGHLIGHT_CHARS)
  if (text === '') throw appError('DB_ERROR', '选中的内容为空，没有可标注的文字')

  const info = db
    .prepare(
      `INSERT INTO highlights
         (book_id, chapter_id, start_cfi, end_cfi, text, note, color, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.bookId,
      input.chapterId,
      input.startCfi,
      input.endCfi,
      text,
      normalizeNote(input.note),
      normalizeColor(input.color),
      now,
      now
    )

  const created = getHighlight(db, Number(info.lastInsertRowid))
  if (!created) throw appError('DB_ERROR', '标注写入后读不回来')
  return created
}

/** 只改批注与颜色。没传的字段保持原值，传 null 表示「清空批注」 */
export function updateHighlight(
  db: Database.Database,
  id: number,
  patch: HighlightPatch,
  now: number
): Highlight | null {
  const current = getHighlight(db, id)
  if (!current) return null
  db.prepare('UPDATE highlights SET note = ?, color = ?, updated_at = ? WHERE id = ?').run(
    patch.note === undefined ? current.note : normalizeNote(patch.note),
    patch.color === undefined ? current.color : normalizeColor(patch.color),
    now,
    id
  )
  return getHighlight(db, id)
}

export function deleteHighlight(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM highlights WHERE id = ?').run(id)
}

/**
 * 跨书汇总。
 *
 * 排序固定为「最近加入的书在前，书内按章节顺序」：笔记页的分组头就是按这个顺序出的，
 * 不提供排序控件（见「计划拆分说明」）。
 *
 * `chapterOrdinal` 用 `c2.id <= c.id` 数可读章节：计划 02 是先序写入 chapters 的，
 * 所以自增 id 的顺序就是目录先序 —— 与 `listReaderChapters` 依赖的是同一条性质。
 */
export function listAllHighlights(db: Database.Database): HighlightWithBook[] {
  const rows = db
    .prepare(
      `SELECT ${COLUMNS},
              b.title AS bookTitle,
              c.title AS chapterTitle,
              (SELECT COUNT(*) FROM chapters c2
                WHERE c2.book_id = h.book_id AND c2.href <> '' AND c2.id <= c.id) AS chapterOrdinal,
              (SELECT COUNT(*) FROM chapters c3
                WHERE c3.book_id = h.book_id AND c3.href <> '') AS chapterTotal
       FROM highlights h
       JOIN books b ON b.id = h.book_id
       LEFT JOIN chapters c ON c.id = h.chapter_id
       ORDER BY b.added_at DESC, c.order_index, h.id`
    )
    .all() as (Omit<Highlight, 'aiNotes'> & {
    bookTitle: string
    chapterTitle: string | null
    chapterOrdinal: number
    chapterTotal: number
  })[]

  const mapped = rows.map((row) => {
    const total = Math.max(1, row.chapterTotal)
    const ordinal = Math.max(1, row.chapterOrdinal)
    return {
      id: row.id,
      bookId: row.bookId,
      chapterId: row.chapterId,
      startCfi: row.startCfi,
      endCfi: row.endCfi,
      text: row.text,
      note: row.note,
      color: row.color,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      bookTitle: row.bookTitle,
      chapterTitle: row.chapterTitle,
      percent: Math.min(1, (ordinal - 1) / total)
    }
  })

  return attachAiNotes(db, mapped)
}

export function insertAiNote(
  db: Database.Database,
  input: { highlightId: number; content: string; source: HighlightAiNote['source'] },
  now: number
): HighlightAiNote {
  const content = input.content.trim()
  if (content === '') throw appError('DB_ERROR', '没有可记下的回答内容')
  const info = db
    .prepare(
      `INSERT INTO highlight_ai_notes (highlight_id, content, source, created_at)
       VALUES (?, ?, ?, ?)`
    )
    .run(input.highlightId, content, input.source, now)
  const row = db
    .prepare(`SELECT ${AI_NOTE_COLUMNS} FROM highlight_ai_notes WHERE id = ?`)
    .get(Number(info.lastInsertRowid)) as HighlightAiNote | undefined
  if (!row) throw appError('DB_ERROR', 'AI 笔记写入后读不回来')
  return row
}

export function deleteAiNote(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM highlight_ai_notes WHERE id = ?').run(id)
}

/**
 * 找或建划线 + 插入一条 AI 笔记。整段包在事务里。
 * 缺 CFI 且无同文划线 → 可读错误，不建无定位脏数据。
 */
export function pinAiToHighlight(
  db: Database.Database,
  input: PinAiToHighlightInput,
  now: number
): PinAiToHighlightResult {
  const text = normalizeSpan(input.text).slice(0, MAX_HIGHLIGHT_CHARS)
  if (text === '') throw appError('DB_ERROR', '选中的内容为空，没有可标注的文字')

  const run = db.transaction((): PinAiToHighlightResult => {
    const same = db
      .prepare(
        `SELECT id FROM highlights
         WHERE book_id = ? AND chapter_id = ? AND text = ?
         ORDER BY id`
      )
      .all(input.bookId, input.chapterId, text) as { id: number }[]

    const choice = chooseHighlightForPin(same)
    let highlightId: number
    let reusedEarliestDuplicate = false

    if (choice.kind === 'reuse') {
      highlightId = choice.id
      reusedEarliestDuplicate = choice.reusedEarliestDuplicate
    } else {
      if (!input.startCfi || !input.endCfi) {
        throw appError('DB_ERROR', '没法定位到原文，请先划线后再记')
      }
      const created = createHighlight(
        db,
        {
          bookId: input.bookId,
          chapterId: input.chapterId,
          startCfi: input.startCfi,
          endCfi: input.endCfi,
          text,
          note: null,
          color: input.color ?? DEFAULT_HIGHLIGHT_COLOR
        },
        now
      )
      highlightId = created.id
    }

    const aiNote = insertAiNote(
      db,
      { highlightId, content: input.content, source: input.source },
      now
    )
    const highlight = getHighlight(db, highlightId)
    if (!highlight) throw appError('DB_ERROR', '划线读不回来')
    return { highlight, aiNote, reusedEarliestDuplicate }
  })

  return run()
}

/**
 * 右栏的原文上下文。
 *
 * 章节正文只在 chunks 里，所以按 order_index 逐块找「哪个块含这句话」。
 * 块之间有一段重叠，命中可能落在重叠部分 —— 无所谓，取第一个命中的即可。
 * 全都没命中就退化成「只给标注时存下的原句」，located 为 false，界面要明说。
 */
export function highlightContext(db: Database.Database, id: number): HighlightContext {
  const highlight = getHighlight(db, id)
  if (!highlight) {
    return { located: false, chapterTitle: null, before: '', matched: '', after: '' }
  }

  const chapterTitle =
    highlight.chapterId === null ? null : (chapterTitleOf(db, highlight.chapterId) ?? null)

  if (highlight.chapterId !== null) {
    const chunks = db
      .prepare('SELECT text FROM chunks WHERE chapter_id = ? ORDER BY order_index')
      .all(highlight.chapterId) as { text: string }[]
    for (const chunk of chunks) {
      const slice = sliceContext(chunk.text, highlight.text)
      if (slice) return { located: true, chapterTitle, ...slice }
    }
  }

  return { located: false, chapterTitle, before: '', matched: highlight.text, after: '' }
}

function chapterTitleOf(db: Database.Database, chapterId: number): string | null {
  const row = db.prepare('SELECT title FROM chapters WHERE id = ?').get(chapterId)
  return row ? (row as { title: string }).title : null
}
