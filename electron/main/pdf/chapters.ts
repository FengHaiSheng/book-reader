import type { SpineText, TocNode } from '../epub/types'
import type { PdfBlock, PdfExtract, PdfOutlineEntry } from './extract'

export type PdfDraft = {
  toc: TocNode[]
  /** 可读章节的 entry，按阅读顺序 */
  spine: string[]
  texts: SpineText[]
  /** entry -> 生成的 XHTML，导入时写到书目录里 */
  htmlByEntry: Map<string, string>
}

type PlanNode = {
  title: string
  depth: number
  /** 1 起算，闭区间 */
  page: number
  endPage: number
  /** 目录项指向的页与前一条重复，只能当目录节点，没有正文 */
  tocOnly: boolean
  /** 没有目录时按页分组的章节；空组直接丢掉，不占目录 */
  generated: boolean
}

/** 没有目录时每多少页合成一章。太碎会让目录变成几百条，太大又翻不动 */
const PAGES_PER_CHAPTER = 10

/**
 * 把抽取结果整理成现有导入管线认识的形状：目录树 + spine + 每章纯文本/HTML。
 *
 * 分章优先用 PDF 自带的书签目录；没有书签才按固定页数分组。目录项指向同一页时
 * 只保留第一条可读，其余退化成没有正文的目录节点，保证一页不会被重复读两遍。
 */
export function buildPdfDraft(extract: PdfExtract): PdfDraft {
  const entries = extract.outline.filter(
    (entry) => entry.page >= 1 && entry.page <= extract.pageCount
  )
  const plan = entries.length > 0 ? outlinePlan(entries, extract.pageCount) : pagePlan(extract.pageCount)
  const toc: TocNode[] = []
  const stack: { depth: number; node: TocNode }[] = []
  const spine: string[] = []
  const texts: SpineText[] = []
  const htmlByEntry = new Map<string, string>()
  let fileIndex = 0

  for (const node of plan) {
    const blocks = node.tocOnly ? [] : collectBlocks(extract, node)
    const text = blocks.map((block) => block.text).join('\n')

    // 没有目录的页组里，图片页/空白页不留空章节；有目录则保留标题
    if (!text.trim() && node.generated) continue

    const entry = text.trim()
      ? `pdf/${String((fileIndex += 1)).padStart(5, '0')}.html`
      : ''

    if (entry) {
      spine.push(entry)
      texts.push({ entry, text, heading: null })
      htmlByEntry.set(entry, renderChapter(blocks))
    }

    const tocNode: TocNode = { title: node.title, entry, children: [] }
    while (stack.length > 0 && stack[stack.length - 1]!.depth >= node.depth) stack.pop()
    const parent = stack[stack.length - 1]
    if (parent) parent.node.children.push(tocNode)
    else toc.push(tocNode)
    stack.push({ depth: node.depth, node: tocNode })
  }

  return { toc, spine, texts, htmlByEntry }
}

function outlinePlan(entries: PdfOutlineEntry[], pageCount: number): PlanNode[] {
  const plan: PlanNode[] = []
  let lastStart = 0

  for (const entry of entries) {
    // 页序回退或与前一条同页：只留目录标题，不再切一段正文
    if (entry.page <= lastStart) {
      plan.push({
        title: entry.title,
        depth: entry.depth,
        page: entry.page,
        endPage: entry.page - 1,
        tocOnly: true,
        generated: false
      })
      continue
    }
    lastStart = entry.page
    plan.push({
      title: entry.title,
      depth: entry.depth,
      page: entry.page,
      endPage: pageCount,
      tocOnly: false,
      generated: false
    })
  }

  // 每个可读章节到下一个可读章节开头为止；最后一章读到书末
  for (let i = 0; i < plan.length; i += 1) {
    const node = plan[i]!
    if (node.tocOnly) continue
    const next = plan.slice(i + 1).find((item) => !item.tocOnly)
    node.endPage = next ? next.page - 1 : pageCount
  }

  // 目录第一条之前还有正文（封面、前言）时补一章，否则这部分会读不到
  const first = plan.find((node) => !node.tocOnly)
  if (first && first.page > 1) {
    plan.unshift({
      title: '开篇',
      depth: 0,
      page: 1,
      endPage: first.page - 1,
      tocOnly: false,
      generated: false
    })
  }

  return plan
}

function pagePlan(pageCount: number): PlanNode[] {
  const plan: PlanNode[] = []
  for (let start = 1; start <= pageCount; start += PAGES_PER_CHAPTER) {
    const end = Math.min(pageCount, start + PAGES_PER_CHAPTER - 1)
    plan.push({
      title: start === end ? `第 ${start} 页` : `第 ${start}–${end} 页`,
      depth: 0,
      page: start,
      endPage: end,
      tocOnly: false,
      generated: true
    })
  }
  return plan
}

function collectBlocks(extract: PdfExtract, node: PlanNode): PdfBlock[] {
  return extract.pages.slice(node.page - 1, node.endPage).flat()
}

function renderChapter(blocks: PdfBlock[]): string {
  const body = blocks
    .map((block) =>
      block.kind === 'h'
        ? `<h2>${escapeHtml(block.text)}</h2>`
        : `<p>${escapeHtml(block.text)}</p>`
    )
    .join('\n')

  return [
    '<!DOCTYPE html>',
    '<html xmlns="http://www.w3.org/1999/xhtml">',
    '<head><meta charset="utf-8"/><title></title></head>',
    `<body>${body}</body>`,
    '</html>'
  ].join('\n')
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
