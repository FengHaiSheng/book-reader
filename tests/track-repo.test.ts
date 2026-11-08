import type Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import type { TrackGapPayload, TrackNodeInput } from '../shared/track'
import {
  getActiveTrack,
  getTrackAiResult,
  latestGapResult,
  listNodesWithBooks,
  rebuildActiveTree,
  renameNode,
  replaceActiveTrack,
  saveTrackAiResult,
  setNodeBooks,
  type TrackLinkInput
} from '../electron/main/track/repo'

/**
 * better-sqlite3 在当前 Node 里一构造就崩溃，vitest 也加载不了原生模块。
 * 这里按仓库实际发出的 SQL 做一份内存库，把归档、挂载合并和唯一键跑通。
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
  type AiRec = {
    id: number
    track_id: string
    task: string
    scope_key: string
    prompt_version: string
    provider: string
    model: string
    payload: string
    input_tokens: number
    output_tokens: number
    created_at: number
  }
  type State = {
    tracks: TrackRec[]
    nodes: NodeRec[]
    links: LinkRec[]
    books: BookRec[]
    ai: AiRec[]
    linkRow: number
    aiId: number
  }

  let state: State = { tracks: [], nodes: [], links: [], books: [], ai: [], linkRow: 1, aiId: 1 }

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

    if (text.startsWith('UPDATE tracks SET status = \'archived\'')) {
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

    if (text.startsWith('INSERT INTO track_node_books')) {
      const userLiteral = text.includes("'user'")
      const trackId = String(params[0])
      const nodeId = String(params[1])
      const bookId = String(params[2])
      const source = userLiteral ? 'user' : String(params[3])
      const createdAt = num(userLiteral ? params[3] : params[4])
      if (!state.books.some((book) => book.id === bookId)) {
        fail('FOREIGN KEY constraint failed', 'SQLITE_CONSTRAINT_FOREIGNKEY')
      }
      if (state.links.some((link) => link.node_id === nodeId && link.book_id === bookId)) {
        fail(
          'UNIQUE constraint failed: track_node_books.node_id, track_node_books.book_id',
          'SQLITE_CONSTRAINT_PRIMARYKEY'
        )
      }
      state.links.push({
        rowid: state.linkRow++,
        track_id: trackId,
        node_id: nodeId,
        book_id: bookId,
        source,
        created_at: createdAt
      })
      return { changes: 1 }
    }

    if (text.startsWith('INSERT INTO track_ai_results')) {
      const [
        trackId,
        task,
        scopeKey,
        promptVersion,
        provider,
        model,
        payload,
        inputTokens,
        outputTokens,
        createdAt
      ] = params
      if (!state.tracks.some((track) => track.id === trackId)) {
        fail('FOREIGN KEY constraint failed', 'SQLITE_CONSTRAINT_FOREIGNKEY')
      }
      const existing = state.ai.find(
        (row) =>
          row.track_id === trackId &&
          row.task === task &&
          row.scope_key === scopeKey &&
          row.prompt_version === promptVersion &&
          row.model === model
      )
      if (existing) {
        existing.payload = String(payload)
        existing.provider = String(provider)
        existing.input_tokens = num(inputTokens)
        existing.output_tokens = num(outputTokens)
        existing.created_at = num(createdAt)
        return { changes: 1 }
      }
      state.ai.push({
        id: state.aiId++,
        track_id: String(trackId),
        task: String(task),
        scope_key: String(scopeKey),
        prompt_version: String(promptVersion),
        provider: String(provider),
        model: String(model),
        payload: String(payload),
        input_tokens: num(inputTokens),
        output_tokens: num(outputTokens),
        created_at: num(createdAt)
      })
      return { changes: 1 }
    }

    if (text.startsWith('DELETE FROM track_node_books WHERE track_id = ? AND node_id = ?')) {
      const [trackId, nodeId] = params
      const before = state.links.length
      state.links = state.links.filter((link) => !(link.track_id === trackId && link.node_id === nodeId))
      return { changes: before - state.links.length }
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

    if (text.startsWith('DELETE FROM books WHERE id = ?')) {
      const [bookId] = params
      state.books = state.books.filter((book) => book.id !== bookId)
      state.links = state.links.filter((link) => link.book_id !== bookId)
      return { changes: 1 }
    }

    if (text.startsWith('UPDATE tracks SET updated_at = ? WHERE id = (SELECT')) {
      const [now, nodeId] = params
      const node = state.nodes.find((item) => item.id === nodeId)
      const track = state.tracks.find((item) => item.id === node?.track_id)
      if (track) track.updated_at = num(now)
      return { changes: track ? 1 : 0 }
    }

    if (text.startsWith('UPDATE tracks SET updated_at = ? WHERE id = ?')) {
      const [now, trackId] = params
      const track = state.tracks.find((item) => item.id === trackId)
      if (track) track.updated_at = num(now)
      return { changes: track ? 1 : 0 }
    }

    if (text.startsWith('UPDATE track_nodes SET updated_at = ? WHERE id = ?')) {
      const [now, nodeId] = params
      const node = state.nodes.find((item) => item.id === nodeId)
      if (node) node.updated_at = num(now)
      return { changes: node ? 1 : 0 }
    }

    if (text.startsWith('UPDATE track_nodes SET title')) {
      const [title, summary, now, nodeId] = params
      const node = state.nodes.find((item) => item.id === nodeId)
      if (!node) return { changes: 0 }
      node.title = String(title)
      node.summary = String(summary)
      node.updated_at = num(now)
      return { changes: 1 }
    }

    if (text.startsWith('UPDATE track_ai_results SET payload')) {
      const [payload, scopeKey] = params
      for (const row of state.ai) {
        if (row.scope_key === scopeKey) row.payload = String(payload)
      }
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

    if (text.startsWith('SELECT id, status FROM tracks')) {
      return [...state.tracks]
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map((track) => ({ id: track.id, status: track.status }))
    }

    if (text.includes('COUNT(*)')) {
      const [trackId] = params
      return [{ c: state.nodes.filter((node) => node.track_id === trackId).length }]
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

    if (text.startsWith('SELECT id FROM track_nodes WHERE id = ?')) {
      const node = state.nodes.find((item) => item.id === params[0])
      return node ? { id: node.id } : undefined
    }

    if (text.includes('task = \'gap\'') && text.includes('LIMIT 1')) {
      const [trackId] = params
      const row = state.ai
        .filter((item) => item.track_id === trackId && item.task === 'gap')
        .sort((a, b) => b.created_at - a.created_at || b.id - a.id)[0]
      if (!row) return undefined
      return {
        payload: row.payload,
        scopeKey: row.scope_key,
        promptVersion: row.prompt_version,
        provider: row.provider,
        model: row.model,
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        createdAt: row.created_at
      }
    }

    if (text.includes('FROM track_ai_results') && text.includes('prompt_version = ?')) {
      const [trackId, task, scopeKey, promptVersion, model] = params
      const row = state.ai.find(
        (item) =>
          item.track_id === trackId &&
          item.task === task &&
          item.scope_key === scopeKey &&
          item.prompt_version === promptVersion &&
          item.model === model
      )
      if (!row) return undefined
      return {
        payload: row.payload,
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        createdAt: row.created_at
      }
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
const child: TrackNodeInput = {
  id: 'n2',
  parentId: 'n1',
  title: '进程',
  summary: '调度与地址空间',
  depth: 2,
  sortOrder: 1
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

describe('track repo', () => {
  it('空库没有正在使用的脉络', () => {
    const db = openDb()
    expect(getActiveTrack(db)).toBeNull()
    expect(listNodesWithBooks(db, 'missing')).toEqual([])
    expect(latestGapResult(db, 'missing')).toBeNull()
  })

  it('写入当前脉络，再次生成会归档上一条且始终只有一条 active', () => {
    const db = openDb()
    seedBook(db, 'b1', '操作系统概念')
    replaceActiveTrack(
      db,
      activeInput('t1', [root, child], [{ nodeId: 'n1', bookId: 'b1', source: 'ai' }]),
      1000
    )

    expect(getActiveTrack(db)).toMatchObject({
      id: 't1',
      goalText: '学操作系统',
      title: '操作系统脉络',
      status: 'active',
      promptVersion: 'v1',
      createdAt: 1000,
      updatedAt: 1000
    })

    const nodes = listNodesWithBooks(db, 't1')
    expect(nodes.map((node) => node.id)).toEqual(['n1', 'n2'])
    expect(nodes[0]).toMatchObject({ parentId: null, depth: 1, sortOrder: 0 })
    expect(nodes[1]).toMatchObject({ parentId: 'n1', summary: '调度与地址空间' })
    expect(nodes[0]?.books).toEqual([
      { bookId: 'b1', title: '操作系统概念', author: null, source: 'ai', createdAt: 1000 }
    ])
    expect(nodes[1]?.books).toEqual([])

    db.prepare(
      `INSERT INTO tracks (id, goal_text, title, status, prompt_version, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?, ?)`
    ).run('rogue', 'x', 'x', 'v1', 1, 1)

    replaceActiveTrack(
      db,
      activeInput(
        't2',
        [{ id: 'n9', parentId: null, title: '网络', summary: '', depth: 1, sortOrder: 0 }],
        []
      ),
      2000
    )

    expect(getActiveTrack(db)?.id).toBe('t2')
    expect(db.prepare('SELECT id, status FROM tracks ORDER BY id').all()).toEqual([
      { id: 'rogue', status: 'archived' },
      { id: 't1', status: 'archived' },
      { id: 't2', status: 'active' }
    ])
    expect(
      (db.prepare('SELECT COUNT(*) AS c FROM track_nodes WHERE track_id = ?').get('t1') as { c: number }).c
    ).toBe(2)
  })

  it('重生骨架时同节点保留旧挂载，对不上的丢掉，且不把用户挂载改回 ai', () => {
    const db = openDb()
    for (const [id, title] of [
      ['b1', '书一'],
      ['b2', '书二'],
      ['b3', '书三'],
      ['b4', '书四']
    ] as const) {
      seedBook(db, id, title)
    }
    replaceActiveTrack(
      db,
      activeInput('t1', [root, child], [
        { nodeId: 'n1', bookId: 'b1', source: 'user' },
        { nodeId: 'n1', bookId: 'b2', source: 'ai' },
        { nodeId: 'n2', bookId: 'b3', source: 'ai' }
      ]),
      1000
    )

    rebuildActiveTree(
      db,
      't1',
      [root, { id: 'n3', parentId: 'n1', title: '内存', summary: '', depth: 2, sortOrder: 2 }],
      [
        { nodeId: 'n1', bookId: 'b1', source: 'ai' },
        { nodeId: 'n1', bookId: 'b4', source: 'ai' }
      ],
      true,
      1500
    )

    const nodes = listNodesWithBooks(db, 't1')
    expect(nodes.map((node) => node.id)).toEqual(['n1', 'n3'])
    expect(nodes[0]?.books.map((book) => [book.bookId, book.source, book.createdAt])).toEqual([
      ['b1', 'user', 1000],
      ['b2', 'ai', 1000],
      ['b4', 'ai', 1500]
    ])
    expect(nodes[1]?.books).toEqual([])
    expect(getActiveTrack(db)?.updatedAt).toBe(1500)
  })

  it('keepUserLinksByNodeId 为假时只留下新挂载', () => {
    const db = openDb()
    seedBook(db, 'b1', '书一')
    seedBook(db, 'b4', '书四')
    replaceActiveTrack(
      db,
      activeInput('t1', [root], [{ nodeId: 'n1', bookId: 'b1', source: 'user' }]),
      1000
    )
    rebuildActiveTree(db, 't1', [root], [{ nodeId: 'n1', bookId: 'b4', source: 'ai' }], false, 1600)
    expect(listNodesWithBooks(db, 't1')[0]?.books).toEqual([
      { bookId: 'b4', title: '书四', author: null, source: 'ai', createdAt: 1600 }
    ])
  })

  it('手改挂载整表替换为 user，改标题只动该节点', () => {
    const db = openDb()
    seedBook(db, 'b1', '书一')
    seedBook(db, 'b2', '书二')
    replaceActiveTrack(
      db,
      activeInput('t1', [root], [{ nodeId: 'n1', bookId: 'b1', source: 'ai' }]),
      1000
    )
    setNodeBooks(db, 't1', 'n1', ['b2', 'b1'], 1800)
    expect(listNodesWithBooks(db, 't1')[0]?.books).toEqual([
      { bookId: 'b2', title: '书二', author: null, source: 'user', createdAt: 1800 },
      { bookId: 'b1', title: '书一', author: null, source: 'user', createdAt: 1800 }
    ])
    setNodeBooks(db, 't1', 'n1', [], 1900)
    expect(listNodesWithBooks(db, 't1')[0]?.books).toEqual([])

    renameNode(db, 'n1', '内核', '启动与系统调用', 2000)
    expect(listNodesWithBooks(db, 't1')[0]).toMatchObject({
      title: '内核',
      summary: '启动与系统调用',
      updatedAt: 2000
    })
  })

  it('删书只摘掉挂载，节点还在', () => {
    const db = openDb()
    seedBook(db, 'b1', '书一')
    replaceActiveTrack(
      db,
      activeInput('t1', [root], [{ nodeId: 'n1', bookId: 'b1', source: 'ai' }]),
      1000
    )
    db.prepare('DELETE FROM books WHERE id = ?').run('b1')
    const nodes = listNodesWithBooks(db, 't1')
    expect(nodes).toHaveLength(1)
    expect(nodes[0]?.books).toEqual([])
  })

  it('非法写入回滚，不留下半截脉络', () => {
    const db = openDb()
    seedBook(db, 'b1', '书一')
    expect(
      thrownMessage(() =>
        replaceActiveTrack(
          db,
          activeInput('t1', [root], [{ nodeId: 'missing', bookId: 'b1', source: 'ai' }]),
          1000
        )
      )
    ).toMatch(/不存在的节点/)
    expect(getActiveTrack(db)).toBeNull()

    replaceActiveTrack(db, activeInput('t1', [root], []), 1000)
    expect(thrownMessage(() => setNodeBooks(db, 't1', 'n1', ['nope'], 1100))).toMatch(/不在书库/)
    expect(listNodesWithBooks(db, 't1')[0]?.books).toEqual([])
    expect(thrownMessage(() => setNodeBooks(db, 't1', 'nope', ['b1'], 1100))).toMatch(/找不到节点/)
    expect(thrownMessage(() => renameNode(db, 'n1', '  ', 'x', 1100))).toMatch(/标题不能为空/)
    expect(listNodesWithBooks(db, 't1')[0]?.title).toBe('操作系统')

    expect(thrownMessage(() => replaceActiveTrack(db, activeInput('t2', [root], []), 1200))).toMatch(
      /节点 id/
    )
    expect(getActiveTrack(db)?.id).toBe('t1')
  })

  it('问缺缓存按唯一键复用，最新一条与 build 分开', () => {
    const db = openDb()
    replaceActiveTrack(db, activeInput('t1', [root], []), 1000)
    const gap = (summary: string): TrackGapPayload => ({
      overall: summary,
      gaps: [],
      nextSteps: []
    })
    const key = {
      trackId: 't1',
      task: 'gap' as const,
      scopeKey: 'fp-1',
      promptVersion: 'v1',
      provider: 'deepseek' as const,
      model: 'm'
    }
    saveTrackAiResult(db, key, gap('第一份'), { inputTokens: 1, outputTokens: 2 }, 3000)
    saveTrackAiResult(
      db,
      { ...key, scopeKey: 'fp-2' },
      gap('第二份'),
      { inputTokens: 3, outputTokens: 4 },
      3000
    )
    saveTrackAiResult(
      db,
      { ...key, task: 'build', scopeKey: 'goal' },
      { note: '骨架' },
      { inputTokens: 9, outputTokens: 9 },
      4000
    )

    expect(latestGapResult(db, 't1')).toMatchObject({
      scopeKey: 'fp-2',
      payload: { overall: '第二份' },
      inputTokens: 3,
      outputTokens: 4,
      createdAt: 3000
    })

    saveTrackAiResult(db, key, gap('刷新第一份'), { inputTokens: 5, outputTokens: 6 }, 5000)
    expect(getTrackAiResult<TrackGapPayload>(db, key)).toMatchObject({
      payload: { overall: '刷新第一份' },
      inputTokens: 5,
      createdAt: 5000
    })
    expect(latestGapResult(db, 't1')?.payload.overall).toBe('刷新第一份')
    expect(getTrackAiResult(db, { ...key, model: 'other' })).toBeNull()

    db.prepare('UPDATE track_ai_results SET payload = ? WHERE scope_key = ?').run('{', 'fp-1')
    expect(getTrackAiResult(db, key)).toBeNull()
  })
})
