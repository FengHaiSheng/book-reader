import type { TrackNodeInput } from '@shared/track'
import type { ChatMessage } from '../ai/params'
import type { TrackLibraryBook } from './library-summary'

export const TRACK_SKELETON_SCHEMA =
  '{"nodes":[{"id":"n1","parentId":null,"title":"能力","summary":"一句话","depth":1,"sortOrder":0}]}'

export const TRACK_MOUNT_SCHEMA =
  '{"mounts":[{"nodeId":"<骨架里列出的节点 id>","bookIds":["book-id"]}]}'

export const TRACK_GAP_SCHEMA =
  '{"overall":"一两句","gaps":[{"nodeId":"n1","type":"coverage","summary":"缺什么","suggestBookKinds":["哪一类书"]}],"nextSteps":["下一步"]}'

const JSON_ONLY = '只输出一个 JSON 对象，不要代码块，不要开场白，不要解释。'

export type PreviousTrackNode = TrackNodeInput & { userEdited: boolean }

export type GapPromptNode = {
  id: string
  title: string
  summary: string
  depth: number
  bookTitles: string[]
  bookCount: number
  progressAvg: number
  unreadRatio: number
  sediment: number
  strength: 'empty' | 'weak' | 'ok'
}

export function skeletonMessages(input: {
  goalText: string
  books: readonly TrackLibraryBook[]
  previousNodes?: readonly PreviousTrackNode[]
}): ChatMessage[] {
  const lines = [
    `目标：\n${input.goalText}`,
    '',
    '书库（这一步只用来理解用户手里有什么，不要输出 bookId，不要挂书）：'
  ]
  if (input.books.length === 0) lines.push('（书库是空的，只根据目标搭骨架）')
  else lines.push(...input.books.map(bookLine))

  if (input.previousNodes) {
    lines.push('', '上一版节点（请原样沿用这些 id；只有新增或拆开的节点才用新的短 id）：')
    if (input.previousNodes.length === 0) lines.push('（上一版没有节点）')
    else lines.push(...input.previousNodes.map(previousLine))
  }

  lines.push('', `按这个形状输出：${TRACK_SKELETON_SCHEMA}`)
  return [
    {
      role: 'system',
      content: [
        '你是学习路径规划助手。根据目标和书库，输出一棵能力树骨架。',
        '深度只允许 1、2、3。根节点 depth 为 1、parentId 为 null。子节点 depth 必须等于父节点 depth + 1。',
        'id 在本次结果里唯一，用短字符串即可。title 不能为空。summary 可以是空字符串。',
        '没有对应书籍的空节点是合法的，用来标出整块还没覆盖的能力。',
        '不要编造书名，也不要在这一步挂书。',
        JSON_ONLY
      ].join('\n')
    },
    { role: 'user', content: lines.join('\n') }
  ]
}

export function mountMessages(input: {
  goalText: string
  nodes: readonly TrackNodeInput[]
  books: readonly TrackLibraryBook[]
}): ChatMessage[] {
  const lines = [
    `目标：\n${input.goalText}`,
    '',
    '节点（nodeId 必须是下面骨架里列出的 id 之一，不要新造，也不要照抄占位符）：'
  ]
  if (input.nodes.length === 0) lines.push('（没有节点）')
  else lines.push(...input.nodes.map(nodeLine))
  lines.push('', '书库（bookId 必须用下面的 id，不要编造）：')
  if (input.books.length === 0) lines.push('（书库是空的）')
  else lines.push(...input.books.map(bookLine))
  lines.push('', `按这个形状输出：${TRACK_MOUNT_SCHEMA}`)
  return [
    {
      role: 'system',
      content: [
        '你负责把书挂到已经确定的能力节点上。',
        'nodeId 必须是骨架里列出的 id 之一，不要新造。',
        'bookId 只能来自书库列表。拿不准、关系弱的书不要挂，留给未归类。',
        '一本书可以挂到多个真正相关的节点上，不要为了凑数重复。',
        '可以返回空的 mounts。不要修改节点。',
        JSON_ONLY
      ].join('\n')
    },
    { role: 'user', content: lines.join('\n') }
  ]
}

export function gapMessages(input: {
  goalText: string
  nodes: readonly GapPromptNode[]
  question?: string
}): ChatMessage[] {
  const lines = [`目标：\n${input.goalText}`, '', '节点和本地信号（进度、未读比都是 0 到 1）：']
  if (input.nodes.length === 0) lines.push('（当前脉络没有节点）')
  else lines.push(...input.nodes.map(gapLine))
  const question = input.question?.trim() ?? ''
  lines.push('', question ? `用户追问：\n${question}` : '用户没有追问，请直接判断现在最缺什么。')
  lines.push('', `按这个形状输出：${TRACK_GAP_SCHEMA}`)
  return [
    {
      role: 'system',
      content: [
        '你根据每个节点已经算好的本地信号，判断学习者还缺什么。不要改信号里的数字。',
        'type 只能是 coverage（没挂书或覆盖明显不够）、progress（挂了书但几乎没读）、sediment（读过但划线、批注、笔记很少）。',
        'nodeId 必须来自给定节点。suggestBookKinds 写该补的书类，不要写成用户已经拥有的具体书名，也不要编造书库里的书。',
        '角标 empty 是没有挂书，weak 是有书但进度低或沉淀低，ok 是进度和沉淀都还行。角标只是提示，判断仍以数字为准。',
        JSON_ONLY
      ].join('\n')
    },
    { role: 'user', content: lines.join('\n') }
  ]
}

function bookLine(book: TrackLibraryBook): string {
  const author = book.author ? oneLine(book.author, 40) : '佚名'
  const tags = book.tags.length > 0 ? book.tags.slice(0, 8).map((tag) => oneLine(tag, 24)).join('、') : '无'
  const chapters =
    book.chapterTitles.length > 0
      ? book.chapterTitles.map((title) => oneLine(title, 40)).join('、')
      : '无'
  const progress = Math.round(clamp01(book.percent) * 100)
  return `- book ${book.id} | 《${oneLine(book.title, 80)}》 | ${author} | 标签 ${tags} | ${statusLabel(book.status)} | 进度 ${progress}% | 目录 ${chapters}`
}

function nodeLine(node: TrackNodeInput): string {
  return `- node ${node.id} parent ${node.parentId ?? '-'} depth ${node.depth} sort ${node.sortOrder} 《${oneLine(node.title, 80)}》 ${oneLine(node.summary, 120)}`
}

function previousLine(node: PreviousTrackNode): string {
  const edited = node.userEdited ? ' 用户改过挂载' : ''
  return `${nodeLine(node)}${edited}`
}

function gapLine(node: GapPromptNode): string {
  const titles = node.bookTitles.slice(0, 8).map((title) => oneLine(title, 40))
  const books =
    titles.length === 0
      ? '无'
      : node.bookTitles.length > titles.length
        ? `${titles.join('、')} 等 ${node.bookTitles.length} 本`
        : titles.join('、')
  const summary = node.summary.trim() === '' ? '' : ` 摘要 ${oneLine(node.summary, 120)}`
  return `- node ${node.id} depth ${node.depth} 《${oneLine(node.title, 80)}》${summary} 书 ${books} | 覆盖 ${node.bookCount} | 进度 ${node.progressAvg.toFixed(4)} | 未读 ${node.unreadRatio.toFixed(4)} | 沉淀 ${node.sediment} | 角标 ${node.strength}`
}

function statusLabel(status: TrackLibraryBook['status']): string {
  if (status === 'reading') return '在读'
  if (status === 'finished') return '读完'
  return '未读'
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

function oneLine(value: string, max: number): string {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length <= max ? text : `${text.slice(0, max)}…`
}
