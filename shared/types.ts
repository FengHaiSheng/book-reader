import type { AppError } from './errors'
import type { HighlightColor } from './highlights'

export type ProviderId = 'deepseek' | 'qwen' | 'zhipu' | 'kimi'

export const PROVIDERS: { id: ProviderId; name: string; baseURL: string }[] = [
  { id: 'deepseek', name: 'DeepSeek', baseURL: 'https://api.deepseek.com/v1' },
  {
    id: 'qwen',
    name: '通义千问',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1'
  },
  { id: 'zhipu', name: '智谱 GLM', baseURL: 'https://open.bigmodel.cn/api/paas/v4' },
  { id: 'kimi', name: 'Kimi', baseURL: 'https://api.moonshot.cn/v1' }
]

/** 阅读偏好。每行字数是独立控件，不是字号的副产物。 */
export type ReadingPrefs = {
  font: 'serif' | 'sans'
  fontSize: number
  charsPerLine: number
  lineHeight: number
  theme: 'light' | 'dark'
}

export const DEFAULT_PREFS: ReadingPrefs = {
  font: 'serif',
  fontSize: 19,
  charsPerLine: 34,
  lineHeight: 1.85,
  theme: 'light'
}

export type BookStatus = 'unread' | 'reading' | 'finished'

export type BookSummary = {
  id: string
  title: string
  author: string | null
  coverPath: string | null
  status: BookStatus
  chapterCount: number
  totalChars: number
  addedAt: number
  lastOpenedAt: number | null
}

export type ChapterRowView = {
  id: number
  parentId: number | null
  orderIndex: number | null
  title: string
  href: string
  depth: number
  charStart: number | null
  charEnd: number | null
}

export type ImportOutcome =
  | { status: 'imported'; bookId: string; title: string }
  | { status: 'duplicate'; bookId: string; title: string }

export type ImportProgress = {
  phase: 'hash' | 'extract' | 'store'
  done: number
  total: number
}

export type SearchHit = {
  chunkId: number
  chapterId: number | null
  headingPath: string
  text: string
  score: number
}

/**
 * IPC 结果信封。用于需要展示可读中文错误的调用：主进程直接 throw 会被 Electron
 * 套上 "Error invoking remote method '...'" 英文前缀，这里改成回传结果，由 preload
 * 还原成干净的 Error 再抛给渲染进程。
 */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: AppError }

/**
 * 用户可调项的边界。UI 的滑块范围与主进程的落库校验共用这一份，
 * 避免出现「界面能拖到 60 字、存进去被截成 48」这种两边不一致。
 */
export const PREFS_LIMITS = {
  fontSize: [15, 24],
  charsPerLine: [24, 48],
  lineHeight: [1.5, 2.2]
} as const

/** 把任意输入夹进合法范围；类型不对或不是有限数就回落默认值。渲染进程与主进程都调它。 */
export function clampPrefs(input: Partial<ReadingPrefs>): ReadingPrefs {
  return {
    font: input.font === 'sans' ? 'sans' : DEFAULT_PREFS.font,
    fontSize: clampNumber(input.fontSize, PREFS_LIMITS.fontSize, DEFAULT_PREFS.fontSize),
    charsPerLine: clampNumber(
      input.charsPerLine,
      PREFS_LIMITS.charsPerLine,
      DEFAULT_PREFS.charsPerLine
    ),
    lineHeight: clampNumber(input.lineHeight, PREFS_LIMITS.lineHeight, DEFAULT_PREFS.lineHeight),
    theme: input.theme === 'dark' ? 'dark' : DEFAULT_PREFS.theme
  }
}

function clampNumber(value: unknown, [min, max]: readonly [number, number], fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

/** 阅读器需要的一章。只带渲染与定位要用的字段，正文不在这里 —— 正文按需从 epub:// 取。 */
export type ReaderChapter = {
  id: number
  parentId: number | null
  title: string
  /** zip entry 名；目录里只有分组、没有正文的节点是空串 */
  href: string
  depth: number
  /** 在 spine 中的下标，用来拼 CFI 的第一段；没有正文时为 null */
  spineIndex: number | null
}

export type ReaderProgress = {
  cfi: string
  chapterId: number | null
  percent: number
  updatedAt: number
}

export type ReaderBook = {
  id: string
  title: string
  author: string | null
  chapters: ReaderChapter[]
  progress: ReaderProgress | null
}

export type ProgressInput = {
  bookId: string
  cfi: string
  /** 定位失败时允许为 null —— 进度仍要存，下次至少能跳回这一章开头 */
  chapterId: number | null
  percent: number
}

export type Highlight = {
  id: number
  bookId: string
  chapterId: number | null
  startCfi: string
  endCfi: string
  /** 标注时的选中原文 */
  text: string
  /** 批注；null 表示只划了线没写批注 */
  note: string | null
  color: HighlightColor
  createdAt: number
  updatedAt: number
}

export type HighlightInput = {
  bookId: string
  chapterId: number | null
  startCfi: string
  endCfi: string
  text: string
  note?: string | null
  color?: HighlightColor
}

/** 只允许改这两项。位置与原文是既成事实，改位置等于重新标注 */
export type HighlightPatch = {
  note?: string | null
  color?: HighlightColor
}

/** 跨书汇总用：多带书名、章节名与在全书的相对位置 */
export type HighlightWithBook = Highlight & {
  bookTitle: string
  chapterTitle: string | null
  /** 0–1，按「本章是可读章节里的第几章」折算，与阅读器的进度同一口径 */
  percent: number
}

/** 右栏的原文上下文 */
export type HighlightContext = {
  /** 是否在章节正文里重新定位到了这段文字 */
  located: boolean
  chapterTitle: string | null
  before: string
  /** 命中处的原文；located 为 false 时是库里存的那一份 */
  matched: string
  after: string
}

/** 阅读落点：从书架进来只有 bookId，从笔记「回到原文」进来带章节与位置 */
export type ReadingTarget = {
  bookId: string
  /** 指定时优先于上次进度 */
  chapterId: number | null
  /** 仅当 chapterId 不为 null 时有意义 */
  cfi: string | null
}

export type NotesExportOptions = {
  includeNotes: boolean
  includeLocation: boolean
  includeContext: boolean
}

export type NotesExportPreview = {
  markdown: string
  total: number
  /** 附上下文时，没能在章节正文里重新定位到的条数 —— 界面要明说 */
  unlocated: number
}
