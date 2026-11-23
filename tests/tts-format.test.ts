import { describe, expect, it } from 'vitest'
import {
  isWav,
  normalizeEndpoint,
  normalizeTtsRequest,
  normalizeTtsVoices,
  openApiHasInference,
  parseHealthPayload,
  pcm16ToWav,
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
      api: 'simple',
      sampleRate: 24000,
      text: '你好。',
      voice: 'v'.repeat(100),
      rate: 2
    })
  })

  it('保留官方模式与采样率，并夹进 16k–48k', () => {
    const request = normalizeTtsRequest({
      endpoint: 'http://127.0.0.1:50000',
      api: 'cosyvoice',
      sampleRate: 22050,
      text: '你好。',
      voice: '',
      rate: 1
    })
    expect(request).toMatchObject({ api: 'cosyvoice', sampleRate: 22050 })

    expect(
      normalizeTtsRequest({
        endpoint: 'http://127.0.0.1:50000',
        api: 'cosyvoice',
        sampleRate: 90000,
        text: '你好。',
        voice: '',
        rate: 1
      })?.sampleRate
    ).toBe(48000)
    expect(
      normalizeTtsRequest({
        endpoint: 'http://127.0.0.1:50000',
        api: 'cosyvoice',
        sampleRate: Number.NaN,
        text: '你好。',
        voice: '',
        rate: 1
      })?.sampleRate
    ).toBe(24000)
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
    api: 'simple' as const,
    sampleRate: 24000,
    text: '同一句话。',
    voice: 'default',
    rate: 1
  }

  it('相同请求得到相同键', () => {
    expect(ttsCacheKey(base)).toBe(ttsCacheKey({ ...base }))
  })

  it('换服务、接口、音色、语速或原文都会换键', () => {
    const key = ttsCacheKey(base)
    expect(ttsCacheKey({ ...base, endpoint: 'http://127.0.0.1:9000' })).not.toBe(key)
    expect(ttsCacheKey({ ...base, api: 'cosyvoice' })).not.toBe(key)
    expect(ttsCacheKey({ ...base, voice: 'other' })).not.toBe(key)
    expect(ttsCacheKey({ ...base, rate: 1.2 })).not.toBe(key)
    expect(ttsCacheKey({ ...base, text: '另一句。' })).not.toBe(key)
  })

  it('官方模式下采样率不同就是不同的音频；通用模式忽略它', () => {
    const official = { ...base, api: 'cosyvoice' as const }
    expect(ttsCacheKey({ ...official, sampleRate: 22050 })).not.toBe(
      ttsCacheKey({ ...official, sampleRate: 24000 })
    )
    expect(ttsCacheKey({ ...base, sampleRate: 22050 })).toBe(ttsCacheKey(base))
  })
})

describe('pcm16ToWav', () => {
  it('给裸 PCM 补 44 字节 WAV 头，采样率与长度都对得上', () => {
    const pcm = new Uint8Array(320)
    for (let index = 0; index < pcm.length; index += 1) pcm[index] = index % 256

    const wav = pcm16ToWav(pcm, 22050)
    const view = new DataView(wav.buffer)
    expect(isWav(wav)).toBe(true)
    expect(wav.byteLength).toBe(44 + 320)
    expect(view.getUint32(4, true)).toBe(36 + 320)
    expect(view.getUint16(20, true)).toBe(1)
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(22050)
    expect(view.getUint32(28, true)).toBe(22050 * 2)
    expect(view.getUint16(34, true)).toBe(16)
    expect(view.getUint32(40, true)).toBe(320)
    expect(Array.from(wav.subarray(44, 48))).toEqual([0, 1, 2, 3])
  })

  it('已经是 WAV 时原样透传', () => {
    const wav = pcm16ToWav(new Uint8Array(100), 24000)
    expect(pcm16ToWav(wav, 24000)).toBe(wav)
  })

  it('丢掉尾部多余的半个样本，data 长度保持偶数', () => {
    const wav = pcm16ToWav(new Uint8Array(101), 24000)
    expect(new DataView(wav.buffer).getUint32(40, true)).toBe(100)
    expect(wav.byteLength).toBe(44 + 100)
  })
})

describe('openApiHasInference', () => {
  it('官方 FastAPI 的 paths 里有 /inference_sft 时通过', () => {
    expect(openApiHasInference({ paths: { '/inference_sft': { post: {} } } })).toBe(true)
    expect(
      openApiHasInference({
        paths: { '/inference_zero_shot': {}, '/inference_cross_lingual': {} }
      })
    ).toBe(true)
  })

  it('没有推理路由或结构不对时拒绝', () => {
    expect(openApiHasInference({ paths: { '/health': {}, '/tts': {} } })).toBe(false)
    expect(openApiHasInference({ paths: {} })).toBe(false)
    expect(openApiHasInference({ openapi: '3.0.2' })).toBe(false)
    expect(openApiHasInference('nope')).toBe(false)
    expect(openApiHasInference(null)).toBe(false)
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
