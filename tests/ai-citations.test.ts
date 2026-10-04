import { describe, expect, it } from 'vitest'
import { excerptOf, extractMarkers, usedCitations } from '../electron/main/ai/citations'

describe('extractMarkers', () => {
  it('取出所有 [n] 标记，去重并升序', () => {
    expect(extractMarkers('这句话很重要[2]，那句也是[1]，还有[2]。')).toEqual([1, 2])
  })

  it('忽略不是数字的方括号', () => {
    expect(extractMarkers('见 [附录] 与 [注]')).toEqual([])
  })
})

describe('usedCitations', () => {
  const all = [
    { index: 1, chunkId: 11, chapterId: 3, chapterTitle: '第一章', headingPath: '书 > 第一章', excerpt: 'aaa' },
    { index: 2, chunkId: 12, chapterId: 4, chapterTitle: '第二章', headingPath: '书 > 第二章', excerpt: 'bbb' },
    { index: 3, chunkId: 13, chapterId: 4, chapterTitle: '第二章', headingPath: '书 > 第二章', excerpt: 'ccc' }
  ]

  it('只留回答里真的引用到的那些', () => {
    expect(usedCitations('看这里[2]', all).map((c) => c.index)).toEqual([2])
  })

  it('模型引用了不存在的编号时整条丢掉，不生成跳不通的上标', () => {
    expect(usedCitations('看这里[9]', all)).toEqual([])
  })

  it('抽不到引用时返回空数组 —— 界面据此不显示引用区', () => {
    expect(usedCitations('没有任何标注', all)).toEqual([])
  })
})

describe('excerptOf', () => {
  it('去空白后取前 30 字', () => {
    const text = '  这是 一段\n带空白  的原文，长度超过三十个字符，用来验证截取行为是否正确。'
    expect(excerptOf(text)).toBe('这是一段带空白的原文，长度超过三十个字符，用来验证截取行为是')
  })
})