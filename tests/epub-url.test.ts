import { describe, expect, it } from 'vitest'
import { isBookId, mimeFor, normalizeEntry, parseEpubUrl } from '../electron/main/epub/epub-url'

const ID = '7c1f0e4a-9b2d-4f6e-8a31-5d0c2b7e9f10'

describe('parseEpubUrl', () => {
  it('解析出 bookId 与 entry', () => {
    expect(parseEpubUrl(`epub://${ID}/OEBPS/text/ch1.xhtml`)).toEqual({
      bookId: ID,
      entry: 'OEBPS/text/ch1.xhtml'
    })
  })

  it('百分号转义会被解码', () => {
    expect(parseEpubUrl(`epub://${ID}/OEBPS/%E7%AC%AC1%E7%AB%A0.xhtml`)?.entry).toBe(
      'OEBPS/第1章.xhtml'
    )
  })

  it('bookId 不是 uuid 就拒绝', () => {
    expect(parseEpubUrl(`epub://not-a-uuid/OEBPS/ch1.xhtml`)).toBeNull()
    expect(parseEpubUrl('epub:///OEBPS/ch1.xhtml')).toBeNull()
  })

  it('不是 epub 协议就拒绝', () => {
    expect(parseEpubUrl(`https://${ID}/OEBPS/ch1.xhtml`)).toBeNull()
    expect(parseEpubUrl('not a url')).toBeNull()
  })

  it('空路径与坏转义都拒绝', () => {
    expect(parseEpubUrl(`epub://${ID}/`)).toBeNull()
    expect(parseEpubUrl(`epub://${ID}/OEBPS/%zz.xhtml`)).toBeNull()
  })
})

describe('normalizeEntry', () => {
  it('吃掉多余的 / 与 .', () => {
    expect(normalizeEntry('OEBPS/./text//ch1.xhtml')).toBe('OEBPS/text/ch1.xhtml')
  })

  it('拒绝穿越、绝对路径、反斜杠与 NUL', () => {
    expect(normalizeEntry('OEBPS/../../etc/passwd')).toBeNull()
    expect(normalizeEntry('/etc/passwd')).toBeNull()
    expect(normalizeEntry('OEBPS\\ch1.xhtml')).toBeNull()
    expect(normalizeEntry('OEBPS/ch1\0.xhtml')).toBeNull()
    expect(normalizeEntry('')).toBeNull()
    expect(normalizeEntry('./')).toBeNull()
  })
})

describe('mimeFor', () => {
  it('认识阅读需要的类型', () => {
    expect(mimeFor('OEBPS/ch1.xhtml')).toBe('application/xhtml+xml')
    expect(mimeFor('OEBPS/style.css')).toBe('text/css')
    expect(mimeFor('OEBPS/img/FIG1.PNG')).toBe('image/png')
    expect(mimeFor('OEBPS/fonts/x.woff2')).toBe('font/woff2')
  })

  it('认不出的一律返回 null —— 书内 js 就是靠这条挡住的', () => {
    expect(mimeFor('OEBPS/evil.js')).toBeNull()
    expect(mimeFor('OEBPS/content.opf')).toBeNull()
    expect(mimeFor('OEBPS/toc.ncx')).toBeNull()
    expect(mimeFor('OEBPS/noext')).toBeNull()
  })
})

describe('isBookId', () => {
  it('只认导入时生成的 uuid', () => {
    expect(isBookId(ID)).toBe(true)
    expect(isBookId(ID.toUpperCase())).toBe(false)
    expect(isBookId('7c1f0e4a9b2d4f6e8a315d0c2b7e9f10')).toBe(false)
  })
})
