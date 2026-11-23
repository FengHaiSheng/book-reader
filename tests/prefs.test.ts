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
    expect(clampPrefs({ ttsRate: 9 }).ttsRate).toBe(2)
    expect(clampPrefs({ ttsRate: 0.1 }).ttsRate).toBe(0.5)
    expect(clampPrefs({ ttsSampleRate: 90000 }).ttsSampleRate).toBe(48000)
    expect(clampPrefs({ ttsSampleRate: 100 }).ttsSampleRate).toBe(16000)
  })

  it('坏值与缺省值回落到默认；旧 prefs 里的每行字数被丢弃', () => {
    expect(clampPrefs({})).toEqual(DEFAULT_PREFS)
    expect(clampPrefs({ font: 'mono' as never }).font).toBe('serif')
    expect(clampPrefs({ theme: 'sepia' as never }).theme).toBe('light')
    expect(clampPrefs({ fontSize: Number.NaN }).fontSize).toBe(DEFAULT_PREFS.fontSize)
    expect(clampPrefs({ lineHeight: '1.85' as never }).lineHeight).toBe(DEFAULT_PREFS.lineHeight)
    expect(clampPrefs({ charsPerLine: 40 } as never)).toEqual(DEFAULT_PREFS)
    expect(clampPrefs({ ttsVoice: 7 as never }).ttsVoice).toBe('')
    expect(clampPrefs({ ttsRate: Number.NaN }).ttsRate).toBe(DEFAULT_PREFS.ttsRate)
    expect(clampPrefs({ ttsEngine: 'cloud' as never }).ttsEngine).toBe('system')
    expect(clampPrefs({ ttsServerVoice: 7 as never }).ttsServerVoice).toBe('')
    expect(clampPrefs({ ttsApi: 'grpc' as never }).ttsApi).toBe('simple')
    expect(clampPrefs({ ttsSampleRate: Number.NaN }).ttsSampleRate).toBe(
      DEFAULT_PREFS.ttsSampleRate
    )
  })

  it('服务地址只接受 http(s)，并去掉尾部斜杠', () => {
    expect(clampPrefs({ ttsEndpoint: 'http://127.0.0.1:8000/' }).ttsEndpoint).toBe(
      'http://127.0.0.1:8000'
    )
    expect(clampPrefs({ ttsEndpoint: 'https://voice.local' }).ttsEndpoint).toBe(
      'https://voice.local'
    )
    expect(clampPrefs({ ttsEndpoint: 'ftp://voice.local' }).ttsEndpoint).toBe(
      DEFAULT_PREFS.ttsEndpoint
    )
    expect(clampPrefs({ ttsEndpoint: '不是地址' }).ttsEndpoint).toBe(DEFAULT_PREFS.ttsEndpoint)
    expect(clampPrefs({ ttsEndpoint: '' }).ttsEndpoint).toBe(DEFAULT_PREFS.ttsEndpoint)
  })

  it('音色标识去首尾空白并限长', () => {
    expect(clampPrefs({ ttsVoice: '  com.apple.voice  ' }).ttsVoice).toBe('com.apple.voice')
    expect(clampPrefs({ ttsVoice: 'v'.repeat(300) }).ttsVoice).toHaveLength(200)
  })

  it('合法值原样保留', () => {
    const wanted = {
      font: 'sans',
      fontSize: 21,
      lineHeight: 2,
      theme: 'dark',
      aiPanelWidth: 480,
      ttsVoice: 'com.apple.voice.compact.zh-CN.Tingting',
      ttsRate: 1.2,
      ttsEngine: 'http',
      ttsEndpoint: 'http://127.0.0.1:8000',
      ttsServerVoice: 'cosy-default',
      ttsApi: 'cosyvoice',
      ttsSampleRate: 22050
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
      aiPanelWidth: 480,
      ttsVoice: '',
      ttsRate: 1,
      ttsEngine: 'system' as const,
      ttsEndpoint: 'http://127.0.0.1:8000',
      ttsServerVoice: '',
      ttsApi: 'simple' as const,
      ttsSampleRate: 24000
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
    expect(applyPrefsPatch(DEFAULT_PREFS, { ttsRate: 9 }).ttsRate).toBe(2)
  })
})
