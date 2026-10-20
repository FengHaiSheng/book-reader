import type { HighlightWithBook } from '@shared/types'

export type NotesKind = 'all' | 'marked' | 'annotated'

export type NotesFilter = {
  kind: NotesKind
  /** null 表示不限定书籍 */
  bookId: string | null
  /** 关键字子串匹配（大小写不敏感）。trim 后为空则不筛 */
  query: string
}

export const KIND_LABELS: Record<NotesKind, string> = {
  all: '全部笔记',
  marked: '仅高亮',
  annotated: '仅有批注'
}

export type BookGroup = {
  bookId: string
  bookTitle: string
  count: number
  notes: HighlightWithBook[]
}

/**
 * 按书分组，**保持传入顺序**。
 *
 * 顺序由主进程的 SQL 定（最近加入的书在前），这里不再排一次——
 * 两处各排一次，早晚会不一致。
 */
export function groupByBook(notes: readonly HighlightWithBook[]): BookGroup[] {
  const groups: BookGroup[] = []
  const index = new Map<string, BookGroup>()
  for (const note of notes) {
    let group = index.get(note.bookId)
    if (!group) {
      group = { bookId: note.bookId, bookTitle: note.bookTitle, count: 0, notes: [] }
      index.set(note.bookId, group)
      groups.push(group)
    }
    group.notes.push(note)
    group.count += 1
  }
  return groups
}

/**
 * 走渲染层过滤而不是 SQL：`listAllHighlights` 已经把全部笔记一次性取回，
 * 这里再复刻一遍 `kind / bookId / query` 的 SQL 只会多出第二种排序口径。
 *
 * 关键字用大小写不敏感的子串匹配，**不用正则** —— 用户输入一个 `(` 就会抛 SyntaxError。
 * 匹配范围是划线与批注两处正文。
 */
export function applyFilter(
  notes: readonly HighlightWithBook[],
  filter: NotesFilter
): HighlightWithBook[] {
  const query = filter.query.trim().toLowerCase()
  return notes.filter((note) => {
    if (filter.bookId !== null && note.bookId !== filter.bookId) return false
    if (filter.kind === 'annotated' && note.note === null) return false
    if (filter.kind === 'marked' && note.note !== null) return false
    if (query === '') return true
    return note.text.toLowerCase().includes(query) || (note.note ?? '').toLowerCase().includes(query)
  })
}

export type NoteCounts = { all: number; marked: number; annotated: number }

/** 侧栏的计数跟着书籍这一维走：选了某本书，类型计数也只算这本书 */
export function countsByKind(
  notes: readonly HighlightWithBook[],
  bookId: string | null
): NoteCounts {
  const scoped = bookId === null ? notes : notes.filter((note) => note.bookId === bookId)
  return {
    all: scoped.length,
    marked: scoped.filter((note) => note.note === null).length,
    annotated: scoped.filter((note) => note.note !== null).length
  }
}

export type BookOption = { bookId: string; bookTitle: string; count: number }

export function bookOptions(notes: readonly HighlightWithBook[]): BookOption[] {
  return groupByBook(notes).map(({ bookId, bookTitle, count }) => ({ bookId, bookTitle, count }))
}

/**
 * 选中项被筛掉之后要落到剩下的第一条。
 * 否则右栏会一直显示一条当前看不见的笔记，用户会以为筛选坏了。
 */
export function resolveSelection(
  notes: readonly HighlightWithBook[],
  selectedId: number | null
): number | null {
  if (selectedId !== null && notes.some((note) => note.id === selectedId)) return selectedId
  return notes[0]?.id ?? null
}
