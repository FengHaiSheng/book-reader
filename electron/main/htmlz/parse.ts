import { resolveEntry } from '../epub/entry-path'
import { firstHeading, htmlToText } from '../epub/text'

export type HtmlzChapter = { title: string; body: string }

/**
 * 把一个 HTML 文档按 h1/h2 切成章节。
 *
 * HTMLZ 是 Calibre 导出的单文件 HTML，没有目录结构可用，标题层级就是唯一线索。
 * 没有标题时退回单章，至少保证整本可读。
 */
export function splitHtmlBook(html: string): HtmlzChapter[] {
  const body = extractBody(html)
  const headings = Array.from(body.matchAll(/<h([12])\b[^>]*>[\s\S]*?<\/h\1>/gi))

  if (headings.length === 0) {
    return [{ title: firstHeading(body) ?? '正文', body }]
  }

  const chapters: HtmlzChapter[] = []
  const first = headings[0]!
  const preface = body.slice(0, first.index ?? 0).trim()
  if (htmlToText(preface).trim()) chapters.push({ title: '前言', body: preface })

  headings.forEach((heading, index) => {
    const start = heading.index ?? 0
    const end = headings[index + 1]?.index ?? body.length
    const section = body.slice(start, end).trim()
    if (!section) return
    const title = htmlToText(heading[0]).trim() || `第 ${chapters.length + 1} 节`
    chapters.push({ title, body: section })
  })

  return chapters
}

/**
 * 把 HTML 里指向 zip 内部图片的链接改写成 `../media/<新文件名>`。
 *
 * 章节文件在 `chapters/` 下，所以相对路径要先退一层；只改能映射到资源的链接，
 * 外链、data URL、锚点原样保留。
 */
export function rewriteResourceLinks(
  html: string,
  htmlDir: string,
  resources: Map<string, string>
): string {
  const resolve = (raw: string): string | null => {
    if (!raw || /^(?:data:|https?:|\/\/|#)/i.test(raw)) return null
    const clean = raw.split(/[?#]/)[0] ?? ''
    if (!clean) return null
    const entry = resolveEntry(htmlDir, clean)
    return resources.get(entry) ?? resources.get(clean) ?? resources.get(clean.split('/').pop() ?? '') ?? null
  }

  return html
    .replace(/\b(src|href|poster)=(["'])([^"']+)\2/gi, (whole, name: string, quote: string, raw: string) => {
      const next = resolve(raw)
      return next ? `${name}=${quote}${next}${quote}` : whole
    })
    .replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (whole, quote: string, raw: string) => {
      const next = resolve(raw.trim())
      return next ? `url(${quote}${next}${quote})` : whole
    })
}

function extractBody(html: string): string {
  const matched = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html)
  return (matched?.[1] ?? html).trim()
}
