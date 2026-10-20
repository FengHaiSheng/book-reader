import { readFile } from 'node:fs/promises'
import { appError } from '@shared/errors'

/** 页面里的一块正文。标题块会被渲染成 h2，正文块是 p。 */
export type PdfBlock = { kind: 'p' | 'h'; text: string }

export type PdfOutlineEntry = {
  title: string
  /** 1 起算的页码；解析不出来时不会进这个数组 */
  page: number
  depth: number
}

export type PdfExtract = {
  title: string | null
  author: string | null
  language: string | null
  pageCount: number
  /** 每页整理后的段落，下标即 page - 1 */
  pages: PdfBlock[][]
  outline: PdfOutlineEntry[]
}

type RawTextItem = {
  str?: string
  transform?: number[]
  width?: number
  height?: number
  hasEOL?: boolean
}

type PdfLine = {
  text: string
  x: number
  y: number
  right: number
  size: number
}

/** 康熙部首、兼容汉字与连字：字体缺 ToUnicode 时会抽成这些码位，NFKC 能还原 */
const COMPAT = /[\u2e80-\u2fdf\uf900-\ufaff\ufb00-\ufb06]/g
const ZERO_WIDTH = /[\u00ad\u200b-\u200f\ufeff]/g
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/
const PAGE_NUMBER = /^(第\s*\d+\s*页|\d{1,4}\s*\/\s*\d{1,4}|\d{1,4}|[ivxlcdm]{1,7})$/i

/**
 * 抽出整本 PDF 的文字与目录。
 *
 * 只做文字层：没有文字层的扫描件会得到空页，由导入层明确报错，不假装成功。
 * 整个函数是纯 Node 的（不碰 DOM/Canvas），所以能直接跑在 worker 线程里。
 */
export async function extractPdf(
  pdfPath: string,
  onProgress?: (done: number, total: number) => void
): Promise<PdfExtract> {
  const data = new Uint8Array(await readFile(pdfPath))
  // legacy 构建是给 Node 用的；用动态 import，主进程的 CJS 产物里也能加载 ESM
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')

  const task = pdfjs.getDocument({
    data,
    useSystemFonts: false,
    isEvalSupported: false,
    disableFontFace: true,
    verbosity: 0
  })

  let doc: Awaited<typeof task.promise>
  try {
    doc = await task.promise
  } catch (error) {
    throw pdfLoadError(error)
  }

  try {
    const pageCount = doc.numPages
    const rawLines: PdfLine[][] = []
    for (let pageNo = 1; pageNo <= pageCount; pageNo += 1) {
      const page = await doc.getPage(pageNo)
      const content = await page.getTextContent()
      rawLines.push(groupLines(content.items as unknown as RawTextItem[]))
      page.cleanup()
      onProgress?.(pageNo, pageCount)
    }

    const cleaned = dropRunningHeads(rawLines)
    const pages = cleaned.map(pageBlocks)
    const meta = await readMetadata(doc)
    const outline = await readOutline(doc)

    return { ...meta, pageCount, pages, outline }
  } finally {
    await doc.destroy()
  }
}

function pdfLoadError(error: unknown): ReturnType<typeof appError> {
  const name = error instanceof Error ? error.name : ''
  if (name === 'PasswordException') {
    return appError('PDF_PARSE_FAILED', '这本 PDF 有密码保护，暂时打不开')
  }
  const detail = error instanceof Error ? `${name}: ${error.message}` : String(error)
  return appError('PDF_PARSE_FAILED', '这本 PDF 打不开，文件可能已经损坏', { detail })
}

async function readMetadata(doc: {
  getMetadata: () => Promise<{ info?: unknown }>
}): Promise<Pick<PdfExtract, 'title' | 'author' | 'language'>> {
  try {
    const meta = await doc.getMetadata()
    const info = (meta.info ?? {}) as Record<string, unknown>
    return {
      title: clean(info.Title),
      author: clean(info.Author),
      language: clean(info.Language)
    }
  } catch {
    return { title: null, author: null, language: null }
  }
}

function clean(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.replace(/\s+/g, ' ').trim()
  return text || null
}

/** 目录项的目标可能是字符串（命名目标）也可能是数组，两种都要解成页码 */
async function readOutline(doc: {
  getOutline: () => Promise<unknown>
  getDestination: (name: string) => Promise<unknown>
  getPageIndex: (ref: any) => Promise<number>
}): Promise<PdfOutlineEntry[]> {
  let raw: unknown
  try {
    raw = await doc.getOutline()
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []

  const out: PdfOutlineEntry[] = []

  const resolvePage = async (dest: unknown): Promise<number | null> => {
    let target = dest
    if (typeof target === 'string') {
      try {
        target = await doc.getDestination(target)
      } catch {
        return null
      }
    }
    if (!Array.isArray(target) || target.length === 0) return null
    const first = target[0]
    try {
      if (typeof first === 'number') return Math.max(1, Math.floor(first) + 1)
      if (first && typeof first === 'object') {
        return (await doc.getPageIndex(first)) + 1
      }
    } catch {
      return null
    }
    return null
  }

  const walk = async (nodes: unknown[], depth: number): Promise<void> => {
    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue
      const item = node as { title?: unknown; dest?: unknown; items?: unknown }
      const page = await resolvePage(item.dest)
      const title = clean(item.title)
      if (page !== null && title) out.push({ title, page, depth })
      if (Array.isArray(item.items)) await walk(item.items, depth + 1)
    }
  }

  await walk(raw, 0)
  return out
}

function normalizeText(text: string): string {
  return text
    .replace(ZERO_WIDTH, '')
    .replace(/\u00a0/g, ' ')
    .replace(COMPAT, (ch) => ch.normalize('NFKC'))
}

/**
 * 按基线把文本项拼成行。
 *
 * PDF 没有「行」这个概念，只有一堆带坐标的文字块。同一基线上的连续项算一行；
 * 误差用字号的三分之一放宽，避免上下标把一行拆成两行。
 */
function groupLines(items: RawTextItem[]): PdfLine[] {
  const groups: RawTextItem[][] = []
  let current: RawTextItem[] = []
  let currentY: number | null = null

  const flush = (): void => {
    if (current.length > 0) groups.push(current)
    current = []
    currentY = null
  }

  for (const item of items) {
    const str = typeof item.str === 'string' ? item.str : ''
    if (!str) {
      if (item.hasEOL) flush()
      continue
    }
    const transform = Array.isArray(item.transform) ? item.transform : null
    if (!transform || transform.length < 6) continue

    const size = Math.abs(transform[3] ?? item.height ?? 10) || 10
    const x = transform[4] ?? 0
    const y = transform[5] ?? 0

    if (currentY !== null && Math.abs(y - currentY) > Math.max(2, size * 0.35)) flush()
    current.push(item)
    currentY = y
    if (item.hasEOL) flush()
  }
  flush()

  return groups.map(makeLine).filter((line): line is PdfLine => line !== null)
}

function makeLine(items: RawTextItem[]): PdfLine | null {
  const placed = items
    .map((item) => {
      const transform = item.transform ?? []
      const size = Math.abs(transform[3] ?? item.height ?? 10) || 10
      return {
        str: normalizeText(item.str ?? ''),
        x: transform[4] ?? 0,
        y: transform[5] ?? 0,
        width: typeof item.width === 'number' ? item.width : 0,
        size
      }
    })
    .filter((item) => item.str.length > 0)
    .sort((a, b) => a.x - b.x)

  const first = placed[0]
  if (!first) return null

  let text = ''
  let prevEnd: number | null = null
  let prevSize = first.size
  for (const item of placed) {
    if (prevEnd !== null) {
      const gap = item.x - prevEnd
      // 只有英文/数字之间才补空格；中文之间补空格会把词语断开
      if (
        gap > Math.max(1.5, Math.min(prevSize, item.size) * 0.3) &&
        /[A-Za-z0-9]$/.test(text) &&
        /^[A-Za-z0-9]/.test(item.str)
      ) {
        text += ' '
      }
    }
    text += item.str
    prevEnd = item.x + item.width
    prevSize = item.size
  }

  text = text.replace(/\s+/g, ' ').trim()
  if (!text) return null

  const last = placed[placed.length - 1] ?? first
  return {
    text,
    x: first.x,
    y: first.y,
    right: Math.max(last.x + last.width, first.x),
    size: first.size
  }
}

/**
 * 去掉页眉页脚：页码独自成行、或者同一段文字反复出现在每页上下边缘。
 *
 * 只看每页最前/最后两行，正文中间的重复短句（表格标题之类）不会误伤。
 */
function dropRunningHeads(pages: PdfLine[][]): PdfLine[][] {
  if (pages.length === 0) return pages

  const counts = new Map<string, number>()
  for (const lines of pages) {
    for (const line of marginLines(lines)) {
      const key = headKey(line.text)
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }

  const threshold = Math.max(3, Math.ceil(pages.length * 0.4))
  const repeated = new Set<string>()
  for (const [key, count] of counts) {
    if (count >= threshold) repeated.add(key)
  }

  return pages.map((lines) => {
    const margins = new Set(marginLines(lines))
    return lines.filter((line) => {
      if (!margins.has(line)) return true
      if (PAGE_NUMBER.test(line.text)) return false
      return !repeated.has(headKey(line.text))
    })
  })
}

function marginLines(lines: PdfLine[]): PdfLine[] {
  if (lines.length <= 4) return lines
  return [...lines.slice(0, 2), ...lines.slice(-2)]
}

/** 页眉里的数字每页都在变，比较时统一抹成 # */
function headKey(text: string): string {
  return text.replace(/\d+/g, '#').replace(/\s+/g, '')
}

/**
 * 把一页的行拼成段落。
 *
 * 判段依据：上一行明显短（段落末行）、以句末标点结尾、段首缩进、行距突然变大。
 * 这些信号任意一个成立就断段；都不成立就认为还在同一段，按中英文规则接上。
 */
function pageBlocks(lines: PdfLine[]): PdfBlock[] {
  if (lines.length === 0) return []

  const sizes = lines.map((line) => line.size).sort((a, b) => a - b)
  const bodySize = sizes[Math.floor(sizes.length / 2)] ?? 10
  const left = mode(lines.map((line) => Math.round(line.x)))
  const right = Math.max(...lines.map((line) => line.right))

  const blocks: PdfBlock[] = []
  let current: string | null = null
  let prev: PdfLine | null = null

  const flush = (): void => {
    if (current !== null) blocks.push({ kind: 'p', text: current })
    current = null
  }

  for (const line of lines) {
    const heading =
      line.size >= bodySize * 1.18 &&
      line.text.length <= 40 &&
      !/[，,。.；;：:]$/.test(line.text)

    if (heading) {
      flush()
      blocks.push({ kind: 'h', text: line.text })
      prev = line
      continue
    }

    const indent = line.x > left + Math.max(2, bodySize * 0.7)
    const gapBreak = prev !== null && prev.y - line.y > Math.max(prev.size * 1.9, line.size * 1.9)
    const shortPrev = prev !== null && prev.right < right - bodySize * 1.5
    const endPunct = prev !== null && /[。！？!?；;：:]$/.test(prev.text)

    if (current === null || indent || gapBreak || shortPrev || endPunct) {
      flush()
      current = line.text
    } else {
      current = joinLine(current, line.text)
    }
    prev = line
  }
  flush()

  return blocks
}

function joinLine(prev: string, next: string): string {
  if (prev.endsWith('-') && /^[a-z]/.test(next)) return prev.slice(0, -1) + next
  const left = prev.slice(-1)
  const right = next.slice(0, 1)
  if (CJK.test(left) || CJK.test(right)) return prev + next
  return `${prev} ${next}`
}

function mode(values: number[]): number {
  const counts = new Map<number, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  let best = values[0] ?? 0
  let bestCount = 0
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value
      bestCount = count
    }
  }
  return best
}
