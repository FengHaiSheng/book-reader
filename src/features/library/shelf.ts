import type {
  BookStatus,
  BookSummary,
  ImportOutcome,
  ImportProgressEvent,
  LibrarySort
} from '@shared/types'

export type LibraryView = 'grid' | 'list'

/** 设置里存的是字符串，读到什么都不许让书架渲染不出来 */
export function parseView(raw: string | undefined | null): LibraryView {
  return raw === 'list' ? 'list' : 'grid'
}

/** 导入结束后的那一句话：导入了几本、哪几本是重复的 */
export function summarizeImport(outcomes: readonly ImportOutcome[]): string {
  const imported = outcomes.filter((item) => item.status === 'imported')
  const duplicates = outcomes.filter((item) => item.status === 'duplicate')
  const parts: string[] = []

  if (imported.length > 0) parts.push(`导入 ${imported.length} 本`)
  if (duplicates.length > 0) {
    const titles = duplicates.map((item) => `《${item.title}》`).join('')
    parts.push(`${duplicates.length} 本已在书库里${titles}`)
  }
  return parts.join('，')
}

const PHASE_LABEL: Record<ImportProgressEvent['phase'], string> = {
  hash: '校验文件',
  extract: '解析正文',
  store: '写入书库'
}

/** 进度文案要能看出「进行到第几本、这一步做到哪儿」，否则多本导入像卡住了 */
export function progressText(progress: ImportProgressEvent): string {
  const book = progress.fileCount > 1 ? `第 ${progress.fileIndex + 1}/${progress.fileCount} 本 · ` : ''
  const step = progress.total > 1 ? ` ${progress.done}/${progress.total}` : '…'
  return `${book}${PHASE_LABEL[progress.phase]}${step}`
}

/**
 * 删书的二次确认文案只有这一份。spec §6.3 要求明说笔记与高亮一起删，
 * 网格视图与列表视图的删除按钮共用它，别让两处文案各自演化。
 */
export function confirmRemove(book: { title: string }): boolean {
  return window.confirm(`删除《${book.title}》？笔记、高亮与阅读进度会一起删除，不可恢复。`)
}

/** 书架筛选条件：状态（null 为不筛）与搜索词（trim 后为空则不筛） */
export type ShelfFilters = { status: BookStatus | null; query: string }

/**
 * 搜索是本地小规模数据，直接在标题、作者与标签名里做大小写不敏感的子串匹配。
 * 返回新数组，不改原数组。
 */
export function filterBooks(books: readonly BookSummary[], filters: ShelfFilters): BookSummary[] {
  const query = filters.query.trim().toLowerCase()
  return books.filter((book) => {
    if (filters.status !== null && book.status !== filters.status) return false
    if (query === '') return true
    const fields = [book.title, book.author ?? '', ...book.tags.map((tag) => tag.name)]
    return fields.some((field) => field.toLowerCase().includes(query))
  })
}

/** 排序口径见 shared/types 的 LibrarySort。返回新数组，不改原数组。 */
export function sortBooks(books: readonly BookSummary[], sort: LibrarySort): BookSummary[] {
  const copy = [...books]
  if (sort === 'title') {
    copy.sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'))
  } else if (sort === 'added') {
    copy.sort((a, b) => b.addedAt - a.addedAt)
  } else {
    copy.sort((a, b) => (b.lastOpenedAt ?? b.addedAt) - (a.lastOpenedAt ?? a.addedAt))
  }
  return copy
}

/** 封面悬停 CTA：按状态给出下一步动作 */
export function ctaLabel(book: BookSummary): string {
  if (book.status === 'finished') return '重读'
  if (book.status === 'reading') return '继续阅读'
  return '开始阅读'
}

/**
 * 进度行文案。名字与导入用的 `progressText(progress)` 区分开，避免同名两义。
 * finished→「已读完」；有进度→百分比；未开始→空串（调用方据此不渲染）。
 */
export function progressLabel(book: BookSummary): string {
  if (book.status === 'finished') return '已读完'
  if (book.percent > 0) return `${Math.round(book.percent * 100)}%`
  return ''
}

export function statusLabel(status: BookStatus): string {
  if (status === 'reading') return '在读'
  if (status === 'finished') return '已完成'
  return '未开始'
}

/**
 * 文件大小：≥1GB 用一位小数 GB，≥10MB 用整数 MB，其余一位小数 MB。
 * 0 单独写成 0 MB。
 */
export function formatBytes(bytes: number): string {
  const gb = 1024 ** 3
  const mb = 1024 ** 2
  if (bytes >= gb) return `${(bytes / gb).toFixed(1)} GB`
  if (bytes === 0) return '0 MB'
  if (bytes >= 10 * mb) return `${Math.round(bytes / mb)} MB`
  return `${(bytes / mb).toFixed(1)} MB`
}