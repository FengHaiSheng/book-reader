import { copyFileSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { ImportOutcome, ImportProgress } from '@shared/types'
import { appError, toAppError } from '@shared/errors'
import { buildChapters } from '../epub/chapters'
import { buildChunks } from '../epub/chunks'
import { totalChars } from '../epub/parse'
import { sha256File } from '../storage/sha256'
import { bookDir, ensureLibraryDir } from './paths'
import { findByHash, insertBookGraph, type ChapterInsert } from './repo'
import { buildPdfDraft } from '../pdf/chapters'
import { extractPdfInWorker } from '../pdf/extract-pool'

type ProgressFn = (progress: ImportProgress) => void

/**
 * 导入一本 PDF：去重 → 抽文字与书签 → 生成可重排的 XHTML 章节 → 单事务落库。
 *
 * 原文件留在书库里（book.pdf）作为底稿，但阅读用的是生成的章节 HTML，
 * 这样分页、CFI、划词与全文搜索和 epub 完全共用一条链路。
 */
export async function importPdf(
  db: Database.Database,
  sourcePath: string,
  onProgress: ProgressFn = () => {}
): Promise<ImportOutcome> {
  if (!existsSync(sourcePath)) {
    throw appError('FILE_MISSING', '找不到这个文件，可能已被移动或删除')
  }

  ensureLibraryDir()

  onProgress({ phase: 'hash', done: 0, total: 1 })
  const fileHash = await sha256File(sourcePath)
  const existing = findByHash(db, fileHash)
  if (existing) {
    return { status: 'duplicate', bookId: existing.id, title: existing.title }
  }

  onProgress({ phase: 'extract', done: 0, total: 1 })
  const extracted = await extractPdfInWorker(sourcePath, (done, total) => {
    onProgress({ phase: 'extract', done, total })
  })

  const title =
    extracted.title ?? basename(sourcePath, extname(sourcePath)) ?? '未命名 PDF'
  const draft = buildPdfDraft(extracted)
  if (draft.texts.length === 0) {
    throw appError(
      'PDF_PARSE_FAILED',
      '这本 PDF 没有可抽取的文字，可能是扫描版；扫描件需要 OCR，暂不支持'
    )
  }

  const chapterRows = buildChapters(draft.toc, draft.spine, draft.texts)
  const textByEntry = new Map(draft.texts.map((item) => [item.entry, item.text]))
  const chapters: ChapterInsert[] = chapterRows.map((row) => ({
    row,
    headingPath: `${title} > ${row.title}`,
    chunks: buildChunks(row.entry ? (textByEntry.get(row.entry) ?? '') : '')
  }))

  const bookId = randomUUID()
  const dir = bookDir(bookId)
  mkdirSync(dir, { recursive: true })

  try {
    const filePath = join(dir, 'book.pdf')
    copyFileSync(sourcePath, filePath)

    onProgress({ phase: 'store', done: 0, total: 1 })
    writeChapters(dir, draft.htmlByEntry)

    const run = db.transaction(() => {
      insertBookGraph(db, {
        id: bookId,
        title,
        author: extracted.author,
        publisher: null,
        language: extracted.language,
        isbn: null,
        coverPath: null,
        filePath,
        fileHash,
        fileSize: statSync(sourcePath).size,
        totalChars: totalChars(draft.texts),
        chapterCount: chapterRows.filter((row) => row.orderIndex !== null).length,
        addedAt: Date.now()
      }, chapters)
    })
    run()
    onProgress({ phase: 'store', done: 1, total: 1 })

    return { status: 'imported', bookId, title }
  } catch (error) {
    rmSync(dir, { recursive: true, force: true })
    throw toAppError(error, '导入失败，已回滚，没有留下未完成的数据')
  }
}

/** 章节 HTML 写到 `library/<bookId>/pdf/`，由 epub:// 协议按同一套路径规则读回。 */
function writeChapters(dir: string, htmlByEntry: Map<string, string>): void {
  if (htmlByEntry.size === 0) return
  const chapterDir = join(dir, 'pdf')
  mkdirSync(chapterDir, { recursive: true })
  for (const [entry, html] of htmlByEntry) {
    writeFileSync(join(dir, entry), html, 'utf-8')
  }
}
