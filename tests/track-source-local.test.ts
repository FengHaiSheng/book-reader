import type Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import type { TrackNodeInput } from '../shared/track'
import {
  addBookLinks,
  getActiveTrack,
  listNodesWithBooks,
  rebuildActiveTree,
  replaceActiveTrack,
  type TrackLinkInput
} from '../electron/main/track/repo'

/**
 * 与 tests/track-repo.test.ts 同一套内存库：better-sqlite3 在当前 Node 里加载不了，
 * 按仓储实际 SQL 把挂载的主键冲突和读回跑通。
 */
function openDb(): Database.Database {
  type TrackRec = {
    id: string
    goal_text: string
    title: string
    status: string
    prompt_version: string
    created_at: number
    updated_at: number
  }
  type NodeRec = {
    id: string
    track_id: string
    parent_id: string | null
    title: string
    summary: string
    sort_order: number
    depth: number
    created_at: number
    updated_at: number
  }
  type LinkRec = {
    rowid: number
    track_id: string
    node_id: string
    book_id: string
    source: string
    created_at: number
  }
  type BookRec = { id: string; title: string; author: string | null }
  type State = { tracks: TrackRec[]; nodes: NodeRec[]; links: LinkRec[]; books: BookRec[]; linkRow: number }

  let state: State = { tracks: [], nodes: [], links: [], books: [], linkRow: 1 }
  const snapshot = (): State => structuredClone(state)
  const restore = (saved: State) => {
    state = saved
  }

  function fail(message: string, code: string): never {
    throw Object.assign(new Error(message), { code })
  }

  function num(value: unknown): number {
    return typeof value === 'number' ? value : Number(value)
  }

  function run(sql: string, params: unknown[]): { changes: number } {
    const text = sql.replace(/\s+/g, ' ').trim()

    if (text.startsWith("UPDATE tracks SET status = 'archived'")) {
      const now = num(params[0])
      let changes = 0
      for (const track of state.tracks) {
        if (track.status !== 'active') continue
        track.status = 'archived'
        track.updated_at = now
        changes += 1
      }
      return { changes }
    }

    if (text.startsWith('INSERT INTO tracks')) {
      const [id, goalText, title, promptVersion, createdAt, updatedAt] = params
      if (state.tracks.some((track) => track.id === id)) {
        fail('UNIQUE constraint failed: tracks.id', 'SQLITE_CONSTRAINT_PRIMARYKEY')
      }
      state.tracks.push({
        id: String(id),
        goal_text: String(goalText),
        title: String(title),
        status: 'active',
        prompt_version: String(promptVersion),
        created_at: num(createdAt),
        updated_at: num(updatedAt)
      })
      return { changes: 1 }
    }

    if (text.startsWith('INSERT INTO track_nodes')) {
      const [id, trackId, parentId, title, summary, sortOrder, depth, createdAt, updatedAt] = params
      if (!state.tracks.some((track) => track.id === trackId)) {
        fail('FOREIGN KEY constraint failed', 'SQLITE_CONSTRAINT_FOREIGNKEY')
      }
      if (state.nodes.some((node) => node.id === id)) {
        fail('UNIQUE constraint failed: track_nodes.id', 'SQLITE_CONSTRAINT_PRIMARYKEY')
      }
      state.nodes.push({
        id: String(id),
        track_id: String(trackId),
        parent_id: parentId == null || parentId === '' ? null : String(parentId),
        title: String(title),
        summary: String(summary),
        sort_order: num(sortOrder),
        depth: num(depth),
        created_at: num(createdAt),
        updated_at: num(updatedAt)
      })
      return { changes: 1 }
    }

    if (text.startsWith('INSERT INTO track_node_books') || text.startsWith('INSERT OR IGNORE INTO track_node_books')) {
      const ignore = text.startsWith('INSERT OR IGNORE')
      const [trackId, nodeId, bookId, source, createdAt] = params
      if (!state.books.some((book) => book.id === bookId)) {
        if (ignore) return { changes: 0 }
        fail('FOREIGN KEY constraint failed', 'SQLITE_CONSTRAINT_FOREIGNKEY')
      }
      if (state.links.some((link) => link.node_id === nodeId && link.book_id === bookId)) {
        if (ignore) return { changes: 0 }
        fail(
          'UNIQUE constraint failed: track_node_books.node_id, track_node_books.book_id',
          'SQLITE_CONSTRAINT_PRIMARYKEY'
        )
      }
      state.links.push({
        rowid: state.linkRow++,
        track_id: String(trackId),
        node_id: String(nodeId),
        book_id: String(bookId),
        source: String(source),
        created_at: num(createdAt)
      })
      return { changes: 1 }
    }

    if (text.startsWith('DELETE FROM track_node_books WHERE track_id = ?')) {
      const [trackId] = params
      const before = state.links.length
      state.links = state.links.filter((link) => link.track_id !== trackId)
      return { changes: before - state.links.length }
    }

    if (text.startsWith('DELETE FROM track_nodes WHERE track_id = ?')) {
      const [trackId] = params
      const before = state.nodes.length
      state.nodes = state.nodes.filter((node) => node.track_id !== trackId)
      return { changes: before - state.nodes.length }
    }

    if (text.startsWith('UPDATE tracks SET updated_at = ? WHERE id = ?')) {
      const [now, trackId] = params
      const track = state.tracks.find((item) => item.id === trackId)
      if (track) track.updated_at = num(now)
      return { changes: track ? 1 : 0 }
    }

    fail(`未实现的写入 SQL：${text}`, 'TEST_FAKE')
  }

  function rows(sql: string, params: unknown[]): unknown[] {
    const text = sql.replace(/\s+/g, ' ').trim()

    if (text.includes('FROM track_nodes') && text.includes('ORDER BY sort_order, id')) {
      const [trackId] = params
      return state.nodes
        .filter((node) => node.track_id === trackId)
        .sort((a, b) => a.sort_order - b.sort_order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map((node) => ({
          id: node.id,
          trackId: node.track_id,
          parentId: node.parent_id,
          title: node.title,
          summary: node.summary,
          sortOrder: node.sort_order,
          depth: node.depth,
          createdAt: node.created_at,
          updatedAt: node.updated_at
        }))
    }

    if (text.includes('JOIN books')) {
      const [trackId] = params
      return state.links
        .filter((link) => link.track_id === trackId)
        .sort((a, b) => a.created_at - b.created_at || a.rowid - b.rowid)
        .flatMap((link) => {
          const book = state.books.find((item) => item.id === link.book_id)
          if (!book) return []
          return [
            {
              nodeId: link.node_id,
              bookId: link.book_id,
              source: link.source,
              createdAt: link.created_at,
              title: book.title,
              author: book.author
            }
          ]
        })
    }

    if (text.includes('FROM track_node_books') && text.includes('node_id AS nodeId')) {
      const [trackId] = params
      return state.links
        .filter((link) => link.track_id === trackId)
        .sort((a, b) => a.created_at - b.created_at || a.rowid - b.rowid)
        .map((link) => ({
          nodeId: link.node_id,
          bookId: link.book_id,
          source: link.source,
          createdAt: link.created_at
        }))
    }

    if (text.includes('created_at AS createdAt FROM track_nodes')) {
      const [trackId] = params
      return state.nodes
        .filter((node) => node.track_id === trackId)
        .map((node) => ({ id: node.id, createdAt: node.created_at }))
    }

    fail(`未实现的查询 SQL：${text}`, 'TEST_FAKE')
  }

  function one(sql: string, params: unknown[]): unknown {
    const text = sql.replace(/\s+/g, ' ').trim()

    if (text.includes("WHERE status = 'active'") && text.includes('LIMIT 1')) {
      const active = state.tracks
        .filter((track) => track.status === 'active')
        .sort((a, b) => b.updated_at - a.updated_at || (a.id < b.id ? 1 : -1))
      const track = active[0]
      if (!track) return undefined
      return {
        id: track.id,
        goalText: track.goal_text,
        title: track.title,
        status: track.status,
        promptVersion: track.prompt_version,
        createdAt: track.created_at,
        updatedAt: track.updated_at
      }
    }

    if (text.startsWith('SELECT status FROM tracks WHERE id = ?')) {
      const track = state.tracks.find((item) => item.id === params[0])
      return track ? { status: track.status } : undefined
    }

    if (text.includes('WHERE id = ? AND track_id = ?')) {
      const [nodeId, trackId] = params
      const node = state.nodes.find((item) => item.id === nodeId && item.track_id === trackId)
      return node ? { id: node.id } : undefined
    }

    const found = rows(sql, params)
    return found[0]
  }

  const db = {
    prepare(sql: string) {
      return {
        get: (...params: unknown[]) => one(sql, params),
        all: (...params: unknown[]) => rows(sql, params),
        run: (...params: unknown[]) => run(sql, params)
      }
    },
    transaction(fn: () => void) {
      return () => {
        const saved = snapshot()
        try {
          fn()
        } catch (error) {
          restore(saved)
          throw error
        }
      }
    },
    seedBook(id: string, title: string) {
      if (state.books.some((book) => book.id === id)) return
      state.books.push({ id, title, author: null })
    }
  }

  return db as unknown as Database.Database
}

function seedBook(db: Database.Database, id: string, title: string): void {
  ;(db as unknown as { seedBook: (id: string, title: string) => void }).seedBook(id, title)
}

const root: TrackNodeInput = {
  id: 'n1',
  parentId: null,
  title: '操作系统',
  summary: '',
  depth: 1,
  sortOrder: 0
}

function activeInput(id: string, nodes: TrackNodeInput[], links: TrackLinkInput[]) {
  return {
    id,
    goalText: '学操作系统',
    title: '操作系统脉络',
    nodes,
    links,
    promptVersion: 'v1'
  }
}

function thrownMessage(fn: () => void): string {
  try {
    fn()
    return ''
  } catch (error) {
    if (error instanceof Error) return error.message
    if (typeof error === 'object' && error !== null && 'message' in error) {
      return String((error as { message: unknown }).message)
    }
    return String(error)
  }
}

describe('track source=local', () => {
  it('插入 source=local 后 listNodesWithBooks 读回 local', () => {
    const db = openDb()
    seedBook(db, 'b1', '操作系统概念')
    replaceActiveTrack(db, activeInput('t1', [root], []), 1000)
    db.prepare(
      `INSERT INTO track_node_books (track_id, node_id, book_id, source, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run('t1', 'n1', 'b1', 'local', 1000)

    expect(listNodesWithBooks(db, 't1')[0]?.books).toEqual([
      { bookId: 'b1', title: '操作系统概念', author: null, source: 'local', createdAt: 1000 }
    ])
  })

  it('replaceActiveTrack 可以写入 local', () => {
    const db = openDb()
    seedBook(db, 'b1', '操作系统概念')
    const message = thrownMessage(() =>
      replaceActiveTrack(
        db,
        activeInput('t1', [root], [{ nodeId: 'n1', bookId: 'b1', source: 'local' }]),
        1000
      )
    )
    expect(message).toBe('')
    expect(listNodesWithBooks(db, 't1')[0]?.books[0]?.source).toBe('local')
  })

  it('非法来源在写入前被拒绝', () => {
    const db = openDb()
    seedBook(db, 'b1', '书一')
    expect(
      thrownMessage(() =>
        replaceActiveTrack(
          db,
          activeInput('t1', [root], [
            { nodeId: 'n1', bookId: 'b1', source: 'nope' as TrackLinkInput['source'] }
          ]),
          1000
        )
      )
    ).toMatch(/挂载来源无效/)
    expect(getActiveTrack(db)).toBeNull()
  })

  it('读回时丢掉非法 source', () => {
    const db = openDb()
    seedBook(db, 'b1', '书一')
    replaceActiveTrack(db, activeInput('t1', [root], []), 1000)
    db.prepare(
      `INSERT INTO track_node_books (track_id, node_id, book_id, source, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run('t1', 'n1', 'b1', 'nope', 1000)
    expect(listNodesWithBooks(db, 't1')[0]?.books).toEqual([])
  })

  it('local 不能覆盖 user，但可以替换 ai', () => {
    const db = openDb()
    seedBook(db, 'b1', '书一')
    seedBook(db, 'b2', '书二')
    replaceActiveTrack(
      db,
      activeInput('t1', [root], [
        { nodeId: 'n1', bookId: 'b1', source: 'user' },
        { nodeId: 'n1', bookId: 'b2', source: 'ai' }
      ]),
      1000
    )
    const message = thrownMessage(() =>
      rebuildActiveTree(
        db,
        't1',
        [root],
        [
          { nodeId: 'n1', bookId: 'b1', source: 'local' },
          { nodeId: 'n1', bookId: 'b2', source: 'local' }
        ],
        true,
        1500
      )
    )
    expect(message).toBe('')
    expect(listNodesWithBooks(db, 't1')[0]?.books).toEqual([
      { bookId: 'b1', title: '书一', author: null, source: 'user', createdAt: 1000 },
      { bookId: 'b2', title: '书二', author: null, source: 'local', createdAt: 1000 }
    ])
  })

  it('addBookLinks 只补新挂载，已有键保持原 source', () => {
    const db = openDb()
    seedBook(db, 'b1', '书一')
    seedBook(db, 'b2', '书二')
    seedBook(db, 'b3', '书三')
    replaceActiveTrack(
      db,
      activeInput('t1', [root], [
        { nodeId: 'n1', bookId: 'b1', source: 'user' },
        { nodeId: 'n1', bookId: 'b2', source: 'ai' }
      ]),
      1000
    )

    const message = thrownMessage(() =>
      addBookLinks(
        db,
        't1',
        [
          { nodeId: 'n1', bookId: 'b1', source: 'local' },
          { nodeId: 'n1', bookId: 'b2', source: 'local' },
          { nodeId: 'n1', bookId: 'b3', source: 'local' }
        ],
        2000
      )
    )
    expect(message).toBe('')
    expect(listNodesWithBooks(db, 't1')[0]?.books).toEqual([
      { bookId: 'b1', title: '书一', author: null, source: 'user', createdAt: 1000 },
      { bookId: 'b2', title: '书二', author: null, source: 'ai', createdAt: 1000 },
      { bookId: 'b3', title: '书三', author: null, source: 'local', createdAt: 2000 }
    ])
  })

  it('addBookLinks 拒绝不属于该脉络的节点，并不留下半截挂载', () => {
    const db = openDb()
    seedBook(db, 'b1', '书一')
    seedBook(db, 'b2', '书二')
    replaceActiveTrack(
      db,
      activeInput('t1', [root], [{ nodeId: 'n1', bookId: 'b1', source: 'ai' }]),
      1000
    )
    expect(
      thrownMessage(() =>
        addBookLinks(
          db,
          't1',
          [
            { nodeId: 'n1', bookId: 'b2', source: 'local' },
            { nodeId: 'missing', bookId: 'b1', source: 'local' }
          ],
          2000
        )
      )
    ).toMatch(/找不到节点/)
    expect(listNodesWithBooks(db, 't1')[0]?.books).toEqual([
      { bookId: 'b1', title: '书一', author: null, source: 'ai', createdAt: 1000 }
    ])
  })

  it('addBookLinks 遇到不在书库的书整批回滚', () => {
    const db = openDb()
    seedBook(db, 'b1', '书一')
    replaceActiveTrack(db, activeInput('t1', [root], []), 1000)
    expect(
      thrownMessage(() =>
        addBookLinks(
          db,
          't1',
          [
            { nodeId: 'n1', bookId: 'b1', source: 'local' },
            { nodeId: 'n1', bookId: 'missing', source: 'local' }
          ],
          2000
        )
      )
    ).toMatch(/不在书库/)
    expect(listNodesWithBooks(db, 't1')[0]?.books).toEqual([])
  })

  it('addBookLinks 在写入前拒绝非法来源', () => {
    const db = openDb()
    seedBook(db, 'b1', '书一')
    replaceActiveTrack(db, activeInput('t1', [root], []), 1000)
    expect(
      thrownMessage(() =>
        addBookLinks(
          db,
          't1',
          [{ nodeId: 'n1', bookId: 'b1', source: 'nope' as TrackLinkInput['source'] }],
          2000
        )
      )
    ).toMatch(/挂载来源无效/)
    expect(listNodesWithBooks(db, 't1')[0]?.books).toEqual([])
  })
})
