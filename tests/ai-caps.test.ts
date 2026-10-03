import { describe, expect, it } from 'vitest'
import {
  AI_TASKS,
  CAPABILITY_LABELS,
  PROMPT_VERSION,
  PROVIDER_AI,
  clampTemperature,
  hasCapability,
  modelsFor
} from '../shared/ai'
import { PROVIDERS } from '../shared/types'

describe('能力声明', () => {
  it('四家 provider 都有声明，且 baseURL 与 shared/types.ts 里的 PROVIDERS 一致', () => {
    for (const provider of PROVIDERS) {
      const declared = PROVIDER_AI[provider.id]
      expect(declared, provider.id).toBeTruthy()
      expect(declared.baseURL).toBe(provider.baseURL)
    }
  })

  it('每家都至少有一个模型，且 id 不重复', () => {
    for (const provider of PROVIDERS) {
      const models = modelsFor(provider.id)
      expect(models.length, provider.id).toBeGreaterThan(0)
      expect(new Set(models.map((m) => m.id)).size).toBe(models.length)
    }
  })

  it('能力表的每一行都能在四家声明上读出「支持 / 不支持」', () => {
    for (const row of CAPABILITY_LABELS) {
      for (const provider of PROVIDERS) {
        expect(typeof hasCapability(provider.id, row.key)).toBe('boolean')
      }
    }
  })

  it('声明了 embed 的就必须有 embedModel 与 embedDim', () => {
    for (const provider of PROVIDERS) {
      const caps = PROVIDER_AI[provider.id]
      if (caps.embed) {
        expect(caps.embedModel, provider.id).toBeTruthy()
        expect(caps.embedDim, provider.id).toBeGreaterThan(0)
      }
    }
  })

  it('DeepSeek 与 Kimi 不提供 embedding —— 这是降级路径要覆盖的真实情况', () => {
    expect(PROVIDER_AI.deepseek.embed).toBe(false)
    expect(PROVIDER_AI.kimi.embed).toBe(false)
  })

  it('温度夹取到各家允许的区间', () => {
    expect(clampTemperature('zhipu', 1.8)).toBe(1)
    expect(clampTemperature('deepseek', 1.8)).toBe(1.8)
    expect(clampTemperature('kimi', -1)).toBe(0)
  })

  it('任务枚举与提示词版本是稳定字符串', () => {
    expect(AI_TASKS).toContain('chapterSummary')
    expect(AI_TASKS).toContain('bookDigest')
    expect(PROMPT_VERSION).toMatch(/^v\d+$/)
  })
})