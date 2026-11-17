import { describe, expect, it } from 'vitest'
import {
  normalizeEndpoint,
  normalizeTtsRequest,
  normalizeTtsVoices,
  parseHealthPayload,
  pickCacheVictims,
  ttsCacheKey,
  TTS_CACHE_LIMIT_BYTES
} from '../electron/main/tts/format'

describe('normalizeEndpoint', () => {
  it('保留 http(s)，去掉尾部斜杠', () => {
    expect(normalizeEndpoint(' http://127.0.0.1:8000/ ')).toBe('http://127.0.0.1:8000')
    expect(normalizeEndpoint('https://voice.local//')).toBe('https://voice.local')
  })

  it('拒绝空值、坏地址与其它协议', () => {
    expect(normalizeEndpoint('')).toBeNull()
    expect(normalizeEndpoint('不是地址')).toBeNull()
    expect(normalizeEndpoint('ftp://voice.local')).toBeNull()
    expect(normalizeEndpoint(42)).toBeNull()
  })
})

describe('normalizeTtsRequest', () => {
  it('去文本首尾空白、夹取语速、限制音色长度', () => {
    const request = normalizeTtsRequest({
      endpoint: 'http://127.0.0.1:8000',
      text: '  你好。  ',
      voice: ` ${'v'.repeat(300)} `,
      rate: 9
    })
    expect(request).toEqual({
      endpoint: 'http://127.0.0.1:8000',
      text: '你好。',
      voice: 'v'.repeat(100),
      rate: 2
    })
  })

  it('空文本与过长文本直接拒绝', () => {
    const base = { endpoint: 'http://127.0.0.1:8000', voice: '', rate: 1 }
    expect(normalizeTtsRequest({ ...base, text: '   ' })).toBeNull()
    expect(normalizeTtsRequest({ ...base, text: '字'.repeat(401) })).toBeNull()
  })
})

describe('ttsCacheKey', () => {
  const base = {
    endpoint: 'http://127.0.0.1:8000',
    text: '同一句话。',
    voice: 'default',
    rate: 1
  }

  it('相同请求得到相同键', () => {
    expect(ttsCacheKey(base)).toBe(ttsCacheKey({ ...base }))
  })

  it('换服务、音色、语速或原文都会换键', () => {
    const key = ttsCacheKey(base)
    expect(ttsCacheKey({ ...base, endpoint: 'http://127.0.0.1:9000' })).not.toBe(key)
    expect(ttsCacheKey({ ...base, voice: 'other' })).not.toBe(key)
    expect(ttsCacheKey({ ...base, rate: 1.2 })).not.toBe(key)
    expect(ttsCacheKey({ ...base, text: '另一句。' })).not.toBe(key)
  })
})

describe('normalizeTtsVoices', () => {
  it('兼容字符串、对象与 id/voice 两种字段名', () => {
    expect(normalizeTtsVoices(['xiaochun'])).toEqual([
      { id: 'xiaochun', name: 'xiaochun', lang: '' }
    ])
    expect(
      normalizeTtsVoices([
        { id: 'cosy', name: '晓春', lang: 'zh-CN' },
        { voice: 'legacy' },
        { name: '没有 id' },
        42
      ])
    ).toEqual([
      { id: 'cosy', name: '晓春', lang: 'zh-CN' },
      { id: 'legacy', name: 'legacy', lang: '' }
    ])
  })

  it('最多保留 200 个音色', () => {
    const many = Array.from({ length: 260 }, (_, index) => `voice-${index}`)
    expect(normalizeTtsVoices(many)).toHaveLength(200)
  })
})

describe('parseHealthPayload', () => {
  it('接受数组或 {voices}', () => {
    expect(parseHealthPayload(['a'])).toEqual([{ id: 'a', name: 'a', lang: '' }])
    expect(parseHealthPayload({ voices: ['b'] })).toEqual([{ id: 'b', name: 'b', lang: '' }])
  })

  it('ok:false 与坏结构返回 null', () => {
    expect(parseHealthPayload({ ok: false, voices: ['a'] })).toBeNull()
    expect(parseHealthPayload('nope')).toBeNull()
    expect(parseHealthPayload(null)).toBeNull()
  })
})

describe('pickCacheVictims', () => {
  const entry = (name: string, size: number, mtimeMs: number) => ({ name, size, mtimeMs })

  it('未超上限时不删', () => {
    expect(pickCacheVictims([entry('a', 10, 1), entry('b', 10, 2)], 100)).toEqual([])
  })

  it('超上限时先删最旧的文件，直到回到上限内', () => {
    const entries = [
      entry('new', 40, 3),
      entry('old', 40, 1),
      entry('mid', 40, 2)
    ]
    expect(pickCacheVictims(entries, TTS_CACHE_LIMIT_BYTES)).toEqual([])
    expect(pickCacheVictims(entries, 90)).toEqual(['old'])
    expect(pickCacheVictims(entries, 50)).toEqual(['old', 'mid'])
  })
})
