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

/**
 * 单字列：每个汉字各占一个 token，与 bigram 列分开存。
 *
 * 单字查询（「雾」）在 bigram 列里永远命不中 —— 那列只有二字滑窗切出来的东西。
 * 之所以另开一列而不是把单字混进 bigram 列，是因为 FTS5 的短语匹配只要求「同一列内」token 相邻：
 * 混在一起的话，像「量子纠缠」这种多字查询的相邻性会被插在中间的单字打断，反而漏召回。
 */
export function toSingleIndexText(text: string): string {
  const singles: string[] = []
  for (const ch of text) if (CJK.test(ch)) singles.push(ch)
  return singles.join(' ')
}

/** 短语查询：token 之间必须相邻，避免 bigram 切分后召回一堆无关段落。 */
export function toMatchQuery(text: string): string {
  const tokens = tokenize(text)
  return tokens.length === 0 ? '' : `"${tokens.join(' ')}"`
}
