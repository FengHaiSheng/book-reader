import { describe, expect, it } from 'vitest'
import { maskKey } from '../electron/main/secrets/mask'

describe('maskKey', () => {
  it('保留前三后四，中间打码', () => {
    expect(maskKey('sk-abcdefghijklmnop3f7a')).toBe('sk-••••••••3f7a')
  })

  it('短 key 全部打码，不泄露片段', () => {
    expect(maskKey('sk-123456789')).toBe('••••••••••••')
  })

  it('去掉首尾空白后再处理', () => {
    expect(maskKey('  sk-abcdefghijklmnop3f7a  ')).toBe('sk-••••••••3f7a')
  })

  it('恰好 12 字符，仍在阈值内，全部打码', () => {
    expect(maskKey('sk-12345678a')).toBe('••••••••••••')
  })

  it('恰好 13 字符，跨过阈值，变为前3+8个•+后4', () => {
    expect(maskKey('sk-1234567890')).toBe('sk-••••••••7890')
  })

  it('空串返回空串，0 个•', () => {
    expect(maskKey('')).toBe('')
  })
})
