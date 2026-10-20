import type { SearchHitWithBook } from '@shared/types'

export type BookHits = {
  bookId: string
  bookTitle: string
  count: number
  hits: SearchHitWithBook[]
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
