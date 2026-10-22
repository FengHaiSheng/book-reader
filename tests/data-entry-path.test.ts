import { describe, expect, it } from 'vitest'
import { isSafeEntry } from '../electron/main/data/entry-path'

describe('isSafeEntry', () => {
  it('接受导出包里真实存在的路径', () => {
    expect(isSafeEntry('db.sqlite')).toBe(true)
    expect(isSafeEntry('README.txt')).toBe(true)
    expect(isSafeEntry('library/abc123/book.epub')).toBe(true)
    expect(isSafeEntry('library/abc123/')).toBe(true)
  })

  it('拒绝目录穿越与绝对路径', () => {
    expect(isSafeEntry('../evil')).toBe(false)
    expect(isSafeEntry('library/../../evil')).toBe(false)
    expect(isSafeEntry('/etc/passwd')).toBe(false)
    expect(isSafeEntry('library\\..\\evil')).toBe(false)
    expect(isSafeEntry('')).toBe(false)
    expect(isSafeEntry('/')).toBe(false)
  })

  it('拒绝空段与单点段', () => {
    expect(isSafeEntry('library//book.epub')).toBe(false)
    expect(isSafeEntry('./db.sqlite')).toBe(false)
  })
})
