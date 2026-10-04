import { describe, expect, it } from 'vitest'
import {
  RETRY_DELAY_MS,
  classifyError,
  isJsonModeRejection,
  shouldRetry
} from '../electron/main/ai/retry'

describe('classifyError', () => {
  it('401 → 配置问题，指向设置页', () => {
    const e = classifyError(401, '{"error":{"message":"Invalid API key"}}')
    expect(e.code).toBe('AI_AUTH')
    expect(e.action).toBe('openSettings')
    expect(e.message).toContain('密钥')
  })

  it('402 / 余额不足 → 配额问题', () => {
    expect(classifyError(402, '').code).toBe('AI_QUOTA')
    expect(classifyError(400, '{"error":{"message":"Insufficient Balance"}}').code).toBe('AI_QUOTA')
  })

  it('429 → 限流，可重试', () => {
    const e = classifyError(429, '')
    expect(e.code).toBe('AI_RATE_LIMIT')
    expect(e.action).toBe('retry')
  })

  it('5xx → 服务端问题，可重试', () => {
    expect(classifyError(503, '').action).toBe('retry')
  })

  it('400 → 参数问题，不可重试，不指向设置页', () => {
    const e = classifyError(400, '{"error":{"message":"model not found"}}')
    expect(e.code).toBe('AI_UNSUPPORTED')
    expect(e.action).toBe('none')
    expect(e.detail).toContain('model not found')
  })

  it('网络层错误 → OFFLINE，可重试', () => {
    const e = classifyError(null, '')
    expect(e.code).toBe('OFFLINE')
    expect(e.action).toBe('retry')
  })

  it('detail 里绝不出现 key', () => {
    const e = classifyError(401, '{"error":{"message":"bad key sk-abcdefghijklmnop3f7a"}}')
    expect(e.detail ?? '').not.toContain('sk-abcdefghijklmnop3f7a')
  })
})

describe('shouldRetry', () => {
  it('只重试一次', () => {
    expect(shouldRetry(classifyError(429, ''), 0)).toBe(true)
    expect(shouldRetry(classifyError(429, ''), 1)).toBe(false)
  })

  it('401 与 400 一次都不重试', () => {
    expect(shouldRetry(classifyError(401, ''), 0)).toBe(false)
    expect(shouldRetry(classifyError(400, ''), 0)).toBe(false)
  })

  it('退避 800ms', () => {
    expect(RETRY_DELAY_MS).toBe(800)
  })
})

describe('isJsonModeRejection', () => {
  it('这次要求了 JSON、服务商回 400 —— 是真的不接受结构化输出', () => {
    expect(isJsonModeRejection(classifyError(400, ''), true)).toBe(true)
  })

  it('这次本来就没要求 JSON —— 400 与结构化输出无关，不能记账', () => {
    expect(isJsonModeRejection(classifyError(400, ''), false)).toBe(false)
  })

  it('网络 / 限流 / 鉴权都不是「不支持」', () => {
    expect(isJsonModeRejection(classifyError(null, ''), true)).toBe(false)
    expect(isJsonModeRejection(classifyError(429, ''), true)).toBe(false)
    expect(isJsonModeRejection(classifyError(401, ''), true)).toBe(false)
  })
})