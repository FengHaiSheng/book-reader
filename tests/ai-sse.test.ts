import { describe, expect, it } from 'vitest'
import { SseDecoder } from '../electron/main/ai/sse'

describe('SseDecoder', () => {
  it('一个分片里有多条 data 行', () => {
    const decoder = new SseDecoder()
    const events = decoder.push('data: {"a":1}\n\ndata: {"a":2}\n\n')
    expect(events.map((e) => e.raw)).toEqual(['{"a":1}', '{"a":2}'])
  })

  it('半个 data 行跨分片时先攒着，不吐半截 JSON', () => {
    const decoder = new SseDecoder()
    expect(decoder.push('data: {"choi')).toEqual([])
    const events = decoder.push('ce":"月亮"}\n\n')
    expect(events).toHaveLength(1)
    expect(events[0]!.raw).toBe('{"choice":"月亮"}')
  })

  it('识别 [DONE] 标记', () => {
    const decoder = new SseDecoder()
    const events = decoder.push('data: [DONE]\n\n')
    expect(events[0]!.done).toBe(true)
  })

  it('忽略注释行与空行，容忍 CRLF', () => {
    const decoder = new SseDecoder()
    const events = decoder.push(': keep-alive\r\n\r\ndata: {"x":1}\r\n\r\n')
    expect(events).toHaveLength(1)
    expect(events[0]!.raw).toBe('{"x":1}')
  })
})