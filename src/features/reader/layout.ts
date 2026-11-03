import { PREFS_LIMITS, type ReadingPrefs } from '@shared/types'
import { SIDEBAR_BORDER } from '../../shell/sidebarWidth'

/**
 * 纸面留白。这一圈是**屏幕空间**的留白，不参与分栏 —— 也就是说 iframe（正文区）
 * 的尺寸就是纯文字区域，视觉上的页边距由外面的纸面提供。
 *
 * 纵向同样是上下各一份：纸面比正文多出下方的那一份，正好被窗口底边裁掉，
 * 所以看起来是「纸一路通到窗口底部」，而正文在纸面上依然是上下居中的。
 */
export const PAGE_PAD_X = 48
export const PAGE_PAD_Y = 40

/** 相邻两栏之间的间隙。改它必须同步改 theme.ts 里的 column-gap，两处只能有一个来源 */
export const COLUMN_GAP = 48

/** 窗口窄到这个宽度以下：侧栏收成图标栏、字号降级（.uicraft.md 的自适应表） */
export const NARROW_WIDTH = 840
/** 窗口够宽就上对开双页（.uicraft.md 的自适应表） */
export const SPREAD_WIDTH = 1900
/** 窄窗口下的实际字号 */
export const NARROW_FONT_SIZE = 17
/** 版心宽的兜底下限，避免退化输入算出负数或 0 */
export const MIN_COLUMN_WIDTH = 120

export type ReaderLayout = {
  /** 一屏几栏 */
  columns: 1 | 2
  /** 单个版心宽（像素）——吃满正文区可用宽 */
  columnWidth: number
  /** 正文区总宽 = 一屏内所有栏加间隙 */
  frameWidth: number
  /** 一屏的高度 */
  pageHeight: number
  /** 翻一次页横向移动多少像素 */
  step: number
  /** 实际使用的字号 */
  fontSize: number
  /** 字号被降级了 */
  fontSizeClamped: boolean
}

/**
 * 按窗口宽度与正文区尺寸算出版式。
 *
 * 纯函数、不碰 DOM：版心吃满纸面可用宽；字号只影响 font-size，不参与算版心。
 *
 * 两个宽度分工不同，不能混用：
 * - windowWidth 决定 .uicraft.md 的自适应断点（对开、字号降级）—— 那一列说的是**窗口**；
 * - containerWidth 是正文区（纸面）的真实宽度，决定版心宽能分到多少。
 */
export function computeLayout(input: {
  windowWidth: number
  containerWidth: number
  containerHeight: number
  prefs: ReadingPrefs
}): ReaderLayout {
  const { windowWidth, containerWidth, containerHeight, prefs } = input

  const fontSizeClamped = windowWidth < NARROW_WIDTH && prefs.fontSize > NARROW_FONT_SIZE
  const fontSize = fontSizeClamped ? NARROW_FONT_SIZE : prefs.fontSize

  const columns: 1 | 2 = windowWidth >= SPREAD_WIDTH ? 2 : 1
  const pageHeight = Math.max(MIN_COLUMN_WIDTH, Math.round(containerHeight - PAGE_PAD_Y * 2))
  const textWidth = Math.max(MIN_COLUMN_WIDTH, Math.round(containerWidth - PAGE_PAD_X * 2))

  const columnWidth = Math.max(
    MIN_COLUMN_WIDTH,
    Math.floor((textWidth - COLUMN_GAP * (columns - 1)) / columns)
  )

  return {
    columns,
    columnWidth,
    // 必须反算回「正好 columns 栏」的宽度：给多了浏览器会自己多开一栏，页数就全错了
    frameWidth: (columnWidth + COLUMN_GAP) * columns - COLUMN_GAP,
    pageHeight,
    step: (columnWidth + COLUMN_GAP) * columns,
    fontSize,
    fontSizeClamped
  }
}

/**
 * 正文区至少要留多宽，AI 面板才不至于把阅读列挤没。
 * 与版心「吃满剩余」配套：面板先退到这个地板之上，正文拿剩下的全部宽度。
 */
export function minReadingAreaWidth(windowWidth: number): number {
  const columns = windowWidth >= SPREAD_WIDTH ? 2 : 1
  return PAGE_PAD_X * 2 + columns * MIN_COLUMN_WIDTH + COLUMN_GAP * (columns - 1)
}

/**
 * AI 面板当下能占的宽度区间。
 *
 * 上限不是写死的 720，而是「窗口扣掉壳层侧栏、再扣掉正文最小宽度」之后剩下的那一块：
 * 窗口够宽时上限就是 720，窗口不够宽时上限跟着变小。
 * 窄到连下限都放不下时上限就是下限，那种情况下正文只能被压到最小宽以下。
 */
export function aiPanelRange(input: {
  windowWidth: number
  shellSidebarWidth: number
}): { min: number; max: number } {
  const [min, cap] = PREFS_LIMITS.aiPanelWidth
  const room =
    input.windowWidth -
    input.shellSidebarWidth -
    SIDEBAR_BORDER -
    minReadingAreaWidth(input.windowWidth)
  return { min, max: Math.max(min, Math.min(cap, room)) }
}

/**
 * AI 面板的实际宽度。
 *
 * 偏好里存的是「用户拖出来的宽度」，也就是他想要多宽；这个函数把它夹进窗口当下给得起的
 * 区间里：在正文列保住最小宽度的前提下让面板尽量宽，最多到 720。
 */
export function computeAiPanelWidth(input: {
  windowWidth: number
  preferred: number
  shellSidebarWidth: number
}): number {
  const { min, max } = aiPanelRange(input)
  return Math.max(min, Math.min(max, input.preferred))
}
