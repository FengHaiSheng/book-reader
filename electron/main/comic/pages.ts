import { sniffImageMime } from '../epub/epub-url'

/**
 * 漫画页的挑选与排序。
 *
 * 纯函数、不碰文件系统，pages.ts 与导入器都能直接用，也方便在 vitest 里单测。
 * 漫画包里经常混着 `__MACOSX/`、`.DS_Store`、`ComicInfo.xml` 与封面图，
 * 不加筛选会把它们当成页面读进书里。
 */

/** 协议层能服务、浏览器能解码的图片类型 */
const IMAGE_EXT = /\.(?:jpe?g|jpe|jfif|png|gif|webp|bmp)$/i

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp'
}

/** 隐藏文件 / 目录、macOS 资源叉、Windows 缩略图缓存都不算页面 */
export function isComicPage(name: string): boolean {
  if (!IMAGE_EXT.test(name)) return false
  return !name
    .split('/')
    .some((segment) => segment.startsWith('.') || segment === '__MACOSX')
}

/**
 * 自然排序：`page2.jpg` 必须排在 `page10.jpg` 前面。
 *
 * 用 `en` 的 numeric collation 而不是逐个字符比较，`001.jpg`、`第 12 页.jpg`
 * 这类常见命名都能得到符合直觉的顺序。排序结果同时决定页码。
 */
export function sortPageNames(names: readonly string[]): string[] {
  const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })
  return [...names].sort(collator.compare)
}

/**
 * 落盘时用的扩展名。
 *
 * 优先信文件名（`.jfif` / `.jpe` 这类 JPEG 别名统一改成 `.jpg`），
 * 名字认不出时再看文件头 —— 有些包里的图片压根没有扩展名。
 * 两者都认不出返回 null，这一页不写、也不占页码。
 */
export function pageFileExt(name: string, bytes: Uint8Array): string | null {
  const dot = name.lastIndexOf('.')
  if (dot >= 0) {
    const raw = name.slice(dot + 1).toLowerCase()
    if (raw === 'jpeg' || raw === 'jpe' || raw === 'jfif') return 'jpg'
    if (raw === 'jpg' || raw === 'png' || raw === 'gif' || raw === 'webp' || raw === 'bmp') return raw
  }
  const mime = sniffImageMime(bytes)
  return mime ? (EXT_BY_MIME[mime] ?? null) : null
}

/** 整页图在 book 目录里的 entry 名，与 protocol 层的 media/ 白名单同一形状 */
export function pageEntry(name: string): string {
  return `media/${name}`
}

/** 页面文件名固定成 `00001.jpg`，字典序就是阅读顺序 */
export function pageFileName(index: number, ext: string): string {
  return `${String(index).padStart(5, '0')}.${ext}`
}
