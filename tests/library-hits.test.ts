import { describe, expect, it } from 'vitest'
import type { SearchHitWithBook } from '../shared/types'
import {
  groupHitsByBook,
  hitPageCount,
  PAGE_SIZE,
  sliceHitsPage
} from '../src/features/library/hits'

function hit(bookId: string, bookTitle: string, chunkId: number): SearchHitWithBook {
  return {
    chunkId,
    chapterId: chunkId * 10,
    headingPath: `第 ${chunkId} 章`,
    text: `第 ${chunkId} 段正文`,
    score: -chunkId,
    bookId,
    bookTitle
  }
}

describe('groupHitsByBook', () => {
  it('按书归组，但保持传入顺序（名次不能被打乱）', () => {
    const groups = groupHitsByBook([
      hit('b2', '思考，快与慢', 1),
      hit('b1', '深度工作', 2),
      hit('b2', '思考，快与慢', 3)
    ])
    expect(groups.map((g) => g.bookTitle)).toEqual(['思考，快与慢', '深度工作'])
    expect(groups[0]?.hits.map((h) => h.chunkId)).toEqual([1, 3])
  })

  it('带每本书的命中条数', () => {
    const groups = groupHitsByBook([hit('b1', '深度工作', 1), hit('b1', '深度工作', 2)])
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ bookId: 'b1', bookTitle: '深度工作', count: 2 })
  })

  it('空数组给空分组', () => {
    expect(groupHitsByBook([])).toEqual([])
  })
})

describe('sliceHitsPage / hitPageCount', () => {
  const many = Array.from({ length: 25 }, (_, i) => hit('b1', '书', i + 1))

  it('每页 PAGE_SIZE 条，跨页不重不漏', () => {
    expect(PAGE_SIZE).toBe(10)
    expect(sliceHitsPage(many, 0).map((h) => h.chunkId)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(sliceHitsPage(many, 1).map((h) => h.chunkId)).toEqual([
      11, 12, 13, 14, 15, 16, 17, 18, 19, 20
    ])
    expect(sliceHitsPage(many, 2).map((h) => h.chunkId)).toEqual([21, 22, 23, 24, 25])
  })

  it('越界与空', () => {
    expect(sliceHitsPage(many, 3)).toEqual([])
    expect(sliceHitsPage([], 0)).toEqual([])
    expect(sliceHitsPage(many, -1)).toEqual([])
  })

  it('页数', () => {
    expect(hitPageCount(0)).toBe(0)
    expect(hitPageCount(1)).toBe(1)
    expect(hitPageCount(10)).toBe(1)
    expect(hitPageCount(11)).toBe(2)
    expect(hitPageCount(25)).toBe(3)
  })
})
