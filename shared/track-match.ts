export const TRACK_MATCH = {
  highMin: 0.82,
  highGap: 0.15,
  medMin: 0.48,
  tocTitleMax: 12,
  pendingMax: 3
} as const

export type MatchBookInput = {
  bookId: string
  title: string
  author: string | null
  tocTitles: string[] // 已截断
}

export type MatchNodeInput = {
  id: string
  parentId: string | null
  title: string
  summary: string
  depth: number
}

export type MatchDecision =
  | { bookId: string; kind: 'mount'; nodeIds: string[] }
  | { bookId: string; kind: 'pending'; candidates: Array<{ nodeId: string; score: number }> }
  | { bookId: string; kind: 'skip'; reason: 'low' | 'already-linked' }

const CONTAINMENT_SCORE = 0.92
const AUTHOR_FLOOR = 0.55

const STRIP_RE = /[\u3000\s.,，。:：;；!！?？、·_/\\()（）[\]【】「」『』"'-]+/gu
const TOKEN_RE = /\p{Script=Han}+|[a-z0-9]+/gu

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(STRIP_RE, '')
}

function tokenSet(parts: Array<string | null | undefined>): Set<string> {
  const tokens = new Set<string>()
  for (const part of parts) {
    if (!part) continue
    const found = part.toLowerCase().match(TOKEN_RE)
    if (!found) continue
    for (const token of found) tokens.add(token)
  }
  return tokens
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const token of left) {
    if (right.has(token)) shared += 1
  }
  return shared / (left.size + right.size - shared)
}

/** 节点名与书名规范化后互为子串，且较短方不少于较长方的 40%。 */
function titlesContain(bookTitle: string, nodeTitle: string): boolean {
  if (!nodeTitle || !bookTitle) return false
  if (!bookTitle.includes(nodeTitle) && !nodeTitle.includes(bookTitle)) return false
  const short = Math.min(bookTitle.length, nodeTitle.length)
  const long = Math.max(bookTitle.length, nodeTitle.length)
  return short * 5 >= long * 2
}

function isAncestor(
  ancestorId: string,
  nodeId: string,
  byId: ReadonlyMap<string, MatchNodeInput>
): boolean {
  const seen = new Set<string>()
  let current = byId.get(nodeId)?.parentId ?? null
  while (current && !seen.has(current)) {
    if (current === ancestorId) return true
    seen.add(current)
    current = byId.get(current)?.parentId ?? null
  }
  return false
}

export function scoreBookAgainstNode(book: MatchBookInput, node: MatchNodeInput): number {
  const nodeTitle = normalize(node.title)
  const bookTitle = normalize(book.title)
  // 书名包含命中记 0.92，不再与 Jaccard 取最大；否则用 token Jaccard。作者命中再与 0.55 取最大。
  let score = titlesContain(bookTitle, nodeTitle)
    ? CONTAINMENT_SCORE
    : jaccard(
        tokenSet([book.title, book.author, ...book.tocTitles]),
        tokenSet([node.title, node.summary])
      )

  const author = book.author ? normalize(book.author) : ''
  if (author && normalize(`${node.title}${node.summary}`).includes(author)) {
    score = Math.max(score, AUTHOR_FLOOR)
  }
  return Math.min(1, Math.max(0, score))
}

export function decideBookMatch(
  book: MatchBookInput,
  nodes: MatchNodeInput[],
  linkedBookIds: ReadonlySet<string>
): MatchDecision {
  if (linkedBookIds.has(book.bookId)) {
    return { bookId: book.bookId, kind: 'skip', reason: 'already-linked' }
  }

  const byId = new Map(nodes.map((item) => [item.id, item]))
  const ranked = nodes
    .map((item, index) => ({ item, index, score: scoreBookAgainstNode(book, item) }))
    .filter((entry) => entry.score >= TRACK_MATCH.medMin)

  if (ranked.length === 0) {
    return { bookId: book.bookId, kind: 'skip', reason: 'low' }
  }

  const kept = ranked.filter(
    (entry) =>
      !ranked.some(
        (other) => other.item.id !== entry.item.id && isAncestor(entry.item.id, other.item.id, byId)
      )
  )
  kept.sort((a, b) => b.score - a.score || a.index - b.index)

  const best = kept[0]?.score ?? 0
  const second = kept[1]?.score ?? 0
  if (kept.length > 0 && kept.every((entry) => entry.score >= TRACK_MATCH.highMin)) {
    return { bookId: book.bookId, kind: 'mount', nodeIds: kept.map((entry) => entry.item.id) }
  }
  const winner = kept[0]
  if (winner && best >= TRACK_MATCH.highMin && best - second >= TRACK_MATCH.highGap) {
    return { bookId: book.bookId, kind: 'mount', nodeIds: [winner.item.id] }
  }
  return {
    bookId: book.bookId,
    kind: 'pending',
    candidates: kept.slice(0, TRACK_MATCH.pendingMax).map((entry) => ({
      nodeId: entry.item.id,
      score: entry.score
    }))
  }
}

export function decideMatches(
  books: MatchBookInput[],
  nodes: MatchNodeInput[],
  linkedBookIds: ReadonlySet<string>
): MatchDecision[] {
  return books.map((item) => decideBookMatch(item, nodes, linkedBookIds))
}
