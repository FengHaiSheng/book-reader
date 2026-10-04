import { describe, expect, it } from 'vitest'
import { estimateTokens, fitPassages, windowFromText } from '../electron/main/ai/retrieve'

describe('estimateTokens', () => {
  it('中文按 1 字 ≈ 1 token，拉丁按 4 字符 ≈ 1 token', () => {
    expect(estimateTokens('月亮')).toBe(2)
    expect(estimateTokens('abcdefgh')).toBe(2)
  })

  it('空串为 0', () => {
    expect(estimateTokens('')).toBe(0)
  })
})

describe('windowFromText', () => {
  const text = Array.from({ length: 20 }, (_, i) => `第${i}段内容。`).join('\n')

  it('以 needle 所在段为中心，前后各取 radius 段', () => {
    const window = windowFromText(text, '第10段内容。', 2)
    expect(window).toContain('第8段内容。')
    expect(window).toContain('第10段内容。')
    expect(window).toContain('第12段内容。')
    expect(window).not.toContain('第13段内容。')
  })

  it('needle 找不到时退回开头若干段，而不是空手而归', () => {
    const window = windowFromText(text, '不存在的话', 2)
    expect(window).toContain('第0段内容。')
  })
})

describe('fitPassages', () => {
  const passages = Array.from({ length: 6 }, (_, i) => ({
    index: i + 1,
    headingPath: `书 > 第${i}章`,
    text: 'x'.repeat(100)
  }))

  it('预算够就全留', () => {
    const result = fitPassages(passages, 10_000)
    expect(result.kept).toHaveLength(6)
    expect(result.dropped).toBe(0)
  })

  it('预算不够时从尾部丢，保留前面的高相关段', () => {
    const result = fitPassages(passages, 250)
    expect(result.kept.length).toBeLessThan(6)
    expect(result.kept[0]!.index).toBe(1)
    expect(result.dropped).toBe(6 - result.kept.length)
  })
})