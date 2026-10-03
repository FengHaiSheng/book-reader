/**
 * 解析模型给的 JSON。
 *
 * 强模型也不保证每次都吐合法 JSON：可能包在 ``` 里、可能前后加一句「好的，这是结果：」、
 * 可能多一个尾逗号、可能用中文引号。为这些情况各写一次提示词重试是浪费用户的钱，
 * 能本地修的就本地修。
 *
 * 全都修不好就返回 null —— 由调用方决定是「按纯文本展示」还是报错，本函数不抛。
 */
export function parseLooseJson(text: string): unknown {
  const trimmed = text.trim()
  if (trimmed === '') return null

  const direct = tryParse(trimmed)
  if (direct !== undefined) return direct

  const stripped = stripFence(trimmed)
  if (stripped !== trimmed) {
    const fromFence = tryParse(stripped)
    if (fromFence !== undefined) return fromFence
  }

  const sliced = sliceOutermost(trimmed)
  if (sliced !== null) {
    const fromSlice = tryParse(sliced)
    if (fromSlice !== undefined) return fromSlice

    const repaired = repair(sliced)
    if (repaired !== sliced) {
      const fromRepair = tryParse(repaired)
      if (fromRepair !== undefined) return fromRepair
    }

    const balanced = balance(repaired)
    if (balanced !== null) {
      const fromBalance = tryParse(balanced)
      if (fromBalance !== undefined) return fromBalance
    }
  }

  return null
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

/** 去 ```json ... ``` 包裹 */
function stripFence(text: string): string {
  const match = text.match(/^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```$/)
  return match ? match[1]!.trim() : text
}

/** 截出最外层的 { ... } 或 [ ... ]，去掉前后的解释性文字 */
function sliceOutermost(text: string): string | null {
  const firstBrace = text.indexOf('{')
  const firstBracket = text.indexOf('[')
  const candidates = [firstBrace, firstBracket].filter((i) => i !== -1)
  if (candidates.length === 0) return null
  const start = Math.min(...candidates)
  const open = text[start]
  const close = open === '{' ? '}' : ']'
  const end = text.lastIndexOf(close)
  if (end <= start) return null
  return text.slice(start, end + 1)
}

/** 尾逗号、单引号、中文引号 */
function repair(text: string): string {
  return text
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/([{,]\s*)'([^']*)'(\s*:)/g, '$1"$2"$3')
    .replace(/:\s*'([^']*)'/g, ': "$1"')
}

/** 括号没闭合（模型被 max_tokens 截断）时补全，尽力救回已生成的部分 */
function balance(text: string): string | null {
  const stack: string[] = []
  let inString = false
  let escape = false

  for (const ch of text) {
    if (escape) {
      escape = false
      continue
    }
    if (ch === '\\') {
      escape = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === '{' || ch === '[') stack.push(ch)
    else if (ch === '}' || ch === ']') stack.pop()
  }

  if (inString) return null
  if (stack.length === 0) return text

  // 被截断在最值钱的字段上时，直接补闭括号会得到非法 JSON；先把尾部残缺的
  // 键值对切掉，再补。
  let body = text.replace(/,\s*"[^"]*"?\s*:?\s*[^,}\]]*$/, '').replace(/,\s*$/, '')
  const closers = stack
    .slice()
    .reverse()
    .map((open) => (open === '{' ? '}' : ']'))
    .join('')
  return body + closers
}