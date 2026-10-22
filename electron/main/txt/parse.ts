/**
 * TXT 的编码识别与分章。
 *
 * TXT 没有元数据，也没有规范的分章标记，所以这里只做两件事：
 * 把字节解成字符串，再按中文小说最常见的标题行切章。切不准时按长度兜底，
 * 至少保证不会把整本书塞进一个章节里。
 */

export type TxtChapter = { title: string; text: string }

/** 单章上限。中文 txt 常见「一章一屏」到「一卷几万字」，超过就按段落再切。 */
const MAX_CHAPTER_CHARS = 20000

/** 中文标题行：第X章/节/回/卷/部/篇/集，以及常见的非编号章节。 */
const HEADING =
  /^[\s\u3000]*(?:第\s*[0-9０-９一二三四五六七八九十百千万零两〇]+\s*[章节回卷部篇集]|序章|楔子|引子|前言|序言|后记|尾声|附录\s*[0-9一二三四五六七八九十]*|Chapter\s+[0-9IVXLC]+|CHAPTER\s+[0-9IVXLC]+)(?:[\s:：·、.\-].*)?$/

/** 标题行不该太长；超过这个长度的「标题」多半是正文里的正常句子。 */
const MAX_HEADING_CHARS = 60

/**
 * 解码 txt。
 *
 * 顺序是 BOM → UTF-8（严格）→ GB18030。中文 txt 里 GBK/GB18030 极常见，
 * 而 UTF-8 严格解码失败正好是可靠的切换信号；GB18030 解不出来时最后退回宽松 UTF-8，
 * 让用户至少能看到大部分正文，而不是整本导入失败。
 */
export function decodeTxt(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3))
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    try {
      return new TextDecoder('gb18030', { fatal: true }).decode(bytes)
    } catch {
      return new TextDecoder('utf-8').decode(bytes)
    }
  }
}

/**
 * 按标题行分章。标题行本身从正文里摘掉，改写成章节标题。
 * 第一个标题之前的内容保留为「前言」——那通常是书名页、作者的话，丢掉才是真的丢内容。
 */
export function splitTxtChapters(source: string): TxtChapter[] {
  const text = source.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '')
  const lines = text.split('\n')

  const chapters: TxtChapter[] = []
  let title = ''
  let body: string[] = []
  let sawHeading = false

  const flush = (): void => {
    const content = body.join('\n').trim()
    if (!title && !content) return
    // 没有任何标题行时，整本正文按长度切；有标题时，第一个标题前的内容算前言
    const name = title || (sawHeading ? '前言' : '正文')
    for (const part of splitLongText(content, MAX_CHAPTER_CHARS, name)) chapters.push(part)
    title = ''
    body = []
  }

  for (const line of lines) {
    if (isHeading(line)) {
      // 先标记「有标题」，第一个标题之前的正文才会被命名为「前言」而不是「正文」
      sawHeading = true
      flush()
      title = line.trim().replace(/[\s\u3000]+/g, ' ')
      continue
    }
    body.push(line)
  }
  flush()

  return chapters.filter((chapter) => chapter.text.trim() !== '')
}

function isHeading(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed || trimmed.length > MAX_HEADING_CHARS) return false
  return HEADING.test(trimmed)
}

/**
 * 超长章节按段落边界切开。切出来的小章都保留原标题并加序号，
 * 这样目录里仍然认得出它们属于同一章。
 */
function splitLongText(text: string, limit: number, title: string): TxtChapter[] {
  if (text.length <= limit) return [{ title, text }]

  const parts: string[] = []
  let rest = text
  while (rest.length > limit) {
    // 往前找最近的换行，宁可短一点也不要从句子中间切开
    let cut = rest.lastIndexOf('\n', limit)
    if (cut < limit * 0.5) cut = limit
    parts.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) parts.push(rest)

  return parts.filter(Boolean).map((part, index) => ({
    title: `${title}（${index + 1}）`,
    text: part
  }))
}
