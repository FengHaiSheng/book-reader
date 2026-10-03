import type Database from 'better-sqlite3'
import type {
  HighlightContext,
  NotesExportOptions,
  NotesExportPreview
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
