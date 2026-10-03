import { CHAPTER_CSP } from '@shared/csp'

const XHTML_NS = 'http://www.w3.org/1999/xhtml'

/** 能执行代码、能发起外部请求、能把文档导航走的节点，整类摘掉 */
const FORBIDDEN = ['script', 'iframe', 'frame', 'object', 'embed', 'template', 'applet']

export type PreparedChapter = {
  html: string
  /** 解析与序列化用同一套规则，输出类型必须跟着走 */
  mime: 'application/xhtml+xml' | 'text/html'
}

/**
 * 把从 epub:// 取回的原始章节 XHTML 加工成一个可以安全放进 iframe 的同源文档。
 *
 * 同源是功能前提：父文档要能读它的 DOM，才能注入排版样式、算 CFI、读选区。
 * 无脚本是安全前提：书是外来文件，spec §6.4 要求章节文档 `script-src 'none'`。
 */
export function prepareChapter(input: {
  html: string
  /** epub://<bookId>/<本章所在目录>/ —— 书内所有相对路径都靠它解析 */
  baseHref: string
  /** 排版与主题样式，写进 <style id="reader-theme"> */
  themeCss: string
}): PreparedChapter {
  const { doc, mime } = parse(input.html)

  strip(doc)

  const head = ensureHead(doc, mime)
  // <base> 必须排在 head 最前：它之后出现的相对路径才按 epub:// 解析
  head.prepend(make(doc, mime, 'base', { href: input.baseHref }))
  head.append(
    make(doc, mime, 'meta', { 'http-equiv': 'Content-Security-Policy', content: CHAPTER_CSP })
  )

  const style = make(doc, mime, 'style', { id: 'reader-theme' })
  style.textContent = input.themeCss
  head.append(style)

  return { html: new XMLSerializer().serializeToString(doc), mime }
}

/**
 * 优先按 XHTML（XML）解析：epub 的章节本来是 XML，XML 解析不会像 HTML 解析那样
 * 自作主张地补 `<p>`、丢标签、改结构。
 *
 * 但真实 epub 里不合规的 XHTML 相当常见，所以退回容错的 HTML 解析；
 * 此时输出也标成 text/html —— 解析与序列化必须同一套规则，否则 XML 序列化出的
 * 自闭合标签（`<div/>`）会被 HTML 解析器当成「未闭合」，后面的内容全被吞进去。
 */
function parse(html: string): { doc: Document; mime: PreparedChapter['mime'] } {
  const parser = new DOMParser()
  const xml = parser.parseFromString(html, 'application/xhtml+xml')
  if (xml.getElementsByTagName('parsererror').length === 0) {
    return { doc: xml, mime: 'application/xhtml+xml' }
  }
  return { doc: parser.parseFromString(html, 'text/html'), mime: 'text/html' }
}

function strip(doc: Document): void {
  for (const name of FORBIDDEN) {
    for (const node of Array.from(doc.getElementsByTagName(name))) node.remove()
  }

  // 书自带的 CSP 声明会挡我们的注入样式；refresh 能把文档直接导航走，绕开所有定位逻辑
  for (const meta of Array.from(doc.getElementsByTagName('meta'))) {
    const equiv = meta.getAttribute('http-equiv')?.toLowerCase()
    if (equiv === 'refresh' || equiv === 'content-security-policy') meta.remove()
  }

  // 只留样式表：rel 为 preload / prefetch / dns-prefetch 的都会发起我们不需要的请求
  for (const link of Array.from(doc.getElementsByTagName('link'))) {
    if ((link.getAttribute('rel') ?? '').toLowerCase() !== 'stylesheet') link.remove()
  }

  // 书里写死的 base 会顶掉我们注入的那个
  for (const base of Array.from(doc.getElementsByTagName('base'))) base.remove()
}

function ensureHead(doc: Document, mime: PreparedChapter['mime']): Element {
  const existing = doc.getElementsByTagName('head')[0]
  if (existing) return existing
  const head = make(doc, mime, 'head', {})
  const root = doc.documentElement
  root.insertBefore(head, root.firstChild)
  return head
}

/** XML 文档里建的节点必须带命名空间，否则序列化出来是另一个命名空间的元素 */
function make(
  doc: Document,
  mime: PreparedChapter['mime'],
  name: string,
  attrs: Record<string, string>
): Element {
  const el =
    mime === 'application/xhtml+xml' ? doc.createElementNS(XHTML_NS, name) : doc.createElement(name)
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value)
  return el
}

/**
 * 章节文档用 Blob URL 装进 iframe：blob: 与创建它的文档同源，
 * 因此父文档能读它的 DOM。用完记得 `URL.revokeObjectURL`。
 */
export function chapterBlobUrl(prepared: PreparedChapter): string {
  return URL.createObjectURL(new Blob([prepared.html], { type: prepared.mime }))
}
