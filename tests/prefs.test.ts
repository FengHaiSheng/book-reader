import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFS, applyPrefsPatch, clampPrefs } from '../shared/types'

describe('clampPrefs', () => {
  it('把越界值夹回范围', () => {
    expect(clampPrefs({ fontSize: 99 }).fontSize).toBe(32)
    expect(clampPrefs({ fontSize: 2 }).fontSize).toBe(15)
    expect(clampPrefs({ lineHeight: 9 }).lineHeight).toBe(2.2)
    expect(clampPrefs({ lineHeight: 0.1 }).lineHeight).toBe(1.5)
    expect(clampPrefs({ aiPanelWidth: 9999 }).aiPanelWidth).toBe(720)
    expect(clampPrefs({ aiPanelWidth: 100 }).aiPanelWidth).toBe(320)
  })

  it('坏值与缺省值回落到默认；旧 prefs 里的每行字数被丢弃', () => {
    expect(clampPrefs({})).toEqual(DEFAULT_PREFS)
    expect(clampPrefs({ font: 'mono' as never }).font).toBe('serif')
    expect(clampPrefs({ theme: 'sepia' as never }).theme).toBe('light')
    expect(clampPrefs({ fontSize: Number.NaN }).fontSize).toBe(DEFAULT_PREFS.fontSize)
    expect(clampPrefs({ lineHeight: '1.85' as never }).lineHeight).toBe(DEFAULT_PREFS.lineHeight)
    expect(clampPrefs({ charsPerLine: 40 } as never)).toEqual(DEFAULT_PREFS)
  })

  it('合法值原样保留', () => {
    const wanted = {
      font: 'sans',
      fontSize: 21,
      lineHeight: 2,
      theme: 'dark',
      aiPanelWidth: 480
    } as const
    expect(clampPrefs(wanted)).toEqual(wanted)
  })
})

describe('applyPrefsPatch', () => {
  it('只改补丁里的字段，其余保留现有值', () => {
    const current = {
      font: 'sans' as const,
      fontSize: 22,
      lineHeight: 2,
      theme: 'dark' as const,
      aiPanelWidth: 480
    }
    expect(applyPrefsPatch(current, { fontSize: 18 })).toEqual({
      ...current,
      fontSize: 18
    })
    expect(applyPrefsPatch(current, { lineHeight: 1.6 })).toEqual({
      ...current,
      lineHeight: 1.6
    })
  })

  it('补丁里的越界值仍被夹取', () => {
    expect(applyPrefsPatch(DEFAULT_PREFS, { fontSize: 99 }).fontSize).toBe(32)
  })
})
