import { describe, expect, it } from 'vitest'
import { decodeTxt, splitTxtChapters } from '../electron/main/txt/parse'

describe('decodeTxt', () => {
  it('去掉 UTF-8 BOM', () => {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('第一章', 'utf-8')])
    expect(decodeTxt(bytes)).toBe('第一章')
  })

  it('UTF-8 解不出来时按 GB18030 解', () => {
    // GBK 的「中文」：D6 D0 CE C4，在 UTF-8 里是非法字节序列
    const bytes = Buffer.from([0xd6, 0xd0, 0xce, 0xc4])
    expect(decodeTxt(bytes)).toBe('中文')
  })
})

describe('splitTxtChapters', () => {
  it('按章节标题切分，标题前的内容算前言', () => {
    const chapters = splitTxtChapters(
      ['书名页', '作者的话', '第一章 起点', '他说。', '第二章 归途', '她走了。'].join('\n')
    )

    expect(chapters.map((chapter) => chapter.title)).toEqual(['前言', '第一章 起点', '第二章 归途'])
    expect(chapters[1]?.text).toBe('他说。')
  })

  it('没有任何标题行时整本算正文', () => {
    const chapters = splitTxtChapters('第一段。\n第二段。')
    expect(chapters).toHaveLength(1)
    expect(chapters[0]?.title).toBe('正文')
    expect(chapters[0]?.text).toBe('第一段。\n第二段。')
  })

  it('超长章节按段落边界再切，标题带序号', () => {
    const paragraph = '这是一段很长的正文。'.repeat(200) // 2000 字
    const body = Array.from({ length: 12 }, () => paragraph).join('\n')
    const chapters = splitTxtChapters(`第一章 长夜\n${body}`)

    expect(chapters.length).toBeGreaterThan(1)
    expect(chapters[0]?.title).toBe('第一章 长夜（1）')
    expect(chapters[1]?.title).toBe('第一章 长夜（2）')
    expect(chapters.every((chapter) => chapter.text.length <= 20000)).toBe(true)
  })
})
