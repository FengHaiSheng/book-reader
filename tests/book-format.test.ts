import { describe, expect, it } from 'vitest'
import { BOOK_EXTENSIONS, bookFormatOf, isBookFile } from '../shared/types'

describe('bookFormatOf', () => {
  it('识别全部声明的扩展名', () => {
    expect(bookFormatOf('a.epub')).toBe('epub')
    expect(bookFormatOf('a.pdf')).toBe('pdf')
    expect(bookFormatOf('a.txt')).toBe('txt')
    expect(bookFormatOf('a.mobi')).toBe('mobi')
    expect(bookFormatOf('a.azw')).toBe('mobi')
    expect(bookFormatOf('a.azw3')).toBe('kf8')
    expect(bookFormatOf('a.fb2')).toBe('fb2')
    expect(bookFormatOf('a.htmlz')).toBe('htmlz')
    expect(bookFormatOf('a.cbz')).toBe('cbz')
    expect(bookFormatOf('a.cbr')).toBe('cbr')
  })

  it('扩展名大小写不敏感', () => {
    expect(bookFormatOf('/books/Book.EPUB')).toBe('epub')
    expect(bookFormatOf('/books/Book.AZW3')).toBe('kf8')
    expect(bookFormatOf('/books/Book.CBZ')).toBe('cbz')
  })

  it('不是书的文件返回 null', () => {
    expect(bookFormatOf('/tmp/notes.md')).toBeNull()
    expect(bookFormatOf('/tmp/archive.zip')).toBeNull()
    expect(bookFormatOf('/tmp/README')).toBeNull()
  })

  it('isBookFile 与 bookFormatOf 同一口径', () => {
    expect(isBookFile('x.epub')).toBe(true)
    expect(isBookFile('x.htmlz')).toBe(true)
    expect(isBookFile('x.cbz')).toBe(true)
    expect(isBookFile('x.doc')).toBe(false)
    expect(BOOK_EXTENSIONS).toContain('azw3')
    expect(BOOK_EXTENSIONS).toContain('cbr')
  })
})
