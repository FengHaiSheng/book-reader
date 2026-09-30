import { parseDocument } from 'htmlparser2'
import { childrenOf, findAll, isElement, localName, textOf, type AnyNode, type Text } from './dom-helpers'

/** 这些标签前后要断行。中文段落之间靠它们分开，不能挤成一行。 */
const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'br', 'caption', 'dd', 'div', 'dl', 'dt',
  'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr',
  'li', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead',
  'tr', 'ul'
])

/** 这些子树整块丢掉：它们的文本不是正文。 */
const SKIP_TAGS = new Set(['head', 'script', 'style', 'title', 'svg', 'audio', 'video', 'iframe', 'noscript'])

export function htmlToText(html: string): string {
  if (!html.trim()) return ''
  const doc = parseDocument(html, { decodeEntities: true })
  const raw: string[] = []
  walk(doc as AnyNode, raw)
  return normalize(raw.join(''))
}

function walk(node: AnyNode, out: string[]): void {
  for (const child of childrenOf(node)) {
    if (child.type === 'text') {
      out.push((child as Text).data)
      continue
    }
    if (!isElement(child)) continue
    const name = localName(child)
    if (SKIP_TAGS.has(name)) continue
    if (BLOCK_TAGS.has(name)) out.push('\n')
    walk(child, out)
    if (BLOCK_TAGS.has(name)) out.push('\n')
  }
}

function normalize(raw: string): string {
  return raw
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0\u3000]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n')
}

/** 章节的兜底标题：目录里没有这一篇时，用文档自己的标题顶上。 */
export function firstHeading(html: string): string | null {
  if (!html.trim()) return null
  const doc = parseDocument(html, { decodeEntities: true })

  for (const level of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
    // 用递归的 findAll 而不是只查直接子节点的 findFirst：
    // document 的直接子节点只有 <html>，findFirst 在真实文档上永远取不到。
    const heading = findAll(doc as AnyNode, level)[0] ?? null
    if (heading) {
      const text = textOf(heading)
      if (text) return text
    }
  }

  const title = findAll(doc as AnyNode, 'title')[0] ?? null
  const text = title ? textOf(title) : ''
  return text || null
}
