import { describe, expect, it } from 'vitest'
import { buildChatBody, buildEmbedBody } from '../electron/main/ai/params'

describe('buildChatBody', () => {
  it('夹取 max_tokens 与 temperature', () => {
    const body = buildChatBody('zhipu', 'glm-4-plus', {
      messages: [{ role: 'user', content: '你好' }],
      maxTokens: 99999,
      temperature: 5
    })
    expect(body.max_tokens).toBe(4095)
    expect(body.temperature).toBe(1)
  })

  it('jsonMode 为 true 时带 response_format，为 false 时彻底不带这个字段', () => {
    const withJson = buildChatBody('deepseek', 'deepseek-chat', {
      messages: [],
      json: true,
      maxTokens: 100
    })
    expect(withJson.response_format).toEqual({ type: 'json_object' })

    const noJson = buildChatBody('deepseek', 'deepseek-reasoner', {
      messages: [],
      json: true,
      maxTokens: 100
    })
    expect('response_format' in noJson).toBe(false)
  })

  it('不传 temperature 时不写这个字段，交给服务商默认值', () => {
    const body = buildChatBody('kimi', 'moonshot-v1-8k', { messages: [], maxTokens: 64 })
    expect('temperature' in body).toBe(false)
  })

  it('stream 为 true 时带上 stream_options，让服务商回传用量', () => {
    const body = buildChatBody('qwen', 'qwen-plus', { messages: [], maxTokens: 64, stream: true })
    expect(body.stream).toBe(true)
    expect(body.stream_options).toEqual({ include_usage: true })
  })

  it('模型不存在时抛错，而不是悄悄用别的模型', () => {
    expect(() => buildChatBody('kimi', 'gpt-4', { messages: [], maxTokens: 64 })).toThrow(/模型/)
  })
})

describe('buildEmbedBody', () => {
  it('按 embedBatch 分批', () => {
    const batches = buildEmbedBody('zhipu', Array.from({ length: 130 }, (_, i) => `第 ${i} 段`))
    expect(batches).toHaveLength(3)
    expect(batches[0]!.input).toHaveLength(64)
    expect(batches[2]!.input).toHaveLength(2)
  })

  it('不支持 embedding 的 provider 抛错', () => {
    expect(() => buildEmbedBody('deepseek', ['x'])).toThrow(/向量/)
  })
})