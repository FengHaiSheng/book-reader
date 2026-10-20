import { describe, expect, it } from 'vitest'
import type { HighlightWithBook } from '../shared/types'
import {
  applyFilter,
  bookOptions,
  countsByKind,
  groupByBook,
  resolveSelection
} from '../src/features/notes/group'

function note(id: number, bookId: string, bookTitle: string, hasNote: boolean): HighlightWithBook {
  return {
    id,
    bookId,
    chapterId: id * 10,
    startCfi: `epubcfi(/6/${id * 2}!/4/2/1:0)`,
    endCfi: `epubcfi(/6/${id * 2}!/4/2/1:8)`,
    text: `第 ${id} 条原文`,
    note: hasNote ? `第 ${id} 条批注` : null,
    color: 'yellow',
    createdAt: id,
    updatedAt: id,
    bookTitle,
    chapterTitle: `第 ${id} 章`,
    percent: 0.5
  }
}

const NOTES = [
  note(1, 'b1', '深度工作', true),
  note(2, 'b1', '深度工作', false),
  note(3, 'b2', '思考，快与慢', false)
]

describe('applyFilter', () => {
  it('只按类型筛', () => {
    expect(applyFilter(NOTES, { kind: 'annotated', bookId: null, query: '' }).map((n) => n.id)).toEqual([1])
    expect(applyFilter(NOTES, { kind: 'marked', bookId: null, query: '' }).map((n) => n.id)).toEqual([2, 3])
    expect(applyFilter(NOTES, { kind: 'all', bookId: null, query: '' })).toHaveLength(3)
  })

  it('类型与书籍同时生效', () => {
    expect(applyFilter(NOTES, { kind: 'marked', bookId: 'b1', query: '' }).map((n) => n.id)).toEqual([2])
  })

  it('关键字在原文与批注里各筛一次', () => {
    expect(applyFilter(NOTES, { kind: 'all', bookId: null, query: '第 1 条原文' }).map((n) => n.id)).toEqual([1])
    expect(applyFilter(NOTES, { kind: 'all', bookId: null, query: '批注' }).map((n) => n.id)).toEqual([1])
  })

  it('关键字与类型、书籍三者叠加', () => {
    expect(
      applyFilter(NOTES, { kind: 'marked', bookId: 'b2', query: '第 3 条' }).map((n) => n.id)
    ).toEqual([3])
  })

  it('关键字大小写不敏感，纯空白不筛', () => {
    const withCase = [{ ...NOTES[0]!, text: 'Deep Work 的注意力' }]
    expect(applyFilter(withCase, { kind: 'all', bookId: null, query: 'deep work' })).toHaveLength(1)
    expect(applyFilter(NOTES, { kind: 'all', bookId: null, query: '   ' })).toHaveLength(3)
  })

  it('正则元字符按普通字符处理，不抛 SyntaxError', () => {
    const paren = [{ ...NOTES[0]!, text: '这里有个 ( 括号' }]
    expect(() => applyFilter(paren, { kind: 'all', bookId: null, query: '(' })).not.toThrow()
    expect(applyFilter(paren, { kind: 'all', bookId: null, query: '(' })).toHaveLength(1)
  })
})

describe('countsByKind', () => {
  it('不选书时是全局计数', () => {
    expect(countsByKind(NOTES, null)).toEqual({ all: 3, marked: 2, annotated: 1 })
  })

  it('选了书，类型计数也只算这本书', () => {
    expect(countsByKind(NOTES, 'b1')).toEqual({ all: 2, marked: 1, annotated: 1 })
  })
})

describe('groupByBook', () => {
  it('保持传入顺序，同书的归到一组', () => {
    const groups = groupByBook(NOTES)
    expect(groups.map((g) => [g.bookTitle, g.count])).toEqual([
      ['深度工作', 2],
      ['思考，快与慢', 1]
    ])
  })
})

describe('bookOptions', () => {
  it('每本书一条，带条数', () => {
    expect(bookOptions(NOTES)).toEqual([
      { bookId: 'b1', bookTitle: '深度工作', count: 2 },
      { bookId: 'b2', bookTitle: '思考，快与慢', count: 1 }
    ])
  })
})

describe('resolveSelection', () => {
  it('选中的还在就保持不动', () => {
    expect(resolveSelection(NOTES, 3)).toBe(3)
  })

  it('选中的被筛掉了就落到第一条，避免右栏停在一个看不见的笔记上', () => {
    expect(resolveSelection([NOTES[0]!], 3)).toBe(1)
  })

  it('一条都没有时是 null', () => {
    expect(resolveSelection([], 3)).toBeNull()
  })
})
