import { copyFileSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { ImportOutcome, ImportProgress } from '@shared/types'
import { appError, toAppError } from '@shared/errors'
import { buildChapters } from '../epub/chapters'
import { buildChunks } from '../epub/chunks'
import { extractInWorker } from '../epub/extract-pool'
import { loadToc, readEpubInfo, totalChars } from '../epub/parse'
import { readEntries } from '../epub/zip'
import { sha256File } from '../storage/sha256'
import { bookDir, ensureLibraryDir } from './paths'
import { findByHash, insertBookGraph, type ChapterInsert } from './repo'

type ProgressFn = (progress: ImportProgress) => void

/**
 * 导入一本 epub。流程：去重 → 解析 → 抽取 → 复制文件 → 单事务落库。
 * 任何一步失败都不留半本书：数据库事务回滚，已复制的目录一并删掉。
 */
export async function importEpub(
  db: Database.Database,
  sourcePath: string,
  onProgress: ProgressFn = () => {}
): Promise<ImportOutcome> {
  if (!existsSync(sourcePath)) {
    throw appError('FILE_MISSING', '找不到这个文件，可能已被移动或删除')
  }

  // 提前建库目录：即便这次导入失败，书库根目录也应存在且保持干净
  ensureLibraryDir()

  onProgress({ phase: 'hash', done: 0, total: 1 })
  const fileHash = await sha256File(sourcePath)
  const existing = findByHash(db, fileHash)
  if (existing) {
    return { status: 'duplicate', bookId: existing.id, title: existing.title }
  }

  const info = await readEpubInfo(sourcePath)
  const toc = await loadToc(sourcePath, info)

  onProgress({ phase: 'extract', done: 0, total: info.spineEntries.length })
  const [texts, cover] = await Promise.all([
    extractInWorker(sourcePath, info.spineEntries),
    readCover(sourcePath, info.coverEntry)
  ])
  onProgress({ phase: 'extract', done: texts.length, total: info.spineEntries.length })

  const chapterRows = buildChapters(toc, info.spineEntries, texts)
  const textByEntry = new Map(texts.map((item) => [item.entry, item.text]))
  const chapters: ChapterInsert[] = chapterRows.map((row) => ({
    row,
    headingPath: `${info.metadata.title} > ${row.title}`,
    chunks: buildChunks(row.entry ? (textByEntry.get(row.entry) ?? '') : '')
  }))

  const bookId = randomUUID()
  const dir = bookDir(bookId)
  mkdirSync(dir, { recursive: true })

  try {
    const filePath = join(dir, 'book.epub')
    copyFileSync(sourcePath, filePath)

    onProgress({ phase: 'store', done: 0, total: 1 })
    const run = db.transaction(() => {
      insertBookGraph(db, {
        id: bookId,
        title: info.metadata.title,
        author: info.metadata.author,
        publisher: info.metadata.publisher,
        language: info.metadata.language,
        isbn: info.metadata.isbn,
        coverPath: writeCoverSync(cover, info.coverEntry, dir),
        filePath,
        fileHash,
        fileSize: statSync(sourcePath).size,
        totalChars: totalChars(texts),
        chapterCount: chapterRows.filter((row) => row.orderIndex !== null).length,
        addedAt: Date.now()
      }, chapters)
    })
    run()
    onProgress({ phase: 'store', done: 1, total: 1 })

    return { status: 'imported', bookId, title: info.metadata.title }
  } catch (error) {
    rmSync(dir, { recursive: true, force: true })
    throw toAppError(error, '导入失败，已回滚，没有留下未完成的数据')
  }
}

/** 封面读不到就返回 null——封面缺失/损坏不该让整本书导不进来。 */
async function readCover(zipPath: string, coverEntry: string | null): Promise<Buffer | null> {
  if (!coverEntry) return null
  try {
    const files = await readEntries(zipPath, [coverEntry])
    const buffer = files.get(coverEntry)
    return buffer && buffer.length > 0 ? buffer : null
  } catch {
    return null
  }
}

/** 只能在事务里调用，因为它是同步的。 */
function writeCoverSync(cover: Buffer | null, coverEntry: string | null, dir: string): string | null {
  if (!cover) return null
  const ext = coverEntry ? extname(coverEntry).toLowerCase() || '.jpg' : '.jpg'
  const target = join(dir, `cover${ext}`)
  writeFileSync(target, cover)
  return target
}
