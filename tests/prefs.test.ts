import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFS, clampPrefs } from '../shared/types'

describe('clampPrefs', () => {
  it('把越界值夹回范围', () => {
    expect(clampPrefs({ charsPerLine: 200 }).charsPerLine).toBe(48)
    expect(clampPrefs({ charsPerLine: 3 }).charsPerLine).toBe(24)
    expect(clampPrefs({ fontSize: 99 }).fontSize).toBe(24)
    expect(clampPrefs({ fontSize: 2 }).fontSize).toBe(15)
    expect(clampPrefs({ lineHeight: 9 }).lineHeight).toBe(2.2)
    expect(clampPrefs({ lineHeight: 0.1 }).lineHeight).toBe(1.5)
    expect(clampPrefs({ aiPanelWidth: 9999 }).aiPanelWidth).toBe(720)
    expect(clampPrefs({ aiPanelWidth: 100 }).aiPanelWidth).toBe(320)
  })

  it('坏值与缺省值回落到默认', () => {
    expect(clampPrefs({})).toEqual(DEFAULT_PREFS)
    expect(clampPrefs({ font: 'mono' as never }).font).toBe('serif')
    expect(clampPrefs({ theme: 'sepia' as never }).theme).toBe('light')
    expect(clampPrefs({ fontSize: Number.NaN }).fontSize).toBe(DEFAULT_PREFS.fontSize)
    expect(clampPrefs({ charsPerLine: '34' as never }).charsPerLine).toBe(DEFAULT_PREFS.charsPerLine)
  })

  it('合法值原样保留', () => {
    const wanted = {
      font: 'sans',
      fontSize: 21,
      charsPerLine: 40,
      lineHeight: 2,
      theme: 'dark',
      aiPanelWidth: 480
    } as const
    expect(clampPrefs(wanted)).toEqual(wanted)
  })
})
