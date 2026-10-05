/**
 * epub://<bookId>/<entry> 的解析与校验。
 *
 * 纯函数、不依赖 electron，因此能在 vitest 里直接跑——协议层最需要被测试的就是这里的判断。
 */

import { EPUB_SCHEME } from '@shared/epub'

export { EPUB_SCHEME }

/** 导入时用的是 randomUUID()，这里只认这一种形状 */
const BOOK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export type EpubUrl = { bookId: string; entry: string }

export function isBookId(value: string): boolean {
  return BOOK_ID.test(value)
}

/**
 * 解析一个 epub:// 请求。
 *
 * 安全上真正的保证是**结构性的**：文件路径只由 bookId 决定
 * （`library/<bookId>/book.epub`），entry 只用来在 zip 里查条目，
 * 从不参与文件系统路径拼接，所以 entry 就算带穿越也出不了这一本书。
 * 下面这些校验是第二道防线，不是唯一那道。
 */
export function parseEpubUrl(url: string): EpubUrl | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${EPUB_SCHEME}:`) return null
  if (!isBookId(parsed.hostname)) return null

  let pathname: string
  try {
    pathname = decodeURIComponent(parsed.pathname)
  } catch {
    // `%zz` 这类坏转义会让 decodeURIComponent 抛错
    return null
  }

  const entry = normalizeEntry(pathname.replace(/^\/+/, ''))
  if (!entry) return null
  return { bookId: parsed.hostname, entry }
}

/**
 * 归一化 zip 内部路径：`.` 与空段丢掉，`..`、反斜杠、NUL、绝对路径一律拒绝。
 *
 * 注意 `..` 是拒绝而不是化解：合法 epub 的 manifest 里不会出现它，
 * 出现了就是有人在试探。URL 解析本身也会先化解 `..`（所以经 URL 走进来的
 * 穿越路径到不了这里），保留这条是为了函数被直接调用时同样安全。
 */
export function normalizeEntry(entry: string): string | null {
  if (!entry || entry.includes('\\') || entry.includes('\0')) return null
  if (entry.startsWith('/')) return null

  const segments: string[] = []
  for (const segment of entry.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') return null
    segments.push(segment)
  }
  return segments.length > 0 ? segments.join('/') : null
}

const MIME: Record<string, string> = {
  '.xhtml': 'application/xhtml+xml',
  '.html': 'application/xhtml+xml',
  '.htm': 'application/xhtml+xml',
  '.css': 'text/css',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4'
}

/**
 * 认得出的类型才服务，认不出的返回 null 由调用方拒绝。
 * 白名单而不是黑名单：书内的 `.js` 因此根本不会被递到渲染进程手里。
 */
export function mimeFor(entry: string): string | null {
  const dot = entry.lastIndexOf('.')
  if (dot < 0) return null
  return MIME[entry.slice(dot).toLowerCase()] ?? null
}

/** 有没有扩展名。`mimeFor` 返回 null 时要靠它区分「认不出」与「压根没有」。 */
export function hasExtension(entry: string): boolean {
  return entry.slice(entry.lastIndexOf('/') + 1).includes('.')
}

/**
 * 无扩展名的 entry 认不了文件名，只能读出来看开头。
 *
 * 真存在这种书：转换工具产出的 epub 会把正文写成 `OEBPS/Text/chapter001`（OPF 里
 * 照样声明 media-type="application/xhtml+xml"）。同一个 zip 里 `mimetype` 也没有
 * 扩展名，但它不是文档——所以按内容而不是按名字放行，认不出的一律返回 null。
 */
export function sniffDocumentMime(bytes: Uint8Array): string | null {
  const head = new TextDecoder('utf-8').decode(bytes.subarray(0, 1024))
  const text = head.replace(/^\uFEFF/, '').trimStart()
  if (text.startsWith('<?xml') || /^<!doctype\s+html\b/i.test(text) || /^<html[\s>]/i.test(text)) {
    return 'application/xhtml+xml'
  }
  return null
}

function startsWithAscii(bytes: Uint8Array, offset: number, text: string): boolean {
  if (bytes.length < offset + text.length) return false
  for (let i = 0; i < text.length; i++) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false
  }
  return true
}

/**
 * 按文件头认图片格式。封面的扩展名来自 epub 内部（`.jfif`、`.jpe` 这类 JPEG 别名很常见），
 * 按扩展名查白名单会漏，所以用真实的文件头来定 MIME。认不出的返回 null。
 */
export function sniffImageMime(bytes: Uint8Array): string | null {
  if (startsWithAscii(bytes, 0, '\xFF\xD8\xFF')) return 'image/jpeg'
  if (startsWithAscii(bytes, 0, '\x89PNG')) return 'image/png'
  if (startsWithAscii(bytes, 0, 'GIF8')) return 'image/gif'
  if (startsWithAscii(bytes, 0, 'BM')) return 'image/bmp'
  if (startsWithAscii(bytes, 0, 'RIFF') && startsWithAscii(bytes, 8, 'WEBP')) return 'image/webp'
  return null
}
