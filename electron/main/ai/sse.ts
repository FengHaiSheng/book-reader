export type SseEvent = { raw: string; done: boolean }

/**
 * SSE 分片解码器。
 *
 * `fetch` 的 body 分片边界与 SSE 的事件边界毫无关系：一个 `data:` 行完全可能
 * 被切成两半。所以必须自己攒缓冲，只在见到空行（事件分隔符）时才吐事件。
 */
export class SseDecoder {
  private buffer = ''

  push(chunk: string): SseEvent[] {
    this.buffer += chunk
    const events: SseEvent[] = []

    // 事件之间以空行分隔；CRLF 与 LF 都要认
    let index = this.buffer.search(/\r?\n\r?\n/)
    while (index !== -1) {
      const block = this.buffer.slice(0, index)
      const rest = this.buffer.slice(index)
      const match = rest.match(/^\r?\n\r?\n/)
      this.buffer = this.buffer.slice(index + (match ? match[0].length : 2))

      const dataLines = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())

      if (dataLines.length > 0) {
        const raw = dataLines.join('\n')
        events.push({ raw, done: raw.trim() === '[DONE]' })
      }

      index = this.buffer.search(/\r?\n\r?\n/)
    }

    return events
  }

  /** 流结束时把残留缓冲吐出来，避免最后一个事件刚好没有尾随空行时被丢掉 */
  flush(): SseEvent[] {
    if (this.buffer.trim() === '') {
      this.buffer = ''
      return []
    }
    const block = this.buffer
    this.buffer = ''
    const dataLines = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
    if (dataLines.length === 0) return []
    const raw = dataLines.join('\n')
    return [{ raw, done: raw.trim() === '[DONE]' }]
  }
}

/** 从一条 SSE 事件里取正文增量。取不到（心跳、用量帧）就返回空串。 */
export function deltaOf(raw: string): { text: string; usage: Usage | null } {
  const usage: Usage | null = null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { text: '', usage }
  }
  if (typeof parsed !== 'object' || parsed === null) return { text: '', usage }

  const frame = parsed as {
    choices?: { delta?: { content?: string }; finish_reason?: string | null }[]
    usage?: { prompt_tokens?: number; completion_tokens?: number } | null
  }

  const text = frame.choices?.[0]?.delta?.content ?? ''
  if (frame.usage) {
    return {
      text,
      usage: {
        inputTokens: frame.usage.prompt_tokens ?? 0,
        outputTokens: frame.usage.completion_tokens ?? 0
      }
    }
  }
  return { text, usage }
}

export type Usage = { inputTokens: number; outputTokens: number }