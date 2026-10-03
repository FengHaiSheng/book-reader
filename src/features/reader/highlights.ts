import { HIGHLIGHT_COLORS, highlightRegistryName, type HighlightColor } from '@shared/highlights'
import type { Highlight } from '@shared/types'
import { containsPoint, rangeFromSpan } from './cfi'

/** `CSS.highlights` 是类 Map 对象，不同 Electron 版本的类型声明不一定带，这里按最小形状断言 */
type HighlightRegistry = {
  delete: (name: string) => boolean
  set: (name: string, value: unknown) => void
}
type HighlightCtor = new (...ranges: Range[]) => unknown

type HighlightApi = { registry: HighlightRegistry; Ctor: HighlightCtor }

function apiOf(win: Window): HighlightApi | null {
  const css = (win as unknown as { CSS?: { highlights?: HighlightRegistry } }).CSS
  const Ctor = (win as unknown as { Highlight?: HighlightCtor }).Highlight
  if (!css?.highlights || typeof Ctor !== 'function') return null
  return { registry: css.highlights, Ctor }
}

/** 环境是否支持无侵入高亮。不支持时界面要明说，不能装作画上去了 */
export function supportsHighlights(win: Window): boolean {
  return apiOf(win) !== null
}

/**
 * 把本章高亮画上去。
 *
 * 关键在「不碰 DOM」：CSS Custom Highlight API 接受 Range 数组，由浏览器负责上色，
 * 书的 DOM 结构一个字节都不变，所以已存的 CFI 永远不会因为我们画高亮而漂移（spec §3.4）。
 * 用 Range 还要注意必须来自**同一个文档**，所以 `win` 与 `doc` 都从 iframe 取。
 *
 * 注册名按颜色分四组：一个注册名只能有一套样式，四种颜色就是四次注册。
 * 返回真正画上去的条数，0 表示本章没有高亮、或全部定位失败。
 */
export function paintHighlights(win: Window, doc: Document, list: readonly Highlight[]): number {
  const api = apiOf(win)
  if (!api) return 0
  clearHighlights(win)

  const byColor = new Map<HighlightColor, Range[]>()
  for (const item of list) {
    const range = rangeFromSpan(doc, item.startCfi, item.endCfi)
    if (!range) continue
    const bucket = byColor.get(item.color)
    if (bucket) bucket.push(range)
    else byColor.set(item.color, [range])
  }

  let painted = 0
  for (const [color, ranges] of byColor) {
    api.registry.set(highlightRegistryName(color), new api.Ctor(...ranges))
    painted += ranges.length
  }
  return painted
}

export function clearHighlights(win: Window): void {
  const api = apiOf(win)
  if (!api) return
  for (const color of HIGHLIGHT_COLORS) api.registry.delete(highlightRegistryName(color))
}

/**
 * 点到哪条高亮上。
 *
 * 区间不是元素，挂不了 click；只能反过来问「这个点落在哪条区间里」。
 * 从后往前遍历：重叠时让新标注赢，这与「新画的那条在最上层」的直觉一致。
 */
export function highlightAt(
  doc: Document,
  list: readonly Highlight[],
  node: Node,
  offset: number
): Highlight | null {
  for (let i = list.length - 1; i >= 0; i--) {
    const item = list[i]
    if (item && containsPoint(doc, item, node, offset)) return item
  }
  return null
}
