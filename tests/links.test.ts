import { describe, expect, it } from 'vitest'
import { classifyLink } from '../src/features/reader/links'

const BOOK = '11111111-2222-3333-4444-555555555555'
const BASE = `epub://${BOOK}/OEBPS/text/`

describe('classifyLink', () => {
  it('同文档锚点', () => {
    expect(classifyLink('#note1', BASE, BOOK)).toEqual({ kind: 'anchor', fragment: 'note1' })
  })

  it('同章文件带锚点', () => {
    expect(classifyLink('ch1.xhtml#note1', BASE, BOOK)).toEqual({
      kind: 'chapter',
      entry: 'OEBPS/text/ch1.xhtml',
      fragment: 'note1'
    })
  })

  it('相对路径里的 .. 按 URL 语义化解', () => {
    expect(classifyLink('../images/cover.jpg', BASE, BOOK)).toEqual({
      kind: 'chapter',
      entry: 'OEBPS/images/cover.jpg',
      fragment: ''
    })
    // 走出书目录的路径照样会被解析出来，但它匹配不上任何一章，等于被忽略
    expect(classifyLink('../../secrets.json', BASE, BOOK)).toEqual({
      kind: 'chapter',
      entry: 'secrets.json',
      fragment: ''
    })
  })

  it('百分号转义会解码', () => {
    expect(classifyLink('%E7%AC%AC%E4%B8%80%E7%AB%A0.xhtml', BASE, BOOK)).toEqual({
      kind: 'chapter',
      entry: 'OEBPS/text/第一章.xhtml',
      fragment: ''
    })
  })

  it('外链交给系统浏览器', () => {
    expect(classifyLink('https://example.com/a?b=1', BASE, BOOK)).toEqual({
      kind: 'external',
      url: 'https://example.com/a?b=1'
    })
  })

  it('别的书、别的协议、空链接一律忽略', () => {
    expect(
      classifyLink(`epub://22222222-2222-3333-4444-555555555555/OEBPS/ch1.xhtml`, BASE, BOOK)
    ).toEqual({ kind: 'ignore' })
    expect(classifyLink('file:///etc/passwd', BASE, BOOK)).toEqual({ kind: 'ignore' })
    expect(classifyLink('javascript:alert(1)', BASE, BOOK)).toEqual({ kind: 'ignore' })
    expect(classifyLink('   ', BASE, BOOK)).toEqual({ kind: 'ignore' })
  })
})
