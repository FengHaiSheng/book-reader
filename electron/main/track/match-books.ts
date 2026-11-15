import type Database from 'better-sqlite3'
import { appError } from '@shared/errors'
import {
  decideMatches,
  TRACK_MATCH,
  type MatchBookInput,
  type MatchNodeInput,
  type TrackMatchResult
} from '@shared/track-match'
import { listBooks, listChapters } from '../library/repo'
import { addBookLinks, getActiveTrack, listNodesWithBooks } from './repo'

/**
 * 本地归位：只处理还没挂到任何节点的书，不花钱、不调模型。
 * 高置信的当场以 source=local 落库；中置信的只返回候选，等用户在界面确认。
 */
export function runMatchBooks(
  db: Database.Database,
  opts: { bookIds?: string[] }
): TrackMatchResult {
  const result: TrackMatchResult = { mounted: [], pending: [], skipped: [] }
  const track = getActiveTrack(db)
  if (!track) return result

  const nodes = listNodesWithBooks(db, track.id)
  const linkedBookIds = new Set<string>()
  for (const node of nodes) {
    for (const book of node.books) linkedBookIds.add(book.bookId)
  }

  const library = new Map(listBooks(db).map((book) => [book.id, book]))
  const wanted = Array.isArray(opts.bookIds)
    ? opts.bookIds
    : [...library.keys()].filter((id) => !linkedBookIds.has(id))
  const targetIds = [...new Set(wanted)].filter((id) => library.has(id))

  const books: MatchBookInput[] = targetIds.map((bookId) => {
    const book = library.get(bookId)
    return {
      bookId,
      title: book?.title ?? '',
      author: book?.author ?? null,
      tocTitles: listChapters(db, bookId)
        .slice(0, TRACK_MATCH.tocTitleMax)
        .map((chapter) => chapter.title)
    }
  })

  const matchNodes: MatchNodeInput[] = nodes.map((node) => ({
    id: node.id,
    parentId: node.parentId,
    title: node.title,
    summary: node.summary,
    depth: node.depth
  }))
  const titleById = new Map(nodes.map((node) => [node.id, node.title]))

  const mounts: Array<{ bookId: string; nodeIds: string[] }> = []
  for (const decision of decideMatches(books, matchNodes, linkedBookIds)) {
    if (decision.kind === 'mount') {
      mounts.push({ bookId: decision.bookId, nodeIds: decision.nodeIds })
    } else if (decision.kind === 'pending') {
      result.pending.push({
        bookId: decision.bookId,
        candidates: decision.candidates.map((candidate) => ({
          nodeId: candidate.nodeId,
          score: candidate.score,
          title: titleById.get(candidate.nodeId) ?? ''
        }))
      })
    } else {
      result.skipped.push({ bookId: decision.bookId, reason: decision.reason })
    }
  }

  if (mounts.length > 0) {
    // 一次事务写完，中途出错不会留下只挂了一半的归位结果
    addBookLinks(
      db,
      track.id,
      mounts.flatMap((mount) =>
        mount.nodeIds.map((nodeId) => ({ nodeId, bookId: mount.bookId, source: 'local' as const }))
      ),
      Date.now()
    )
    result.mounted.push(...mounts)
  }
  return result
}

/** 用户确认待归位候选：整批记为 user。这本书已经挂过节点就不再接受。 */
export function runConfirmMatch(
  db: Database.Database,
  bookId: string,
  nodeIds: string[],
  now: number = Date.now()
): void {
  const track = getActiveTrack(db)
  if (!track) throw appError('DB_ERROR', '还没有学习脉络')

  const id = typeof bookId === 'string' ? bookId.trim() : ''
  if (id === '') throw appError('DB_ERROR', '缺少要归位的书')
  if (!Array.isArray(nodeIds) || nodeIds.some((nodeId) => typeof nodeId !== 'string')) {
    throw appError('DB_ERROR', '挂书列表不正确')
  }
  const unique = [...new Set(nodeIds.map((nodeId) => nodeId.trim()).filter((nodeId) => nodeId !== ''))]
  if (unique.length === 0) throw appError('DB_ERROR', '至少选一个节点')

  const linked = listNodesWithBooks(db, track.id).some((node) =>
    node.books.some((book) => book.bookId === id)
  )
  if (linked) throw appError('DB_ERROR', '这本书已经挂过节点了')

  // addBookLinks 在同一事务里校验节点属于这条脉络，任何一个对不上都整批不写
  addBookLinks(
    db,
    track.id,
    unique.map((nodeId) => ({ nodeId, bookId: id, source: 'user' as const })),
    now
  )
}
