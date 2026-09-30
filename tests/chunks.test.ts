import { describe, expect, it } from 'vitest'
import { buildChunks, estimateTokens, splitParagraphs } from '../electron/main/epub/chunks'

describe('estimateTokens', () => {
  it('中文按字计，英文按词计', () => {
    expect(estimateTokens('中文四个字')).toBe(5)
    expect(estimateTokens('hello world')).toBe(2)
  })

  it('混合文本两个都算上', () => {
    expect(estimateTokens('中文 hello')).toBe(3)
  })
})

describe('splitParagraphs', () => {
  it('按行切段并丢掉空行', () => {
    expect(splitParagraphs('甲\n\n乙\n  \n丙')).toEqual(['甲', '乙', '丙'])
  })

  it('超长单段被硬切成不超过上限的片段', () => {
    const long = '甲'.repeat(1500)
    const parts = splitParagraphs(long, 600)
    expect(parts.length).toBeGreaterThan(1)
    for (const part of parts) expect(estimateTokens(part)).toBeLessThanOrEqual(600)
  })
})

describe('buildChunks', () => {
  const paragraph = (n: number) => '甲'.repeat(n)

  it('空文本产出零个 chunk', () => {
    expect(buildChunks('')).toEqual([])
  })

  it('短文本只产出一个 chunk', () => {
    const chunks = buildChunks('甲\n乙\n丙')
    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.text).toBe('甲\n乙\n丙')
    expect(chunks[0]?.orderIndex).toBe(0)
  })

  it('累加到超过上限就切开，且每块不超过上限', () => {
    const text = Array.from({ length: 10 }, () => paragraph(200)).join('\n')
    const chunks = buildChunks(text)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) expect(chunk.tokenCount).toBeLessThanOrEqual(600)
  })

  it('相邻块之间重叠一段', () => {
    const text = Array.from({ length: 10 }, () => paragraph(200)).join('\n')
    const chunks = buildChunks(text)
    const firstLastLine = chunks[0]!.text.split('\n').at(-1)
    expect(chunks[1]!.text.split('\n')[0]).toBe(firstLastLine)
  })

  it('orderIndex 连续递增', () => {
    const text = Array.from({ length: 10 }, () => paragraph(200)).join('\n')
    const chunks = buildChunks(text)
    expect(chunks.map((chunk) => chunk.orderIndex)).toEqual(chunks.map((_, index) => index))
  })

  it('极端输入不会死循环', () => {
    const text = Array.from({ length: 40 }, () => paragraph(1)).join('\n')
    expect(buildChunks(text).length).toBeGreaterThan(0)
  })

  it('重叠段放不下时不带重叠，块不会超过上限', () => {
    const text = Array.from({ length: 4 }, () => paragraph(350)).join('\n')
    const chunks = buildChunks(text)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) expect(chunk.tokenCount).toBeLessThanOrEqual(600)
  })
})
