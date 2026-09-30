const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/
const WORD = /[a-zA-Z0-9_]/

/**
 * 切词：连续 CJK 串按二字滑窗切开；拉丁/数字按整词小写；其他字符只当分隔符。
 * 入库列与查询串必须走同一个函数，否则召回会对不上。
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = []
  let cjk: string[] = []
  let word: string[] = []

  const flushCjk = (): void => {
    if (cjk.length === 1) tokens.push(cjk[0]!)
    else for (let i = 0; i + 1 < cjk.length; i += 1) tokens.push(`${cjk[i]}${cjk[i + 1]}`)
    cjk = []
  }
  const flushWord = (): void => {
    if (word.length > 0) tokens.push(word.join('').toLowerCase())
    word = []
  }

  for (const ch of text) {
    if (CJK.test(ch)) {
      flushWord()
      cjk.push(ch)
    } else if (WORD.test(ch)) {
      flushCjk()
      word.push(ch)
    } else {
      flushCjk()
      flushWord()
    }
  }
  flushCjk()
  flushWord()
  return tokens
}

export function toIndexText(text: string): string {
  return tokenize(text).join(' ')
}

/** 短语查询：token 之间必须相邻，避免 bigram 切分后召回一堆无关段落。 */
export function toMatchQuery(text: string): string {
  const tokens = tokenize(text)
  return tokens.length === 0 ? '' : `"${tokens.join(' ')}"`
}
