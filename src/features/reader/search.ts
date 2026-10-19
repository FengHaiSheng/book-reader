/**
 * 书内查找的两条纯逻辑：结果摘要怎么截，关键词值不值得去查。
 *
 * 检索本身在主进程完成（`library:search` = bigram 切分 + FTS5），
 * 这里只处理「拿回来的段落怎么摆给人看」。
 */

/** 命中处两边各留多少字，超出的部分掐掉 */
const SNIPPET_PAD = 40
const ELLIPSIS = '…'

export type Snippet = {
  /** 命中之前的部分 */
  before: string
  /** 命中的原文，空串表示这段里没找到关键词 */
  hit: string
  /** 命中之后的部分 */
  after: string
}

/**
 * 把一段检索结果裁成「前后文 + 命中词」三段，供界面把命中词标出来。
 *
 * 匹配用的是原样大小写不敏感的子串查找，而不是入库那套 bigram 切词：
 * 切词只为召回服务，切完的 token 与屏幕上看到的字对不上，标不准确还不如不标。
 */
export function snippetOf(text: string, query: string, pad = SNIPPET_PAD): Snippet {
  const flat = text.replace(/\s+/gu, ' ').trim()
  const needle = query.trim()
  const at = needle === '' ? -1 : flat.toLowerCase().indexOf(needle.toLowerCase())

  if (at < 0) {
    // 没命中就只摆开头（检索是按关键词召回的，这一支几乎不会走到）
    const head = flat.slice(0, pad * 2)
    return { before: head + (flat.length > pad * 2 ? ELLIPSIS : ''), hit: '', after: '' }
  }

  const start = Math.max(0, at - pad)
  const end = Math.min(flat.length, at + needle.length + pad)
  return {
    before: (start > 0 ? ELLIPSIS : '') + flat.slice(start, at),
    hit: flat.slice(at, at + needle.length),
    after: flat.slice(at + needle.length, end) + (end < flat.length ? ELLIPSIS : '')
  }
}

/** 汉字、字母、数字、下划线 —— 与主进程 bigram / 单字两列的切词字符集保持一致 */
const SEARCHABLE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaffa-zA-Z0-9_]/u

/**
 * 关键词能不能被索引匹配上。
 *
 * 索引列里既有二字滑窗（多字查询），也有每个汉字一枚的单字列，所以单个汉字查得动。
 * 只有标点、空白这类字符时切不出任何 token，`MATCH ''` 必然是空 ——
 * 那种「查了但没结果」会被当成「书里没有」，所以要在界面上分开说。
 */
export function isSearchableQuery(query: string): boolean {
  return SEARCHABLE.test(query)
}
