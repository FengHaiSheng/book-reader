import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sedimentScore, signalsFingerprintSource } from '../shared/track'
import type { TrackNodeView } from '../electron/main/track/repo'

vi.mock('../electron/main/track/repo', () => ({
  listNodesWithBooks: vi.fn()
}))

import { listNodesWithBooks } from '../electron/main/track/repo'
import {
  aggregateTrackSignals,
  computeTrackSignals,
  loadBookSignalMetrics,
  UNREAD_PERCENT,
  WEAK_PROGRESS_AVG,
  WEAK_SEDIMENT,
  type BookSignalMetrics
} from '../electron/main/track/signals'

const noted = { percent: 1, highlight: 1, note: 1, aiNote: 0 }

describe('节点信号聚合', () => {
  it('把角标阈值钉在平均进度 0.2、沉淀 3、未读 0.005', () => {
    expect(WEAK_PROGRESS_AVG).toBe(0.2)
    expect(WEAK_SEDIMENT).toBe(3)
    expect(UNREAD_PERCENT).toBe(0.005)
  })

  it('没挂书是 empty，进度 0、未读比 1', () => {
    const row = aggregateTrackSignals([{ nodeId: 'empty', bookIds: [] }], new Map()).nodes[0]
    expect(row).toEqual({
      nodeId: 'empty',
      bookCount: 0,
      progressAvg: 0,
      unreadRatio: 1,
      sediment: 0,
      strength: 'empty'
    })
  })

  it('有书但平均进度不足 0.2 是 weak；刚好 0.2 且有一处批注划线是 ok', () => {
    const low = aggregateTrackSignals([{ nodeId: 'low', bookIds: ['b'] }], metrics({ b: { ...noted, percent: 0.19 } }))
    const enough = aggregateTrackSignals(
      [{ nodeId: 'enough', bookIds: ['b'] }],
      metrics({ b: { ...noted, percent: 0.2 } })
    )
    expect(low.nodes[0]?.strength).toBe('weak')
    expect(enough.nodes[0]?.strength).toBe('ok')
    expect(enough.nodes[0]?.sediment).toBe(sedimentScore(1, 1, 0))
  })

  it('读完了但沉淀不够仍是 weak；一处批注或一条 AI 笔记才够', () => {
    const bare = aggregateTrackSignals(
      [{ nodeId: 'bare', bookIds: ['b'] }],
      metrics({ b: { percent: 1, highlight: 1, note: 0, aiNote: 0 } })
    )
    const annotated = aggregateTrackSignals(
      [{ nodeId: 'note', bookIds: ['b'] }],
      metrics({ b: noted })
    )
    const aiOnly = aggregateTrackSignals(
      [{ nodeId: 'ai', bookIds: ['b'] }],
      metrics({ b: { percent: 1, highlight: 0, note: 0, aiNote: 1 } })
    )
    expect(bare.nodes[0]).toMatchObject({ sediment: 1, strength: 'weak' })
    expect(annotated.nodes[0]?.strength).toBe('ok')
    expect(aiOnly.nodes[0]).toMatchObject({ sediment: 3, strength: 'ok' })
  })

  it('无进度行或 percent < 0.005 算未读，均值用夹紧后的进度', () => {
    const result = aggregateTrackSignals(
      [{ nodeId: 'mix', bookIds: ['none', 'dust', 'read', 'over'] }],
      metrics({
        dust: { percent: 0.004, highlight: 0, note: 0, aiNote: 0 },
        read: { percent: 0.5, highlight: 0, note: 0, aiNote: 0 },
        over: { percent: 1.4, highlight: 0, note: 0, aiNote: 0 }
      })
    )
    const row = result.nodes[0]
    expect(row?.unreadRatio).toBe(0.5)
    expect(row?.progressAvg).toBeCloseTo((0 + 0.004 + 0.5 + 1) / 4, 10)
    expect(row?.strength).toBe('weak')
  })

  it('同一本书只计一次；缺指标当未读且没有沉淀；多本书的沉淀相加', () => {
    const result = aggregateTrackSignals(
      [
        { nodeId: 'dup', bookIds: ['b1', 'b1', ' ', 'b1'] },
        { nodeId: 'gone', bookIds: ['missing'] },
        {
          nodeId: 'sum',
          bookIds: ['left', 'right']
        }
      ],
      metrics({
        b1: { percent: 0.4, highlight: 2, note: 0, aiNote: 0 },
        left: { percent: 0.8, highlight: 2, note: 1, aiNote: 0 },
        right: { percent: 0, highlight: 0, note: 0, aiNote: 1 }
      })
    )
    expect(result.nodes.map((node) => node.nodeId)).toEqual(['dup', 'gone', 'sum'])
    expect(result.nodes[0]).toMatchObject({ bookCount: 1, sediment: 2, progressAvg: 0.4, strength: 'weak' })
    expect(result.nodes[1]).toMatchObject({
      bookCount: 1,
      progressAvg: 0,
      unreadRatio: 1,
      sediment: 0,
      strength: 'weak'
    })
    expect(result.nodes[2]).toMatchObject({
      bookCount: 2,
      progressAvg: 0.4,
      unreadRatio: 0.5,
      sediment: sedimentScore(2, 1, 0) + sedimentScore(0, 0, 1),
      strength: 'ok'
    })
  })

  it('fingerprint 是排序后信号原文的 sha256，不含角标，且不跟节点入参顺序走', () => {
    const forward = aggregateTrackSignals(
      [
        { nodeId: 'b', bookIds: [] },
        { nodeId: 'a', bookIds: ['book'] }
      ],
      metrics({ book: { percent: 0.5, highlight: 2, note: 1, aiNote: 0 } })
    )
    const backward = aggregateTrackSignals(
      [
        { nodeId: 'a', bookIds: ['book'] },
        { nodeId: 'b', bookIds: [] }
      ],
      metrics({ book: { percent: 0.5, highlight: 2, note: 1, aiNote: 0 } })
    )
    const source = ['v1', 'a|1|0.5000|0.0000|4', 'b|0|0.0000|1.0000|0'].join('\n')
    expect(forward.nodes.map((node) => node.nodeId)).toEqual(['b', 'a'])
    expect(forward.fingerprintSource).toBe(source)
    expect(forward.fingerprintSource).toBe(
      signalsFingerprintSource([
        { id: 'b', bookCount: 0, progressAvg: 0, unreadRatio: 1, sediment: 0 },
        { id: 'a', bookCount: 1, progressAvg: 0.5, unreadRatio: 0, sediment: 4 }
      ])
    )
    expect(forward.fingerprint).toBe(createHash('sha256').update(source).digest('hex'))
    expect(forward.fingerprint).toBe(backward.fingerprint)
    expect(forward.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(forward.fingerprintSource.includes('weak')).toBe(false)
  })

  it('空树的指纹原文只有版本行', () => {
    const result = aggregateTrackSignals([], new Map())
    expect(result.nodes).toEqual([])
    expect(result.fingerprintSource).toBe('v1\n')
    expect(result.fingerprint).toBe(createHash('sha256').update('v1\n').digest('hex'))
  })
})

describe('书指标查询', () => {
  it('没有书 id 不发 SQL', () => {
    let calls = 0
    const db = scriptedDb(() => {
      calls += 1
      return []
    })
    expect(loadBookSignalMetrics(db, []).size).toBe(0)
    expect(calls).toBe(0)
  })

  it('按 0–1 进度、非空批注和 AI 笔记行数查，并去重', () => {
    const seen: { sql: string; params: unknown[] }[] = []
    const db = scriptedDb((sql, params) => {
      seen.push({ sql, params })
      return [{ bookId: 'b1', percent: null, highlight: 2, note: 1, aiNote: 3 }]
    })
    const metrics = loadBookSignalMetrics(db, ['b1', ' b1 ', '', 'b2'])
    expect(seen).toHaveLength(1)
    expect(seen[0]?.params).toEqual(['b1', 'b2'])
    expect(seen[0]?.sql).toContain('reading_progress')
    expect(seen[0]?.sql).toContain('FROM highlights h WHERE h.book_id = b.id')
    expect(seen[0]?.sql).toContain("h.note IS NOT NULL AND TRIM(h.note) <> ''")
    expect(seen[0]?.sql).toContain('highlight_ai_notes')
    expect(metrics.get('b1')).toEqual({ percent: null, highlight: 2, note: 1, aiNote: 3 })
    expect(metrics.has('b2')).toBe(false)
  })

  it('超过 400 个书 id 拆成两次查询', () => {
    const sizes: number[] = []
    const db = scriptedDb((_sql, params) => {
      sizes.push(params.length)
      return []
    })
    const ids = Array.from({ length: 401 }, (_, index) => `b${index}`)
    expect(loadBookSignalMetrics(db, ids).size).toBe(0)
    expect(sizes).toEqual([400, 1])
  })
})

describe('computeTrackSignals', () => {
  const list = vi.mocked(listNodesWithBooks)

  beforeEach(() => {
    list.mockReset()
  })

  it('空脉络不查书，指纹与空聚合一致', () => {
    list.mockReturnValue([])
    let calls = 0
    const db = scriptedDb(() => {
      calls += 1
      return []
    })
    const result = computeTrackSignals(db, 'missing')
    expect(list).toHaveBeenCalledWith(db, 'missing')
    expect(calls).toBe(0)
    expect(result).toEqual(aggregateTrackSignals([], new Map()))
  })

  it('用节点挂载去重后的书指标做聚合，节点顺序保持目录顺序', () => {
    list.mockReturnValue([view('n2', ['b2', 'b1']), view('n1', ['b1'])])
    const seen: unknown[][] = []
    const db = scriptedDb((_sql, params) => {
      seen.push(params)
      return [
        { bookId: 'b1', percent: null, highlight: 0, note: 0, aiNote: 0 },
        { bookId: 'b2', percent: 0.8, highlight: 1, note: 1, aiNote: 0 }
      ]
    })
    const result = computeTrackSignals(db, 't1')
    expect(seen).toEqual([['b2', 'b1']])
    expect(result.nodes.map((node) => node.nodeId)).toEqual(['n2', 'n1'])
    expect(result.nodes[0]).toMatchObject({
      bookCount: 2,
      progressAvg: 0.4,
      unreadRatio: 0.5,
      sediment: sedimentScore(1, 1, 0),
      strength: 'ok'
    })
    expect(result.nodes[1]).toMatchObject({
      bookCount: 1,
      progressAvg: 0,
      unreadRatio: 1,
      sediment: 0,
      strength: 'weak'
    })
    expect(result.fingerprint).toBe(
      createHash('sha256').update(result.fingerprintSource).digest('hex')
    )
  })
})

function metrics(books: Record<string, BookSignalMetrics>): Map<string, BookSignalMetrics> {
  return new Map(Object.entries(books))
}

function scriptedDb(run: (sql: string, params: unknown[]) => unknown[]): Database.Database {
  return {
    prepare(sql: string) {
      return {
        all: (...params: unknown[]) => run(sql, params)
      }
    }
  } as unknown as Database.Database
}

function view(id: string, bookIds: string[]): TrackNodeView {
  return {
    id,
    trackId: 't1',
    parentId: null,
    title: id,
    summary: '',
    sortOrder: 0,
    depth: 1,
    createdAt: 0,
    updatedAt: 0,
    books: bookIds.map((bookId) => ({
      bookId,
      title: bookId,
      author: null,
      source: 'user',
      createdAt: 0
    }))
  }
}
