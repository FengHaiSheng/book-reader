import { parseDocument } from 'htmlparser2'
import { attr, childrenOf, findAll, findChildren, findFirst, isElement, localName, textOf, type AnyNode } from './dom-helpers'
import { resolveEntry } from './entry-path'
import type { TocNode } from './types'

export function parseNcx(xml: string, baseDir: string): TocNode[] {
  const doc = parseDocument(xml, { xmlMode: true })
  const navMap = findAll(doc, 'navMap')[0]
  if (!navMap) return []
  return navPoints(navMap, baseDir)
}

function navPoints(parent: AnyNode, baseDir: string): TocNode[] {
  return findChildren(parent, 'navPoint').map((point) => {
    const label = findFirst(point, 'navLabel')
    const content = findFirst(point, 'content')
    const src = content ? attr(content, 'src') : null
    return {
      title: (label ? textOf(label) : '') || '未命名章节',
      entry: src ? resolveEntry(baseDir, src) : '',
      children: navPoints(point, baseDir)
    }
  })
}

export function parseNav(html: string, baseDir: string): TocNode[] {
  const doc = parseDocument(html, { xmlMode: true })
  const nav = findAll(doc, 'nav').find((element) => (attr(element, 'type') ?? '') === 'toc')
  if (!nav) return []
  const list = findFirst(nav, 'ol')
  return list ? listItems(list, baseDir) : []
}

/** 只取 li 的直接子节点里第一个 a / span 的文本，避免把子列表标题也拼进来。 */
function directLabel(item: AnyNode): string {
  for (const child of childrenOf(item)) {
    if (!isElement(child)) continue
    const name = localName(child)
    if (name === 'a' || name === 'span') {
      const text = textOf(child)
      if (text) return text
    }
  }
  return ''
}

function listItems(list: AnyNode, baseDir: string): TocNode[] {
  return findChildren(list, 'li').map((item) => {
    const link = findFirst(item, 'a')
    const href = link ? attr(link, 'href') : null
    const sublist = findFirst(item, 'ol')
    return {
      title: directLabel(item) || '未命名章节',
      entry: href ? resolveEntry(baseDir, href) : '',
      children: sublist ? listItems(sublist, baseDir) : []
    }
  })
}

/** 目录节点里的 entry 结果做一次去重计数，供章节树判断哪些 spine 项已被目录覆盖。 */
export function collectEntries(nodes: TocNode[]): string[] {
  const out: string[] = []
  const walk = (list: TocNode[]): void => {
    for (const node of list) {
      if (node.entry) out.push(node.entry)
      walk(node.children)
    }
  }
  walk(nodes)
  return out
}
