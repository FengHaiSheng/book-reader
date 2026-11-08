import type { TrackGapPayload, TrackGapType } from '@shared/track'

export type MountSuggestion = {
  nodeId: string
  bookIds: string[]
}

export type MountLink = {
  nodeId: string
  bookId: string
  source: 'ai'
}

const GAP_TYPES = new Set<TrackGapType>(['coverage', 'progress', 'sediment'])

/**
 * 挂载建议。认 `{ mounts | links | assignments: [...] }`、数组，
 * 以及 `{ nodeId: bookId[] }`。认不出的形状返回 null，调用方把书全部留在未归类。
 */
export function parseMountSuggestions(raw: unknown): MountSuggestion[] | null {
  if (Array.isArray(raw)) return parseMountList(raw)
  const row = asRecord(raw)
  if (!row) return null
  if (Array.isArray(row.mounts)) return parseMountList(row.mounts)
  if (Array.isArray(row.links)) return parseMountList(row.links)
  if (Array.isArray(row.assignments)) return parseMountList(row.assignments)
  const entries = Object.entries(row)
  if (entries.length === 0) return []
  if (entries.some(([key]) => key === 'nodes' || key === 'overall' || key === 'gaps')) return null
  if (!entries.every(([, value]) => Array.isArray(value) || typeof value === 'string')) return null
  return entries.map(([nodeId, value]) => ({
    nodeId: nodeId.trim(),
    bookIds: bookIdsOf(value)
  }))
}

/**
 * 丢掉不存在的节点和书库里没有的 bookId。
 * 同一节点上的重复书只留一次。一本书可以出现在多个节点上。
 */
export function applyMountSuggestions(
  suggestions: readonly MountSuggestion[],
  nodeIds: ReadonlySet<string>,
  libraryBookIds: ReadonlySet<string>
): { links: MountLink[]; mountedBookIds: string[] } {
  const byNode = new Map<string, string[]>()
  const mounted = new Set<string>()
  for (const suggestion of suggestions) {
    const nodeId = suggestion.nodeId.trim()
    if (nodeId === '' || !nodeIds.has(nodeId)) continue
    const list = byNode.get(nodeId) ?? []
    const seen = new Set(list)
    for (const bookId of suggestion.bookIds) {
      const id = bookId.trim()
      if (id === '' || !libraryBookIds.has(id) || seen.has(id)) continue
      seen.add(id)
      list.push(id)
      mounted.add(id)
    }
    if (list.length > 0) byNode.set(nodeId, list)
  }
  const links: MountLink[] = []
  for (const [nodeId, bookIds] of byNode) {
    for (const bookId of bookIds) links.push({ nodeId, bookId, source: 'ai' })
  }
  return { links, mountedBookIds: [...mounted] }
}

/** 按书库排序留下还没挂到任何节点的书。 */
export function uncategorizedBookIds(
  rankedIds: readonly string[],
  mounted: ReadonlySet<string>
): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const id of rankedIds) {
    if (id === '' || mounted.has(id) || seen.has(id)) continue
    seen.add(id)
    result.push(id)
  }
  return result
}

/**
 * 问缺结构。指向未知节点的 gap 丢掉，并在 note 里标明条数。
 * 类型或说明不合法的条目直接丢掉，不计入那条 note。
 * 连 overall 和 gaps 都没有时返回 null，调用方改保留原文。
 */
export function validateGapPayload(
  raw: unknown,
  nodeIds: ReadonlySet<string>
): TrackGapPayload | null {
  const row = asRecord(raw)
  if (!row) return null
  const overall = typeof row.overall === 'string' ? row.overall.trim() : null
  const gapsRaw = Array.isArray(row.gaps) ? row.gaps : null
  if (overall === null && gapsRaw === null) return null

  let dropped = 0
  const gaps: TrackGapPayload['gaps'] = []
  for (const item of gapsRaw ?? []) {
    const gap = parseGap(item, nodeIds)
    if (gap === 'unknown') {
      dropped += 1
      continue
    }
    if (gap) gaps.push(gap)
  }

  const stepsRaw = row.nextSteps ?? row.next_steps
  const nextSteps = Array.isArray(stepsRaw)
    ? stepsRaw
        .filter((step): step is string => typeof step === 'string' && step.trim() !== '')
        .map((step) => step.trim())
    : []

  return {
    overall: overall ?? '',
    gaps,
    nextSteps,
    note: dropped > 0 ? `已忽略 ${dropped} 条指向未知节点的缺口` : null
  }
}

function parseMountList(items: readonly unknown[]): MountSuggestion[] {
  const suggestions: MountSuggestion[] = []
  for (const item of items) {
    const row = asRecord(item)
    if (!row) continue
    const nodeId = asText(row.nodeId ?? row.node_id)
    if (!nodeId) continue
    const books = row.bookIds ?? row.book_ids ?? row.books
    suggestions.push({ nodeId, bookIds: bookIdsOf(books) })
  }
  return suggestions
}

function bookIdsOf(value: unknown): string[] {
  if (typeof value === 'string') {
    const id = value.trim()
    return id === '' ? [] : [id]
  }
  if (!Array.isArray(value)) return []
  const ids: string[] = []
  for (const item of value) {
    const id = bookIdOf(item)
    if (id) ids.push(id)
  }
  return ids
}

function bookIdOf(value: unknown): string | null {
  if (typeof value === 'string') return asText(value)
  const row = asRecord(value)
  if (!row) return null
  return asText(row.bookId ?? row.book_id ?? row.id)
}

function parseGap(
  value: unknown,
  nodeIds: ReadonlySet<string>
): TrackGapPayload['gaps'][number] | 'unknown' | null {
  const row = asRecord(value)
  if (!row) return null
  const nodeId = asText(row.nodeId ?? row.node_id)
  if (!nodeId) return null
  if (!nodeIds.has(nodeId)) return 'unknown'
  const type = row.type
  if (typeof type !== 'string' || !GAP_TYPES.has(type as TrackGapType)) return null
  const summary = asText(row.summary)
  if (!summary) return null
  return {
    nodeId,
    type: type as TrackGapType,
    summary,
    suggestBookKinds: textList(row.suggestBookKinds ?? row.suggest_book_kinds)
  }
}

function textList(value: unknown): string[] {
  if (typeof value === 'string') {
    const text = value.trim()
    return text === '' ? [] : [text]
  }
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    .map((item) => item.trim())
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}
