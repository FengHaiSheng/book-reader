import { flattenForSpeech, splitSentences } from './speech-text'

/** 能产生可朗读文本的节点之外，这些标签里的字不是正文 */
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'RT', 'RP'])

/**
 * 段落级标签。两个文本节点属于不同段落时，拍平时要补一个空格：
 * `<p>你好</p><p>世界</p>` 的文本节点之间没有任何空白，不补就读成「你好世界」。
 */
const BLOCK_TAGS = new Set([
  'ADDRESS',
  'ARTICLE',
  'ASIDE',
  'BLOCKQUOTE',
  'BODY',
  'CAPTION',
  'CENTER',
  'DD',
  'DIV',
  'DL',
  'DT',
  'FIGCAPTION',
  'FIGURE',
  'FOOTER',
  'FORM',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HEADER',
  'HR',
  'LI',
  'MAIN',
  'NAV',
  'OL',
  'P',
  'PRE',
  'SECTION',
  'TABLE',
  'TBODY',
  'TD',
  'TFOOT',
  'TH',
  'THEAD',
  'TR',
  'UL'
])

export type SpeechSegment = {
  text: string
  /** Range 属于章节 iframe 的文档，Highlight 注册也必须用同一个 Window */
  range: Range
}

/** 当前环境有没有系统朗读能力 */
export function speechSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof SpeechSynthesisUtterance !== 'undefined'
  )
}

/**
 * 选一个语音。
 *
 * 用户存下的 voiceURI 优先；它可能来自另一台电脑或已经被系统删掉，这时退回
 * 「第一个中文语音」，再退回系统默认。返回 null 表示交给系统自己挑。
 */
export function pickVoice(
  voices: readonly SpeechSynthesisVoice[],
  preferred: string
): SpeechSynthesisVoice | null {
  if (preferred !== '') {
    const saved = voices.find((voice) => voice.voiceURI === preferred)
    if (saved) return saved
  }
  const chinese = voices.find((voice) => voice.lang.toLowerCase().startsWith('zh'))
  return chinese ?? voices[0] ?? null
}

/** 系统朗读错误码 → 界面上能看懂的一句话 */
const SPEECH_ERRORS: Record<string, string> = {
  'not-allowed': '系统没有允许朗读，检查一下系统的语音权限。',
  'audio-busy': '音频设备正忙，稍后再试。',
  'synthesis-failed': '系统语音合成失败。',
  'synthesis-unavailable': '系统语音服务不可用。',
  'language-unavailable': '当前语音不支持这本书的语言。',
  'voice-unavailable': '选中的语音不在这台电脑上，换一个声音试试。',
  network: '朗读需要网络，但网络不可用。',
  'text-too-long': '这一段太长，系统读不了。',
  'invalid-argument': '朗读参数不合法。'
}

export function speechErrorMessage(code: string): string {
  return SPEECH_ERRORS[code] ?? `朗读失败（${code}）。`
}

/**
 * 有没有可朗读的文本先看父节点链：`<div><script>…</script></div>` 里的文本节点
 * 直接看父节点是 script，但 ruby 注音这类要顺着往上找。
 */
function inSkippedTag(node: Node): boolean {
  let element = node.parentElement
  while (element) {
    if (SKIP_TAGS.has(element.tagName)) return true
    element = element.parentElement
  }
  return false
}

/** 最近的段落级祖先；没有就返回 null（body 直接挂着文本） */
function nearestBlock(node: Node): Element | null {
  let element = node.parentElement
  while (element) {
    if (BLOCK_TAGS.has(element.tagName)) return element
    element = element.parentElement
  }
  return null
}

/** 收集参与朗读的文本节点，顺序即文档顺序。空白节点也要留着，它决定词间空格 */
function speechNodes(doc: Document): Text[] {
  const root = doc.body
  if (!root) return []
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  let current = walker.nextNode()
  while (current) {
    const node = current as Text
    if (!inSkippedTag(node)) nodes.push(node)
    current = walker.nextNode()
  }
  return nodes
}

/**
 * 把一章正文切成「一句一个 Range」。
 *
 * 断句在拍平串上做，再把边界映射回文本节点；一句可能跨多个内联节点（`<em>`、
 * 脚注编号），所以 Range 的起止节点可以不同。任一端的映射不合法就跳过这一句：
 * 宁可少读一句，也不能拿错的 Range 去注册高亮。
 */
export function speechSegments(doc: Document): SpeechSegment[] {
  const nodes = speechNodes(doc)
  if (nodes.length === 0) return []

  const blocks = nodes.map(nearestBlock)
  const breaks = nodes.map((_, index) => index > 0 && blocks[index] !== blocks[index - 1])
  const flat = flattenForSpeech(
    nodes.map((node) => node.data),
    breaks
  )

  const segments: SpeechSegment[] = []
  for (const span of splitSentences(flat.text)) {
    const head = flat.map[span.start]
    const tail = flat.map[span.end - 1]
    if (!head || !tail) continue
    const startNode = nodes[head.nodeIndex]
    const endNode = nodes[tail.nodeIndex]
    if (!startNode || !endNode) continue
    if (head.offset >= startNode.data.length) continue
    const endOffset = Math.min(tail.offset + 1, endNode.data.length)
    if (endOffset <= 0) continue

    const range = doc.createRange()
    try {
      range.setStart(startNode, head.offset)
      range.setEnd(endNode, endOffset)
    } catch {
      continue
    }
    segments.push({ text: span.text, range })
  }
  return segments
}

/**
 * 从文档里的某个位置开始读：找出第一句「还没读完」的句子。
 *
 * 位置可以是当前页页首，也可以是上次朗读停下的那句句首。页首可能落在一句话中间
 * （上一页只排了半句），这一句也要读，所以比较的是句尾与位置。
 * compareBoundaryPoints 的 2 是 END_TO_START —— 不能用父窗口的 Range 常量：
 * 这里的 Range 来自 iframe 的 realm，跨 realm 取常量不可靠，而数值是规范固定的。
 */
const END_TO_START = 2

export function startIndexFromPoint(
  segments: readonly SpeechSegment[],
  point: Range
): number {
  const index = segments.findIndex(
    (segment) => segment.range.compareBoundaryPoints(END_TO_START, point) > 0
  )
  return index < 0 ? segments.length : index
}
