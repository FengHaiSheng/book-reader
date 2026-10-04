import type { MindmapNode, TermsPayload } from '@shared/types'

type Term = TermsPayload['terms'][number]

/**
 * 把「关键词」的结果组织成一棵树。
 *
 * 这里**不调用模型**：思维导图是同一批术语换个组织方式，是确定性变换。
 * 再花一次钱请模型把同样的话排成树，产品上毫无收益（硬规则 1）。
 * 因此这个函数是纯函数，可被穷举测试。
 */
export function buildMindmap(bookTitle: string, terms: readonly Term[]): MindmapNode | null {
  if (terms.length === 0) return null

  const groups = new Map<string, MindmapNode[]>()
  for (const item of terms) {
    const where = item.where.trim()
    const key = where === '' ? '未归类' : where
    const leaf: MindmapNode = { label: item.term, children: [] }
    const bucket = groups.get(key)
    if (bucket) bucket.push(leaf)
    else groups.set(key, [leaf])
  }

  // Map 保持插入顺序，所以章节顺序 == 术语首次出现的顺序，不需要额外排序
  return {
    label: bookTitle,
    children: [...groups.entries()].map(([label, children]) => ({ label, children }))
  }
}