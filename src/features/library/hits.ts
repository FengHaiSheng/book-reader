import type { SearchHitWithBook } from '@shared/types'

/** 浮层整次结果统一分页；与「每书截 5 条」无关 */
export const PAGE_SIZE = 10

export type BookHits = {
  bookId: string
  bookTitle: string
  count: number
  hits: SearchHitWithBook[]
}

/** 0-based 页；越界给空数组 */
export function sliceHitsPage(
  hits: readonly SearchHitWithBook[],
  page: number
): SearchHitWithBook[] {
  if (page < 0) return []
  const start = page * PAGE_SIZE
  return hits.slice(start, start + PAGE_SIZE)
}

/** 至少 1 页（空结果也显示「第 1 / 1 页」由 UI 决定；这里空为 0） */
export function hitPageCount(total: number): number {
  if (total <= 0) return 0
  return Math.ceil(total / PAGE_SIZE)
}

/**
 * 按书分组，**保持传入顺序**。
 *
 * 主进程回的是扁平数组、顺序就是 bm25 名次；这里只做保序分组，不重排 ——
 * 重排（比如按命中数）会把「最相关的那条」从组首挤下去，用户点开的就不再是最相关的一处。
 */
export function groupHitsByBook(hits: readonly SearchHitWithBook[]): BookHits[] {
  const groups: BookHits[] = []
  const index = new Map<string, BookHits>()
  for (const hit of hits) {
    let group = index.get(hit.bookId)
    if (!group) {
      group = { bookId: hit.bookId, bookTitle: hit.bookTitle, count: 0, hits: [] }
      index.set(hit.bookId, group)
      groups.push(group)
    }
    group.hits.push(hit)
    group.count += 1
  }
  return groups
}
