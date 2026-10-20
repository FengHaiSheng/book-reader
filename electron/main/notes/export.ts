import type Database from 'better-sqlite3'
import type {
  HighlightContext,
  NotesExportFormat,
  NotesExportOptions,
  NotesExportPreview,
  NotesFilePreview
} from '@shared/types'
import { highlightContext, listAllHighlights } from './repo'

export type ExportEntry = {
  bookTitle: string
  chapterTitle: string | null
  percent: number
  text: string
  note: string | null
  /** 只有 includeContext 为 true 时才需要填，其余情况传 null */
  context: HighlightContext | null
}

/**
 * 由高亮列表生成一份 Markdown。
 *
 * 纯函数，不碰数据库也不碰文件：本机导出是用户要拿去别处用的东西，
 * 它必须能被逐条断言，而不是靠「导出完看一眼」。
 */
export function buildMarkdown(
  entries: readonly ExportEntry[],
  options: NotesExportOptions,
  now: Date
): string {
  const books = new Set(entries.map((entry) => entry.bookTitle))
  const lines: string[] = [
    '# 读书笔记',
    '',
    `导出时间：${stamp(now)} · 共 ${entries.length} 条 · 跨 ${books.size} 本书`,
    ''
  ]

  let currentBook: string | null = null
  for (const entry of entries) {
    if (entry.bookTitle !== currentBook) {
      currentBook = entry.bookTitle
      lines.push(`## ${entry.bookTitle}`, '')
    }

    if (options.includeLocation) {
      const where = entry.chapterTitle ?? '未知章节'
      lines.push(`### ${where} · 全书 ${Math.round(entry.percent * 100)}%`, '')
    }

    lines.push(`> ${entry.text}`, '')

    if (options.includeNotes && entry.note) {
      lines.push(`**我的批注**：${entry.note}`, '')
    }

    if (options.includeContext) {
      const block = contextBlock(entry.context)
      if (block.length > 0) lines.push(...block, '')
    }
  }

  return `${lines.join('\n').trimEnd()}\n`
}

/**
 * 上下文块。
 *
 * 命中那一段加粗：导出去到别处（Obsidian、Notion、微信）时，
 * 读者要能一眼分出「被划的那句」和它周围的原话。
 *
 * 没能定位到（`located` 为 false）就返回空数组，让调用方整块跳过——
 * 生成一行空的 `> ` 比什么都不生成更糟。
 */
function contextBlock(context: HighlightContext | null): string[] {
  if (!context || !context.located) return []
  const lines: string[] = []
  if (context.before) lines.push(`> ${context.before}`)
  lines.push(`> **${context.matched}**`)
  if (context.after) lines.push(`> ${context.after}`)
  return lines
}

/** 表头用：2026-09-29 21:40 */
function stamp(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  return `${date} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

/** 默认文件名用：2026-09-29-2140。冒号在 Windows 上是非法字符，所以时刻不加分隔符 */
export function fileStamp(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  return `${date}-${pad(now.getHours())}${pad(now.getMinutes())}`
}

/**
 * 取要导出的条目。
 *
 * `ids` 为 null 表示「全部」。给了数组就按**数据库顺序**过滤，而不是按 ids 的先后——
 * `buildMarkdown` 靠「相邻同名书」分节，顺序一乱会把同一本书拆成好几个 `## `。
 */
export function collectEntries(
  db: Database.Database,
  ids: readonly number[] | null,
  options: NotesExportOptions
): ExportEntry[] {
  const all = listAllHighlights(db)
  const picked = ids === null ? all : all.filter((item) => ids.includes(item.id))
  return picked.map((item) => ({
    bookTitle: item.bookTitle,
    chapterTitle: item.chapterTitle,
    percent: item.percent,
    text: item.text,
    note: item.note,
    context: options.includeContext ? highlightContext(db, item.id) : null
  }))
}

/** 预览与真正导出走同一条路：浮层里看见的就是落盘的那一份 */
export function previewExport(
  db: Database.Database,
  ids: readonly number[] | null,
  options: NotesExportOptions,
  now: number
): NotesExportPreview {
  const entries = collectEntries(db, ids, options)
  const unlocated = entries.filter((entry) => entry.context !== null && !entry.context.located).length
  return {
    markdown: buildMarkdown(entries, options, new Date(now)),
    total: entries.length,
    unlocated
  }
}

// ---------------------------------------------------------------------------
// 新导出通道：三格式共用一个入口，预览与落盘是同一个 buildExport 产出
// ---------------------------------------------------------------------------

/** 落盘信息（对话框标题 / 扩展名 / 过滤器名）只在这里定义一处 */
export const EXPORT_FORMATS: Record<
  NotesExportFormat,
  { title: string; extension: string; filterName: string }
> = {
  markdown: { title: '导出 Markdown', extension: 'md', filterName: 'Markdown' },
  anki: { title: '导出 Anki CSV', extension: 'csv', filterName: 'CSV' },
  html: { title: '导出 HTML 卡片', extension: 'html', filterName: 'HTML' }
}

/** 写 UTF-8 BOM：不写的话，旧版 Excel 打开 CSV 会把中文显示成乱码 */
const BOM = '\uFEFF'

/** Anki 卡片统一打这个标签，导入后能一眼筛出「来自这本书的笔记」 */
const ANKI_TAG = '读书笔记'

/**
 * Anki 可导入的 CSV。
 *
 * 列：Front / Back / Tags / Book / Chapter / Location（附上下文时多一列 Context，
 * 表头与数据列数因此永远一致 —— 少一列会让 Anki 把整行错位）。
 *
 * 前两行是 Anki 2.1.55+ 直接识别的元数据；更早的版本要手动勾选「跳过头两行」，
 * 这一点在导出浮层有一行提示，不静默留下一个需要用户自己猜的兼容问题。
 *
 * 按 RFC 4180 转义：含 `, " \r \n` 的字段加引号、字段内的 `"` 变成 `""`、
 * 字段内的换行原样保留（Context 列天然会带换行），行分隔用 `\r\n`。
 */
export function buildAnkiCsv(entries: readonly ExportEntry[], options: NotesExportOptions): string {
  const columns = ['Front', 'Back', 'Tags', 'Book', 'Chapter', 'Location']
  if (options.includeContext) columns.push('Context')

  const lines = ['#separator:Comma', `#columns:${columns.join(',')}`, columns.join(',')]

  for (const entry of entries) {
    const cells: string[] = [
      entry.text,
      options.includeNotes && entry.note ? entry.note : '',
      ANKI_TAG,
      entry.bookTitle,
      entry.chapterTitle ?? '',
      options.includeLocation ? `全书 ${Math.round(entry.percent * 100)}%` : ''
    ]
    if (options.includeContext) cells.push(contextPlain(entry.context))
    lines.push(cells.map(csvCell).join(','))
  }

  return `${BOM}${lines.join('\r\n')}\r\n`
}

/** 上下文拍成一行：CSV 里换行虽然合法，但会让人一行分成两行看，读起来更费劲 */
function contextPlain(context: HighlightContext | null): string {
  if (!context || !context.located) return ''
  return [context.before, context.matched, context.after].filter((part) => part !== '').join(' ')
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/**
 * 自包含的 HTML 卡片。
 *
 * 单文件、零外部引用（不写 `<link>`、不写 `http://`）—— 导出的东西要能离线打开、随手发人。
 * 配色固定为纸感浅色，**不跟随应用主题**：这份文件是给别人看的，不该由导出者的偏好决定。
 * 所有文本来源（正文 / 批注 / 书名 / 章节 / 上下文）都必须过 `escapeHtml`，漏一处即破版。
 */
export function buildHtmlCards(
  entries: readonly ExportEntry[],
  options: NotesExportOptions,
  now: Date
): string {
  const books = new Set(entries.map((entry) => entry.bookTitle))
  const cards = entries.map((entry) => {
    const where = [entry.bookTitle, entry.chapterTitle ?? '未知章节']
    if (options.includeLocation) where.push(`全书 ${Math.round(entry.percent * 100)}%`)

    const parts = [
      '  <article class="card">',
      `    <p class="where">${where.map(escapeHtml).join(' · ')}</p>`,
      `    <blockquote>${escapeHtml(entry.text)}</blockquote>`
    ]
    if (options.includeNotes && entry.note) {
      parts.push(`    <p class="note">${escapeHtml(entry.note)}</p>`)
    }
    const context = entry.context
    if (options.includeContext && context && context.located) {
      const before = context.before ? escapeHtml(context.before) : ''
      const after = context.after ? escapeHtml(context.after) : ''
      parts.push(
        `    <p class="context">${before}<mark>${escapeHtml(context.matched)}</mark>${after}</p>`
      )
    }
    parts.push('  </article>')
    return parts.join('\n')
  })

  const header = [
    '  <header class="head">',
    '    <h1>读书笔记</h1>',
    `    <p>导出时间：${escapeHtml(stamp(now))} · 共 ${entries.length} 条 · 跨 ${books.size} 本书</p>`,
    '  </header>'
  ].join('\n')

  return [
    '<!DOCTYPE html>',
    '<html lang="zh-CN">',
    '<head>',
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    '  <title>读书笔记</title>',
    `  <style>${HTML_STYLE}</style>`,
    '</head>',
    '<body>',
    header,
    '  <main>',
    cards.join('\n'),
    '  </main>',
    '</body>',
    '</html>',
    ''
  ].join('\n')
}

const HTML_STYLE = [
  ':root{color-scheme:light}',
  'body{margin:0;padding:32px 16px;background:#f4f1ea;color:#2c2a26;',
  'font-family:Georgia,"Songti SC","Noto Serif CJK SC",serif;line-height:1.85}',
  '.head{max-width:720px;margin:0 auto 24px}',
  '.head h1{margin:0 0 4px;font-size:24px}',
  '.head p{margin:0;color:#6f6a61;font-size:13px}',
  'main{max-width:720px;margin:0 auto;display:grid;gap:16px}',
  '.card{background:#fffdf8;border:1px solid #e3ded4;border-radius:10px;',
  'padding:18px 20px;box-shadow:0 1px 2px rgba(0,0,0,.04)}',
  '.where{margin:0 0 10px;color:#8a8478;font-size:12px}',
  'blockquote{margin:0;padding-left:12px;border-left:3px solid #d8cfbd;font-size:17px}',
  '.note{margin:12px 0 0;font-size:15px;color:#3d3a34}',
  '.context{margin:12px 0 0;font-size:14px;color:#6f6a61}',
  '.context mark{background:#f6e2a0;color:inherit;padding:0 2px}'
].join('')

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 分派：Markdown 沿用既有实现，Anki / HTML 走上面两个 */
export function buildExport(
  entries: readonly ExportEntry[],
  options: NotesExportOptions,
  format: NotesExportFormat,
  now: Date
): string {
  if (format === 'anki') return buildAnkiCsv(entries, options)
  if (format === 'html') return buildHtmlCards(entries, options, now)
  return buildMarkdown(entries, options, now)
}

/** 默认文件名：读书笔记-2026-09-29-2140.md */
export function exportFileName(format: NotesExportFormat, now: Date): string {
  return `读书笔记-${fileStamp(now)}.${EXPORT_FORMATS[format].extension}`
}

/** 新通道的预览：与落盘共用 buildExport，所以「看见的就是导出的」继续成立 */
export function previewFile(
  db: Database.Database,
  ids: readonly number[] | null,
  options: NotesExportOptions,
  format: NotesExportFormat,
  now: number
): NotesFilePreview {
  const entries = collectEntries(db, ids, options)
  const unlocated = entries.filter((entry) => entry.context !== null && !entry.context.located).length
  const date = new Date(now)
  return {
    content: buildExport(entries, options, format, date),
    fileName: exportFileName(format, date),
    total: entries.length,
    unlocated
  }
}
