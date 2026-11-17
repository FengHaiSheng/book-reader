import { describe, expect, it } from 'vitest'
import {
  MAX_SPEECH_CHARS,
  flattenForSpeech,
  splitSentences
} from '../src/features/reader/speech-text'

describe('splitSentences', () => {
  it('中文按句末标点断句，收尾引号跟着上一句', () => {
    const spans = splitSentences('他说：“走吧。”她点头。')
    expect(spans.map((span) => span.text)).toEqual(['他说：“走吧。”', '她点头。'])
  })

  it('连续标点不拆开', () => {
    const spans = splitSentences('真的？！好。')
    expect(spans.map((span) => span.text)).toEqual(['真的？！', '好。'])
  })

  it('英文句号只在空格或结尾处断句，小数点不断', () => {
    const spans = splitSentences('3.14 is pi. Done.')
    expect(spans.map((span) => span.text)).toEqual(['3.14 is pi.', 'Done.'])
  })

  it('超长句优先在逗号处断开，且每条不超过上限', () => {
    const text = `${'甲'.repeat(100)}，${'乙'.repeat(100)}。`
    const spans = splitSentences(text)
    expect(spans).toHaveLength(2)
    expect(spans[0]?.text.endsWith('，')).toBe(true)
    for (const span of spans) expect(span.text.length).toBeLessThanOrEqual(MAX_SPEECH_CHARS)
  })

  it('没有断点的超长句也会硬切，不会一直憋到句末', () => {
    const spans = splitSentences('字'.repeat(MAX_SPEECH_CHARS * 2 + 10))
    expect(spans.length).toBeGreaterThan(1)
    for (const span of spans) expect(span.text.length).toBeLessThanOrEqual(MAX_SPEECH_CHARS)
  })

  it('偏移能直接切回原文', () => {
    const text = '第一句。第二句！第三句？'
    for (const span of splitSentences(text)) {
      expect(text.slice(span.start, span.end)).toBe(span.text)
    }
  })

  it('纯空白不成句', () => {
    expect(splitSentences('   ')).toEqual([])
  })
})

describe('flattenForSpeech', () => {
  it('把空白折成一个空格，英文单词不会粘在一起', () => {
    const flat = flattenForSpeech(['Hello ', 'world'])
    expect(flat.text).toBe('Hello world')
  })

  it('不同段落之间补空格，段内不补', () => {
    expect(flattenForSpeech(['段落一', '段落二'], [false, true]).text).toBe('段落一 段落二')
    expect(flattenForSpeech(['前半', '后半'], [false, false]).text).toBe('前半后半')
  })

  it('map 的每个字都能指回原节点与下标', () => {
    const flat = flattenForSpeech(['ab', 'cd'], [false, true])
    expect(flat.text).toBe('ab cd')
    expect(flat.text).toHaveLength(flat.map.length)
    expect(flat.map[0]).toEqual({ nodeIndex: 0, offset: 0 })
    expect(flat.map[2]).toEqual({ nodeIndex: 1, offset: 0 })
    expect(flat.map[3]).toEqual({ nodeIndex: 1, offset: 0 })
    expect(flat.map[4]).toEqual({ nodeIndex: 1, offset: 1 })
  })

  it('开头与结尾的空白不会变成空行', () => {
    expect(flattenForSpeech(['  ', ' 你好 ', ' ']).text).toBe('你好')
  })
})
