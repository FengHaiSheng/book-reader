import { describe, expect, it } from 'vitest'
import { migrate, type Migration, type MigrationDb } from '../electron/main/store/migrate'
import { migrations } from '../electron/main/store/migrations'

/** 记录调用的假数据库，替代真实 better-sqlite3（原生模块在 vitest 里加载不了） */
function fakeDb(initialVersion = 0, chunkRows: { id: number; text: string }[] = []) {
  const applied: string[] = []
  const ftsRows: unknown[][] = []
  let version = initialVersion
  const db: MigrationDb = {
    pragma(source, options) {
      const set = /^user_version\s*=\s*(\d+)$/.exec(source)
      if (set) {
        version = Number(set[1])
        applied.push(`pragma:${version}`)
        return undefined
      }
      return options?.simple ? version : [{ user_version: version }]
    },
    exec(sql) {
      applied.push(`exec:${sql}`)
      return undefined
    },
    // 真实 better-sqlite3 的 transaction 返回一个可直接调用的函数，假实现保持同样形状
    transaction: ((fn: () => void) => fn) as MigrationDb['transaction'],
    prepare(sql) {
      return {
        all: () => (sql.includes('FROM chunks') ? chunkRows : []),
        run: (...params: unknown[]) => {
          if (sql.includes('INSERT INTO chunks_fts')) ftsRows.push(params)
          return undefined
        }
      }
    }
  }
  return { db, applied, ftsRows, version: () => version }
}

describe('migrate', () => {
  it('从 0 升到最新版本并按序执行', () => {
    const { db, applied, version } = fakeDb(0)
    expect(
      migrate(db, [
        { version: 1, up: (d) => d.exec('settings') },
        { version: 2, up: (d) => d.exec('books') }
      ])
    ).toBe(2)
    expect(version()).toBe(2)
    expect(applied).toEqual(['exec:settings', 'pragma:1', 'exec:books', 'pragma:2'])
  })

  it('已是最新版时不重复执行', () => {
    const { db, applied } = fakeDb(2)
    expect(
      migrate(db, [
        { version: 1, up: (d) => d.exec('settings') },
        { version: 2, up: (d) => d.exec('books') }
      ])
    ).toBe(2)
    expect(applied).toEqual([])
  })

  it('从中间版本升级时只执行更高的迁移', () => {
    const { db, applied } = fakeDb(1)
    migrate(db, [
      { version: 1, up: (d) => d.exec('one') },
      { version: 2, up: (d) => d.exec('two') },
      { version: 3, up: (d) => d.exec('three') }
    ])
    expect(applied).toEqual(['exec:two', 'pragma:2', 'exec:three', 'pragma:3'])
  })

  it('清单乱序传入也能按 version 升序执行', () => {
    const { db, applied } = fakeDb(0)
    migrate(db, [
      { version: 2, up: (d) => d.exec('two') },
      { version: 1, up: (d) => d.exec('one') }
    ])
    expect(applied).toEqual(['exec:one', 'pragma:1', 'exec:two', 'pragma:2'])
  })

  it('v4 从 chunks.text 就地重切索引，补出单字列，不需要重新导入', () => {
    const { db, applied, ftsRows } = fakeDb(3, [{ id: 7, text: '河面上浮着一层薄薄的雾' }])
    expect(migrate(db, migrations)).toBe(5)
    expect(applied).toContain('exec:DROP TABLE IF EXISTS chunks_fts')
    expect(applied).toContain(
      "exec:CREATE VIRTUAL TABLE chunks_fts USING fts5(text_bigram, text_single, tokenize = 'unicode61')"
    )
    expect(ftsRows).toEqual([
      [
        7,
        '河面 面上 上浮 浮着 着一 一层 层薄 薄薄 薄的 的雾',
        '河 面 上 浮 着 一 层 薄 薄 的 雾'
      ]
    ])
  })

  it('库里没有 chunk 时 v4 只是把表换成两列，不灌任何行', () => {
    const { db, ftsRows } = fakeDb(3, [])
    expect(migrate(db, migrations)).toBe(5)
    expect(ftsRows).toEqual([])
  })

  it('从 v4 升到 v5 只跑 v5，建书签与阅读时长两张表', () => {
    const { db, applied, version } = fakeDb(4)
    expect(migrate(db, migrations)).toBe(5)
    const ddl = applied.filter((a) => a.startsWith('exec:')).join('\n')
    expect(applied).not.toContain('exec:DROP TABLE IF EXISTS chunks_fts')
    expect(ddl).toContain('CREATE TABLE bookmarks')
    expect(ddl).toContain('CREATE UNIQUE INDEX idx_bookmarks_place')
    expect(ddl).toContain('CREATE TABLE reading_time')
    expect(version()).toBe(5)
  })

  it('已是 v5 时不重复执行任何迁移', () => {
    const { db, applied } = fakeDb(5)
    expect(migrate(db, migrations)).toBe(5)
    expect(applied).toEqual([])
  })
})
