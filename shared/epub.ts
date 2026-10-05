/**
 * epub:// 的公共约定。主进程（协议实现）与渲染进程（拼 URL）都要用，
 * 所以放 shared——两边各写一遍字符串，迟早在某一侧改错。
 */

export const EPUB_SCHEME = 'epub'

/**
 * 封面的虚拟 entry。
 *
 * 封面在导入时被抽到 `library/<bookId>/cover.<ext>`，不在 zip 里，
 * 所以给它一个固定的虚拟路径，由协议层直接读文件。
 *
 * 代价：真实 zip 里若存在叫 `__cover` 的条目会被它遮住。这个风险由
 * 「同一本书的封面只有一份」兜住——就算撞上，返回的也正是这本书自己的封面。
 */
export const COVER_ENTRY = '__cover'

/** entry 里可能带空格或中文，逐段编码，别让 URL 解析器把 `/` 之外的东西吃掉 */
export function epubUrl(bookId: string, entry: string): string {
  return `${EPUB_SCHEME}://${bookId}/${entry.split('/').map(encodeURIComponent).join('/')}`
}

export function coverUrl(bookId: string): string {
  return epubUrl(bookId, COVER_ENTRY)
}