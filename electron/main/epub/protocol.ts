import { join } from 'node:path'
import { protocol } from 'electron'
import { CHAPTER_CSP } from '@shared/csp'
import { bookDir } from '../library/paths'
import { EPUB_SCHEME, hasExtension, mimeFor, parseEpubUrl, sniffDocumentMime } from './epub-url'
import { readEntries } from './zip'

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
