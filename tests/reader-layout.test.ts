import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFS } from '../shared/types'
import {
  COLUMN_GAP,
  MIN_COLUMN_WIDTH,
  PAGE_PAD_X,
  PAGE_PAD_Y,
  computeAiPanelWidth,
  computeLayout,
  minReadingAreaWidth
} from '../src/features/reader/layout'

const prefs = { ...DEFAULT_PREFS }

describe('computeLayout', () => {
  it('宽窗口上对开双页，版心吃满正文区可用宽', () => {
    const layout = computeLayout({
      windowWidth: 2000,
      containerWidth: 1600,
      containerHeight: 900,
      prefs
    })
    const textWidth = 1600 - PAGE_PAD_X * 2
    const columnWidth = Math.floor((textWidth - COLUMN_GAP) / 2)
    expect(layout.columns).toBe(2)
    expect(layout.columnWidth).toBe(columnWidth)
    expect(layout.frameWidth).toBe(columnWidth * 2 + COLUMN_GAP)
    expect(layout.pageHeight).toBe(900 - 2 * PAGE_PAD_Y)
    expect(layout.step).toBe((columnWidth + COLUMN_GAP) * 2)
    expect(layout.fontSize).toBe(19)
    expect(layout.fontSizeClamped).toBe(false)
  })

  it('中等宽度是单栏，版心吃满正文区', () => {
    const layout = computeLayout({
      windowWidth: 1400,
      containerWidth: 1160,
      containerHeight: 800,
      prefs
    })
    expect(layout.columns).toBe(1)
    expect(layout.columnWidth).toBe(1160 - PAGE_PAD_X * 2)
    expect(layout.frameWidth).toBe(1160 - PAGE_PAD_X * 2)
    expect(layout.fontSizeClamped).toBe(false)
  })

  it('窄窗口只降字号，版心仍吃满可用宽', () => {
    const layout = computeLayout({
      windowWidth: 800,
      containerWidth: 600,
      containerHeight: 700,
      prefs
    })
    expect(layout.fontSize).toBe(17)
    expect(layout.fontSizeClamped).toBe(true)
    expect(layout.columnWidth).toBe(600 - PAGE_PAD_X * 2)
  })

  it('用户字号本来就小于等于降级值时不算降级', () => {
    const layout = computeLayout({
      windowWidth: 800,
      containerWidth: 600,
      containerHeight: 700,
      prefs: { ...prefs, fontSize: 16 }
    })
    expect(layout.fontSize).toBe(16)
    expect(layout.fontSizeClamped).toBe(false)
  })

  it('改字号不改变版心宽，改行距也不改变', () => {
    const base = computeLayout({
      windowWidth: 2000,
      containerWidth: 2000,
      containerHeight: 900,
      prefs
    })
    const big = computeLayout({
      windowWidth: 2000,
      containerWidth: 2000,
      containerHeight: 900,
      prefs: { ...prefs, fontSize: 32 }
    })
    expect(big.columnWidth).toBe(base.columnWidth)
    expect(big.fontSize).toBe(32)

    const loose = computeLayout({
      windowWidth: 2000,
      containerWidth: 2000,
      containerHeight: 900,
      prefs: { ...prefs, lineHeight: 2.2 }
    })
    expect(loose.columnWidth).toBe(base.columnWidth)
  })

  it('退化输入不崩，且给出版心下限', () => {
    const layout = computeLayout({ windowWidth: 1, containerWidth: 1, containerHeight: 1, prefs })
    expect(layout.columnWidth).toBe(MIN_COLUMN_WIDTH)
    expect('pages' in layout).toBe(false)
    expect(layout.pageHeight).toBe(MIN_COLUMN_WIDTH)
  })
})

describe('computeAiPanelWidth', () => {
  const width = (windowWidth: number, preferred = 720, shellSidebarWidth = 248): number =>
    computeAiPanelWidth({ windowWidth, preferred, shellSidebarWidth })

  it('窗口够宽就给到最大宽度 720', () => {
    expect(width(2560)).toBe(720)
  })

  it('正文只保留最小宽，面板可吃到上限', () => {
    // 1400：侧栏 248 + 最小正文 216 → 剩 935，够 720
    expect(width(1400)).toBe(720)
    const ai = width(1400)
    const layout = computeLayout({
      windowWidth: 1400,
      containerWidth: 1400 - 248 - 1 - ai,
      containerHeight: 800,
      prefs
    })
    expect(layout.columnWidth).toBe(1400 - 248 - 1 - ai - PAGE_PAD_X * 2)
  })

  it('阅读侧栏收起时面板仍可到上限', () => {
    expect(width(1400, 720, 56)).toBe(720)
  })

  it('窄到连下限都放不下时止步于下限', () => {
    // room = W - 248 - 1 - 216 < 320 → W < 785
    expect(width(780)).toBe(320)
  })

  it('用户拖窄过就尊重用户的值，不再自动撑开', () => {
    expect(width(2560, 400)).toBe(400)
  })

  it('最小正文宽随对开断点变宽', () => {
    expect(minReadingAreaWidth(1400)).toBe(PAGE_PAD_X * 2 + MIN_COLUMN_WIDTH)
    expect(minReadingAreaWidth(2000)).toBe(
      PAGE_PAD_X * 2 + MIN_COLUMN_WIDTH * 2 + COLUMN_GAP
    )
  })
})
