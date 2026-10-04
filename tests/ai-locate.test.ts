import { describe, expect, it } from 'vitest'
import { flatten, locateInFlat, squash } from '../src/features/reader/locate'

describe('squash', () => {
  it('去掉换行、缩进与全角空格', () => {
    expect(squash('他\n  说：「好　的」')).toBe('他说：「好的」')
  })
})

describe('flatten', () => {
  it('跳过空白并记住每个保留字符的出处', () => {
    const flat = flatten(['ab\n', ' c d'])
    expect(flat.text).toBe('abcd')
    expect(flat.map).toEqual([
      { nodeIndex: 0, offset: 0 },
      { nodeIndex: 0, offset: 1 },
      { nodeIndex: 1, offset: 1 },
      { nodeIndex: 1, offset: 3 }
    ])
  })

  it('全空白的输入得到空串与空映射', () => {
    const flat = flatten([' ', '\n\t'])
    expect(flat.text).toBe('')
    expect(flat.map).toEqual([])
  })
})

describe('locateInFlat', () => {
  it('命中时返回拍平串里的起止下标', () => {
    const flat = flatten(['他说：「好的。」'])
    expect(locateInFlat(flat.text, '：「好的。」')).toEqual({ start: 2, end: 8 })
  })

  it('正文里的换行与缩进不影响匹配', () => {
    const flat = flatten(['他却笑了，\n    说：「好的。」\n'])
    expect(locateInFlat(flat.text, '他却笑了，说：「好的。」')).toEqual({ start: 0, end: 12 })
  })

  it('摘录尾部与正文有出入时用短探针仍能命中同一段', () => {
    const flat = flatten(['他却在那一刻笑了很久'])
    const hit = locateInFlat(flat.text, '他却在那一刻笑了很久很久，直到天亮')
    expect(hit).not.toBeNull()
    // 只断言「落在同一段上」：探针长度是内部策略，不该被测试钉死
    expect(flat.text.slice(hit!.start, hit!.end)).toBe('他却在那一刻笑了')
  })

  it('完全找不到时返回 null，不做模糊猜测', () => {
    const flat = flatten(['这本书里没有这句话'])
    expect(locateInFlat(flat.text, '完全不同的一段文字内容')).toBeNull()
  })

  it('空摘录返回 null', () => {
    const flat = flatten(['有正文'])
    expect(locateInFlat(flat.text, '   \n ')).toBeNull()
  })

  it('正文为空返回 null', () => {
    expect(locateInFlat('', '任意一段')).toBeNull()
  })
})