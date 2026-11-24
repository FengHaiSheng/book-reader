import type Database from 'better-sqlite3'
import type { BookSummary, BookTag } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TRACK_LIBRARY_TOP_N } from '../shared/track'
import {
  loadLibrarySummary,
  rankLibraryBooks,
  TRACK_SUMMARY_CHAPTERS,
  type RankableBook
} from '../electron/main/track/library-summary'
import {
  TRACK_GAP_SCHEMA,
  TRACK_MOUNT_SCHEMA,
  TRACK_SKELETON_SCHEMA,
  gapMessages,
  mountMessages,
  skeletonMessages
} from '../electron/main/track/prompts'
import {
  applyMountSuggestions,
  parseMountSuggestions,
  uncategorizedBookIds,
  validateGapPayload
} from '../electron/main/track/validate-mount'

vi.mock('../electron/main/library/repo', () => ({
  listBooks: vi.fn()
}))

import { listBooks } from '../electron/main/library/repo'

function book(partial: Partial<RankableBook> & { id: string }): RankableBook {
  return {
    status: 'unread',
    tags: [],
    lastOpenedAt: null,
    addedAt: 0,
    ...partial
  }
}

function summary(partial: Partial<BookSummary> & { id: string }): BookSummary {
  return {
    title: partial.title ?? partial.id,
    author: null,
    coverPath: null,
    status: 'unread',
    chapterCount: 0,
    totalChars: 0,
    percent: 0,
    fileSize: 0,
    addedAt: 0,
    lastOpenedAt: null,
    pinnedAt: null,
    tags: [],
    ...partial
  }
}

function tag(name: string): BookTag {
  return { id: 1, name, color: 'yellow' }
}

describe('书库摘要排序', () => {
  it('在读优先于有标签，有标签优先于最近打开；没打开过的再看加入时间', () => {
    const ranked = rankLibraryBooks([
      book({ id: 'finished-tagged', status: 'finished', tags: ['x'], lastOpenedAt: 100 }),
      book({ id: 'reading-plain', status: 'reading', tags: [], lastOpenedAt: 100 }),
      book({ id: 'reading-tagged', status: 'reading', tags: ['x'], lastOpenedAt: 1 }),
      book({ id: 'unread-tagged', status: 'unread', tags: ['x'], lastOpenedAt: 1 }),
      book({ id: 'unread-new', status: 'unread', lastOpenedAt: 50 }),
      book({ id: 'unread-old', status: 'unread', lastOpenedAt: 10 }),
      book({ id: 'never-later', lastOpenedAt: null, addedAt: 20 }),
      book({ id: 'never-sooner', lastOpenedAt: null, addedAt: 9 })
    ])

    expect(ranked.books.map((item) => item.id)).toEqual([
      'reading-tagged',
      'reading-plain',
      'finished-tagged',
      'unread-tagged',
      'unread-new',
      'unread-old',
      'never-later',
      'never-sooner'
    ])
    expect(ranked.note).toBeNull()
    expect(ranked.total).toBe(8)
  })

  it('打开时间相同则加入时间新的在前，仍相同则按 id', () => {
    const ranked = rankLibraryBooks([
      book({ id: 'b', lastOpenedAt: 5, addedAt: 1 }),
      book({ id: 'a', lastOpenedAt: 5, addedAt: 1 }),
      book({ id: 'newer', lastOpenedAt: 5, addedAt: 9 })
    ])
    expect(ranked.books.map((item) => item.id)).toEqual(['newer', 'a', 'b'])
  })

  it('不改入参数组的顺序', () => {
    const input = [book({ id: 'b' }), book({ id: 'a', status: 'reading' })]
    rankLibraryBooks(input)
    expect(input.map((item) => item.id)).toEqual(['b', 'a'])
  })

  it('超过 TRACK_LIBRARY_TOP_N 时截断，并写明本次只参考了 N 本', () => {
    const books = Array.from({ length: TRACK_LIBRARY_TOP_N + 1 }, (_, index) =>
      book({ id: `b${String(index).padStart(3, '0')}`, lastOpenedAt: index })
    )
    const ranked = rankLibraryBooks(books)
    expect(ranked.books).toHaveLength(TRACK_LIBRARY_TOP_N)
    expect(ranked.books[0]?.id).toBe(`b${String(TRACK_LIBRARY_TOP_N).padStart(3, '0')}`)
    expect(ranked.books.map((item) => item.id)).not.toContain('b000')
    expect(ranked.rankedIds).toHaveLength(TRACK_LIBRARY_TOP_N + 1)
    expect(ranked.rankedIds.at(-1)).toBe('b000')
    expect(ranked.note).toBe(
      `书库共 ${TRACK_LIBRARY_TOP_N + 1} 本，本次只参考了 ${TRACK_LIBRARY_TOP_N} 本`
    )
  })

  it('没超过上限时 note 为空，排序后的 id 全部留下', () => {
    const ranked = rankLibraryBooks([book({ id: 'only', status: 'reading', lastOpenedAt: 1 })])
    expect(ranked.note).toBeNull()
    expect(ranked.books.map((item) => item.id)).toEqual(['only'])
    expect(ranked.rankedIds).toEqual(['only'])
  })
})

describe('loadLibrarySummary', () => {
  beforeEach(() => {
    vi.mocked(listBooks).mockReset()
  })

  it('空书库不查目录', () => {
    vi.mocked(listBooks).mockReturnValue([])
    const calls: string[] = []
    const db = {
      prepare(sql: string) {
        calls.push(sql)
        return { all: () => [] }
      }
    } as unknown as Database.Database

    expect(loadLibrarySummary(db)).toEqual({ books: [], rankedIds: [], total: 0, note: null })
    expect(calls).toEqual([])
  })

  it('按同一顺序截取，并只给送进摘要的书带上前几条目录', () => {
    vi.mocked(listBooks).mockReturnValue([
      summary({ id: 'late', status: 'unread', lastOpenedAt: 9, tags: [tag('闲')] }),
      summary({ id: 'now', status: 'reading', lastOpenedAt: 1, percent: 1.4, tags: [tag('系统')] })
    ])
    const calls: { sql: string; params: unknown[] }[] = []
    const db = {
      prepare(sql: string) {
        return {
          all: (...params: unknown[]) => {
            calls.push({ sql, params })
            return [
              { bookId: 'now', title: ' 第一章 ' },
              { bookId: 'now', title: '第二章' },
              { bookId: 'now', title: '第三章' },
              { bookId: 'now', title: '第四章' },
              { bookId: 'now', title: '第五章' },
              { bookId: 'now', title: '第六章' },
              { bookId: 'late', title: '闲章' }
            ]
          }
        }
      }
    } as unknown as Database.Database

    const summaryResult = loadLibrarySummary(db)
    expect(summaryResult.books.map((item) => item.id)).toEqual(['now', 'late'])
    expect(summaryResult.books[0]).toMatchObject({
      percent: 1,
      tags: ['系统'],
      chapterTitles: ['第一章', '第二章', '第三章', '第四章', '第五章']
    })
    expect(summaryResult.books[0]?.chapterTitles).toHaveLength(TRACK_SUMMARY_CHAPTERS)
    expect(summaryResult.books[1]?.chapterTitles).toEqual(['闲章'])
    expect(summaryResult.note).toBeNull()
    expect(calls[0]?.sql).toContain('FROM chapters')
    expect(calls[0]?.sql).toContain('href <>')
    expect(calls[0]?.params).toEqual(['now', 'late'])
  })

  it('超过上限时目录查询不再带上被截掉的书', () => {
    vi.mocked(listBooks).mockReturnValue(
      Array.from({ length: TRACK_LIBRARY_TOP_N + 1 }, (_, index) =>
        summary({ id: `b${String(index).padStart(3, '0')}`, lastOpenedAt: index })
      )
    )
    const calls: unknown[][] = []
    const db = {
      prepare() {
        return {
          all: (...params: unknown[]) => {
            calls.push(params)
            return []
          }
        }
      }
    } as unknown as Database.Database

    const summaryResult = loadLibrarySummary(db)
    expect(summaryResult.note).toContain(`本次只参考了 ${TRACK_LIBRARY_TOP_N} 本`)
    expect(summaryResult.books).toHaveLength(TRACK_LIBRARY_TOP_N)
    expect(calls[0]).toHaveLength(TRACK_LIBRARY_TOP_N)
    expect(calls[0]).not.toContain('b000')
    expect(summaryResult.rankedIds).toContain('b000')
  })
})

describe('挂载校验', () => {
  it('丢掉未知节点和不在书库里的书，未归类保持书库顺序', () => {
    const suggestions = parseMountSuggestions({
      mounts: [
        { nodeId: 'ghost', bookIds: ['b1'] },
        { node_id: 'n1', book_ids: [' nope ', 'b2', 'b2', { bookId: 'b1' }] }
      ]
    })
    expect(suggestions).toEqual([
      { nodeId: 'ghost', bookIds: ['b1'] },
      { nodeId: 'n1', bookIds: ['nope', 'b2', 'b2', 'b1'] }
    ])

    const applied = applyMountSuggestions(
      suggestions ?? [],
      new Set(['n1']),
      new Set(['b1', 'b2', 'b3'])
    )
    expect(applied.links).toEqual([
      { nodeId: 'n1', bookId: 'b2', source: 'ai' },
      { nodeId: 'n1', bookId: 'b1', source: 'ai' }
    ])
    expect(uncategorizedBookIds(['b1', 'b2', 'b3'], new Set(applied.mountedBookIds))).toEqual(['b3'])
  })

  it('认 nodeId 到 bookId 数组的映射，认不出的形状返回 null', () => {
    expect(parseMountSuggestions({ n1: ['b1'], n2: 'b2' })).toEqual([
      { nodeId: 'n1', bookIds: ['b1'] },
      { nodeId: 'n2', bookIds: ['b2'] }
    ])
    expect(parseMountSuggestions({})).toEqual([])
    expect(parseMountSuggestions({ nodes: [] })).toBeNull()
    expect(parseMountSuggestions('不是')).toBeNull()
    expect(parseMountSuggestions(null)).toBeNull()
  })
})

describe('问缺结构', () => {
  it('丢掉未知节点并标明条数，非法类型直接跳过', () => {
    expect(
      validateGapPayload(
        {
          overall: '  还缺基础  ',
          gaps: [
            { nodeId: 'n1', type: 'coverage', summary: ' 没书 ', suggestBookKinds: ['教材', ''] },
            { nodeId: 'nope', type: 'progress', summary: '未知' },
            { nodeId: 'n1', type: 'other', summary: '坏类型' },
            { node_id: 'n1', type: 'sediment', summary: '没笔记', suggest_book_kinds: ['习题'] }
          ],
          next_steps: [' 先补一本 ', '']
        },
        new Set(['n1'])
      )
    ).toEqual({
      overall: '还缺基础',
      gaps: [
        { nodeId: 'n1', type: 'coverage', summary: '没书', suggestBookKinds: ['教材'] },
        { nodeId: 'n1', type: 'sediment', summary: '没笔记', suggestBookKinds: ['习题'] }
      ],
      nextSteps: ['先补一本'],
      note: '已忽略 1 条指向未知节点的缺口'
    })
  })

  it('没有 overall 也没有 gaps 时返回 null', () => {
    expect(validateGapPayload('不是 json', new Set(['n1']))).toBeNull()
    expect(validateGapPayload({}, new Set(['n1']))).toBeNull()
    expect(validateGapPayload({ overall: '还行' }, new Set(['n1']))).toEqual({
      overall: '还行',
      gaps: [],
      nextSteps: [],
      note: null
    })
  })
})

describe('脉络提示词', () => {
  const libraryBook = {
    id: 'b1',
    title: '深入理解计算机系统',
    author: null as string | null,
    tags: ['系统'],
    status: 'reading' as const,
    percent: 0.42,
    chapterTitles: ['第1章']
  }

  it('骨架提示词带目标和书，重生时要求沿用旧 id', () => {
    const created = skeletonMessages({ goalText: '学操作系统', books: [libraryBook] })
    expect(created[1]?.content).toContain(TRACK_SKELETON_SCHEMA)
    expect(created[1]?.content).toContain('学操作系统')
    expect(created[1]?.content).toContain('book b1')
    expect(created[1]?.content).toContain('进度 42%')
    expect(created[1]?.content).toContain('在读')
    expect(created[1]?.content).toContain('第1章')
    expect(created[1]?.content).not.toContain('book b9')

    const rebuild = skeletonMessages({
      goalText: '学操作系统',
      books: [],
      previousNodes: [
        {
          id: 'keep',
          parentId: null,
          title: '旧节点',
          summary: '',
          depth: 1,
          sortOrder: 0,
          userEdited: true
        }
      ]
    })
    expect(rebuild[1]?.content).toContain('node keep')
    expect(rebuild[1]?.content).toContain('用户改过挂载')
  })

  it('挂载提示词只允许使用给定的节点和书', () => {
    const messages = mountMessages({
      goalText: '学操作系统',
      nodes: [
        { id: 'n1', parentId: null, title: '内存', summary: '', depth: 1, sortOrder: 0 }
      ],
      books: [libraryBook]
    })
    expect(messages[1]?.content).toContain(TRACK_MOUNT_SCHEMA)
    expect(TRACK_MOUNT_SCHEMA).not.toContain('n1')
    expect(messages[0]?.content).toContain('骨架里列出的 id')
    expect(messages[1]?.content).toContain('骨架里列出的 id')
    expect(messages[1]?.content).toContain('不要编造')
    expect(messages[1]?.content).toContain('node n1')
    expect(messages[1]?.content).toContain('book b1')
  })

  it('问缺提示词带信号和追问', () => {
    const messages = gapMessages({
      goalText: '学操作系统',
      question: '先读什么',
      nodes: [
        {
          id: 'n1',
          title: '内存',
          summary: '地址空间',
          depth: 1,
          bookTitles: ['深入理解计算机系统'],
          bookCount: 1,
          progressAvg: 0.42,
          unreadRatio: 0,
          sediment: 3,
          strength: 'ok'
        }
      ]
    })
    expect(messages[0]?.content).toContain('coverage')
    expect(messages[1]?.content).toContain(TRACK_GAP_SCHEMA)
    expect(messages[1]?.content).toContain('node n1')
    expect(messages[1]?.content).toContain('进度 0.4200')
    expect(messages[1]?.content).toContain('先读什么')
  })
})
