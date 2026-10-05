import { describe, expect, it } from 'vitest'
import {
  hasExtension,
  isBookId,
  mimeFor,
  normalizeEntry,
  parseEpubUrl,
  sniffDocumentMime,
  sniffImageMime
} from '../electron/main/epub/epub-url'

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

describe('hasExtension', () => {
  it('看文件名而不是目录名', () => {
    expect(hasExtension('OEBPS.v2/ch1.xhtml')).toBe(true)
    expect(hasExtension('OEBPS.v2/ch1')).toBe(false)
    expect(hasExtension('mimetype')).toBe(false)
  })
})

describe('sniffDocumentMime', () => {
  const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)

  it('无扩展名的正文文档按 XHTML 放行', () => {
    expect(sniffDocumentMime(bytes('<?xml version="1.0" encoding="utf-8"?><html/>'))).toBe(
      'application/xhtml+xml'
    )
    expect(sniffDocumentMime(bytes('<!DOCTYPE html>\n<html><body>hi</body></html>'))).toBe(
      'application/xhtml+xml'
    )
    expect(sniffDocumentMime(bytes('\uFEFF  <html xmlns="http://www.w3.org/1999/xhtml">'))).toBe(
      'application/xhtml+xml'
    )
  })

  it('不是文档就返回 null —— 同样没有扩展名的 mimetype 靠这条挡住', () => {
    expect(sniffDocumentMime(bytes('application/epub+zip'))).toBeNull()
    expect(sniffDocumentMime(bytes(''))).toBeNull()
  })
})

describe('sniffImageMime', () => {
  const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values)

  it('按文件头认图片，扩展名靠不住时也能认出来', () => {
    // cover.jfif 的真实内容就是 JPEG：FF D8 FF …
    expect(sniffImageMime(bytes(0xff, 0xd8, 0xff, 0xe2, 0x0c))).toBe('image/jpeg')
    expect(sniffImageMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d))).toBe('image/png')
    expect(sniffImageMime(bytes(0x47, 0x49, 0x46, 0x38, 0x39))).toBe('image/gif')
    expect(sniffImageMime(bytes(0x42, 0x4d, 0x36))).toBe('image/bmp')
    expect(
      sniffImageMime(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50))
    ).toBe('image/webp')
  })

  it('不是图片就返回 null —— 冒充 cover.js 的文件靠这条挡在协议外', () => {
    expect(sniffImageMime(bytes())).toBeNull()
    expect(sniffImageMime(new TextEncoder().encode('alert(1)'))).toBeNull()
  })
})

describe('isBookId', () => {
  it('只认导入时生成的 uuid', () => {
    expect(isBookId(ID)).toBe(true)
    expect(isBookId(ID.toUpperCase())).toBe(false)
    expect(isBookId('7c1f0e4a9b2d4f6e8a315d0c2b7e9f10')).toBe(false)
  })
})
