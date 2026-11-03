import { BAR_PAD_LEFT, IS_MAC } from '../features/reader/chrome'

/** 壳层侧栏默认展开宽，与非阅读态 `.sidebar` 一致 */
export const SIDEBAR_WIDTH = 248
/**
 * 阅读时收起轨宽（图标在上、文案在下）。
 * 需放下两字标签；macOS 上至少还要盖住红绿灯让位（BAR_PAD_LEFT）。
 */
export const SIDEBAR_COLLAPSED_WIDTH = Math.max(72, IS_MAC ? BAR_PAD_LEFT : 72)
/**
 * 阅读展开态最小宽：一排放下「书架 / 笔记 / 设置」三个带图标+文案的按钮
 *（约 66×3 + 间距 + 侧栏左右内边距）。
 */
export const SIDEBAR_EXPANDED_MIN_WIDTH = 220
/** 阅读侧栏拖宽上限 */
export const SIDEBAR_MAX_WIDTH = 360
/** 与侧栏右边框一致，算 AI 面板可用宽度时要扣 */
export const SIDEBAR_BORDER = 1

/** 展开态宽度夹紧（不含收起轨） */
export function clampExpandedSidebarWidth(width: number): number {
  return Math.min(
    SIDEBAR_MAX_WIDTH,
    Math.max(SIDEBAR_EXPANDED_MIN_WIDTH, Math.round(width))
  )
}

/**
 * 拖动时的宽度：收起轨与展开区间是两档。
 * 从收起往右拖，过了展开最小宽才进入展开；展开态不能拖得比最小宽更窄（收起靠按钮）。
 */
export function clampSidebarWidth(width: number, fromCollapsed: boolean): number {
  if (fromCollapsed) {
    return width >= SIDEBAR_EXPANDED_MIN_WIDTH
      ? clampExpandedSidebarWidth(width)
      : SIDEBAR_COLLAPSED_WIDTH
  }
  return clampExpandedSidebarWidth(width)
}
