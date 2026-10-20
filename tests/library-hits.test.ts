import { describe, expect, it } from 'vitest'
import type { SearchHitWithBook } from '../shared/types'
import { groupHitsByBook } from '../src/features/library/hits'

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
