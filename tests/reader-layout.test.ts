import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFS } from '../shared/types'
import {
  COLUMN_GAP,
  PAGE_PAD_Y,
  computeAiPanelWidth,
  computeLayout
} from '../src/features/reader/layout'

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

describe('computeAiPanelWidth', () => {
  const width = (windowWidth: number, preferred = 720): number =>
    computeAiPanelWidth({ windowWidth, prefs, preferred })

  it('窗口够宽就给到最大宽度 720', () => {
    // 2560：目录 248 + 对开正文（96 + 646×2 + 48 = 1436）之后还剩 875，够 720
    expect(width(2560)).toBe(720)
  })

  it('窗口不够宽就先把面板收窄，正文列保持每行字数', () => {
    // 1400：目录 248 + 单栏正文（96 + 646 = 742）之后只剩 409
    expect(width(1400)).toBe(409)
    // 面板正好占掉纸面的富余宽度，正文区仍是满版心
    const layout = computeLayout({
      windowWidth: 1400,
      containerWidth: 1400 - 248 - 1 - 409,
      containerHeight: 800,
      prefs
    })
    expect(layout.charsPerLine).toBe(34)
    expect(layout.clamped).toBe(false)
  })

  it('窄到连下限都放不下时止步于下限，正文被压窄由界面明说', () => {
    expect(width(1280)).toBe(320)
  })

  it('用户拖窄过就尊重用户的值，不再自动撑开', () => {
    expect(width(2560, 400)).toBe(400)
  })
})
