import { describe, expect, it } from 'vitest'
import { appError, toAppError } from '../shared/errors'

describe('toAppError', () => {
  it('已经是 AppError 时原样返回', () => {
    const original = appError('AI_AUTH', '密钥无效', { action: 'openSettings' })
    expect(toAppError(original)).toBe(original)
  })

  it('把原生 Error 转成带 detail 的 UNKNOWN', () => {
    const result = toAppError(new TypeError('boom'), '读取失败')
    expect(result.code).toBe('UNKNOWN')
    expect(result.message).toBe('读取失败')
    expect(result.detail).toBe('TypeError: boom')
    expect(result.action).toBe('none')
  })

  it('把非 Error 抛出物也转成字符串 detail', () => {
    expect(toAppError('oops').detail).toBe('oops')
  })
})
