import type Database from 'better-sqlite3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { appError } from '../shared/errors'
import type { TrackGapPayload, TrackNodeInput } from '../shared/track'
import type { LibrarySummary } from '../electron/main/track/library-summary'
import { TRACK_SKELETON_SCHEMA } from '../electron/main/track/prompts'
import type { TrackNodeView } from '../electron/main/track/repo'

const caps = vi.hoisted(() => {
  const state = {
    jsonDisabled: false,
    markUnavailable: vi.fn(() => {
      state.jsonDisabled = true
    })
  }
  return state
})

vi.mock('../electron/main/ai/repo', () => ({
  unavailableCaps: () => (caps.jsonDisabled ? ['jsonMode'] : []),
  markUnavailable: caps.markUnavailable
}))

vi.mock('../electron/main/track/library-summary', () => ({
  loadLibrarySummary: vi.fn()
}))

vi.mock('../electron/main/track/repo', () => ({
  getActiveTrack: vi.fn(),
  getTrackAiResult: vi.fn(),
  listNodesWithBooks: vi.fn(),
  rebuildActiveTree: vi.fn(),
  replaceActiveTrack: vi.fn(),
  saveTrackAiResult: vi.fn()
}))

vi.mock('../electron/main/track/signals', () => ({
  computeTrackSignals: vi.fn()
}))

import { markUnavailable } from '../electron/main/ai/repo'
import { loadLibrarySummary } from '../electron/main/track/library-summary'
import {
  getActiveTrack,
  getTrackAiResult,
  listNodesWithBooks,
  rebuildActiveTree,
  replaceActiveTrack,
  saveTrackAiResult
} from '../electron/main/track/repo'
import { computeTrackSignals } from '../electron/main/track/signals'
import {
  remapTrackNodeIds,
  runTrackBuild,
  runTrackGap,
  trackBuildScopeKey,
  trackGapScopeKey,
  type TrackBuildProgress,
  type TrackChat
} from '../electron/main/track/tasks'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const library: LibrarySummary = {
  books: [
    {
      id: 'b1',
      title: '深入理解计算机系统',
      author: null,
      tags: ['系统'],
      status: 'reading',
      percent: 0.4,
      chapterTitles: []
    },
    {
      id: 'b2',
      title: '操作系统导论',
      author: '某作者',
      tags: [],
      status: 'unread',
      percent: 0,
      chapterTitles: []
    }
  ],
  rankedIds: ['b1', 'b2', 'b3'],
  total: 3,
  note: '书库共 3 本，本次只参考了 2 本'
}

const skeleton = {
  nodes: [
    { id: 'root', parentId: null, title: '操作系统', summary: '底子', depth: 1, sortOrder: 0 },
    { id: 'mem', parentId: 'root', title: '内存', summary: '', depth: 2, sortOrder: 1 }
  ]
}

function dbWithUpdates(): { db: Database.Database; runs: { sql: string; params: unknown[] }[] } {
  const runs: { sql: string; params: unknown[] }[] = []
  const db = {
    prepare(sql: string) {
      return {
        run: (...params: unknown[]) => {
          runs.push({ sql, params })
          return { changes: 1 }
        }
      }
    }
  } as unknown as Database.Database
  return { db, runs }
}

/** 新建路径的 listNodesWithBooks 按刚写入的链接回答，模拟落库后的挂载。 */
function viewsFromLastReplace(): TrackNodeView[] {
  const input = vi.mocked(replaceActiveTrack).mock.calls.at(-1)?.[1]
  if (!input) return []
  return input.nodes.map((node) => ({
    id: node.id,
    trackId: input.id,
    parentId: node.parentId,
    title: node.title,
    summary: node.summary,
    sortOrder: node.sortOrder,
    depth: node.depth,
    createdAt: 1,
    updatedAt: 1,
    books: input.links
      .filter((link) => link.nodeId === node.id)
      .map((link) => ({
        bookId: link.bookId,
        title: link.bookId,
        author: null,
        source: link.source,
        createdAt: 1
      }))
  }))
}

function textOf(chat: ReturnType<typeof vi.fn>, index: number): string {
  const call = chat.mock.calls[index]?.[0] as { input: { messages: { content: string }[] } } | undefined
  return call?.input.messages.map((message) => message.content).join('\n') ?? ''
}

describe('脉络键与节点 id', () => {
  it('成树键忽略目标空白和书 id 顺序', () => {
    const left = trackBuildScopeKey('学操作系统\n第二行', ['b', 'a'])
    const right = trackBuildScopeKey('学操作系统 第二行', ['a', 'b'])
    expect(left).toBe(right)
    expect(left.startsWith('学操作系统 第二行\n')).toBe(true)
    expect(left).not.toBe(trackBuildScopeKey('学操作系统 第二行', ['a']))
  })

  it('问缺键在追问和强制刷新时加后缀', () => {
    expect(trackGapScopeKey('fp', undefined, false, 42)).toBe('fp')
    expect(trackGapScopeKey('fp', '   ', true, 42)).toBe('fp\n42')
    expect(trackGapScopeKey('fp', '  为什么   现在  ', false, 1)).toBe('fp\n为什么 现在')
    expect(trackGapScopeKey('fp', '为什么', true, 42)).toBe('fp\n为什么\n42')
  })

  it('新 id 换成 uuid 并改写父节点；仍在树上的旧 id 留下', () => {
    const nodes = remapTrackNodeIds(
      [
        { id: 'a', parentId: null, title: 'A', summary: '', depth: 1, sortOrder: 0 },
        { id: 'b', parentId: 'a', title: 'B', summary: '', depth: 2, sortOrder: 0 },
        { id: 'keep', parentId: 'b', title: 'K', summary: '', depth: 3, sortOrder: 0 }
      ],
      new Set(['keep', 'dropped'])
    )
    const root = nodes[0]
    const mid = nodes[1]
    const kept = nodes[2]
    expect(root?.id).toMatch(UUID)
    expect(root?.id).not.toBe('a')
    expect(mid?.id).toMatch(UUID)
    expect(mid?.parentId).toBe(root?.id)
    expect(kept?.id).toBe('keep')
    expect(kept?.parentId).toBe(mid?.id)
    expect(nodes.map((node) => node.id)).not.toContain('dropped')
  })
})

describe('runTrackBuild', () => {
  beforeEach(() => {
    caps.jsonDisabled = false
    caps.markUnavailable.mockClear()
    vi.mocked(loadLibrarySummary).mockReset()
    vi.mocked(getActiveTrack).mockReset()
    vi.mocked(listNodesWithBooks).mockReset()
    vi.mocked(replaceActiveTrack).mockReset()
    vi.mocked(rebuildActiveTree).mockReset()
    vi.mocked(saveTrackAiResult).mockReset()
    vi.mocked(loadLibrarySummary).mockReturnValue(library)
    vi.mocked(getActiveTrack).mockReturnValue(null)
    vi.mocked(listNodesWithBooks).mockImplementation(() => viewsFromLastReplace())
  })

  it('两阶段成树后把短 id 换成 uuid，并丢掉不存在的书', async () => {
    const { db } = dbWithUpdates()
    const progress: TrackBuildProgress[] = []
    const signal = new AbortController().signal
    const chat = vi.fn<TrackChat>(async (options) => {
      const text = options.input.messages.map((message) => message.content).join('\n')
      if (text.includes(TRACK_SKELETON_SCHEMA)) {
        return { content: JSON.stringify(skeleton), usage: { inputTokens: 10, outputTokens: 4 } }
      }
      const nodeId = text.match(/^- node (\S+)/m)?.[1]
      return {
        content: JSON.stringify({ mounts: [{ nodeId, bookIds: ['b1', 'nope'] }] }),
        usage: { inputTokens: 3, outputTokens: 2 }
      }
    })

    const result = await runTrackBuild(db, {
      goalText: '  学操作系统  ',
      rebuild: false,
      providerId: 'deepseek',
      model: 'deepseek-chat',
      signal,
      onProgress: (item) => progress.push(item),
      chat
    })

    expect(progress.map((item) => item.phase)).toEqual([1, 2])
    expect(chat).toHaveBeenCalledTimes(2)
    expect(chat.mock.calls[0]?.[0].input.json).toBe(true)
    expect(chat.mock.calls[0]?.[0].input.stream).toBe(false)
    expect(chat.mock.calls[0]?.[0].input.maxTokens).toBe(4096)
    expect(chat.mock.calls[0]?.[0].signal).toBe(signal)
    expect(textOf(chat, 0)).toContain('book b1')
    expect(textOf(chat, 0)).not.toContain('book b3')

    const saved = vi.mocked(replaceActiveTrack).mock.calls[0]?.[1]
    expect(saved?.goalText).toBe('学操作系统')
    expect(saved?.title).toBe('学操作系统')
    expect(saved?.promptVersion).toBe('v1')
    expect(saved?.id).toMatch(UUID)
    const root = saved?.nodes[0]
    const child = saved?.nodes[1]
    expect(root?.id).toMatch(UUID)
    expect(root?.id).not.toBe('root')
    expect(child?.parentId).toBe(root?.id)
    expect(child?.id).not.toBe('mem')
    expect(saved?.links).toEqual([{ nodeId: root?.id, bookId: 'b1', source: 'ai' }])
    expect(textOf(chat, 1)).toContain(`node ${root?.id}`)
    expect(textOf(chat, 1)).not.toContain('node root')
    expect(result.trackId).toBe(saved?.id)
    expect(result.uncategorizedBookIds).toEqual(['b2', 'b3'])
    expect(result.usage).toEqual({ inputTokens: 13, outputTokens: 6 })
    expect(result.note).toContain('本次只参考了 2 本')
    expect(rebuildActiveTree).not.toHaveBeenCalled()
    expect(saveTrackAiResult).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        trackId: saved?.id,
        task: 'build',
        scopeKey: trackBuildScopeKey('学操作系统', ['b1', 'b2', 'b3']),
        promptVersion: 'v1',
        provider: 'deepseek',
        model: 'deepseek-chat'
      }),
      expect.objectContaining({
        uncategorizedBookIds: ['b2', 'b3'],
        mountedBookIds: ['b1']
      }),
      result.usage,
      expect.any(Number)
    )
  })

  it('骨架不合法时说明原因并且不落库', async () => {
    const { db } = dbWithUpdates()
    const chat = vi.fn<TrackChat>(async () => ({
      content: JSON.stringify({
        nodes: [{ id: 'a', parentId: null, title: 'A', summary: '', depth: 4, sortOrder: 0 }]
      }),
      usage: { inputTokens: 1, outputTokens: 1 }
    }))

    await expect(
      runTrackBuild(db, {
        goalText: '学操作系统',
        rebuild: false,
        providerId: 'deepseek',
        model: 'deepseek-chat',
        signal: new AbortController().signal,
        onProgress: () => undefined,
        chat
      })
    ).rejects.toMatchObject({
      code: 'AI_UNSUPPORTED',
      message: expect.stringMatching(/没能保存脉络：节点深度超出上限/)
    })
    expect(chat).toHaveBeenCalledTimes(1)
    expect(replaceActiveTrack).not.toHaveBeenCalled()
    expect(saveTrackAiResult).not.toHaveBeenCalled()
  })

  it('不是 JSON 时把原文带进错误', async () => {
    const { db } = dbWithUpdates()
    const chat = vi.fn<TrackChat>(async () => ({
      content: '不是 json',
      usage: { inputTokens: 1, outputTokens: 1 }
    }))

    await expect(
      runTrackBuild(db, {
        goalText: '学操作系统',
        rebuild: false,
        providerId: 'deepseek',
        model: 'deepseek-chat',
        signal: new AbortController().signal,
        onProgress: () => undefined,
        chat
      })
    ).rejects.toMatchObject({
      message: expect.stringMatching(/模型没有返回可用的脉络树。模型原文：不是 json/)
    })
  })

  it('挂载建议解析失败时仍然保存树，书都留在未归类', async () => {
    const { db } = dbWithUpdates()
    const chat = vi.fn<TrackChat>(async (options) => {
      const text = options.input.messages.map((message) => message.content).join('\n')
      if (text.includes(TRACK_SKELETON_SCHEMA)) {
        return { content: JSON.stringify(skeleton), usage: { inputTokens: 2, outputTokens: 2 } }
      }
      return { content: '没挂上', usage: { inputTokens: 1, outputTokens: 1 } }
    })

    const result = await runTrackBuild(db, {
      goalText: '学操作系统',
      rebuild: false,
      providerId: 'deepseek',
      model: 'deepseek-chat',
      signal: new AbortController().signal,
      onProgress: () => undefined,
      chat
    })

    expect(vi.mocked(replaceActiveTrack).mock.calls[0]?.[1].links).toEqual([])
    expect(result.uncategorizedBookIds).toEqual(['b1', 'b2', 'b3'])
    expect(result.note).toContain('挂载建议没能解析，书都留在未归类')
    expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 3 })
  })

  it('挂载建议里的节点全对不上时说明书留在未归类', async () => {
    const { db } = dbWithUpdates()
    const chat = vi.fn<TrackChat>(async (options) => {
      const text = options.input.messages.map((message) => message.content).join('\n')
      if (text.includes(TRACK_SKELETON_SCHEMA)) {
        return { content: JSON.stringify(skeleton), usage: { inputTokens: 2, outputTokens: 2 } }
      }
      return {
        content: JSON.stringify({ mounts: [{ nodeId: 'n1', bookIds: ['b1'] }] }),
        usage: { inputTokens: 1, outputTokens: 1 }
      }
    })

    const result = await runTrackBuild(db, {
      goalText: '学操作系统',
      rebuild: false,
      providerId: 'deepseek',
      model: 'deepseek-chat',
      signal: new AbortController().signal,
      onProgress: () => undefined,
      chat
    })

    expect(vi.mocked(replaceActiveTrack).mock.calls[0]?.[1].links).toEqual([])
    expect(result.uncategorizedBookIds).toEqual(['b1', 'b2', 'b3'])
    expect(result.note).toContain('对不上')
    expect(result.note).toContain('未归类')
  })

  it('故意返回空挂载时不说节点对不上', async () => {
    const { db } = dbWithUpdates()
    const chat = vi.fn<TrackChat>(async (options) => {
      const text = options.input.messages.map((message) => message.content).join('\n')
      if (text.includes(TRACK_SKELETON_SCHEMA)) {
        return { content: JSON.stringify(skeleton), usage: { inputTokens: 1, outputTokens: 1 } }
      }
      return { content: JSON.stringify({ mounts: [] }), usage: { inputTokens: 1, outputTokens: 1 } }
    })

    const result = await runTrackBuild(db, {
      goalText: '学操作系统',
      rebuild: false,
      providerId: 'deepseek',
      model: 'deepseek-chat',
      signal: new AbortController().signal,
      onProgress: () => undefined,
      chat
    })

    expect(vi.mocked(replaceActiveTrack).mock.calls[0]?.[1].links).toEqual([])
    expect(result.note ?? '').not.toContain('对不上')
    expect(result.note ?? '').not.toContain('未归类')
  })

  it('服务商拒绝 jsonMode 后去掉参数重试，同一次成树的挂载不再带该参数', async () => {
    const { db } = dbWithUpdates()
    const chat = vi.fn<TrackChat>(async (options) => {
      if (options.input.json) throw appError('AI_UNSUPPORTED', '不接受 response_format')
      const text = options.input.messages.map((message) => message.content).join('\n')
      if (text.includes(TRACK_SKELETON_SCHEMA)) {
        return { content: JSON.stringify(skeleton), usage: { inputTokens: 1, outputTokens: 1 } }
      }
      return { content: JSON.stringify({ mounts: [] }), usage: { inputTokens: 1, outputTokens: 1 } }
    })

    const result = await runTrackBuild(db, {
      goalText: '学操作系统',
      rebuild: false,
      providerId: 'deepseek',
      model: 'deepseek-chat',
      signal: new AbortController().signal,
      onProgress: () => undefined,
      chat
    })

    expect(chat.mock.calls.map((call) => call[0].input.json)).toEqual([true, false, false])
    expect(markUnavailable).toHaveBeenCalledWith(db, 'deepseek', 'jsonMode')
    expect(result.note).toContain('服务商不接受结构化输出参数')
    expect(replaceActiveTrack).toHaveBeenCalled()
  })

  it('没有目标或没有旧脉络时不调用模型', async () => {
    const { db } = dbWithUpdates()
    const chat = vi.fn<TrackChat>()
    const base = {
      providerId: 'deepseek' as const,
      model: 'deepseek-chat',
      signal: new AbortController().signal,
      onProgress: () => undefined,
      chat
    }

    await expect(runTrackBuild(db, { ...base, goalText: '   ', rebuild: false })).rejects.toMatchObject({
      message: '请先写下学习目标'
    })
    expect(loadLibrarySummary).not.toHaveBeenCalled()

    await expect(runTrackBuild(db, { ...base, goalText: '学操作系统', rebuild: true })).rejects.toMatchObject({
      message: '还没有脉络，无法重生'
    })
    expect(loadLibrarySummary).not.toHaveBeenCalled()
    expect(chat).not.toHaveBeenCalled()
  })

  it('重生沿用模型带回的旧 id，并保留同 id 挂载', async () => {
    const { db, runs } = dbWithUpdates()
    vi.mocked(loadLibrarySummary).mockReturnValue({
      ...library,
      rankedIds: ['b1', 'b2', 'b3', 'old-book']
    })
    vi.mocked(getActiveTrack).mockReturnValue({
      id: 'track-1',
      goalText: '旧目标',
      title: '旧目标',
      status: 'active',
      promptVersion: 'v1',
      createdAt: 1,
      updatedAt: 1
    })
    const kept = {
      id: 'keep',
      trackId: 'track-1',
      parentId: null,
      title: '旧节点',
      summary: '原来的',
      sortOrder: 0,
      depth: 1,
      createdAt: 1,
      updatedAt: 1
    }
    vi.mocked(listNodesWithBooks)
      .mockReturnValueOnce([
        {
          ...kept,
          books: [{ bookId: 'old-book', title: '旧书', author: null, source: 'user', createdAt: 1 }]
        }
      ] as TrackNodeView[])
      .mockReturnValue([
        {
          ...kept,
          books: [
            { bookId: 'old-book', title: '旧书', author: null, source: 'user', createdAt: 1 },
            { bookId: 'b1', title: '深入理解计算机系统', author: null, source: 'ai', createdAt: 2 }
          ]
        }
      ] as TrackNodeView[])

    const chat = vi.fn<TrackChat>(async (options) => {
      const text = options.input.messages.map((message) => message.content).join('\n')
      if (text.includes(TRACK_SKELETON_SCHEMA)) {
        return {
          content: JSON.stringify({
            nodes: [
              { id: 'keep', parentId: null, title: '旧节点', summary: '原来的', depth: 1, sortOrder: 0 },
              { id: 'fresh', parentId: 'keep', title: '新枝', summary: '', depth: 2, sortOrder: 0 }
            ]
          }),
          usage: { inputTokens: 1, outputTokens: 1 }
        }
      }
      return {
        content: JSON.stringify({ mounts: [{ nodeId: 'keep', bookIds: ['b1'] }] }),
        usage: { inputTokens: 1, outputTokens: 1 }
      }
    })

    const result = await runTrackBuild(db, {
      goalText: '新目标',
      rebuild: true,
      providerId: 'deepseek',
      model: 'deepseek-chat',
      signal: new AbortController().signal,
      onProgress: () => undefined,
      chat
    })

    expect(textOf(chat, 0)).toContain('node keep')
    expect(textOf(chat, 0)).toContain('用户改过挂载')
    expect(replaceActiveTrack).not.toHaveBeenCalled()
    const nodes = vi.mocked(rebuildActiveTree).mock.calls[0]?.[2] as TrackNodeInput[]
    const links = vi.mocked(rebuildActiveTree).mock.calls[0]?.[3]
    expect(vi.mocked(rebuildActiveTree).mock.calls[0]?.[1]).toBe('track-1')
    expect(vi.mocked(rebuildActiveTree).mock.calls[0]?.[4]).toBe(true)
    expect(nodes.map((node) => node.id)).toContain('keep')
    expect(nodes.find((node) => node.id !== 'keep')).toMatchObject({ parentId: 'keep', title: '新枝' })
    expect(nodes.find((node) => node.id !== 'keep')?.id).toMatch(UUID)
    expect(links).toEqual([{ nodeId: 'keep', bookId: 'b1', source: 'ai' }])
    expect(vi.mocked(rebuildActiveTree).mock.calls[0]?.[6]).toEqual({
      goalText: '新目标',
      title: '新目标',
      promptVersion: 'v1'
    })
    expect(runs).toEqual([])
    expect(result.trackId).toBe('track-1')
    expect(result.uncategorizedBookIds).not.toContain('old-book')
    expect(result.uncategorizedBookIds).toEqual(['b2', 'b3'])
    expect(saveTrackAiResult).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ trackId: 'track-1', task: 'build' }),
      expect.objectContaining({
        mountedBookIds: ['old-book', 'b1'],
        uncategorizedBookIds: ['b2', 'b3']
      }),
      expect.anything(),
      expect.any(Number)
    )
  })

  it('重生时挂载建议解析失败，已保留的书不再说成全部未归类', async () => {
    const { db } = dbWithUpdates()
    vi.mocked(loadLibrarySummary).mockReturnValue({
      ...library,
      rankedIds: ['b1', 'b2', 'b3', 'old-book']
    })
    vi.mocked(getActiveTrack).mockReturnValue({
      id: 'track-1',
      goalText: '旧目标',
      title: '旧目标',
      status: 'active',
      promptVersion: 'v1',
      createdAt: 1,
      updatedAt: 1
    })
    const kept = {
      id: 'keep',
      trackId: 'track-1',
      parentId: null,
      title: '旧节点',
      summary: '',
      sortOrder: 0,
      depth: 1,
      createdAt: 1,
      updatedAt: 1,
      books: [{ bookId: 'old-book', title: '旧书', author: null, source: 'user' as const, createdAt: 1 }]
    }
    vi.mocked(listNodesWithBooks)
      .mockReturnValueOnce([kept] as TrackNodeView[])
      .mockReturnValue([kept] as TrackNodeView[])

    const chat = vi.fn<TrackChat>(async (options) => {
      const text = options.input.messages.map((message) => message.content).join('\n')
      if (text.includes(TRACK_SKELETON_SCHEMA)) {
        return {
          content: JSON.stringify({
            nodes: [{ id: 'keep', parentId: null, title: '旧节点', summary: '', depth: 1, sortOrder: 0 }]
          }),
          usage: { inputTokens: 1, outputTokens: 1 }
        }
      }
      return { content: '没挂上', usage: { inputTokens: 1, outputTokens: 1 } }
    })

    const result = await runTrackBuild(db, {
      goalText: '新目标',
      rebuild: true,
      providerId: 'deepseek',
      model: 'deepseek-chat',
      signal: new AbortController().signal,
      onProgress: () => undefined,
      chat
    })

    expect(result.uncategorizedBookIds).not.toContain('old-book')
    expect(result.uncategorizedBookIds).toEqual(['b1', 'b2', 'b3'])
    expect(result.note).toContain('挂载建议没能解析')
    expect(result.note).not.toContain('书都留在未归类')
  })
})

describe('runTrackGap', () => {
  const track = {
    id: 'track-1',
    goalText: '学操作系统',
    title: '学操作系统',
    status: 'active' as const,
    promptVersion: 'v1',
    createdAt: 1,
    updatedAt: 1
  }
  const tree = [
    {
      id: 'n1',
      trackId: 'track-1',
      parentId: null,
      title: '内存',
      summary: '',
      sortOrder: 0,
      depth: 1,
      createdAt: 1,
      updatedAt: 1,
      books: []
    }
  ] as TrackNodeView[]

  beforeEach(() => {
    caps.jsonDisabled = false
    vi.mocked(getActiveTrack).mockReset()
    vi.mocked(listNodesWithBooks).mockReset()
    vi.mocked(computeTrackSignals).mockReset()
    vi.mocked(getTrackAiResult).mockReset()
    vi.mocked(saveTrackAiResult).mockReset()
    vi.mocked(getActiveTrack).mockReturnValue(track)
    vi.mocked(listNodesWithBooks).mockReturnValue(tree)
    vi.mocked(computeTrackSignals).mockReturnValue({
      nodes: [
        { nodeId: 'n1', bookCount: 0, progressAvg: 0, unreadRatio: 1, sediment: 0, strength: 'empty' }
      ],
      fingerprintSource: 'src',
      fingerprint: 'fp1'
    })
  })

  it('指纹和模型都没变时直接复用，不再调用模型', async () => {
    const payload: TrackGapPayload = { overall: '缺基础', gaps: [], nextSteps: ['去读书'], note: null }
    vi.mocked(getTrackAiResult).mockReturnValue({
      payload,
      inputTokens: 5,
      outputTokens: 6,
      createdAt: 1
    })
    const chat = vi.fn<TrackChat>()

    const result = await runTrackGap({} as Database.Database, {
      providerId: 'deepseek',
      model: 'deepseek-chat',
      signal: new AbortController().signal,
      chat
    })

    expect(result).toEqual({
      payload,
      cached: true,
      usage: { inputTokens: 5, outputTokens: 6 },
      fingerprint: 'fp1'
    })
    expect(chat).not.toHaveBeenCalled()
    expect(getTrackAiResult).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        trackId: 'track-1',
        task: 'gap',
        scopeKey: 'fp1',
        promptVersion: 'v1',
        provider: 'deepseek',
        model: 'deepseek-chat'
      })
    )
    expect(saveTrackAiResult).not.toHaveBeenCalled()
  })

  it('未知节点的缺口丢掉后再落库', async () => {
    vi.mocked(getTrackAiResult).mockReturnValue(null)
    const chat = vi.fn<TrackChat>(async () => ({
      content: JSON.stringify({
        overall: '还缺',
        gaps: [
          { nodeId: 'n1', type: 'coverage', summary: '没有书', suggestBookKinds: ['教材'] },
          { nodeId: 'ghost', type: 'progress', summary: '不存在', suggestBookKinds: [] }
        ],
        nextSteps: ['先补一本']
      }),
      usage: { inputTokens: 4, outputTokens: 5 }
    }))

    const result = await runTrackGap({} as Database.Database, {
      question: '  先读什么  ',
      providerId: 'deepseek',
      model: 'deepseek-chat',
      signal: new AbortController().signal,
      chat
    })

    expect(result.cached).toBe(false)
    expect(result.fingerprint).toBe('fp1')
    expect(result.payload.gaps).toEqual([
      { nodeId: 'n1', type: 'coverage', summary: '没有书', suggestBookKinds: ['教材'] }
    ])
    expect(result.payload.note).toContain('已忽略 1 条指向未知节点的缺口')
    expect(result.usage).toEqual({ inputTokens: 4, outputTokens: 5 })
    expect(textOf(chat, 0)).toContain('先读什么')
    expect(saveTrackAiResult).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ task: 'gap', scopeKey: 'fp1\n先读什么' }),
      result.payload,
      result.usage,
      expect.any(Number)
    )
  })

  it('强制刷新使用带时间戳的新键', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    try {
      vi.mocked(getTrackAiResult).mockReturnValue(null)
      const chat = vi.fn<TrackChat>(async () => ({
        content: JSON.stringify({ overall: '再看一次', gaps: [], nextSteps: [] }),
        usage: { inputTokens: 1, outputTokens: 1 }
      }))

      const result = await runTrackGap({} as Database.Database, {
        question: '为什么',
        forceRefresh: true,
        providerId: 'deepseek',
        model: 'deepseek-chat',
        signal: new AbortController().signal,
        chat
      })

      expect(result.cached).toBe(false)
      expect(result.fingerprint).toBe('fp1')
      expect(getTrackAiResult).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ scopeKey: 'fp1\n为什么\n1700000000000' })
      )
      expect(chat).toHaveBeenCalledTimes(1)
    } finally {
      vi.mocked(Date.now).mockRestore()
    }
  })

  it('问缺结果不是结构时保留原文', async () => {
    vi.mocked(getTrackAiResult).mockReturnValue(null)
    const chat = vi.fn<TrackChat>(async () => ({
      content: '先把内存读完',
      usage: null
    }))

    const result = await runTrackGap({} as Database.Database, {
      providerId: 'deepseek',
      model: 'deepseek-chat',
      signal: new AbortController().signal,
      chat
    })

    expect(result.payload.rawText).toBe('先把内存读完')
    expect(result.payload.gaps).toEqual([])
    expect(result.payload.note).toContain('已保留原文')
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 })
    expect(saveTrackAiResult).toHaveBeenCalled()
  })

  it('没有脉络时不计算信号也不调用模型', async () => {
    vi.mocked(getActiveTrack).mockReturnValue(null)
    const chat = vi.fn<TrackChat>()
    await expect(
      runTrackGap({} as Database.Database, {
        providerId: 'deepseek',
        model: 'deepseek-chat',
        signal: new AbortController().signal,
        chat
      })
    ).rejects.toMatchObject({ message: '还没有学习脉络，请先生成' })
    expect(computeTrackSignals).not.toHaveBeenCalled()
    expect(chat).not.toHaveBeenCalled()
  })
})
