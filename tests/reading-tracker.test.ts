import { describe, expect, it } from 'vitest'
import { creditMs } from '../src/features/reading/tracker'

/** 用 1 分钟的阈值做断言，数字一眼能算清；上线阈值是 5 分钟，逻辑同一条 */
const IDLE = 60_000

function credit(input: Partial<Parameters<typeof creditMs>[0]>) {
  return creditMs({
    now: 100_000,
    lastTickAt: 10_000,
    lastActivityAt: 30_000,
    active: true,
    idleMs: IDLE,
    ...input
  })
}

describe('creditMs', () => {
  it('一直有操作时整段都算', () => {
    expect(credit({ lastActivityAt: 99_500 })).toBe(90_000)
  })

  it('中途超时只算到「最后一次操作 + 阈值」', () => {
    // 最后一次操作在 30 秒，阈值 60 秒 → 只算到 90 秒
    expect(credit({})).toBe(80_000)
  })

  it('不可见或失焦时返回 0', () => {
    expect(credit({ active: false })).toBe(0)
  })

  it('零间隔不记', () => {
    expect(credit({ now: 10_000 })).toBe(0)
  })

  it('时钟回拨不记负数', () => {
    expect(credit({ now: 5_000 })).toBe(0)
  })

  it('刚恢复（阈值内）算整段', () => {
    expect(credit({ lastActivityAt: 100_000 })).toBe(90_000)
  })

  it('操作时刻早于上次结算时，这一段倒扣为 0 而不是负数', () => {
    expect(credit({ lastTickAt: 90_000, lastActivityAt: 1_000 })).toBe(0)
  })
})
