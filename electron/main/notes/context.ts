export type ContextSlice = {
  before: string
  matched: string
  after: string
}

/** 命中处前后各取 160 字，大约是两三句，够判断这条笔记要不要留 */
export const CONTEXT_RADIUS = 160

export type Span = { start: number; end: number }

/**
 * 在章节正文里找一段选中的文字，返回它在正文里的真实坐标。
 *
 * 为什么不直接 `indexOf`：用户选中的文本跨段时带换行与缩进，与正文里的排布不完全一致；
 * chunk 是按 token 聚合的，段与段的接缝处还可能多一个空格。
 * 所以先两边都去掉空白再找，然后靠一张「去空白坐标 → 原文坐标」的表映射回去 ——
 * 这样返回的坐标能直接拿去切原文，切出来的是真正的那句话。
 */
export function locate(text: string, needle: string): Span | null {
  const target = needle.replace(/\s+/g, '')
  if (target === '') return null

  const map: number[] = []
  let flat = ''
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === undefined || /\s/.test(char)) continue
    flat += char
    map.push(i)
  }

  const at = flat.indexOf(target)
  if (at < 0) return null
  const start = map[at]
  const end = map[at + target.length - 1]
  if (start === undefined || end === undefined) return null
  return { start, end: end + 1 }
}

/**
 * 切出「命中处 + 前后各一段」。
 *
 * 定位失败返回 null —— 不做「假装成功」的兜底。跨 chunk 接缝的句子确实可能找不到，
 * 那时调用方明说「没能在本章正文里定位到这段文字」，比给一段不相干的上下文好。
 */
export function sliceContext(text: string, needle: string, radius = CONTEXT_RADIUS): ContextSlice | null {
  const span = locate(text, needle)
  if (!span) return null
  const start = Math.max(0, span.start - radius)
  const end = Math.min(text.length, span.end + radius)
  return {
    before: text.slice(start, span.start).trim(),
    matched: text.slice(span.start, span.end),
    after: text.slice(span.end, end).trim()
  }
}
