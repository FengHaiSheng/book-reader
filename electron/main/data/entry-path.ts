/**
 * 判断 zip 内的 entry 名能不能落到磁盘上。
 *
 * 导出包只会有 `db.sqlite`、`README.txt` 与 `library/<bookId>/<file>`，
 * 但压缩包是可以被伪造的：`../`、绝对路径与反斜杠一律拒绝，
 * 不让一个坏包把文件写到 userData 之外。
 */
export function isSafeEntry(name: string): boolean {
  if (!name || name.startsWith('/') || name.includes('\\') || name.includes('\0')) return false
  const parts = name.split('/')
  const isDir = name.endsWith('/')
  const meaningful = isDir ? parts.slice(0, -1) : parts
  if (meaningful.length === 0) return false
  return meaningful.every((part) => part !== '' && part !== '.' && part !== '..')
}
