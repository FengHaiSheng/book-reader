import type { AiCaps, CapabilityKey } from './ai'
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
  /** 阅读进度，0–1；没有进度时为 0 */
  percent: number
  /** epub 文件字节数 */
  fileSize: number
  addedAt: number
  lastOpenedAt: number | null
  /** 按标签名排序；没打标签就是空数组，不是 undefined */
  tags: BookTag[]
}

/** 书架的排序口径。recent 用「上次阅读，没有就加入时间」 */
export type LibrarySort = 'recent' | 'title' | 'added'

/** 侧栏「本地书库」的汇总。bytes 是全部 epub 文件大小之和 */
export type LibraryStats = {
  total: number
  unread: number
  reading: number
  finished: number
  bytes: number
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

/** 导出落盘的结果。用户点了「取消」也是正常路径，所以用 saved 而不是抛错 */
export type NotesExportResult = {
  saved: boolean
  path: string | null
}

export type AiSettings = { providerId: ProviderId; model: string }

export type AiMessageRole = 'user' | 'assistant'

export type AiMessage = {
  id: number
  bookId: string
  chapterId: number | null
  scopeKey: string
  role: AiMessageRole
  content: string
  tokens: number
  createdAt: number
}

/** 回答里 [n] 上标指向的那一段原文 */
export type Citation = {
  index: number
  chunkId: number
  chapterId: number | null
  chapterTitle: string | null
  headingPath: string
  /** 前 30 字，用于回跳时在章节正文里匹配 */
  excerpt: string
}

/**
 * 本次回答的降级说明。
 *
 * 存在的理由就是硬规则 2：能力不足必须在 UI 上明说，不能静默降级。
 * 文案在主进程生成，界面只负责渲染成提示条——避免同一句降级说明散落在多个组件里。
 *
 * 只有划词问答这条路会用到它，三条都对应 `runChat` 里的一次真实判断。
 * 结构化任务的降级走 `AiResultView.note`：那边一次返回一份结果，
 * 再配一个 `degraded` 数组就得让界面同时读两个地方，反而容易漏。
 */
export type AiDegrade = {
  kind: 'noEmbed' | 'contextTruncated' | 'blindIndex'
  message: string
}

export type AiUsage = { inputTokens: number; outputTokens: number }

export type AiChatResult = {
  requestId: string
  content: string
  /** 服务商没返回用量时为 null，界面显示「用量未返回」，不编数字 */
  usage: AiUsage | null
  citations: Citation[]
  degraded: AiDegrade[]
}

/**
 * 花钱之前的 token 预估。
 *
 * 它是**估算不是计费值**：界面上一律写成「约」，绝不能当成真实用量。
 * `inputTokens` 只统计这次要送进模型的内容；`calls` 为 0 表示不调模型、不产生费用。
 * `note` 如实说明估不到的部分（不含向量召回、按假设估、缺前置等）——
 * 估不准就要说原因，不能编一个数字（硬规则 2）。
 */
export type AiEstimate = {
  inputTokens: number
  /** 单次请求的输出上限（max_tokens）。多步任务取单次的值，总量要乘 calls */
  maxOutputTokens: number
  /** 真实会发起的调用次数 */
  calls: number
  note: string | null
}

export type AiEstimateRequest =
  | {
      kind: 'chat'
      bookId: string
      chapterId: number | null
      task: 'ask' | 'explain' | 'translate'
      excerpt?: string
      question?: string
    }
  | {
      kind: 'task'
      bookId: string
      chapterId: number | null
      task: 'chapterSummary' | 'bookDigest' | 'terms' | 'mindmap'
    }

export type IndexState = { total: number; done: number; running: boolean }

export type AiStatus = {
  providerId: ProviderId
  model: string
  /** 是否已填 key */
  configured: boolean
  caps: AiCaps
  /** 运行中被真实调用标成不可用的能力 */
  unavailable: CapabilityKey[]
  index: IndexState
}

export type AiDegradeEvent = { requestId: string; delta: string }

export type AiProgressEvent = {
  /** 'index' 是建索引，'digest' 是全书要点逐章 map */
  kind: 'index' | 'digest'
  bookId: string
  done: number
  total: number
  label: string
  running: boolean
}

export type ChapterSummaryPayload = {
  overview: string
  keyPoints: string[]
  terms: { term: string; gloss: string }[]
}

export type BookDigestPayload = {
  threads: string[]
  arguments: string[]
  conclusion: string
}

export type TermsPayload = { terms: { term: string; gloss: string; where: string }[] }

export type MindmapNode = { label: string; children: MindmapNode[] }

/**
 * 结构化任务的结果视图。
 *
 * `payload` 为 null 表示模型没给出可用的 JSON——那时 `text` 放它的原文、`note` 说明原因，
 * 界面按纯文本展示。**不出现「什么都没有」的空结果**是硬规则 2 的底线。
 * `usage` 为 null 表示服务商没返回用量（或这次根本没调模型），界面显示「未返回」。
 * `cached` 为 true 表示命中 ai_results 唯一键，这一次没有花钱。
 */
export type AiResultView<T> = {
  payload: T | null
  text: string | null
  cached: boolean
  usage: AiUsage | null
  createdAt: number
  note: string | null
}

/**
 * 打开面板时从 ai_results 读回来的已有结果。
 *
 * 只读缓存、**不发起任何模型调用**（硬规则 1）：没有的键就是 undefined，界面据此显示「生成」。
 */
export type CachedTaskResults = {
  summary?: AiResultView<ChapterSummaryPayload>
  digest?: AiResultView<BookDigestPayload>
  terms?: AiResultView<TermsPayload>
  mindmap?: AiResultView<MindmapNode>
}

/** 书上的标签，够渲染一行 chip 用 */
export type BookTag = {
  id: number
  name: string
  color: HighlightColor
}

/** 侧栏用的标签：比 BookTag 多一个计数 */
export type Tag = BookTag & { bookCount: number }

/** 主进程推给渲染进程的导入进度：多本一起导入时要能说出「第几本」 */
export type ImportProgressEvent = ImportProgress & {
  fileIndex: number
  fileCount: number
  fileName: string
}
