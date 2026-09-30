import { describe, expect, it } from 'vitest'
import { buildChapters } from '../electron/main/epub/chapters'
import type { SpineText, TocNode } from '../electron/main/epub/types'

const spine = ['OEBPS/ch1.xhtml', 'OEBPS/ch2.xhtml', 'OEBPS/ch3.xhtml']

const texts: SpineText[] = [
  { entry: 'OEBPS/ch1.xhtml', text: '甲'.repeat(10), heading: '正文一' },
  { entry: 'OEBPS/ch2.xhtml', text: '乙'.repeat(20), heading: '正文二' },
  { entry: 'OEBPS/ch3.xhtml', text: '丙'.repeat(30), heading: '正文三' }
]

const toc: TocNode[] = [
  {
    title: '第一章',
    entry: 'OEBPS/ch1.xhtml',
    children: [{ title: '第一节', entry: 'OEBPS/ch2.xhtml', children: [] }]
  },
  { title: '只有目录没有正文的卷', entry: '', children: [{ title: '第二章', entry: 'OEBPS/ch2.xhtml', children: [] }] }
]

describe('buildChapters', () => {
  it('目录节点的层级与父子下标正确', () => {
    const rows = buildChapters(toc, spine, texts)
    const first = rows[0]!
    expect(first).toMatchObject({ title: '第一章', depth: 0, parentIndex: null, orderIndex: 0 })
    expect(rows[1]).toMatchObject({ title: '第一节', depth: 1, parentIndex: 0, orderIndex: 1 })
  })

  it('char 区间按 spine 顺序累计，含换行分隔符', () => {
    const rows = buildChapters(toc, spine, texts)
    const first = rows[0]!
    expect(first.charStart).toBe(0)
    expect(first.charEnd).toBe(10)
    // 第二篇从第一段的结束位置 + 1（一个换行）开始
    expect(rows[1]).toMatchObject({ charStart: 11, charEnd: 31 })
  })

  it('没有正文的目录节点 char 区间为 null，且不影响其他节点', () => {
    const rows = buildChapters(toc, spine, texts)
    const groupIndex = rows.findIndex((row) => row.title === '只有目录没有正文的卷')
    const group = rows[groupIndex]!
    expect(group.orderIndex).toBeNull()
    expect(group.charStart).toBeNull()
    expect(group.entry).toBe('')
  })

  it('同一 entry 被目录引用两次时，只有第一条拿到 char 区间', () => {
    const rows = buildChapters(toc, spine, texts)
    const duplicates = rows.filter((row) => row.entry === 'OEBPS/ch2.xhtml')
    expect(duplicates).toHaveLength(2)
    expect(duplicates[0]!.charStart).not.toBeNull()
    expect(duplicates[1]!.charStart).toBeNull()
  })

  it('目录没覆盖的 spine 项被补成平级章节，标题取文档标题', () => {
    const rows = buildChapters(toc, spine, texts)
    const synthetic = rows.find((row) => row.entry === 'OEBPS/ch3.xhtml')
    expect(synthetic).toMatchObject({ title: '正文三', depth: 0, parentIndex: null, orderIndex: 2 })
  })

  it('目录为空时全部走兜底命名', () => {
    const rows = buildChapters([], ['OEBPS/ch1.xhtml'], [{ entry: 'OEBPS/ch1.xhtml', text: '甲'.repeat(5), heading: null }])
    expect(rows).toEqual([
      {
        title: '第 1 节',
        entry: 'OEBPS/ch1.xhtml',
        depth: 0,
        parentIndex: null,
        orderIndex: 0,
        charStart: 0,
        charEnd: 5
      }
    ])
  })
})
