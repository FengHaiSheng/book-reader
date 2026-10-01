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
