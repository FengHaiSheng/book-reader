import { describe, expect, it } from 'vitest'
import { isSearchableQuery, snippetOf } from '../src/features/reader/search'

describe('isSearchableQuery', () => {
  it('汉字、字母、数字、下划线都算能查', () => {
    expect(isSearchableQuery('月亮')).toBe(true)
    expect(isSearchableQuery('你好世界')).toBe(true)
    expect(isSearchableQuery('hello')).toBe(true)
    expect(isSearchableQuery('第2章')).toBe(true)
    expect(isSearchableQuery('a_b')).toBe(true)
  })

  it('单个汉字也能查 —— 索引里除了二字滑窗，还有每个汉字一枚的单字列', () => {
    expect(isSearchableQuery('雾')).toBe(true)
    expect(isSearchableQuery('一')).toBe(true)
  })

  it('只有标点与空白时查不出来（切不出 token，MATCH 必然是空）', () => {
    expect(isSearchableQuery('……')).toBe(false)
    expect(isSearchableQuery('——！？')).toBe(false)
    expect(isSearchableQuery('   ')).toBe(false)
    expect(isSearchableQuery('')).toBe(false)
  })
})

describe('snippetOf', () => {
  const long = `${'a'.repeat(10)}月亮升起来了${'b'.repeat(10)}`

  it('命中在中间：前后各留一段，掐掉的一头补省略号', () => {
    expect(snippetOf(long, '月亮', 3)).toEqual({
      before: '…aaa',
      hit: '月亮',
      after: '升起来…'
    })
  })

  it('命中在开头：前面不补省略号', () => {
    expect(snippetOf('月亮升起来', '月亮', 3)).toEqual({
      before: '',
      hit: '月亮',
      after: '升起来'
    })
  })

  it('命中在结尾：后面不补省略号', () => {
    expect(snippetOf('升起月亮', '月亮', 3)).toEqual({
      before: '升起',
      hit: '月亮',
      after: ''
    })
  })

  it('命中词按屏幕上的原文返回，大小写不按查询词改', () => {
    expect(snippetOf('Hello World', 'hello', 3).hit).toBe('Hello')
  })

  it('换行与连续空白折成一个空格，摘要是单行可读的', () => {
    expect(snippetOf('a\n\n 月亮b', '月亮', 3)).toEqual({
      before: 'a ',
      hit: '月亮',
      after: 'b'
    })
  })

  it('这段里找不到关键词时只摆开头，hit 为空串', () => {
    const snippet = snippetOf('abcdefghij', 'zzz', 3)
    expect(snippet.hit).toBe('')
    expect(snippet.before).toBe('abcdef…')
    expect(snippet.after).toBe('')
  })

  it('关键词为空时不做匹配，也不报错', () => {
    expect(snippetOf('abcdefghij', '  ', 3).hit).toBe('')
  })
})
