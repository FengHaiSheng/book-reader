import { toMatchQuery } from '../epub/bigram'
import type { SearchHit } from '@shared/types'

/**
 * token 估算。
 *
 * 不引 tiktoken：它是按 BPE 表算的，四家服务商的表都不一样，算得再准也不等于
 * 计费的 token 数。这里只要一个**保守不超**的估计来做预算截断。
 */
export function estimateTokens(text: string): number {
  let cjk = 0
  let latin = 0
  for (const ch of text) {
    if (/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(ch)) cjk += 1
    else latin += 1
  }
  return cjk + Math.ceil(latin / 4)
}

/**
 * 以 needle 所在段为中心开窗。
 *
 * 这是「就这段话问」场景的主力：bigram 关键词召回在中文短句上偶尔会空手而归，
 * 而用户选中的话一定就在当前章节里，直接从正文开窗最可靠。
 */
export function windowFromText(text: string, needle: string, radius: number): string {
  const paragraphs = text.split(/\n+/)
  const cleaned = needle.replace(/\s+/g, '')
  const hit = paragraphs.findIndex((paragraph) => {
    const flat = paragraph.replace(/\s+/g, '')
    return cleaned !== '' && flat.includes(cleaned.slice(0, Math.min(12, cleaned.length)))
  })

  const center = hit === -1 ? 0 : hit
  const from = Math.max(0, center - radius)
  const to = Math.min(paragraphs.length, center + radius + 1)
  return paragraphs.slice(from, to).join('\n')
}

export type Passage = { index: number; headingPath: string; text: string }

export type FitResult = {
  kept: Passage[]
  /** 因为预算被丢掉了几段 —— 界面要明说「本次只送入了 N 段」 */
  dropped: number
}

/**
 * 按预算截断，**从尾部丢**。
 *
 * 召回结果是按相关度排序的（`searchChunks` 的 `ORDER BY f.score`，bm25 越小越相关），
 * 所以尾部就是最不相关的。丢头部会丢掉最该给模型看的东西。
 */
export function fitPassages(passages: readonly Passage[], budget: number): FitResult {
  const kept: Passage[] = []
  let used = 0
  for (const passage of passages) {
    // 每段固定开销取 20：标题行、引用标记与分隔符都会进提示词，只按正文估算会低估。
    const cost = estimateTokens(passage.text) + 20
    if (used + cost > budget) break
    used += cost
    kept.push(passage)
  }
  return { kept, dropped: passages.length - kept.length }
}

/**
 * 把检索命中转成带编号的片段。
 *
 * **编号必须从 1 连续**，因为提示词里 `[n]` 直接对应它，模型也会照抄这个数字。
 * 被预算丢掉的段要从映射表里一起删掉，否则会出现「回答里是 [3]、映射表里 [3] 是空」。
 */
export function toPassages(hits: readonly SearchHit[], startIndex = 1): Passage[] {
  return hits.map((hit, offset) => ({
    index: startIndex + offset,
    headingPath: hit.headingPath,
    text: hit.text
  }))
}

export { toMatchQuery }