import type { TrackGapType } from '@shared/track'

/** 问缺 scopeKey 的第一行是信号指纹。追问和强制刷新只在后面另起一行。 */
export function gapScopeFingerprint(scopeKey: string): string {
  const breakAt = scopeKey.indexOf('\n')
  return breakAt === -1 ? scopeKey : scopeKey.slice(0, breakAt)
}

/** 有最近一次问缺、且它记下的指纹已经不是现在的信号时，提示可重问。不自动重跑。 */
export function gapReportIsStale(
  fingerprint: string | null | undefined,
  scopeKey: string | null | undefined
): boolean {
  if (!fingerprint || !scopeKey) return false
  return gapScopeFingerprint(scopeKey) !== fingerprint
}

export type LinkedNode = {
  books: readonly { bookId: string }[]
}

/**
 * 手改挂载之后本地重算未归类：书架上还没挂到任何节点的书，保持传入顺序。
 * 生成接口自己带回的 uncategorizedBookIds 不要用这个覆盖。
 */
export function unlinkedBookIds(
  books: readonly { id: string }[],
  nodes: readonly LinkedNode[]
): string[] {
  const linked = new Set<string>()
  for (const node of nodes) {
    for (const book of node.books) {
      if (book.bookId !== '') linked.add(book.bookId)
    }
  }
  const seen = new Set<string>()
  const result: string[] = []
  for (const book of books) {
    if (book.id === '' || linked.has(book.id) || seen.has(book.id)) continue
    seen.add(book.id)
    result.push(book.id)
  }
  return result
}

export type TreeSource = {
  id: string
  parentId: string | null
  title: string
  sortOrder: number
}

export type TreeItem<T> = T & { children: TreeItem<T>[] }

/** 父节点缺失或成环的节点摊到根上，避免整枝从界面消失。 */
export function treeRoots<T extends TreeSource>(nodes: readonly T[]): TreeItem<T>[] {
  const ids = new Set(nodes.map((node) => node.id))
  const byParent = new Map<string | null, T[]>()
  for (const node of nodes) {
    const parent = node.parentId !== null && ids.has(node.parentId) ? node.parentId : null
    const list = byParent.get(parent)
    if (list) list.push(node)
    else byParent.set(parent, [node])
  }

  const ordered = (parent: string | null): T[] => {
    const list = byParent.get(parent) ?? []
    return [...list].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, 'zh')
    )
  }

  const seen = new Set<string>()
  const walk = (parent: string | null): TreeItem<T>[] =>
    ordered(parent).map((node) => {
      seen.add(node.id)
      return { ...node, children: walk(node.id) }
    })

  const roots = walk(null)
  const orphans = nodes.filter((node) => !seen.has(node.id))
  if (orphans.length === 0) return roots
  const extra = [...orphans]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, 'zh'))
    .map((node) => ({ ...node, children: [] as TreeItem<T>[] }))
  return [...roots, ...extra]
}

export type SignalStrength = 'empty' | 'weak' | 'ok'

export const STRENGTH_LABEL: Record<SignalStrength, string> = {
  empty: '空',
  weak: '弱',
  ok: '够'
}

export const STRENGTH_TITLE: Record<SignalStrength, string> = {
  empty: '还没有挂书',
  weak: '有书，但读得少或笔记少',
  ok: '进度和笔记都够用'
}

export const GAP_TYPE_LABEL: Record<TrackGapType, string> = {
  coverage: '覆盖',
  progress: '进度',
  sediment: '沉淀'
}

export function gapTypeLabel(type: string): string {
  if (type === 'coverage' || type === 'progress' || type === 'sediment') return GAP_TYPE_LABEL[type]
  return type
}

/** 进度事件走 ai.onProgress，kind 为 track，label 以 track:build / track:gap 开头。 */
export function trackProgressTask(event: {
  kind: string
  task?: string
  label: string
}): 'build' | 'gap' | null {
  if (event.kind !== 'track') return null
  if (event.task === 'track:build' || event.label.startsWith('track:build')) return 'build'
  if (event.task === 'track:gap' || event.label.startsWith('track:gap')) return 'gap'
  return null
}

export function trackPhaseLabel(label: string): string {
  const stripped = label.replace(/^track:(?:build|gap)\s*/, '').trim()
  return stripped || label
}

/** 用户取消或主进程中止，不当成失败摊在界面上。 */
export function isQuietStop(message: string): boolean {
  return message === '已取消' || message === '已中断'
}

/**
 * 密钥类文案旁边给设置入口。
 * 不匹配「代理设置」这种网络错误，只认密钥，或「请到设置 / 请先在设置」。
 */
export function errorNeedsSettings(message: string): boolean {
  return /密钥|请到设置|请先在设置/.test(message)
}
