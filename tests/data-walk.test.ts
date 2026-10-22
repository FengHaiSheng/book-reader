import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { dirBytes, listDirs, listFiles } from '../electron/main/data/walk'

function makeTree(): string {
  const root = mkdtempSync(join(tmpdir(), 'book-read-walk-'))
  mkdirSync(join(root, 'library', 'book-a'), { recursive: true })
  mkdirSync(join(root, 'library', 'book-b'), { recursive: true })
  writeFileSync(join(root, 'library', 'book-a', 'book.epub'), 'x'.repeat(100))
  writeFileSync(join(root, 'library', 'book-b', 'cover.jpg'), 'y'.repeat(30))
  writeFileSync(join(root, 'db.sqlite'), 'z'.repeat(10))
  return root
}

describe('dirBytes', () => {
  it('递归累加', () => {
    const root = makeTree()
    expect(dirBytes(join(root, 'library'))).toBe(130)
    expect(dirBytes(root)).toBe(140)
  })

  it('目录不存在按 0 算，不抛错', () => {
    expect(dirBytes('/definitely/not/here')).toBe(0)
  })
})

describe('listFiles', () => {
  it('只列文件、不递归、按名字排序', () => {
    const root = makeTree()
    expect(listFiles(join(root, 'library', 'book-a')).map((f) => f.name)).toEqual(['book.epub'])
    expect(listFiles(join(root, 'library')).map((f) => f.name)).toEqual([])
  })
})

describe('listDirs', () => {
  it('只列子目录', () => {
    const root = makeTree()
    expect(listDirs(join(root, 'library'))).toEqual(['book-a', 'book-b'])
    expect(listDirs(join(root, 'nope'))).toEqual([])
  })
})
