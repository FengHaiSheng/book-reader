/** 一节书架：节点直挂的书，或末尾的未归类 */
export type TrackShelfSection = {
  /** null 表示未归类 */
  nodeId: string | null
  title: string
  /** 未归类用 0 */
  depth: number
  bookIds: string[]
}

export type TrackShelfNode = {
  id: string
  parentId: string | null
  title: string
  depth: number
  sortOrder: number
  /** 该节点直挂的书 */
  bookIds: string[]
}

export const UNCATEGORIZED_TITLE = '未归类'

/**
 * 把平铺节点还原成树序。
 * listNodes 只按 sort_order / id 排，兄弟之间稳、子节点却可能压在父节点前面；
 * 分节要的是「父节在前、子节紧跟」的阅读顺序，所以在这里走一遍。
 * 父节点缺失或成环的节点摊到根上，和脉络页的 treeRoots 口径一致。
 */
function treeOrder(nodes: readonly TrackShelfNode[]): TrackShelfNode[] {
  const ids = new Set(nodes.map((node) => node.id))
  const byParent = new Map<string | null, TrackShelfNode[]>()
  for (const node of nodes) {
    const parent = node.parentId !== null && ids.has(node.parentId) ? node.parentId : null
    const list = byParent.get(parent)
    if (list) list.push(node)
    else byParent.set(parent, [node])
  }

  const ordered = (parent: string | null): TrackShelfNode[] =>
    [...(byParent.get(parent) ?? [])].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, 'zh')
    )

  const seen = new Set<string>()
  const result: TrackShelfNode[] = []
  const walk = (parent: string | null): void => {
    for (const node of ordered(parent)) {
      if (seen.has(node.id)) continue
      seen.add(node.id)
      result.push(node)
      walk(node.id)
    }
  }
  walk(null)

  // 成环的节点一定没被走到，按原顺序补在末尾，至少不让它们凭空消失
  for (const node of nodes) {
    if (!seen.has(node.id)) result.push(node)
  }
  return result
}

/**
 * 书架按脉络分节。
 *
 * 节点按树序输出（父在前、子紧跟，兄弟按 sortOrder）；每节的书按 visibleBookIds 的顺序，
 * 这样排序与筛选在两套视图里是同一口径。空节点也输出一节，让「这里还没挂书」可见；
 * 未归类只在有书时追加，一书多挂会在多个节里重复出现。
 */
export function groupBooksByTrack(
  visibleBookIds: readonly string[],
  nodes: readonly TrackShelfNode[]
): TrackShelfSection[] {
  const visible = new Set(visibleBookIds)
  const linked = new Set<string>()
  const sections: TrackShelfSection[] = treeOrder(nodes).map((node) => {
    const direct = new Set(node.bookIds)
    for (const id of direct) {
      if (visible.has(id)) linked.add(id)
    }
    return {
      nodeId: node.id,
      title: node.title,
      depth: node.depth,
      bookIds: visibleBookIds.filter((id) => direct.has(id))
    }
  })

  const untracked = visibleBookIds.filter((id) => !linked.has(id))
  if (untracked.length > 0) {
    sections.push({
      nodeId: null,
      title: UNCATEGORIZED_TITLE,
      depth: 0,
      bookIds: untracked
    })
  }
  return sections
}
