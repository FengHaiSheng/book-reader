import { describe, expect, it } from 'vitest'
import {
  decideBookMatch,
  decideMatches,
  scoreBookAgainstNode,
  TRACK_MATCH,
  type MatchBookInput,
  type MatchNodeInput
} from '../shared/track-match'

const nodes = [
  { id: 'd1', parentId: null, title: '战略', summary: '公司战略', depth: 1 },
  { id: 'd2', parentId: 'd1', title: '竞争战略', summary: '定位与取舍', depth: 2 },
  { id: 'f1', parentId: null, title: '财务', summary: '财报', depth: 1 }
]

function book(
  bookId: string,
  title: string,
  extra: Partial<Pick<MatchBookInput, 'author' | 'tocTitles'>> = {}
): MatchBookInput {
  return {
    bookId,
    title,
    author: extra.author ?? null,
    tocTitles: extra.tocTitles ?? []
  }
}

function node(
  id: string,
  title: string,
  extra: Partial<Pick<MatchNodeInput, 'parentId' | 'summary' | 'depth'>> = {}
): MatchNodeInput {
  return {
    id,
    parentId: extra.parentId ?? null,
    title,
    summary: extra.summary ?? '',
    depth: extra.depth ?? 1
  }
}

describe('track-match', () => {
  it('书名强含节点名 → 高置信挂最深', () => {
    const d = decideBookMatch(
      { bookId: 'b1', title: '竞争战略精解', author: null, tocTitles: [] },
      nodes,
      new Set()
    )
    expect(d).toEqual({ bookId: 'b1', kind: 'mount', nodeIds: ['d2'] })
  })

  it('已挂载 → already-linked', () => {
    const d = decideBookMatch(
      { bookId: 'b1', title: '竞争战略精解', author: null, tocTitles: [] },
      nodes,
      new Set(['b1'])
    )
    expect(d.kind).toBe('skip')
    if (d.kind === 'skip') expect(d.reason).toBe('already-linked')
  })

  it('弱相关 → pending 或 low', () => {
    const d = decideBookMatch(
      { bookId: 'b2', title: '诗歌选集', author: null, tocTitles: ['春'] },
      nodes,
      new Set()
    )
    expect(d.kind === 'pending' || (d.kind === 'skip' && d.reason === 'low')).toBe(true)
  })

  it('祖孙同时高分只留深节点', () => {
    // 构造 title 同时强匹配「战略」与「竞争战略」时 nodeIds 不含 d1
    const d = decideBookMatch(
      { bookId: 'b3', title: '竞争战略', author: null, tocTitles: [] },
      nodes,
      new Set()
    )
    expect(d.kind).toBe('mount')
    if (d.kind === 'mount') {
      expect(d.nodeIds).toContain('d2')
      expect(d.nodeIds).not.toContain('d1')
    }
  })
})

describe('scoreBookAgainstNode', () => {
  it('阈值常量', () => {
    expect(TRACK_MATCH).toEqual({
      highMin: 0.82,
      highGap: 0.15,
      medMin: 0.48,
      tocTitleMax: 12,
      pendingMax: 3
    })
  })

  it('标点空白大小写去掉后，书名与节点名互相包含且达到四成 → 0.92', () => {
    const noisy = 'He \u3000\t\n.,，。:：;；!！?？、·-_/\\()（）[]【】「」『』"\'lloWorld'
    expect(scoreBookAgainstNode(book('b', noisy), node('n', 'helloworld'))).toBe(0.92)
    expect(scoreBookAgainstNode(book('b', '战略管理学'), node('n', '战略'))).toBe(0.92)
    expect(scoreBookAgainstNode(book('b', '战略'), node('n', '竞争战略'))).toBe(0.92)
    expect(scoreBookAgainstNode(book('b', 'hello world'), node('n', 'hello world'))).toBe(0.92)
  })

  it('短于四成、空标题、目录作者摘要都不走包含分', () => {
    expect(scoreBookAgainstNode(book('b', '竞争战略精解'), node('n', '战略'))).toBe(0)
    expect(scoreBookAgainstNode(book('b', ''), node('n', ''))).toBe(0)
    expect(
      scoreBookAgainstNode(book('b', '杂文集', { tocTitles: ['春日'] }), node('n', '春日'))
    ).toBe(0.5)
    expect(
      scoreBookAgainstNode(book('b', '杂文', { author: '竞争战略' }), node('n', '竞争战略'))
    ).toBe(0.55)
    expect(
      scoreBookAgainstNode(book('b', '定位与取舍'), node('n', '竞争战略', { summary: '定位与取舍' }))
    ).toBe(0.5)
    expect(
      scoreBookAgainstNode(book('b', 'alpha beta'), node('n', '', { summary: 'alpha beta' }))
    ).toBe(1)
  })

  it('未包含时用标题作者目录与节点标题摘要的 token Jaccard', () => {
    expect(scoreBookAgainstNode(book('b', 'beta alpha'), node('n', 'alpha beta'))).toBe(1)
    expect(scoreBookAgainstNode(book('b', 'alpha alpha beta'), node('n', 'alpha gamma'))).toBe(1 / 3)
    expect(
      scoreBookAgainstNode(
        book('b', '甲', { author: '乙', tocTitles: ['丙'] }),
        node('n', '丙', { summary: '乙' })
      )
    ).toBe(2 / 3)
  })

  it('作者规范化后出现在节点标题或摘要里，分数至少 0.55，且不压过更高分', () => {
    expect(
      scoreBookAgainstNode(
        book('b', '甲乙丙', { author: '波特' }),
        node('n', '无关', { summary: '见波·特' })
      )
    ).toBe(0.55)
    expect(
      scoreBookAgainstNode(
        book('b', '竞争战略', { author: '波特' }),
        node('n', '竞争战略', { summary: '见波·特' })
      )
    ).toBe(0.92)
    expect(scoreBookAgainstNode(book('b', '甲乙丙', { author: '   ' }), node('n', '波特'))).toBe(0)
    expect(scoreBookAgainstNode(book('b', '甲乙丙', { author: '···' }), node('n', '波特'))).toBe(0)
  })
})

describe('decideBookMatch 三档', () => {
  it('低于 medMin 记为 low；介于两档之间进入 pending', () => {
    const low = decideBookMatch(book('b', 'alpha beta'), [node('n', 'alpha gamma')], new Set())
    expect(low).toEqual({ bookId: 'b', kind: 'skip', reason: 'low' })

    const pending = decideBookMatch(
      book('b', '杂文集', { tocTitles: ['春日'] }),
      [node('n', '春日')],
      new Set()
    )
    expect(pending).toEqual({
      bookId: 'b',
      kind: 'pending',
      candidates: [{ nodeId: 'n', score: 0.5 }]
    })
  })

  it('候选都达到 highMin 时多挂，分数高的在前，同分保持输入顺序', () => {
    const decision = decideBookMatch(
      book('b', '竞争战略', { tocTitles: ['alpha', 'beta'] }),
      [
        node('low-first', '竞争战略'),
        node('best', 'alpha beta', { summary: '竞争战略' })
      ],
      new Set()
    )
    expect(decision).toEqual({ bookId: 'b', kind: 'mount', nodeIds: ['best', 'low-first'] })

    const tied = decideBookMatch(
      book('b', '财务分析竞争战略'),
      [node('a', '财务分析'), node('b', '竞争战略')],
      new Set()
    )
    expect(tied).toEqual({ bookId: 'b', kind: 'mount', nodeIds: ['a', 'b'] })
  })

  it('最高分明显领先时只挂它；领先不够或并列最高则 pending', () => {
    const clear = decideBookMatch(
      book('b', '竞争战略', { author: '波特' }),
      [node('high', '竞争战略'), node('med', '其他', { summary: '见波·特' })],
      new Set()
    )
    expect(clear).toEqual({ bookId: 'b', kind: 'mount', nodeIds: ['high'] })

    const close = decideBookMatch(
      book('b', '竞争战略', { tocTitles: ['aa', 'bb', 'cc', 'dd'] }),
      [node('high', '竞争战略'), node('med', 'aa bb cc dd')],
      new Set()
    )
    expect(close).toEqual({
      bookId: 'b',
      kind: 'pending',
      candidates: [
        { nodeId: 'high', score: 0.92 },
        { nodeId: 'med', score: 0.8 }
      ]
    })

    const tied = decideBookMatch(
      book('b', '财务分析竞争战略', { author: '波特' }),
      [
        node('a', '财务分析'),
        node('b', '竞争战略'),
        node('c', '其他', { summary: '见波·特' })
      ],
      new Set()
    )
    expect(tied).toEqual({
      bookId: 'b',
      kind: 'pending',
      candidates: [
        { nodeId: 'a', score: 0.92 },
        { nodeId: 'b', score: 0.92 },
        { nodeId: 'c', score: 0.55 }
      ]
    })
  })

  it('pending 最多 pendingMax 条', () => {
    const decision = decideBookMatch(
      book('b', '诗歌', { author: '波特' }),
      ['甲', '乙', '丙', '丁'].map((title, index) =>
        node(`n${index}`, title, { summary: '见波特' })
      ),
      new Set()
    )
    expect(decision).toEqual({
      bookId: 'b',
      kind: 'pending',
      candidates: [
        { nodeId: 'n0', score: 0.55 },
        { nodeId: 'n1', score: 0.55 },
        { nodeId: 'n2', score: 0.55 }
      ]
    })
  })

  it('折叠后只留最深；高分祖先若有中分子孙则不再挂祖先', () => {
    const tree = [
      node('g', '战略管理', { depth: 1 }),
      node('p', '战略管理全书', { parentId: 'g', depth: 2 }),
      node('c', '战略管理全书精要', { parentId: 'p', depth: 3 })
    ]
    expect(decideBookMatch(book('b', '战略管理全书精要'), tree, new Set())).toEqual({
      bookId: 'b',
      kind: 'mount',
      nodeIds: ['c']
    })

    const dropped = decideBookMatch(
      book('b', '竞争战略', { author: '波特' }),
      [
        node('shallow', '竞争战略', { depth: 1 }),
        node('deep', '其他', { parentId: 'shallow', summary: '见波·特', depth: 2 })
      ],
      new Set()
    )
    expect(dropped).toEqual({
      bookId: 'b',
      kind: 'pending',
      candidates: [{ nodeId: 'deep', score: 0.55 }]
    })
  })
})

describe('decideMatches', () => {
  it('按书序各自决策，已挂载与未挂载互不影响', () => {
    const decisions = decideMatches(
      [book('linked', '竞争战略精解'), book('fresh', '竞争战略精解')],
      nodes,
      new Set(['linked'])
    )
    expect(decisions).toEqual([
      { bookId: 'linked', kind: 'skip', reason: 'already-linked' },
      { bookId: 'fresh', kind: 'mount', nodeIds: ['d2'] }
    ])
  })
})
