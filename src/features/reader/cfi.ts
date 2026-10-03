import { fake, fromRange, joinIndir, parse, toRange, type CfiPart } from 'foliate-js/epubcfi.js'
import { MAX_HIGHLIGHT_CHARS, normalizeSpan } from '@shared/highlights'

/** 一段标注的 CFI 对，与 highlights 表的 start_cfi / end_cfi 一一对应 */
export type CfiSpan = {
  startCfi: string
  endCfi: string
  text: string
}

/**
 * CFI 可能带 `!`（spine 段）也可能是区间；这里只取「本章文档内」的那一段。
 *
 * 不能把 `parse` 的完整结果交给 `toRange`：它会拿 `/6/2` 去章节文档里找节点，必然定位失败。
 */
export function localParts(cfi: string): CfiPart[][] | null {
  try {
    const parsed = parse(cfi)
    const indirection = Array.isArray(parsed) ? parsed : parsed.start
    const local = indirection[indirection.length - 1]
    return local ? [local] : null
  } catch {
    return null
  }
}

/** 文档里的一个点 → 带 spine 段的 CFI */
export function pointCfi(doc: Document, node: Node, offset: number, spineIndex: number): string {
  const range = doc.createRange()
  range.setStart(node, offset)
  range.collapse(true)
  return joinIndir(fake.fromIndex(spineIndex), fromRange(range))
}

/**
 * 选区 → CFI 对。
 *
 * 这里**不**检查长度上限：选太长的提示要由界面明说（spec 的「降级要明说」），
 * 静默返回 null 会让用户以为选中失效了。上限由 `MAX_HIGHLIGHT_CHARS` 在调用处判。
 */
export function spanFromSelection(doc: Document, range: Range, spineIndex: number): CfiSpan | null {
  const text = normalizeSpan(range.toString())
  if (text === '') return null
  return {
    startCfi: pointCfi(doc, range.startContainer, range.startOffset, spineIndex),
    endCfi: pointCfi(doc, range.endContainer, range.endOffset, spineIndex),
    text
  }
}

/** CFI 对 → 本章文档里的 Range；任一端定位不到就返回 null，由调用方兜底 */
export function rangeFromSpan(doc: Document, startCfi: string, endCfi: string): Range | null {
  const startParts = localParts(startCfi)
  const endParts = localParts(endCfi)
  if (!startParts || !endParts) return null
  try {
    const start = toRange(doc, startParts)
    const end = toRange(doc, endParts)
    const range = doc.createRange()
    range.setStart(start.startContainer, start.startOffset)
    range.setEnd(end.startContainer, end.startOffset)
    return range
  } catch {
    return null
  }
}

/** 一个点是否落在某段区间里。用于「点已有高亮」——区间不是元素，挂不了事件，只能反着问 */
export function containsPoint(
  doc: Document,
  span: { startCfi: string; endCfi: string },
  node: Node,
  offset: number
): boolean {
  const range = rangeFromSpan(doc, span.startCfi, span.endCfi)
  if (!range) return false
  try {
    return range.isPointInRange(node, offset)
  } catch {
    // 节点已被换章/重排移除时 isPointInRange 会抛，按「不在区间里」处理
    return false
  }
}

/**
 * 选区的第一行矩形，给浮条当锚点。
 *
 * 分栏之后一个跨栏选区会有一串矩形，取第一个即可 —— 浮条跟着选区的起头走，
 * 比取整个选区的中心更符合直觉，也不会因为跨页而飘到正文区外面。
 */
export function anchorOf(range: Range): { x: number; y: number } | null {
  const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 || rect.height > 0)
  const first = rects[0]
  if (!first) return null
  return { x: first.left + first.width / 2, y: first.top }
}

export { MAX_HIGHLIGHT_CHARS }
