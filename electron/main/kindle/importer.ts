import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import type Database from 'better-sqlite3'
import type { ImportOutcome, ImportProgress } from '@shared/types'
import {
  importGeneratedBook,
  type GeneratedDraft
} from '../library/generated-importer'
import { buildKindleDraft } from './draft'
import { extractKindleInWorker } from './extract-pool'
import type { KindleKind } from './types'

type ProgressFn = (progress: ImportProgress) => void

/**
 * 导入 MOBI / AZW / AZW3：内置解析器解包 → 生成 XHTML 章节 → 落库。
 *
 * 扩展名决定解析器，但两种容器可能互相包含（mobi 里带 KF8、azw3 只有 MOBI 部分），
 * 所以解析失败时用另一个解析器再试一次。
 */
export async function importKindle(
  db: Database.Database,
  sourcePath: string,
  kind: KindleKind,
  onProgress: ProgressFn = () => {}
): Promise<ImportOutcome> {
  const extension = extname(sourcePath).replace(/^\./, '').toLowerCase() || 'mobi'

  return importGeneratedBook(
    db,
    sourcePath,
    extension,
    async (_dir, mediaDir): Promise<GeneratedDraft> => {
      const extract = await extractWithFallback(kind, sourcePath, mediaDir, onProgress)
      const cover = await readCover(extract.coverPath)
      return buildKindleDraft(extract, sourcePath, cover)
    },
    onProgress
  )
}

/** FB2 与 Kindle 共用解包线程，只是换了解析器。 */
export async function importFb2(
  db: Database.Database,
  sourcePath: string,
  onProgress: ProgressFn = () => {}
): Promise<ImportOutcome> {
  return importGeneratedBook(
    db,
    sourcePath,
    'fb2',
    async (_dir, mediaDir): Promise<GeneratedDraft> => {
      const extract = await extractKindleInWorker('fb2', sourcePath, mediaDir, (done, total) =>
        onProgress({ phase: 'extract', done, total })
      )
      const cover = await readCover(extract.coverPath)
      return buildKindleDraft(extract, sourcePath, cover)
    },
    onProgress
  )
}

async function extractWithFallback(
  kind: KindleKind,
  sourcePath: string,
  mediaDir: string,
  onProgress: ProgressFn
) {
  const progress = (done: number, total: number): void =>
    onProgress({ phase: 'extract', done, total })

  try {
    return await extractKindleInWorker(kind, sourcePath, mediaDir, progress)
  } catch (first) {
    const fallback: KindleKind = kind === 'kf8' ? 'mobi' : 'kf8'
    try {
      return await extractKindleInWorker(fallback, sourcePath, mediaDir, progress)
    } catch {
      // 两次都失败时抛第一次的错误：它对应的扩展名更接近用户手里的文件
      throw first
    }
  }
}

async function readCover(path: string | null): Promise<{ data: Buffer; ext: string } | null> {
  if (!path) return null
  try {
    return {
      data: await readFile(path),
      ext: extname(path).replace(/^\./, '') || 'jpg'
    }
  } catch {
    // 封面读不到不该让整本书导不进来
    return null
  }
}
