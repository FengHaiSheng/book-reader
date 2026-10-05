import { describe, expect, it } from 'vitest'
import type { BookSummary, BookTag, BookStatus } from '../shared/types'
import {
  ctaLabel,
  filterBooks,
  formatBytes,
  parseView,
  progressLabel,
  progressText,
  sortBooks,
  statusLabel,
  summarizeImport
} from '../src/features/library/shelf'

function book(
  overrides: Partial<BookSummary> & { id: string; title: string }
): BookSummary {
  return {
    author: null,
    coverPath: null,
    status: 'unread' as BookStatus,
    chapterCount: 1,
    totalChars: 1000,
    percent: 0,
    fileSize: 0,
    addedAt: 0,
    lastOpenedAt: null,
    tags: [] as BookTag[],
    ...overrides
  }
}

const tag = (id: number, name: string): BookTag => ({ id, name, color: 'blue' })

describe('parseView', () => {
  it('只认 list，其余一律回网格', () => {
    expect(parseView('list')).toBe('list')
    expect(parseView('grid')).toBe('grid')
    expect(parseView(undefined)).toBe('grid')
    expect(parseView('')).toBe('grid')
    expect(parseView('LIST')).toBe('grid')
  })
})

describe('summarizeImport', () => {
  it('全是新书', () => {
    expect(
      summarizeImport([
        { status: 'imported', bookId: 'a', title: '河边的月亮' },
        { status: 'imported', bookId: 'b', title: '夏夜' }
      ])
    ).toBe('导入 2 本')
  })

  it('全是重复时不谎报导入成功', () => {
    expect(
      summarizeImport([{ status: 'duplicate', bookId: 'a', title: '河边的月亮' }])
    ).toBe('1 本已在书库里《河边的月亮》')
  })

  it('混合时两段都写出来', () => {
    expect(
      summarizeImport([
        { status: 'imported', bookId: 'a', title: '河边的月亮' },
        { status: 'duplicate', bookId: 'b', title: '夏夜' }
      ])
    ).toBe('导入 1 本，1 本已在书库里《夏夜》')
  })

  it('取消选择时返回空串，界面上什么都不显示', () => {
    expect(summarizeImport([])).toBe('')
  })
})

describe('progressText', () => {
  it('单本不带「第几本」，步数只有一步时用省略号', () => {
    expect(
      progressText({ phase: 'hash', done: 1, total: 1, fileIndex: 0, fileCount: 1, fileName: 'a.epub' })
    ).toBe('校验文件…')
  })

  it('多本带序号，多步带分数', () => {
    expect(
      progressText({ phase: 'extract', done: 4, total: 120, fileIndex: 1, fileCount: 3, fileName: 'b.epub' })
    ).toBe('第 2/3 本 · 解析正文 4/120')
  })
})

describe('filterBooks', () => {
  const books = [
    book({ id: 'a', title: '深度工作', author: 'Cal Newport', status: 'reading', tags: [tag(1, '工作方法')] }),
    book({ id: 'b', title: '河边的月亮', author: '测试作者', status: 'unread' }),
    book({ id: 'c', title: 'Deep Work', author: null, status: 'finished' })
  ]

  it('status 为 null 时不按状态筛', () => {
    expect(filterBooks(books, { status: null, query: '' }).map((b) => b.id)).toEqual(['a', 'b', 'c'])
  })

  it('按状态等值筛', () => {
    expect(filterBooks(books, { status: 'reading', query: '' }).map((b) => b.id)).toEqual(['a'])
  })

  it('查询词在标题、作者与标签名里都能命中，且忽略大小写', () => {
    expect(filterBooks(books, { status: null, query: 'deep' }).map((b) => b.id)).toEqual(['c'])
    expect(filterBooks(books, { status: null, query: 'cal' }).map((b) => b.id)).toEqual(['a'])
    expect(filterBooks(books, { status: null, query: '工作' }).map((b) => b.id)).toEqual(['a'])
  })

  it('作者为 null 不报错；空白查询不筛', () => {
    expect(filterBooks(books, { status: null, query: '   ' })).toHaveLength(3)
  })

  it('返回新数组，不改原数组', () => {
    const result = filterBooks(books, { status: 'unread', query: '' })
    expect(result).not.toBe(books)
    expect(books).toHaveLength(3)
  })
})

describe('sortBooks', () => {
  const books = [
    book({ id: 'a', title: 'B 书', addedAt: 100, lastOpenedAt: 500 }),
    book({ id: 'b', title: 'A 书', addedAt: 300, lastOpenedAt: null }),
    // 没打开过：recent 用 addedAt 兜底
    book({ id: 'c', title: 'C 书', addedAt: 900, lastOpenedAt: null })
  ]

  it('recent 用 lastOpenedAt，没有则回落到 addedAt', () => {
    expect(sortBooks(books, 'recent').map((b) => b.id)).toEqual(['c', 'a', 'b'])
  })

  it('added 按加入时间降序', () => {
    expect(sortBooks(books, 'added').map((b) => b.id)).toEqual(['c', 'b', 'a'])
  })

  it('title 用中文排序', () => {
    expect(sortBooks(books, 'title').map((b) => b.id)).toEqual(['b', 'a', 'c'])
  })

  it('返回新数组，不改原数组', () => {
    const result = sortBooks(books, 'added')
    expect(result).not.toBe(books)
    expect(books.map((b) => b.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('ctaLabel', () => {
  it('按状态给出动作', () => {
    expect(ctaLabel(book({ id: 'a', title: 'x', status: 'finished' }))).toBe('重读')
    expect(ctaLabel(book({ id: 'a', title: 'x', status: 'reading' }))).toBe('继续阅读')
    expect(ctaLabel(book({ id: 'a', title: 'x', status: 'unread' }))).toBe('开始阅读')
  })
})

describe('progressLabel', () => {
  it('已完成、有进度、未开始三种', () => {
    expect(progressLabel(book({ id: 'a', title: 'x', status: 'finished' }))).toBe('已读完')
    expect(progressLabel(book({ id: 'a', title: 'x', status: 'reading', percent: 0.38 }))).toBe('38%')
    expect(progressLabel(book({ id: 'a', title: 'x', status: 'unread', percent: 0 }))).toBe('')
  })
})

describe('statusLabel', () => {
  it('三种状态的中文名', () => {
    expect(statusLabel('unread')).toBe('未开始')
    expect(statusLabel('reading')).toBe('在读')
    expect(statusLabel('finished')).toBe('已完成')
  })
})

describe('formatBytes', () => {
  it('按量级选单位', () => {
    expect(formatBytes(0)).toBe('0 MB')
    expect(formatBytes(Math.round(4.2 * 1024 * 1024))).toBe('4.2 MB')
    expect(formatBytes(218 * 1024 * 1024)).toBe('218 MB')
    expect(formatBytes(Math.round(1.5 * 1024 ** 3))).toBe('1.5 GB')
  })
})