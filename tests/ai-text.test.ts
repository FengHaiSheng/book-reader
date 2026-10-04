import { describe, expect, it } from 'vitest'
import { parseBlocks, parseInline } from '../src/features/ai/text'

describe('parseInline', () => {
  it('把 [n] 切成引用标记，前后文本各成一段', () => {
    expect(parseInline('手机会占用注意力[2]，所以要隔离[1]。')).toEqual([
      { kind: 'text', value: '手机会占用注意力' },
      { kind: 'cite', index: 2 },
      { kind: 'text', value: '，所以要隔离' },
      { kind: 'cite', index: 1 },
      { kind: 'text', value: '。' }
    ])
  })

  it('**粗体** 变成 strong，不与引用标记混淆', () => {
    expect(parseInline('**结论**是[1]')).toEqual([
      { kind: 'strong', value: '结论' },
      { kind: 'text', value: '是' },
      { kind: 'cite', index: 1 }
    ])
  })

  it('没有标记时原样返回一段文本', () => {
    expect(parseInline('就是一段普通话')).toEqual([{ kind: 'text', value: '就是一段普通话' }])
  })

  it('空串返回空数组', () => {
    expect(parseInline('')).toEqual([])
  })

  it('四位数以上的方括号不当引用 —— [2024] 是年份', () => {
    expect(parseInline('见[2024]年的记录')).toEqual([{ kind: 'text', value: '见[2024]年的记录' }])
  })
})

describe('parseBlocks', () => {
  it('空行分段，列表单独成块', () => {
    const blocks = parseBlocks('第一段\n\n- 甲\n- 乙\n\n第二段')
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'bullet', 'paragraph'])
    const bullet = blocks[1]
    expect(bullet?.kind === 'bullet' && bullet.items).toHaveLength(2)
  })

  it('有序列表与无序列表不会混进同一块', () => {
    expect(parseBlocks('- 甲\n1. 乙').map((b) => b.kind)).toEqual(['bullet', 'ordered'])
  })

  it('单换行不切段，换行原样留在文本里（渲染端用 pre-wrap 呈现）', () => {
    const blocks = parseBlocks('上半句\n下半句')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toEqual({
      kind: 'paragraph',
      inline: [{ kind: 'text', value: '上半句\n下半句' }]
    })
  })

  it('连续空行不会产出空块', () => {
    expect(parseBlocks('\n\n甲\n\n\n\n乙\n\n')).toHaveLength(2)
  })
})