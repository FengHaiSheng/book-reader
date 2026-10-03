import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFS } from '../shared/types'
import { COLUMN_GAP, PAGE_PAD_Y, computeLayout } from '../src/features/reader/layout'

const prefs = { ...DEFAULT_PREFS }

describe('computeLayout', () => {
  it('宽窗口上对开双页，版心宽 = 每行字数 × 字号', () => {
    const layout = computeLayout({
      windowWidth: 2000,
      containerWidth: 1600,
      containerHeight: 900,
      prefs
    })
    expect(layout.columns).toBe(2)
    expect(layout.columnWidth).toBe(34 * 19)
    expect(layout.frameWidth).toBe(646 * 2 + COLUMN_GAP)
    expect(layout.pageHeight).toBe(900 - 2 * PAGE_PAD_Y)
    expect(layout.step).toBe((646 + COLUMN_GAP) * 2)
    expect(layout.charsPerLine).toBe(34)
    expect(layout.clamped).toBe(false)
    expect(layout.fontSizeClamped).toBe(false)
  })

  it('中等宽度是单栏，多余宽度留在纸面上而不是拉长行宽', () => {
    // 窗口 1400（< SPREAD_WIDTH 1900）但正文区有 1160 —— 对开与否看窗口，不看正文区
    const layout = computeLayout({
      windowWidth: 1400,
      containerWidth: 1160,
      containerHeight: 800,
      prefs
    })
    expect(layout.columns).toBe(1)
    expect(layout.columnWidth).toBe(646)
    expect(layout.frameWidth).toBe(646)
    expect(layout.clamped).toBe(false)
    expect(layout.fontSizeClamped).toBe(false)
  })

  it('窄窗口压行宽，clamped 为真，界面据此明说降级', () => {
    // 600 - 96 = 504 可用；504 / 17 = 29 字 < 设定 34 字
    const layout = computeLayout({
      windowWidth: 800,
      containerWidth: 600,
      containerHeight: 700,
      prefs
    })
    expect(layout.fontSize).toBe(17)
    expect(layout.fontSizeClamped).toBe(true)
    expect(layout.charsPerLine).toBe(29)
    expect(layout.clamped).toBe(true)
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

  it('改字号会改变版心宽，改行距不会', () => {
    const big = computeLayout({
      windowWidth: 2000,
      containerWidth: 2000,
      containerHeight: 900,
      prefs: { ...prefs, fontSize: 24 }
    })
    expect(big.columnWidth).toBe(34 * 24)
    expect(big.charsPerLine).toBe(34)

    const loose = computeLayout({
      windowWidth: 2000,
      containerWidth: 2000,
      containerHeight: 900,
      prefs: { ...prefs, lineHeight: 2.2 }
    })
    expect(loose.columnWidth).toBe(646)
  })

  it('退化输入不崩，且给出版心下限', () => {
    const layout = computeLayout({ windowWidth: 1, containerWidth: 1, containerHeight: 1, prefs })
    expect(layout.columnWidth).toBe(120)
    expect('pages' in layout).toBe(false) // 页数由分页器量出来，不在这里算
    expect(layout.pageHeight).toBe(120)
  })
})
