/** 书内一个 `href` 的去向 */
export type LinkTarget =
  | { kind: 'anchor'; fragment: string }
  | { kind: 'chapter'; entry: string; fragment: string }
  | { kind: 'external'; url: string }
  | { kind: 'ignore' }

/**
 * 判断书内一个 `href` 指向哪里。
 *
 * `base` 必须与注入章节文档的 `<base>` 完全一致（`epub://<bookId>/<本章目录>/`），
 * 这样 `../`、百分号转义、`#fragment` 的语义与浏览器自己的解析结果一致。
 *
 * 为什么标准库能替代主进程的 `resolveEntry`：那一条处理的是 zip entry 名，
 * 语义是「在一棵目录树里往上走」；这一条处理的是 URL，`new URL` 就是权威实现，
 * 而且它天然把 `javascript:` / `file:` 这类协议留在「不认识」那一档。
 */
export function classifyLink(href: string, base: string, bookId: string): LinkTarget {
  const trimmed = href.trim()
  if (trimmed === '') return { kind: 'ignore' }
  if (trimmed.startsWith('#')) return { kind: 'anchor', fragment: trimmed.slice(1) }

  let url: URL
  try {
    url = new URL(trimmed, base)
  } catch {
    return { kind: 'ignore' }
  }

  if (url.protocol === 'http:' || url.protocol === 'https:') {
    return { kind: 'external', url: url.href }
  }
  if (url.protocol !== 'epub:' || url.hostname !== bookId) return { kind: 'ignore' }

  return {
    kind: 'chapter',
    entry: decodeURIComponent(url.pathname.replace(/^\//, '')),
    fragment: url.hash.replace(/^#/, '')
  }
}
