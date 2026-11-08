import { describe, expect, it } from 'vitest'
import { sedimentScore, signalsFingerprintSource, SEDIMENT_WEIGHTS } from '../shared/track'

describe('track signals', () => {
  it('沉淀加权', () => {
    expect(sedimentScore(2, 1, 1)).toBe(
      2 * SEDIMENT_WEIGHTS.highlight + 1 * SEDIMENT_WEIGHTS.note + 1 * SEDIMENT_WEIGHTS.aiNote
    )
  })

  it('fingerprint 原文稳定排序', () => {
    const a = signalsFingerprintSource([
      { id: 'b', bookCount: 0, progressAvg: 0, unreadRatio: 1, sediment: 0 },
      { id: 'a', bookCount: 1, progressAvg: 0.5, unreadRatio: 0, sediment: 3 }
    ])
    const b = signalsFingerprintSource([
      { id: 'a', bookCount: 1, progressAvg: 0.5, unreadRatio: 0, sediment: 3 },
      { id: 'b', bookCount: 0, progressAvg: 0, unreadRatio: 1, sediment: 0 }
    ])
    expect(a).toBe(b)
    expect(a.startsWith('v1\n')).toBe(true)
  })
})
