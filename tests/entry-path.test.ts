import { describe, expect, it } from 'vitest'
import { dirOf, resolveEntry } from '../electron/main/epub/entry-path'

describe('resolveEntry', () => {
  it('按 OPF 所在目录解析相对路径', () => {
    expect(resolveEntry('OEBPS', 'ch1.xhtml')).toBe('OEBPS/ch1.xhtml')
    expect(resolveEntry('OEBPS/text', '../images/cover.jpg')).toBe('OEBPS/images/cover.jpg')
  })

  it('丢到 #fragment 并做百分号解码', () => {
    expect(resolveEntry('OEBPS', 'ch1.xhtml#p3')).toBe('OEBPS/ch1.xhtml')
    expect(resolveEntry('OEBPS', 'a%20b.xhtml')).toBe('OEBPS/a b.xhtml')
  })

  it('OPF 在根目录时不给结果加前导斜杠', () => {
    expect(resolveEntry('', 'content.opf')).toBe('content.opf')
  })

  it('百分号解码失败时保留原字符串，不抛错', () => {
    expect(resolveEntry('', 'bad%zz.xhtml')).toBe('bad%zz.xhtml')
  })

  it('越出根目录的 .. 被吃掉，不产生前导 ..', () => {
    expect(resolveEntry('', '../../etc/passwd')).toBe('etc/passwd')
  })

  it('绝对 href 相对 zip 根解析，不再叠加 OPF 目录', () => {
    expect(resolveEntry('OEBPS', '/OEBPS/ch1.xhtml')).toBe('OEBPS/ch1.xhtml')
    expect(resolveEntry('OEBPS/text', '/images/cover.jpg')).toBe('images/cover.jpg')
  })
})

describe('dirOf', () => {
  it('返回所在目录，根目录下返回空串', () => {
    expect(dirOf('OEBPS/text/ch1.xhtml')).toBe('OEBPS/text')
    expect(dirOf('content.opf')).toBe('')
  })
})
