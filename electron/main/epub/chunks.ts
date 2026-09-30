import type { ChunkDraft } from './types'

/** 目标区间。切到超过 MAX 就断开，所以每块不会大于 MAX；实际多落在 400–600 之间。 */
const MIN_TOKENS = 400
const MAX_TOKENS = 600

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/

/** 中文按字、拉丁按词估算 token。够用即可，这里不需要真的分词器。 */
export function estimateTokens(text: string): number {
  let count = 0
  let inWord = false
  for (const ch of text) {
    if (CJK.test(ch)) {
      count += 1
      inWord = false
    } else if (/[a-zA-Z0-9]/.test(ch)) {
      if (!inWord) count += 1
      inWord = true
    } else {
      inWord = false
    }
  }
  return count
}

/** 按行切段；单段超过 maxTokens 时按句读硬切，保证后续聚合一定收敛。 */
export function splitParagraphs(text: string, maxTokens = MAX_TOKENS): string[] {
  const raw = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  const out: string[] = []
  for (const paragraph of raw) {
    if (estimateTokens(paragraph) <= maxTokens) {
      out.push(paragraph)
      continue
    }
    out.push(...hardSplit(paragraph, maxTokens))
  }
  return out
}

function hardSplit(paragraph: string, maxTokens: number): string[] {
  const sentences = paragraph.split(/(?<=[。！？!?；;])/)
  const out: string[] = []
  let current = ''
  for (const sentence of sentences) {
    if (current && estimateTokens(current + sentence) > maxTokens) {
      out.push(current)
      current = ''
    }
    if (estimateTokens(sentence) > maxTokens) {
      if (current) {
        out.push(current)
        current = ''
      }
      for (let i = 0; i < sentence.length; i += maxTokens) {
        out.push(sentence.slice(i, i + maxTokens))
      }
      continue
    }
    current += sentence
  }
  if (current) out.push(current)
  return out
}

/**
 * 段落聚合成分块。切块时把上一块的最后一段带进新块，作为段间重叠——
 * 检索命中时才有上下文可用。
 */
export function buildChunks(text: string, opts?: { minTokens?: number; maxTokens?: number }): ChunkDraft[] {
  const maxTokens = opts?.maxTokens ?? MAX_TOKENS
  const paragraphs = splitParagraphs(text, maxTokens)
  if (paragraphs.length === 0) return []

  const chunks: ChunkDraft[] = []
  let current: string[] = []
  let currentTokens = 0

  const flush = (): void => {
    if (current.length === 0) return
    chunks.push({
      orderIndex: chunks.length,
      text: current.join('\n'),
      tokenCount: currentTokens
    })
  }

  for (const paragraph of paragraphs) {
    const tokens = estimateTokens(paragraph)
    if (current.length > 0 && currentTokens + tokens > maxTokens) {
      flush()
      const overlap = current[current.length - 1]!
      const overlapTokens = estimateTokens(overlap)
      if (overlapTokens + tokens <= maxTokens) {
        current = [overlap]
        currentTokens = overlapTokens
      } else {
        current = []
        currentTokens = 0
      }
    }
    current.push(paragraph)
    currentTokens += tokens
  }

  flush()
  return chunks
}

export { MIN_TOKENS }
