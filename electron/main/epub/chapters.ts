import type { ChapterRow, SpineText, TocNode } from './types'

/**
 * 把「目录树 + spine 顺序 + 正文」合成落库用的章节行。
 *
 * 目录树（读什么顺序看目录）与阅读顺序（spine）是两件事，所以：
 * - 目录里有的节点逐个成行，带 depth 与 parentIndex；
 * - spine 里有、目录里没有的，补成平级章节，保证正文不会漏读；
 * - 目录里指向同一个 entry 的重复节点保留，但只有第一条拿 char 区间。
 */
export function buildChapters(toc: TocNode[], spine: string[], texts: SpineText[]): ChapterRow[] {
  const orderByEntry = new Map(spine.map((entry, index) => [entry, index]))
  const textByEntry = new Map(texts.map((item) => [item.entry, item]))
  const offsets = buildOffsets(spine, textByEntry)
  const usedEntries = new Set<string>()
  const rows: ChapterRow[] = []

  const walk = (nodes: TocNode[], depth: number, parentIndex: number | null): void => {
    for (const node of nodes) {
      const orderIndex = node.entry ? (orderByEntry.get(node.entry) ?? null) : null
      const range = takeRange(node.entry, orderIndex, offsets, usedEntries)
      const index = rows.length
      rows.push({
        title: node.title,
        entry: node.entry,
        depth,
        parentIndex,
        orderIndex,
        charStart: range?.start ?? null,
        charEnd: range?.end ?? null
      })
      walk(node.children, depth + 1, index)
    }
  }
  walk(toc, 0, null)

  for (const entry of spine) {
    if (usedEntries.has(entry)) continue
    const orderIndex = orderByEntry.get(entry) ?? null
    const range = takeRange(entry, orderIndex, offsets, usedEntries)
    const heading = textByEntry.get(entry)?.heading
    rows.push({
      title: heading || `第 ${rows.filter((row) => row.orderIndex !== null).length + 1} 节`,
      entry,
      depth: 0,
      parentIndex: null,
      orderIndex,
      charStart: range?.start ?? null,
      charEnd: range?.end ?? null
    })
  }

  return rows
}

/** spine 里每篇正文在全书纯文本中的字符区间（篇与篇之间用一个 \n 连接）。 */
function buildOffsets(
  spine: string[],
  textByEntry: Map<string, SpineText>
): Map<string, { start: number; end: number }> {
  const offsets = new Map<string, { start: number; end: number }>()
  let cursor = 0
  for (const entry of spine) {
    const text = textByEntry.get(entry)?.text
    if (text === undefined) continue
    offsets.set(entry, { start: cursor, end: cursor + text.length })
    cursor += text.length + 1
  }
  return offsets
}

function takeRange(
  entry: string,
  orderIndex: number | null,
  offsets: Map<string, { start: number; end: number }>,
  usedEntries: Set<string>
): { start: number; end: number } | null {
  if (!entry || orderIndex === null || usedEntries.has(entry)) return null
  const range = offsets.get(entry)
  if (!range) return null
  usedEntries.add(entry)
  return range
}
