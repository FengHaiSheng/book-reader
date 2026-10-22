import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type Database from 'better-sqlite3'
import type { ImportOutcome, ImportProgress } from '@shared/types'
import { appError } from '@shared/errors'
import type { EpubMetadata, SpineText, TocNode } from '../epub/types'
import { dirOf, resolveEntry } from '../epub/entry-path'
import { firstHeading, htmlToText } from '../epub/text'
import { listEntries, readEntries, type ZipEntry } from '../epub/zip'
import { parseOpf } from '../epub/opf'
import {
  GENERATED_CHAPTER_DIR,
  importGeneratedBook,
  type GeneratedDraft
} from '../library/generated-importer'
import { wrapXhtml } from '../library/xhtml'
import { rewriteResourceLinks, splitHtmlBook } from './parse'

type ProgressFn = (progress: ImportProgress) => void

/** 能被 media/ 服务、需要从 zip 里复制出来的资源类型（.jfif / .jpe 是 JPEG 的常见别名） */
const RESOURCE_EXT =
  /\.(?:jpe?g|jfif|jpe|png|gif|webp|bmp|svg|css|woff2?|ttf|otf|mp3|m4a|mp4|ogg|wav)$/i

/**
 * 导入 HTMLZ：Calibre 导出的单文件 HTML 包（zip 内含 index.html、metadata.opf 与图片）。
 *
 * 正文按 h1/h2 切章，图片/样式复制到 media/ 并把链接改写成相对路径，
 * 之后和 epub / pdf 一样走生成的章节 HTML 阅读。
 */
export async function importHtmlz(
  db: Database.Database,
  sourcePath: string,
  onProgress: ProgressFn = () => {}
): Promise<ImportOutcome> {
  return importGeneratedBook(
    db,
    sourcePath,
    'htmlz',
    async (_dir, mediaDir): Promise<GeneratedDraft> => {
      const entries = await listEntries(sourcePath)
      const htmlEntry = pickMainHtml(entries)
      if (!htmlEntry) {
        throw appError('BOOK_PARSE_FAILED', '这个 htmlz 里没有找到正文 HTML')
      }

      const opfEntry = entries.find((entry) => /(^|\/)metadata\.opf$/i.test(entry.name))?.name
      const resourceEntries = entries.filter(
        (entry) => entry.name !== htmlEntry && RESOURCE_EXT.test(entry.name)
      )
      const names = [
        htmlEntry,
        ...(opfEntry ? [opfEntry] : []),
        ...resourceEntries.map((entry) => entry.name)
      ]
      const files = await readEntries(sourcePath, names)

      const html = files.get(htmlEntry)?.toString('utf-8') ?? ''
      if (!htmlToText(html).trim()) {
        throw appError('BOOK_PARSE_FAILED', '这本书没有可读的正文，文件可能已经损坏')
      }

      const resources = writeResources(resourceEntries, files, mediaDir)
      const rewritten = rewriteResourceLinks(html, dirOf(htmlEntry), resources)

      const parsed = parseMetadata(files.get(opfEntry ?? ''), opfEntry ?? '', sourcePath)
      const chapters = splitHtmlBook(rewritten)

      const toc: TocNode[] = []
      const spine: string[] = []
      const texts: SpineText[] = []
      const htmlByEntry = new Map<string, string>()

      chapters.forEach((chapter, index) => {
        const entry = `${GENERATED_CHAPTER_DIR}/${String(index + 1).padStart(5, '0')}.html`
        const chapterHtml = wrapXhtml(chapter.body, chapter.title)
        const heading = firstHeading(chapterHtml) ?? chapter.title
        toc.push({ title: chapter.title, entry, children: [] })
        spine.push(entry)
        texts.push({ entry, text: htmlToText(chapterHtml), heading })
        htmlByEntry.set(entry, chapterHtml)
      })

      return {
        metadata: parsed.metadata,
        toc,
        spine,
        texts,
        htmlByEntry,
        cover: readCover(parsed.coverEntry, entries, files)
      }
    },
    onProgress
  )
}

/** 优先 index.html，其次取体积最大的 html：有些包里正文文件名是 index_split_000.html。 */
function pickMainHtml(entries: ZipEntry[]): string | null {
  const htmls = entries.filter((entry) => /\.html?$/i.test(entry.name))
  if (htmls.length === 0) return null
  const index = htmls.find((entry) => /(^|\/)index\.html?$/i.test(entry.name))
  if (index) return index.name
  return htmls.sort((a, b) => b.size - a.size)[0]!.name
}

/**
 * 把资源复制到 media/，并返回 zip entry → `../media/<安全文件名>` 的映射。
 *
 * 文件名会做 ASCII 化：协议层只放行 `[A-Za-z0-9_-]+\.[A-Za-z0-9]+`，
 * 中文或空格文件名会读不回来，所以重命名而不是原样复制。
 */
function writeResources(
  entries: ZipEntry[],
  files: Map<string, Buffer>,
  mediaDir: string
): Map<string, string> {
  const resources = new Map<string, string>()
  const used = new Set<string>()

  // 先把所有资源的新文件名定下来，CSS 里引用的图片可能排在 CSS 之后才处理
  entries.forEach((entry, index) => {
    resources.set(entry.name, `../media/${safeMediaName(entry.name, index + 1, used)}`)
  })

  for (const entry of entries) {
    const data = files.get(entry.name)
    if (!data) continue
    const target = resources.get(entry.name)!
    const name = target.slice(target.lastIndexOf('/') + 1)
    if (/\.css$/i.test(name)) {
      const css = rewriteCssResources(data.toString('utf-8'), entry.name, resources)
      writeMedia(mediaDir, name, Buffer.from(css, 'utf-8'))
    } else {
      writeMedia(mediaDir, name, data)
    }
  }

  return resources
}

function writeMedia(mediaDir: string, name: string, data: Buffer): void {
  mkdirSync(mediaDir, { recursive: true })
  writeFileSync(join(mediaDir, name), data)
}

/**
 * CSS 里的 `url(...)` 相对 CSS 文件自身解析；复制之后 CSS 与图片同在 media/ 下，
 * 所以把引用改名成 media 里的文件名即可。
 */
function rewriteCssResources(
  css: string,
  cssEntry: string,
  resources: Map<string, string>
): string {
  const base = dirOf(cssEntry)
  return css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (whole, quote: string, raw: string) => {
    if (!raw || /^(?:data:|https?:|\/\/|#)/i.test(raw)) return whole
    const clean = raw.split(/[?#]/)[0] ?? ''
    if (!clean) return whole
    const resolved =
      resources.get(resolveEntry(base, clean)) ??
      resources.get(clean) ??
      resources.get(clean.split('/').pop() ?? '')
    if (!resolved) return whole
    const name = resolved.slice(resolved.lastIndexOf('/') + 1)
    return `url(${quote}${name}${quote})`
  })
}

/** 只留协议层认得的字符；重名时加序号，避免两张图互相覆盖。 */
function safeMediaName(entry: string, serial: number, used: Set<string>): string {
  const rawName = entry.slice(entry.lastIndexOf('/') + 1)
  const dot = rawName.lastIndexOf('.')
  const ext = (dot >= 0 ? rawName.slice(dot + 1) : '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const stem = (dot >= 0 ? rawName.slice(0, dot) : rawName)
    .replace(/[^A-Za-z0-9_-]/g, '')
    .slice(0, 40)

  const prefix = stem || `media${serial}`
  const suffix = ext ? `.${ext}` : ''
  let name = `${prefix}${suffix}`
  let counter = 1
  while (used.has(name)) {
    counter += 1
    name = `${prefix}-${counter}${suffix}`
  }
  used.add(name)
  return name
}

function parseMetadata(
  opf: Buffer | undefined,
  opfEntry: string,
  sourcePath: string
): { metadata: EpubMetadata; coverEntry: string | null } {
  const fallback = basename(sourcePath, extname(sourcePath)) || '未命名书籍'

  if (opf) {
    try {
      const parsed = parseOpf(opf.toString('utf-8'), opfEntry)
      const title = parsed.metadata.title.trim()
      return {
        metadata: { ...parsed.metadata, title: title || fallback },
        coverEntry: parsed.coverEntry
      }
    } catch {
      // metadata.opf 写坏了不该让整本书导不进来，用文件名兜底继续
    }
  }

  return {
    metadata: {
      title: fallback,
      author: null,
      publisher: null,
      language: null,
      isbn: null
    },
    coverEntry: null
  }
}

function readCover(
  declared: string | null,
  entries: ZipEntry[],
  files: Map<string, Buffer>
): { data: Buffer; ext: string } | null {
  const guessed = entries.find((entry) => /(^|\/)cover\.(?:jpe?g|png|gif|webp|bmp)$/i.test(entry.name))
    ?.name
  const entry = declared && files.has(declared) ? declared : guessed
  if (!entry) return null
  const data = files.get(entry)
  if (!data) return null
  return { data, ext: extname(entry).replace(/^\./, '') || 'jpg' }
}
