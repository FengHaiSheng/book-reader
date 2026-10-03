import type { AppError } from './errors'

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
