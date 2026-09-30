/**
 * 把 epub 内部的相对 href 解析成 zip 内部的绝对 entry 名。
 * 两个必须处理的脏数据：href 常带 #fragment；文件名里的空格常被写成 %20。
 */
export function resolveEntry(baseDir: string, href: string): string {
  const noFragment = href.split('#')[0] ?? ''
  let decoded = noFragment
  try {
    decoded = decodeURIComponent(noFragment)
  } catch {
    // 畸形百分号编码：按原样处理，不让一个坏 href 打断整本书的解析
  }

  // 以 / 开头的 href 在 zip 内部语义上就是相对 zip 根，不能再叠加 OPF 目录。
  const base = decoded.startsWith('/') ? '' : baseDir
  const parts = `${base}/${decoded}`.split('/')
  const out: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      out.pop()
      continue
    }
    out.push(part)
  }
  return out.join('/')
}

export function dirOf(entry: string): string {
  const index = entry.lastIndexOf('/')
  return index < 0 ? '' : entry.slice(0, index)
}
