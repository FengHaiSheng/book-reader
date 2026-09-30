import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

export function libraryDir(): string {
  return join(app.getPath('userData'), 'library')
}

/** 每本书一个目录，里面只放这一本书的 epub 与封面。 */
export function bookDir(bookId: string): string {
  return join(libraryDir(), bookId)
}

export function ensureLibraryDir(): string {
  const dir = libraryDir()
  mkdirSync(dir, { recursive: true })
  return dir
}
