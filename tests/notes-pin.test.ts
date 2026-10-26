import { describe, expect, it } from 'vitest'
import { chooseHighlightForPin } from '../electron/main/notes/pin'

describe('chooseHighlightForPin', () => {
  it('没有同文划线 → 需要新建', () => {
    expect(chooseHighlightForPin([])).toEqual({ kind: 'create' })
  })

  it('一条 → 复用且非重复提示', () => {
    expect(chooseHighlightForPin([{ id: 9 }])).toEqual({
      kind: 'reuse',
      id: 9,
      reusedEarliestDuplicate: false
    })
  })

  it('多条 → 取 id 最小，并标记重复', () => {
    expect(chooseHighlightForPin([{ id: 5 }, { id: 2 }, { id: 8 }])).toEqual({
      kind: 'reuse',
      id: 2,
      reusedEarliestDuplicate: true
    })
  })
})
