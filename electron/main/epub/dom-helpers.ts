import type { AnyNode, Element, Text } from 'domhandler'

export type { AnyNode, Element, Text } from 'domhandler'

/**
 * 比较节点名时统一小写并去掉命名空间前缀：
 * 真实 epub 里同一个元素可能写成 dc:title、DC:Title 或 title。
 */
export function localName(node: AnyNode): string {
  const name = (node as Element).name ?? ''
  const colon = name.indexOf(':')
  return (colon < 0 ? name : name.slice(colon + 1)).toLowerCase()
}

export function isElement(node: AnyNode): node is Element {
  return node.type === 'tag' || node.type === 'script' || node.type === 'style'
}

export function attr(node: AnyNode, name: string): string | null {
  if (!isElement(node)) return null
  const target = name.toLowerCase()
  for (const [key, value] of Object.entries(node.attribs ?? {})) {
    const colon = key.indexOf(':')
    const bare = (colon < 0 ? key : key.slice(colon + 1)).toLowerCase()
    if (bare === target) return value
  }
  return null
}

export function childrenOf(node: AnyNode): AnyNode[] {
  // 不能只认 Element：parseDocument 的根是 type==='root' 的 Document，
  // 只按 isElement 判定会让遍历在根节点就断掉（findAll/findFirst 全部返回空）。
  return 'children' in node ? node.children : []
}

export function findChildren(node: AnyNode, name: string): Element[] {
  const target = name.toLowerCase()
  return childrenOf(node).filter((child) => isElement(child) && localName(child) === target) as Element[]
}

export function findFirst(node: AnyNode, name: string): Element | null {
  return findChildren(node, name)[0] ?? null
}

/** 深度优先找出全部后代（含自身不入内），用于在 package 底下捞 manifest / spine。 */
export function findAll(node: AnyNode, name: string): Element[] {
  const out: Element[] = []
  const target = name.toLowerCase()
  const walk = (current: AnyNode): void => {
    for (const child of childrenOf(current)) {
      if (isElement(child) && localName(child) === target) out.push(child)
      walk(child)
    }
  }
  walk(node)
  return out
}

/** 把节点下所有文本拼起来，只用于书名、章节名这类短文本。 */
export function textOf(node: AnyNode): string {
  let out = ''
  const walk = (current: AnyNode): void => {
    if (current.type === 'text') {
      out += (current as Text).data
      return
    }
    for (const child of childrenOf(current)) walk(child)
  }
  walk(node)
  return out.replace(/\s+/g, ' ').trim()
}
