import type { Citation } from '@shared/types'

const MARKER = /\[(\d{1,3})\]/g

/** 回答里出现的引用编号，去重升序。不是数字的方括号（[附录]）不算。 */
export function extractMarkers(answer: string): number[] {
  const found = new Set<number>()
  for (const match of answer.matchAll(MARKER)) {
    found.add(Number(match[1]))
  }
  return [...found].sort((a, b) => a - b)
}

/**
 * 把回答里的编号映射回真实片段。
 *
 * 模型引用了一个不存在的编号（幻觉）时**整条丢掉**：宁可少一个上标，
 * 也不要给用户一个点下去跳不到任何地方的上标。
 */
export function usedCitations(answer: string, all: readonly Citation[]): Citation[] {
  const byIndex = new Map(all.map((citation) => [citation.index, citation]))
  return extractMarkers(answer)
    .map((index) => byIndex.get(index))
    .filter((citation): citation is Citation => citation !== undefined)
}

/** 回跳时用它在章节正文里匹配定位（spec §3.5 的前 30 字） */
export function excerptOf(text: string, length = 30): string {
  return text.replace(/\s+/g, '').slice(0, length)
}