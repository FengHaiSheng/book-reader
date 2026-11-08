export const TRACK_PROMPT_VERSION = 'v1'

/**
 * 无追问时键就是信号指纹。有追问则另起一行。
 * forceRefresh 再加时间戳，写入新行，不覆盖旧报告。
 */
export function trackGapScopeKey(
  fingerprint: string,
  question: string | undefined,
  forceRefresh: boolean,
  now: number
): string {
  const normalized = (question ?? '').trim().replace(/\s+/g, ' ')
  let key = normalized === '' ? fingerprint : `${fingerprint}\n${normalized}`
  if (forceRefresh) key = `${key}\n${now}`
  return key
}

export const SEDIMENT_WEIGHTS = { highlight: 1, note: 2, aiNote: 3 } as const
export const TRACK_MAX_DEPTH = 3
export const TRACK_LIBRARY_TOP_N = 80

export type NodeSignals = {
  bookCount: number
  progressAvg: number
  unreadRatio: number
  sediment: number
}

export type TrackNodeInput = {
  id: string
  parentId: string | null
  title: string
  summary: string
  depth: number
  sortOrder: number
}

export type TrackGapType = 'coverage' | 'progress' | 'sediment'

export type TrackGapPayload = {
  overall: string
  gaps: Array<{
    nodeId: string
    type: TrackGapType
    summary: string
    suggestBookKinds: string[]
  }>
  nextSteps: string[]
  /** 模型失败降级时保留原文 */
  rawText?: string
  note?: string | null
}

/** 全树节点信号快照。fingerprint 由主进程对 fingerprintSource 做 sha256。 */
export type TrackSignalsSnapshot = {
  nodes: Array<{ id: string } & NodeSignals>
  fingerprintSource: string
}

export function sedimentScore(highlight: number, note: number, aiNote: number): number {
  return (
    highlight * SEDIMENT_WEIGHTS.highlight +
    note * SEDIMENT_WEIGHTS.note +
    aiNote * SEDIMENT_WEIGHTS.aiNote
  )
}

/** 规范化序列；主进程再 sha256。前缀版本便于改算法时废旧缓存 */
export function signalsFingerprintSource(
  nodes: Array<{ id: string } & NodeSignals>
): string {
  const lines = [...nodes]
    .sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
    .map(
      (n) =>
        `${n.id}|${n.bookCount}|${n.progressAvg.toFixed(4)}|${n.unreadRatio.toFixed(4)}|${n.sediment}`
    )
  return `${TRACK_PROMPT_VERSION}\n${lines.join('\n')}`
}

/**
 * 把模型骨架 JSON 收成可落库的节点。
 * 校验：数组、id 非空唯一、parent 存在或 null、无环、depth 1..3 且与父子一致、title 非空。
 * 失败返回中文 error。
 */
export function normalizeTrackTree(raw: unknown): { nodes: TrackNodeInput[] } | { error: string } {
  const list = nodeListOf(raw)
  if (!list) return { error: '脉络树必须是节点数组' }

  const nodes: TrackNodeInput[] = []
  const seen = new Set<string>()
  for (const item of list) {
    const parsed = parseNode(item)
    if ('error' in parsed) return parsed
    if (seen.has(parsed.id)) return { error: '节点 id 重复' }
    seen.add(parsed.id)
    nodes.push(parsed)
  }

  const byId = new Map(nodes.map((node) => [node.id, node]))
  for (const node of nodes) {
    if (node.parentId === null) continue
    if (!byId.has(node.parentId)) return { error: '找不到父节点' }
  }

  if (hasCycle(nodes)) return { error: '脉络树存在环' }

  for (const node of nodes) {
    if (node.parentId === null) {
      if (node.depth !== 1) return { error: '节点深度与父子关系不一致' }
      continue
    }
    const parent = byId.get(node.parentId)
    if (!parent || node.depth !== parent.depth + 1) {
      return { error: '节点深度与父子关系不一致' }
    }
  }

  return { nodes }
}

function nodeListOf(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) return raw
  const row = asRecord(raw)
  return row && Array.isArray(row.nodes) ? row.nodes : null
}

function parseNode(value: unknown): TrackNodeInput | { error: string } {
  const row = asRecord(value)
  if (!row) return { error: '脉络树必须是节点数组' }

  const id = asText(row.id)
  if (!id) return { error: '节点 id 不能为空' }

  const title = asText(row.title)
  if (!title) return { error: '节点标题不能为空' }

  const parentRaw = row.parentId ?? row.parent_id
  let parentId: string | null = null
  if (parentRaw !== null && parentRaw !== undefined && parentRaw !== '') {
    const parentText = asText(parentRaw)
    if (!parentText) return { error: '找不到父节点' }
    parentId = parentText
  }

  const depth = row.depth
  if (
    typeof depth !== 'number' ||
    !Number.isInteger(depth) ||
    depth < 1 ||
    depth > TRACK_MAX_DEPTH
  ) {
    return { error: '节点深度超出上限' }
  }

  const sortRaw = row.sortOrder ?? row.sort_order
  const sortOrder = sortRaw === undefined || sortRaw === null ? 0 : sortRaw
  if (typeof sortOrder !== 'number' || !Number.isFinite(sortOrder)) {
    return { error: '节点格式无效' }
  }

  const summary = typeof row.summary === 'string' ? row.summary : ''

  return { id, parentId, title, summary, depth, sortOrder }
}

function hasCycle(nodes: TrackNodeInput[]): boolean {
  const parentOf = new Map(nodes.map((node) => [node.id, node.parentId]))
  for (const node of nodes) {
    const seen = new Set<string>()
    let current: string | null = node.id
    while (current) {
      if (seen.has(current)) return true
      seen.add(current)
      current = parentOf.get(current) ?? null
    }
  }
  return false
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}
