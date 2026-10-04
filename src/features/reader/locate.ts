/**
 * 把「引用摘录」定位回章节正文。
 *
 * 为什么要文本匹配而不是 CFI：引用来自检索命中的 chunk，它的来源是抽取出来的纯文本
 * （计划 02 的 `chunks.text`），与渲染用的 XHTML 之间隔着一次转换，没有可用的 CFI
 * （spec §3.5 也是这么定的）。所以把正文按空白归一化，再用摘录去查。
 *
 * 这一层是纯函数，DOM 只出现在下面的 `rangeFromExcerpt` 里。
 */

/** 拍平后的字符位置：第几个文本节点、节点内第几个字符 */
export type Position = { nodeIndex: number; offset: number }

export type FlatText = { text: string; map: readonly Position[] }

/**
 * 摘录长度逐级缩短的探针。
 *
 * 正文与摘录之间常有标点、软连字符、脚注编号之类的出入，全串命中不了就退一步。
 * 退到 8 个字还命中不了就放弃：再短下去匹配到别的句子上，还不如不定位。
 */
const PROBE_LENGTHS = [60, 30, 16, 8]

const BLANK = /\s/u

/** 去掉所有空白字符（含换行、制表、全角空格） */
export function squash(text: string): string {
  return text.replace(/\s+/gu, '')
}

/**
 * 把若干个文本节点的内容拼成一条无空白的串，并记住每个保留字符的出处。
 *
 * 之所以要记出处：匹配到的是「拍平串」里的下标，而 `Range` 需要的是
 * 「第几个节点、节点内第几个字符」，这层映射是绕不过去的。
 */
export function flatten(texts: readonly string[]): FlatText {
  const map: Position[] = []
  let text = ''
  for (let nodeIndex = 0; nodeIndex < texts.length; nodeIndex += 1) {
    const source = texts[nodeIndex] ?? ''
    for (let offset = 0; offset < source.length; offset += 1) {
      const char = source[offset] ?? ''
      if (BLANK.test(char)) continue
      text += char
      map.push({ nodeIndex, offset })
    }
  }
  return { text, map }
}

/**
 * 在拍平后的正文里找摘录，返回它在拍平串里的 `[start, end)`。
 *
 * 找不到就返回 null —— 不猜、不模糊匹配到别的句子上：定位错了比不定位更糟。
 */
export function locateInFlat(flat: string, excerpt: string): { start: number; end: number } | null {
  const needle = squash(excerpt)
  if (needle.length === 0 || flat.length === 0) return null

  const probes: number[] = []
  for (const limit of PROBE_LENGTHS) {
    const size = Math.min(limit, needle.length)
    if (size > 0 && !probes.includes(size)) probes.push(size)
  }

  for (const size of probes) {
    const start = flat.indexOf(needle.slice(0, size))
    if (start >= 0) return { start, end: start + size }
  }
  return null
}

/** 脚本、样式这类节点里的文字不是正文，不参与匹配 */
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT'])

/** 收集文档里参与排版的文本节点，顺序即文档顺序 */
function textNodesOf(doc: Document): Text[] {
  const root = doc.body
  if (!root) return []
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  let current = walker.nextNode()
  while (current) {
    const node = current as Text
    const parent = node.parentElement
    if (node.data.trim() !== '' && !(parent && SKIP_TAGS.has(parent.tagName))) {
      nodes.push(node)
    }
    current = walker.nextNode()
  }
  return nodes
}

/**
 * 从章节文档里找出摘录对应的范围。
 *
 * 返回的 Range 属于 `doc` 这个文档 —— `CSS.highlights` 与 `Range` 都只在同一个 Window
 * 内有效，拿父窗口的 Range 去 iframe 的注册表里注册会静默失败。
 */
export function rangeFromExcerpt(doc: Document, excerpt: string): Range | null {
  const nodes = textNodesOf(doc)
  if (nodes.length === 0) return null

  const flat = flatten(nodes.map((node) => node.data))
  const hit = locateInFlat(flat.text, excerpt)
  if (!hit) return null

  const from = flat.map[hit.start]
  const last = flat.map[hit.end - 1]
  if (!from || !last) return null

  const startNode = nodes[from.nodeIndex]
  const endNode = nodes[last.nodeIndex]
  if (!startNode || !endNode) return null
  // 摘录会跨节点：起点落在第一个节点的一个字上，终点落在最后一个节点的下一个字之前
  if (from.offset >= startNode.data.length) return null
  if (last.offset + 1 > endNode.data.length) return null

  const range = doc.createRange()
  range.setStart(startNode, from.offset)
  range.setEnd(endNode, last.offset + 1)
  return range
}