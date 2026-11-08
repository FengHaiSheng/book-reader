import { describe, expect, it } from 'vitest'
import {
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_EXPANDED_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
  clampExpandedSidebarWidth,
  clampSidebarWidth
} from '../src/shell/sidebarWidth'

describe('sidebar width', () => {
  it('展开最小宽能放下书架、脉络、笔记、设置四个图标按钮', () => {
    // 66×4 + 间距 2×3 + 左右内边距 8×2
    expect(SIDEBAR_EXPANDED_MIN_WIDTH).toBe(286)
    expect(SIDEBAR_EXPANDED_MIN_WIDTH).toBeLessThanOrEqual(SIDEBAR_MAX_WIDTH)
  })

  it('展开态不能窄于四项最小宽', () => {
    expect(clampExpandedSidebarWidth(200)).toBe(SIDEBAR_EXPANDED_MIN_WIDTH)
    expect(clampExpandedSidebarWidth(SIDEBAR_EXPANDED_MIN_WIDTH)).toBe(SIDEBAR_EXPANDED_MIN_WIDTH)
    expect(clampExpandedSidebarWidth(400)).toBe(SIDEBAR_MAX_WIDTH)
  })

  it('从收起轨拖过最小宽才展开', () => {
    expect(clampSidebarWidth(SIDEBAR_EXPANDED_MIN_WIDTH - 1, true)).toBe(SIDEBAR_COLLAPSED_WIDTH)
    expect(clampSidebarWidth(SIDEBAR_EXPANDED_MIN_WIDTH, true)).toBe(SIDEBAR_EXPANDED_MIN_WIDTH)
    expect(clampSidebarWidth(SIDEBAR_EXPANDED_MIN_WIDTH - 1, false)).toBe(
      SIDEBAR_EXPANDED_MIN_WIDTH
    )
  })
})
