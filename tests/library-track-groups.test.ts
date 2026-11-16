import { describe, expect, it } from 'vitest'
import { groupBooksByTrack, UNCATEGORIZED_TITLE } from '../src/features/library/track-groups'
import { parseGroupBy } from '../src/features/library/shelf'

const nodes = [
  { id: 'd1', parentId: null, title: '战略', depth: 1, sortOrder: 0, bookIds: [] },
  { id: 'd2', parentId: 'd1', title: '竞争战略', depth: 2, sortOrder: 0, bookIds: ['b1', 'b2'] },
  { id: 'f1', parentId: null, title: '财务', depth: 1, sortOrder: 1, bookIds: ['b3'] }
]

describe('groupBooksByTrack', () => {
  it('每个节点一节，空节点也保留；未归类排在最后', () => {
    const sections = groupBooksByTrack(['b1', 'b2', 'b3', 'b4'], nodes)
    expect(sections.map((section) => section.nodeId)).toEqual(['d1', 'd2', 'f1', null])
    expect(sections[0]).toEqual({ nodeId: 'd1', title: '战略', depth: 1, bookIds: [] })
    expect(sections[1]?.bookIds).toEqual(['b1', 'b2'])
    expect(sections[2]?.bookIds).toEqual(['b3'])
    expect(sections[3]).toEqual({
      nodeId: null,
      title: UNCATEGORIZED_TITLE,
      depth: 0,
      bookIds: ['b4']
    })
  })

  it('筛选后节内只留可见的书；全被筛掉时保留空节', () => {
    const sections = groupBooksByTrack(['b3'], nodes)
    expect(sections[1]?.bookIds).toEqual([])
    expect(sections[2]?.bookIds).toEqual(['b3'])
    expect(sections.some((section) => section.nodeId === null)).toBe(false)

    const filtered = groupBooksByTrack(['b4'], nodes)
    expect(filtered[1]?.bookIds).toEqual([])
    expect(filtered[2]?.bookIds).toEqual([])
    expect(filtered.at(-1)?.bookIds).toEqual(['b4'])
  })

  it('没有未归类的书时省略末节', () => {
    const sections = groupBooksByTrack(['b1', 'b3'], nodes)
    expect(sections.map((section) => section.nodeId)).toEqual(['d1', 'd2', 'f1'])
  })

  it('一书多挂会在多个节里重复出现', () => {
    const sections = groupBooksByTrack(
      ['b1'],
      [
        { id: 'n1', parentId: null, title: '一', depth: 1, sortOrder: 0, bookIds: ['b1'] },
        { id: 'n2', parentId: null, title: '二', depth: 1, sortOrder: 1, bookIds: ['b1'] }
      ]
    )
    expect(sections.map((section) => section.bookIds)).toEqual([['b1'], ['b1']])
    expect(sections.some((section) => section.nodeId === null)).toBe(false)
  })

  it('输入是平铺乱序时仍按树序输出，子节紧跟父节', () => {
    const sections = groupBooksByTrack([], [...nodes].reverse())
    expect(sections.map((section) => section.title)).toEqual(['战略', '竞争战略', '财务'])
  })

  it('节内按 visibleBookIds 的顺序，与排序结果一致', () => {
    const sections = groupBooksByTrack(['b2', 'b1'], nodes)
    expect(sections[1]?.bookIds).toEqual(['b2', 'b1'])
  })
})

describe('parseGroupBy', () => {
  it('只认 track，其余一律落回 list', () => {
    expect(parseGroupBy('track')).toBe('track')
    expect(parseGroupBy('list')).toBe('list')
    expect(parseGroupBy(undefined)).toBe('list')
    expect(parseGroupBy(null)).toBe('list')
    expect(parseGroupBy('')).toBe('list')
    expect(parseGroupBy('TRACK')).toBe('list')
  })
})
