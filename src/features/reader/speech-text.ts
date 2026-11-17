/**
 * 朗读用的文本整理：把若干个文本节点拍平成可朗读的串，再切成一句一段。
 *
 * 这一层刻意不碰 DOM：断句规则值得单独测试，而 Range 的构造放在 `speech.ts`。
 */

/** 一句话最多朗读多少字。中文长句在逗号处断开，避免一次合成太久、断点也粗 */
export const MAX_SPEECH_CHARS = 120

/** 句末标点。分号也算 —— 它后面本来就是一次换气 */
const TERMINATORS = new Set(['。', '！', '？', '!', '?', '；', ';', '…'])

/** 句末标点之后的收尾符号：引号、括号这些要跟着上一句一起读 */
const CLOSERS = new Set(['”', '’', '」', '』', '）', ')', '】', '》', '〉'])

/** 超长句优先在这些地方断开 */
const SOFT_BREAKS = new Set(['，', ',', '、', '：', ':', ' '])

/** 拍平串里的一个字符来自哪个文本节点的哪个下标 */
export type SpeechPosition = { nodeIndex: number; offset: number }

export type FlatSpeech = {
  text: string
  /** 与 text 一一对应：第 i 个字出自哪个节点、节点内第几个字符 */
  map: SpeechPosition[]
}

export type SentenceSpan = {
  /** 在拍平串里的起止下标，左闭右开 */
  start: number
  end: number
  text: string
}

/**
 * 把文本节点按文档顺序拍平。
 *
 * 空白折成一个空格而不是直接删掉：英文单词之间必须留空格，否则 "Hello" 与 "world"
 * 会读成 "Helloworld"。`breaks[i]` 为 true 表示第 i 个节点前需要补一个空格 ——
 * 调用方按「两个节点是否属于不同段落」判断，纯文本层不知道 DOM 结构。
 */
export function flattenForSpeech(
  texts: readonly string[],
  breaks: readonly boolean[] = []
): FlatSpeech {
  let text = ''
  const map: SpeechPosition[] = []
  let needSpace = false

  for (let nodeIndex = 0; nodeIndex < texts.length; nodeIndex += 1) {
    if (nodeIndex > 0 && breaks[nodeIndex] && text !== '') needSpace = true
    const source = texts[nodeIndex] ?? ''

    for (let offset = 0; offset < source.length; offset += 1) {
      const char = source[offset] ?? ''
      if (/\s/u.test(char)) {
        if (text !== '') needSpace = true
        continue
      }
      if (needSpace) {
        text += ' '
        // 空格的出处记在当前字上：它只用于拍平串的定位，不会出现在句子边界
        map.push({ nodeIndex, offset })
        needSpace = false
      }
      text += char
      map.push({ nodeIndex, offset })
    }
  }

  return { text, map }
}

/**
 * 按句末标点断句，返回的偏移直接作用在传入的字符串上。
 *
 * 规则有意保守：英文句号只有后面是空格或结尾时才断，3.14 这种小数不会被拆开；
 * 连续标点（「真的？！」）和收尾引号都留在同一句里。超长句先在逗号、空格处断，
 * 实在没有断点才硬切。
 */
export function splitSentences(text: string): SentenceSpan[] {
  const spans: SentenceSpan[] = []

  const push = (start: number, end: number): void => {
    let from = start
    let to = end
    while (from < to && text[from] === ' ') from += 1
    while (to > from && text[to - 1] === ' ') to -= 1
    if (to <= from) return
    spans.push({ start: from, end: to, text: text.slice(from, to) })
  }

  let start = 0
  let index = 0
  while (index < text.length) {
    const char = text[index] ?? ''
    let end = -1

    if (TERMINATORS.has(char)) {
      end = index + 1
      while (end < text.length) {
        const next = text[end] ?? ''
        if (TERMINATORS.has(next) || CLOSERS.has(next)) end += 1
        else break
      }
    } else if (char === '.') {
      const next = text[index + 1]
      if (next === undefined || next === ' ') end = index + 1
    }

    if (end > 0) {
      push(start, end)
      start = end
      index = end
      continue
    }

    if (index - start >= MAX_SPEECH_CHARS) {
      const cut = lastSoftBreak(text, start, index)
      const at = cut > start ? cut + 1 : index
      push(start, at)
      start = at
      index = at
      continue
    }

    index += 1
  }

  push(start, text.length)
  return spans
}

/** 在 [start, end) 里从后往前找断点；找不到返回 -1 */
function lastSoftBreak(text: string, start: number, end: number): number {
  for (let index = end - 1; index > start; index -= 1) {
    if (SOFT_BREAKS.has(text[index] ?? '')) return index
  }
  return -1
}
