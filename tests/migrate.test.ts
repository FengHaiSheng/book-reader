import { describe, expect, it } from 'vitest'
import { migrate, type MigrationDb } from '../electron/main/store/migrate'
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
    expect(migrate(db, migrations)).toBe(9)
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
    expect(migrate(db, migrations)).toBe(9)
    expect(ftsRows).toEqual([])
  })

  it('从 v4 升到最新会建书签与阅读时长两张表', () => {
    const { db, applied, version } = fakeDb(4)
    expect(migrate(db, migrations)).toBe(9)
    const ddl = applied.filter((a) => a.startsWith('exec:')).join('\n')
    expect(applied).not.toContain('exec:DROP TABLE IF EXISTS chunks_fts')
    expect(ddl).toContain('CREATE TABLE bookmarks')
    expect(ddl).toContain('CREATE UNIQUE INDEX idx_bookmarks_place')
    expect(ddl).toContain('CREATE TABLE reading_time')
    expect(version()).toBe(9)
  })

  it('从 v5 升到最新会给 books 加 kind，并建 highlight_ai_notes', () => {
    const { db, applied, version } = fakeDb(5)
    expect(migrate(db, migrations)).toBe(9)
    expect(applied).toContain(
      "exec:ALTER TABLE books ADD COLUMN kind TEXT NOT NULL DEFAULT 'text';"
    )
    expect(applied).toContain('pragma:6')
    const ddl = applied.filter((a) => a.startsWith('exec:')).join('\n')
    expect(ddl).toContain('CREATE TABLE highlight_ai_notes')
    expect(version()).toBe(9)
  })

  it('从 v6 升级会建 highlight_ai_notes，且不改动 books.kind', () => {
    const { db, applied, version } = fakeDb(6)
    expect(migrate(db, migrations)).toBe(9)
    const ddl = applied.filter((a) => a.startsWith('exec:')).join('\n')
    expect(ddl).toContain('CREATE TABLE highlight_ai_notes')
    expect(ddl).toContain('idx_highlight_ai_notes_highlight')
    expect(ddl).not.toContain('ALTER TABLE books ADD COLUMN kind')
    expect(version()).toBe(9)
  })

  it('从 v7 升到最新会建学习脉络表并加上置顶列', () => {
    const { db, applied, version } = fakeDb(7)
    expect(migrate(db, migrations)).toBe(9)
    const ddl = applied
      .filter((entry) => entry.startsWith('exec:'))
      .map((entry) => entry.slice('exec:'.length))
      .join('\n')
    expect(ddl).toContain('CREATE TABLE tracks')
    expect(ddl).toContain('CREATE TABLE track_nodes')
    expect(ddl).toContain('CREATE TABLE track_node_books')
    expect(ddl).toContain('CREATE TABLE track_ai_results')
    expect(ddl).toContain('CREATE INDEX idx_track_nodes_track ON track_nodes(track_id, sort_order)')
    expect(ddl).toContain('CREATE INDEX idx_track_node_books_book ON track_node_books(book_id)')
    expect(ddl).toContain('REFERENCES tracks(id) ON DELETE CASCADE')
    expect(ddl).toContain('REFERENCES books(id) ON DELETE CASCADE')
    expect(ddl).toContain('PRIMARY KEY (node_id, book_id)')
    expect(ddl).toContain('UNIQUE (track_id, task, scope_key, prompt_version, model)')
    expect(ddl).not.toContain('highlight_ai_notes')
    expect(ddl).not.toContain('ALTER TABLE books ADD COLUMN kind')
    expect(ddl).toContain('ALTER TABLE books ADD COLUMN pinned_at INTEGER')
    expect(applied.filter((entry) => entry.startsWith('exec:'))).toHaveLength(2)
    expect(applied.filter((entry) => entry.startsWith('pragma:'))).toEqual(['pragma:8', 'pragma:9'])
    expect(version()).toBe(9)
  })

  it('从 v8 升到 v9 给 books 加 pinned_at 与部分索引', () => {
    const { db, applied, version } = fakeDb(8)
    expect(migrate(db, migrations)).toBe(9)
    const ddl = applied
      .filter((entry) => entry.startsWith('exec:'))
      .map((entry) => entry.slice('exec:'.length))
      .join('\n')
    expect(ddl).toContain('ALTER TABLE books ADD COLUMN pinned_at INTEGER')
    expect(ddl).toContain('CREATE INDEX idx_books_pinned')
    expect(ddl).toContain('WHERE pinned_at IS NOT NULL')
    expect(version()).toBe(9)
  })

  it('已是 v9 时不重复执行任何迁移', () => {
    const { db, applied } = fakeDb(9)
    expect(migrate(db, migrations)).toBe(9)
    expect(applied).toEqual([])
  })
})
