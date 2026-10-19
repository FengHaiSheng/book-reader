import { PREFS_LIMITS, type ReadingPrefs } from '@shared/types'

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
const MIN_COLUMN_WIDTH = 120

/**
 * 阅读器左栏（目录）宽度，与 base.css 里 `.toc` 的 `flex-basis` 一致，
 * 再加上它右侧那 1px 分隔线。算 AI 面板能占多少时要按它扣，改 CSS 必须同步改这里。
 */
export const TOC_WIDTH = 248
const TOC_BORDER = 1

export type ReaderLayout = {
  /** 一屏几栏 */
  columns: 1 | 2
  /** 单个版心宽（像素） */
  columnWidth: number
  /** 正文区总宽 = 一屏内所有栏加间隙 */
  frameWidth: number
  /** 一屏的高度 */
  pageHeight: number
  /** 翻一次页横向移动多少像素 */
  step: number
  /** 实际使用的字号 */
  fontSize: number
  /** 实际能放下的每行字数 */
  charsPerLine: number
  /** 用户设定的每行字数被窗口宽度压过了 —— 界面必须明说，不许静默降级 */
  clamped: boolean
  /** 字号被降级了 */
  fontSizeClamped: boolean
}

/**
 * 按窗口宽度与正文区尺寸算出版式。
 *
 * 纯函数、不碰 DOM：所有「窗口不够宽怎么办」的判断都在这里，界面只负责把
 * clamped / fontSizeClamped 显示出来。
 *
 * 两个宽度分工不同，不能混用：
 * - windowWidth 决定 .uicraft.md 的自适应断点（对开、字号降级）—— 那一列说的是**窗口**；
 * - containerWidth 是正文区（纸面）的真实宽度，决定版心宽能分到多少。
 *
 * 为什么必须分开：阅读器左栏占掉 248px，窗口 1900 时正文区只有 1652。
 * 若拿正文区去比 SPREAD_WIDTH，窗口再宽也上不了对开。
 */
export function computeLayout(input: {
  windowWidth: number
  containerWidth: number
  containerHeight: number
  prefs: ReadingPrefs
}): ReaderLayout {
  const { windowWidth, containerWidth, containerHeight, prefs } = input

  // 让位顺序（.uicraft.md）：对开 → 单栏 → 降字号
  const fontSizeClamped = windowWidth < NARROW_WIDTH && prefs.fontSize > NARROW_FONT_SIZE
  const fontSize = fontSizeClamped ? NARROW_FONT_SIZE : prefs.fontSize

  const columns: 1 | 2 = windowWidth >= SPREAD_WIDTH ? 2 : 1
  const pageHeight = Math.max(MIN_COLUMN_WIDTH, Math.round(containerHeight - PAGE_PAD_Y * 2))
  const textWidth = Math.max(MIN_COLUMN_WIDTH, Math.round(containerWidth - PAGE_PAD_X * 2))

  // 版心宽 = 每行字数 × 字号（中文一字宽约等于字号）
  const wanted = Math.round(prefs.charsPerLine * fontSize)
  const available = Math.floor((textWidth - COLUMN_GAP * (columns - 1)) / columns)
  const columnWidth = Math.max(MIN_COLUMN_WIDTH, Math.min(wanted, available))
  const charsPerLine = Math.floor(columnWidth / fontSize)

  return {
    columns,
    columnWidth,
    // 必须反算回「正好 columns 栏」的宽度：给多了浏览器会自己多开一栏，页数就全错了
    frameWidth: (columnWidth + COLUMN_GAP) * columns - COLUMN_GAP,
    pageHeight,
    step: (columnWidth + COLUMN_GAP) * columns,
    fontSize,
    charsPerLine,
    clamped: charsPerLine < prefs.charsPerLine,
    fontSizeClamped
  }
}

/**
 * 正文区至少要有多宽，设定的每行字数才不会被压窄（也就是 `computeLayout` 的 clamped 为假）。
 *
 * 与 `computeLayout` 反着算：它拿正文区宽度决定版心宽，这里拿想要的版心宽反推正文区。
 * 断点口径必须一致（都看窗口宽度），否则会和它算出来的结果对不上。
 */
export function readingAreaWidth(prefs: ReadingPrefs, windowWidth: number): number {
  const fontSize =
    windowWidth < NARROW_WIDTH ? Math.min(prefs.fontSize, NARROW_FONT_SIZE) : prefs.fontSize
  const columns = windowWidth >= SPREAD_WIDTH ? 2 : 1
  return PAGE_PAD_X * 2 + columns * prefs.charsPerLine * fontSize + COLUMN_GAP * (columns - 1)
}

/**
 * AI 面板当下能占的宽度区间。
 *
 * 上限不是写死的 720，而是「窗口扣掉目录栏、再扣掉正文所需宽度」之后剩下的那一块：
 * 窗口够宽时上限就是 720（面板吃满自己的最大宽度），窗口不够宽时上限跟着变小，
 * 正文列始终不被压窄 —— 面板先退让，正文优先（.uicraft.md 的自适应策略第一条）。
 * 窄到连下限都放不下时上限就是下限，那种情况下正文只能被压窄，界面按硬规则 2 明说。
 */
export function aiPanelRange(input: {
  windowWidth: number
  prefs: ReadingPrefs
}): { min: number; max: number } {
  const [min, cap] = PREFS_LIMITS.aiPanelWidth
  const room =
    input.windowWidth - TOC_WIDTH - TOC_BORDER - readingAreaWidth(input.prefs, input.windowWidth)
  return { min, max: Math.max(min, Math.min(cap, room)) }
}

/**
 * AI 面板的实际宽度。
 *
 * 偏好里存的是「用户拖出来的宽度」，也就是他想要多宽；这个函数把它夹进窗口当下给得起的
 * 区间里：在正文列不被压窄的前提下让面板尽量宽，最多到 720。
 */
export function computeAiPanelWidth(input: {
  windowWidth: number
  prefs: ReadingPrefs
  preferred: number
}): number {
  const { min, max } = aiPanelRange(input)
  return Math.max(min, Math.min(max, input.preferred))
}
