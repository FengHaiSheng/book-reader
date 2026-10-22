import { readdirSync, statSync, type Dirent } from 'node:fs'
import { join } from 'node:path'

export type FileEntry = { name: string; path: string; bytes: number; mtime: number }

/** 目录不存在（或没权限）按空目录算：占用统计不该让设置页报错 */
function readDir(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

/**
 * 递归累加目录占用。目录不存在按 0 算——「还没导入过书」不是错误。
 * 单个文件读不到（权限、刚被删）也按 0 算。
 */
export function dirBytes(dir: string): number {
  let total = 0
  for (const entry of readDir(dir)) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      total += dirBytes(path)
      continue
    }
    try {
      total += statSync(path).size
    } catch {
      // 读不到就按 0 算
    }
  }
  return total
}

/** 列出目录下的文件（不递归），按名字排序，供导出与备份列表用 */
export function listFiles(dir: string): FileEntry[] {
  const files: FileEntry[] = []
  for (const entry of readDir(dir)) {
    if (!entry.isFile()) continue
    const path = join(dir, entry.name)
    try {
      const stat = statSync(path)
      files.push({ name: entry.name, path, bytes: stat.size, mtime: stat.mtimeMs })
    } catch {
      // 读不到就跳过
    }
  }
  return files.sort((a, b) => a.name.localeCompare(b.name))
}

/** 只列子目录名。书库的每一层都是「一本书一个目录」 */
export function listDirs(dir: string): string[] {
  return readDir(dir)
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

/** 单个文件的大小；文件不存在按 0 算 */
export function singleFileBytes(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}
