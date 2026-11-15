import type Database from 'better-sqlite3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TRACK_MATCH } from '../shared/track-match'
import type { TrackNodeInput } from '../shared/track'
import { listNodesWithBooks, replaceActiveTrack } from '../electron/main/track/repo'

const library = vi.hoisted(() => ({
  books: [] as Array<{ id: string; title: string; author: string | null }>,
  chapters: new Map<string, string[]>(),
  chapterCalls: [] as string[]
}))

const decided = vi.hoisted(() => ({ inputs: [] as Array<{ bookId: string; tocTitles: string[] }[]> }))

vi.mock('@shared/track-match', async () => {
  const actual = await vi.importActual<typeof import('../shared/track-match')>('../shared/track-match')
  return {
    ...actual,
    decideMatches: (...args: Parameters<typeof actual.decideMatches>) => {
      decided.inputs.push(args[0])
      return actual.decideMatches(...args)
    }
  }
})

vi.mock('../electron/main/library/repo', () => ({
  listBooks: () => library.books,
  listChapters: (_db: unknown, bookId: string) => {
    library.chapterCalls.push(bookId)
    return (library.chapters.get(bookId) ?? []).map((title, index) => ({ id: index, title }))
  }
}))

const { runConfirmMatch, runMatchBooks } = await import('../electron/main/track/match-books')

/**
 * 与 tests/track-source-local.test.ts 同一思路：better-sqlite3 在当前 Node 里加载不了，
 * 这里只实现脉络仓储用到的那几条 SQL；书与目录由上面的库仓储 mock 提供。
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
  type State = { tracks: TrackRec[]; nodes: NodeRec[]; links: LinkRec[]; linkRow: number }

  let state: State = { tracks: [], nodes: [], links: [], linkRow: 1 }

  function fail(message: string, code: string): never {
    throw Object.assign(new Error(message), { code })
  }

  function run(sql: string, params: unknown[]): { changes: number } {
    const text = sql.replace(/\s+/g, ' ').trim()

    if (text.startsWith("UPDATE tracks SET status = 'archived'")) {
      for (const track of state.tracks) {
        if (track.status === 'active') track.status = 'archived'
      }
      return { changes: 0 }
    }
    if (text.startsWith('INSERT INTO tracks')) {
      const [id, goalText, title, promptVersion, createdAt, updatedAt] = params
      state.tracks.push({
        id: String(id),
        goal_text: String(goalText),
        title: String(title),
        status: 'active',
        prompt_version: String(promptVersion),
        created_at: Number(createdAt),
        updated_at: Number(updatedAt)
      })
      return { changes: 1 }
    }
    if (text.startsWith('INSERT INTO track_nodes')) {
      const [id, trackId, parentId, title, summary, sortOrder, depth, createdAt, updatedAt] = params
      state.nodes.push({
        id: String(id),
        track_id: String(trackId),
        parent_id: parentId == null || parentId === '' ? null : String(parentId),
        title: String(title),
        summary: String(summary),
        sort_order: Number(sortOrder),
        depth: Number(depth),
        created_at: Number(createdAt),
        updated_at: Number(updatedAt)
      })
      return { changes: 1 }
    }
    if (text.startsWith('INSERT INTO track_node_books')) {
      const [trackId, nodeId, bookId, source, createdAt] = params
      if (!library.books.some((book) => book.id === bookId)) {
        fail('FOREIGN KEY constraint failed', 'SQLITE_CONSTRAINT_FOREIGNKEY')
      }
      if (state.links.some((link) => link.node_id === nodeId && link.book_id === bookId)) {
        fail('UNIQUE constraint failed', 'SQLITE_CONSTRAINT_PRIMARYKEY')
      }
      state.links.push({
        rowid: state.linkRow++,
        track_id: String(trackId),
        node_id: String(nodeId),
        book_id: String(bookId),
        source: String(source),
        created_at: Number(createdAt)
      })
      return { changes: 1 }
    }
    fail(`未实现的写入 SQL：${text}`, 'TEST_FAKE')
  }

  function rows(sql: string, params: unknown[]): unknown[] {
    const text = sql.replace(/\s+/g, ' ').trim()

    if (text.includes('FROM track_nodes') && text.includes('ORDER BY sort_order, id')) {
      const [trackId] = params
      return state.nodes
        .filter((node) => node.track_id === trackId)
        .sort((a, b) => a.sort_order - b.sort_order || (a.id < b.id ? -1 : 1))
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
          const book = library.books.find((item) => item.id === link.book_id)
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
    fail(`未实现的查询 SQL：${text}`, 'TEST_FAKE')
  }

  function one(sql: string, params: unknown[]): unknown {
    const text = sql.replace(/\s+/g, ' ').trim()

    if (text.includes("WHERE status = 'active'") && text.includes('LIMIT 1')) {
      const track = state.tracks
        .filter((item) => item.status === 'active')
        .sort((a, b) => b.updated_at - a.updated_at)[0]
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
    if (text.includes('WHERE id = ? AND track_id = ?')) {
      const [nodeId, trackId] = params
      const node = state.nodes.find((item) => item.id === nodeId && item.track_id === trackId)
      return node ? { id: node.id } : undefined
    }
    fail(`未实现的单行查询 SQL：${text}`, 'TEST_FAKE')
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
        const saved = structuredClone(state)
        try {
          fn()
        } catch (error) {
          state = saved
          throw error
        }
      }
    }
  }
  return db as unknown as Database.Database
}

const NODES: TrackNodeInput[] = [
  { id: 'n1', parentId: null, title: '操作系统', summary: '', depth: 1, sortOrder: 0 },
  { id: 'n2', parentId: null, title: '数据库', summary: '张三主讲', depth: 1, sortOrder: 1 }
]

function seedTrack(db: Database.Database, links: Array<{ nodeId: string; bookId: string }> = []): void {
  replaceActiveTrack(
    db,
    {
      id: 't1',
      goalText: '学计算机',
      title: '计算机脉络',
      nodes: NODES,
      links: links.map((link) => ({ ...link, source: 'user' as const })),
      promptVersion: 'v1'
    },
    1000
  )
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

function sourcesOf(db: Database.Database): Array<[string, string, string]> {
  return listNodesWithBooks(db, 't1').flatMap((node) =>
    node.books.map((book): [string, string, string] => [node.id, book.bookId, book.source])
  )
}

beforeEach(() => {
  library.books = [
    { id: 'b1', title: '操作系统', author: null },
    { id: 'b2', title: '某书', author: '张三' },
    { id: 'b3', title: '烹饪', author: null },
    { id: 'b4', title: '数据库原理', author: null }
  ]
  library.chapters = new Map()
  library.chapterCalls = []
  decided.inputs = []
})

describe('runMatchBooks', () => {
  it('没有 active 脉络时返回空三类', () => {
    const db = openDb()
    expect(runMatchBooks(db, {})).toEqual({ mounted: [], pending: [], skipped: [] })
  })

  it('零挂载的书：高置信挂成 local，中置信待确认带节点标题，低分跳过', () => {
    const db = openDb()
    seedTrack(db, [{ nodeId: 'n2', bookId: 'b4' }])

    const result = runMatchBooks(db, {})

    expect(result.mounted).toEqual([{ bookId: 'b1', nodeIds: ['n1'] }])
    expect(result.pending).toHaveLength(1)
    expect(result.pending[0]?.bookId).toBe('b2')
    expect(result.pending[0]?.candidates).toEqual([
      { nodeId: 'n2', score: expect.any(Number), title: '数据库' }
    ])
    expect(result.skipped).toEqual([{ bookId: 'b3', reason: 'low' }])
    // 只落 mount；pending 没写；已挂的 b4 不在目标里
    expect(sourcesOf(db)).toEqual([
      ['n1', 'b1', 'local'],
      ['n2', 'b4', 'user']
    ])
    expect(library.chapterCalls).not.toContain('b4')
  })

  it('显式 bookIds 里已挂过的书记为 already-linked，不重复挂', () => {
    const db = openDb()
    seedTrack(db, [{ nodeId: 'n2', bookId: 'b4' }])

    const result = runMatchBooks(db, { bookIds: ['b4', 'b1'] })

    expect(result.skipped).toEqual([{ bookId: 'b4', reason: 'already-linked' }])
    expect(result.mounted).toEqual([{ bookId: 'b1', nodeIds: ['n1'] }])
    expect(sourcesOf(db)).toEqual([
      ['n1', 'b1', 'local'],
      ['n2', 'b4', 'user']
    ])
  })

  it('目录标题只取前 tocTitleMax 条', () => {
    const db = openDb()
    seedTrack(db)
    library.chapters.set(
      'b1',
      Array.from({ length: TRACK_MATCH.tocTitleMax + 8 }, (_, index) => `第${index}章`)
    )

    runMatchBooks(db, { bookIds: ['b1'] })

    expect(library.chapterCalls).toEqual(['b1'])
    expect(decided.inputs[0]?.[0]?.tocTitles).toEqual(
      Array.from({ length: TRACK_MATCH.tocTitleMax }, (_, index) => `第${index}章`)
    )
  })

  it('再跑一次不会重复挂载', () => {
    const db = openDb()
    seedTrack(db)
    runMatchBooks(db, {})
    const again = runMatchBooks(db, {})
    expect(again.mounted).toEqual([])
    expect(sourcesOf(db).filter(([, bookId]) => bookId === 'b1')).toHaveLength(1)
  })
})

describe('runConfirmMatch', () => {
  it('确认后挂成 user，且允许多个节点', () => {
    const db = openDb()
    seedTrack(db)
    runConfirmMatch(db, 'b2', ['n1', 'n2'], 2000)
    expect(sourcesOf(db)).toEqual([
      ['n1', 'b2', 'user'],
      ['n2', 'b2', 'user']
    ])
  })

  it('没有 active 脉络时抛错', () => {
    expect(thrownMessage(() => runConfirmMatch(openDb(), 'b2', ['n1']))).toMatch(/还没有学习脉络/)
  })

  it('节点不属于该脉络时抛错，且不留半截挂载', () => {
    const db = openDb()
    seedTrack(db)
    expect(thrownMessage(() => runConfirmMatch(db, 'b2', ['n1', 'nope']))).toMatch(/找不到节点/)
    expect(sourcesOf(db)).toEqual([])
  })

  it('这本书已经挂过节点时抛错', () => {
    const db = openDb()
    seedTrack(db)
    runMatchBooks(db, { bookIds: ['b1'] })
    expect(thrownMessage(() => runConfirmMatch(db, 'b1', ['n2']))).toMatch(/这本书已经挂过节点了/)
    expect(sourcesOf(db)).toEqual([['n1', 'b1', 'local']])
  })

  it('节点列表为空时抛错', () => {
    const db = openDb()
    seedTrack(db)
    expect(thrownMessage(() => runConfirmMatch(db, 'b2', []))).toMatch(/至少选一个节点/)
  })
})
