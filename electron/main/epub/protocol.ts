import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { protocol } from 'electron'
import { CHAPTER_CSP } from '@shared/csp'
import { COVER_ENTRY } from '@shared/epub'
import { bookDir } from '../library/paths'
import { readEntries } from './zip'
import {
  EPUB_SCHEME,
  hasExtension,
  mimeFor,
  parseEpubUrl,
  sniffDocumentMime,
  sniffImageMime
} from './epub-url'

/**
 * 登记 epub:// 的权限。**必须在 app ready 之前调用**，否则拿不到 standard / secure 这些权限。
 *
 * standard 让 `epub://<bookId>/a/b` 能按「主机名 + 路径」解析（否则整串都会当成 host）；
 * supportFetchAPI 让渲染进程能 fetch 它；corsEnabled 让 `Access-Control-Allow-Origin` 生效
 * ——字体与跨源样式表都要求 CORS，缺了这条书里的 @font-face 会静默失败。
 */
export function registerEpubScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: EPUB_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
    }
  ])
}

/**
 * 挂上实际的读取。按需解压单个 entry，不预解压整本书（spec §3.3）。
 */
export function handleEpubProtocol(): void {
  protocol.handle(EPUB_SCHEME, async (request) => {
    const target = parseEpubUrl(request.url)
    if (!target) return new Response(null, { status: 400 })

    // 封面不进 zip：导入时已经抽成文件了，直接读（spec §3.3 的「只有封面例外」）
    if (target.entry === COVER_ENTRY) return serveCover(target.bookId)

    // 非 epub 格式导入时生成的章节 HTML 也落在书目录里；路径形状固定，不接受任意文件名。
    // 文件不存在时继续走 zip，避免 epub 里恰好有同名 entry 时被这里挡住
    if (GENERATED_PAGE_ENTRY.test(target.entry)) {
      const page = serveGeneratedPage(target.bookId, target.entry)
      if (page) return page
    }

    // 解析器把封面、插图、样式写到 media/ 下；文件名同样是限定形状
    if (MEDIA_ENTRY.test(target.entry)) {
      const media = serveMedia(target.bookId, target.entry)
      if (media) return media
    }

    // 有扩展名的一律走白名单，认不出就拒绝：书内的 .js 靠这条挡住
    const known = mimeFor(target.entry)
    if (!known && hasExtension(target.entry)) return new Response(null, { status: 403 })

    try {
      const files = await readEntries(join(bookDir(target.bookId), 'book.epub'), [target.entry])
      const buffer = files.get(target.entry)
      if (!buffer) return new Response(null, { status: 404 })

      // 无扩展名的（转换工具产出的 epub 会把正文写成 OEBPS/Text/chapter001）只能读出来认
      const mime = known ?? sniffDocumentMime(buffer)
      if (!mime) return new Response(null, { status: 403 })

      const headers: Record<string, string> = {
        'Content-Type': mime,
        'Access-Control-Allow-Origin': '*'
      }
      // 章节文档正常由渲染进程 fetch 回来自己加工；万一被直接导航到这里，响应头里的 CSP 也挡住脚本
      if (mime === 'application/xhtml+xml') headers['Content-Security-Policy'] = CHAPTER_CSP
      // Buffer 在当前 @types/node 下不能直接作为 BodyInit，转成 Uint8Array 保持同一份字节
      return new Response(new Uint8Array(buffer), { headers })
    } catch {
      // 书不存在、目录被删、zip 损坏：对渲染进程来说都是 404，不需要区分
      return new Response(null, { status: 404 })
    }
  })
}

const COVER_FILE = /^cover\.[a-z0-9]+$/i

/** 生成的章节固定写成 `<prefix>/00001.html`，位数与导入时 padStart(5) 一致 */
const GENERATED_PAGE_ENTRY = /^(?:pdf|chapters)\/\d{5}\.html$/

/**
 * media/ 下只接受「单层文件名 + 扩展名」。
 * 解析器落盘时扩展名可能是 .bin（例如 MOBI 里带的是 JPEG），所以不按扩展名白名单卡，
 * 读出来之后按文件头认 MIME。
 */
const MEDIA_ENTRY = /^media\/[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/

/**
 * 读导入时生成到 `library/<bookId>/<entry>` 的章节。
 *
 * 文件名由上面的正则限死，entry 不参与任意路径拼接，出不了这本书的目录。
 */
function serveGeneratedPage(bookId: string, entry: string): Response | null {
  try {
    const bytes = readFileSync(join(bookDir(bookId), entry))
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'application/xhtml+xml',
        'Access-Control-Allow-Origin': '*',
        // 与 zip 里的章节同一口径：即使被直接导航也挡掉脚本
        'Content-Security-Policy': CHAPTER_CSP
      }
    })
  } catch {
    return null
  }
}

/** 读 `library/<bookId>/media/` 里的插图、字体、音视频。 */
function serveMedia(bookId: string, entry: string): Response | null {
  try {
    const bytes = readFileSync(join(bookDir(bookId), entry))
    const name = entry.slice(entry.lastIndexOf('/') + 1)
    const mime = sniffImageMime(bytes) ?? mimeFor(name)
    if (!mime) return new Response(null, { status: 403 })

    const headers: Record<string, string> = {
      'Content-Type': mime,
      'Access-Control-Allow-Origin': '*'
    }
    if (mime === 'application/xhtml+xml') headers['Content-Security-Policy'] = CHAPTER_CSP
    return new Response(new Uint8Array(bytes), { headers })
  } catch {
    return null
  }
}

/**
 * 从 `library/<bookId>/` 里找封面文件。
 *
 * 只认 `cover.<ext>` 这个形状，不接受任何来自 URL 的文件名——路径完全由
 * `bookId` 与这个正则决定，URL 里的东西一个字都进不了路径拼接。
 */
function serveCover(bookId: string): Response {
  const dir = bookDir(bookId)

  let name: string
  try {
    name = readdirSync(dir).find((file) => COVER_FILE.test(file)) ?? ''
  } catch {
    // 书不存在、目录被删：对渲染进程都是 404
    return new Response(null, { status: 404 })
  }
  if (!name) return new Response(null, { status: 404 })

  let bytes: Buffer
  try {
    bytes = readFileSync(join(dir, name))
  } catch {
    return new Response(null, { status: 404 })
  }

  // 封面扩展名来自 epub 内部，可能是 .jfif 这类别名，白名单会漏；先按文件头认格式，
  // 认不出再退回按扩展名查（.svg 这类文本格式靠这条兜住）。
  const mime = sniffImageMime(bytes) ?? mimeFor(name)
  if (!mime) return new Response(null, { status: 404 })

  return new Response(new Uint8Array(bytes), {
    headers: { 'Content-Type': mime, 'Access-Control-Allow-Origin': '*' }
  })
}
