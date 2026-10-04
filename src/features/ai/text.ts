/**
 * 模型输出的极简解析。
 *
 * 刻意不引 markdown 库：把模型给的字符串 parse 成 HTML 再插进 DOM，等于把界面的
 * 编辑权交给了一个我们无法约束的远端模型。CSP 能挡住脚本执行，但挡不住一段巨大的
 * `<table>` 把面板撑坏。
 *
 * 这里只认三种块（段落 / 无序列表 / 有序列表）与两种行内标记（**粗体** / [n] 引用），
 * 其余的 markdown 语法一律当普通文字显示。够用，且没有一个字节会变成 HTML。
 */
export type Inline =
  | { kind: 'text'; value: string }
  | { kind: 'strong'; value: string }
  | { kind: 'cite'; index: number }

export type Block =
  | { kind: 'paragraph'; inline: Inline[] }
  | { kind: 'bullet'; items: Inline[][] }
  | { kind: 'ordered'; items: Inline[][] }

/** 引用编号最多三位：`[2024]` 是年份，不是引用 */
const INLINE_TOKEN = /\*\*[^*\n]+\*\*|\[\d{1,3}\]/g
const BULLET = /^[-*•]\s+(.*)$/
const ORDERED = /^\d+[.)]\s+(.*)$/

export function parseInline(line: string): Inline[] {
  const result: Inline[] = []
  let cursor = 0

  for (const match of line.matchAll(INLINE_TOKEN)) {
    const at = match.index
    if (at > cursor) result.push({ kind: 'text', value: line.slice(cursor, at) })
    const token = match[0]
    if (token.startsWith('**')) result.push({ kind: 'strong', value: token.slice(2, -2) })
    else result.push({ kind: 'cite', index: Number(token.slice(1, -1)) })
    cursor = at + token.length
  }

  if (cursor < line.length) result.push({ kind: 'text', value: line.slice(cursor) })
  return result
}

export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = []
  let paragraph: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return
    // 用换行拼而不是空格：模型经常把一句话拆成两行，插空格会在中文里多出空格
    blocks.push({ kind: 'paragraph', inline: parseInline(paragraph.join('\n')) })
    paragraph = []
  }

  const flushList = (): void => {
    if (!list) return
    const items = list.items.map((item) => parseInline(item))
    blocks.push(list.ordered ? { kind: 'ordered', items } : { kind: 'bullet', items })
    list = null
  }

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()

    if (line === '') {
      flushParagraph()
      flushList()
      continue
    }

    const bullet = BULLET.exec(line)
    if (bullet) {
      flushParagraph()
      if (list?.ordered) flushList()
      list ??= { ordered: false, items: [] }
      list.items.push(bullet[1] ?? '')
      continue
    }

    const ordered = ORDERED.exec(line)
    if (ordered) {
      flushParagraph()
      if (list && !list.ordered) flushList()
      list ??= { ordered: true, items: [] }
      list.items.push(ordered[1] ?? '')
      continue
    }

    flushList()
    paragraph.push(line)
  }

  flushParagraph()
  flushList()
  return blocks
}