import { copyFileSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { ImportOutcome, ImportProgress } from '@shared/types'
import { appError, toAppError } from '@shared/errors'
import { buildChapters } from '../epub/chapters'
import { buildChunks } from '../epub/chunks'
import { totalChars } from '../epub/parse'
import type { EpubMetadata, SpineText, TocNode } from '../epub/types'
import { sha256File } from '../storage/sha256'
import { bookDir, ensureLibraryDir } from './paths'
import { findByHash, insertBookGraph, type ChapterInsert } from './repo'

type ProgressFn = (progress: ImportProgress) => void

/**
 * 非 epub/pdf 格式统一整理成这个形状。
 *
 * 关键是 `htmlByEntry`：解析结果先落成可重排的 XHTML 章节，阅读端就只认
 * `epub://<bookId>/<entry>`，分页、CFI、划词、全文搜索与 AI 全都不需要知道原格式。
 */
export type GeneratedDraft = {
  metadata: EpubMetadata
  toc: TocNode[]
  /** 可读章节的 entry，按阅读顺序 */
  spine: string[]
  texts: SpineText[]
  /** entry -> 生成的 XHTML */
  htmlByEntry: Map<string, string>
  cover: { data: Buffer; ext: string } | null
}

export type GeneratedBuild = (dir: string, mediaDir: string) => Promise<GeneratedDraft>

const MEDIA_DIR = 'media'

/** 章节 HTML 写在书目录下的这个子目录里，由 epub:// 协议按固定路径形状读回。 */
export const GENERATED_CHAPTER_DIR = 'chapters'

/**
 * 导入一本「非 epub」的书：去重 → 解析成 XHTML 章节 → 读回数据库。
 *
 * 原文件完整保留在 `book.<ext>` 作为底稿，但阅读走生成出来的章节，
 * 这样任何格式都复用同一条阅读链路。
 */
export async function importGeneratedBook(
  db: Database.Database,
  sourcePath: string,
  extension: string,
  build: GeneratedBuild,
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

  const bookId = randomUUID()
  const dir = bookDir(bookId)
  mkdirSync(dir, { recursive: true })
  const mediaDir = join(dir, MEDIA_DIR)

  try {
    onProgress({ phase: 'extract', done: 0, total: 1 })
    const draft = await build(dir, mediaDir)

    const title = draft.metadata.title.trim() || `未命名书籍`
    if (draft.spine.length === 0 || draft.texts.every((item) => item.text.trim() === '')) {
      throw appError('BOOK_PARSE_FAILED', '这本书没有可读的正文，文件可能已经损坏')
    }

    onProgress({ phase: 'store', done: 0, total: 1 })

    const filePath = join(dir, `book.${extension}`)
    copyFileSync(sourcePath, filePath)
    writeChapterFiles(dir, draft.htmlByEntry)
    const coverPath = writeCover(dir, draft.cover)

    const chapterRows = buildChapters(draft.toc, draft.spine, draft.texts)
    const textByEntry = new Map(draft.texts.map((item) => [item.entry, item.text]))
    const chapters: ChapterInsert[] = chapterRows.map((row) => ({
      row,
      headingPath: `${title} > ${row.title}`,
      chunks: buildChunks(row.entry ? (textByEntry.get(row.entry) ?? '') : '')
    }))

    const run = db.transaction(() => {
      insertBookGraph(
        db,
        {
          id: bookId,
          title,
          author: draft.metadata.author,
          publisher: draft.metadata.publisher,
          language: draft.metadata.language,
          isbn: draft.metadata.isbn,
          coverPath,
          filePath,
          fileHash,
          fileSize: statSync(sourcePath).size,
          totalChars: totalChars(draft.texts),
          chapterCount: chapterRows.filter((row) => row.orderIndex !== null).length,
          addedAt: Date.now(),
          kind: 'text'
        },
        chapters
      )
    })
    run()

    onProgress({ phase: 'store', done: 1, total: 1 })
    return { status: 'imported', bookId, title }
  } catch (error) {
    rmSync(dir, { recursive: true, force: true })
    throw toAppError(error, '导入失败，已回滚，没有留下未完成的数据')
  }
}

function writeChapterFiles(dir: string, htmlByEntry: Map<string, string>): void {
  if (htmlByEntry.size === 0) return
  mkdirSync(join(dir, GENERATED_CHAPTER_DIR), { recursive: true })
  for (const [entry, html] of htmlByEntry) {
    writeFileSync(join(dir, entry), html, 'utf-8')
  }
}

function writeCover(dir: string, cover: GeneratedDraft['cover']): string | null {
  if (!cover) return null
  const ext = normalizeCoverExt(cover.ext)
  const target = join(dir, `cover.${ext}`)
  writeFileSync(target, cover.data)
  return target
}

/** 封面扩展名来自外部文件，只留字母数字，避免拼出目录穿越或奇怪文件名。 */
function normalizeCoverExt(ext: string): string {
  const clean = ext.replace(/^\./, '').toLowerCase().replace(/[^a-z0-9]/g, '')
  return clean || 'jpg'
}

/** 解析器写文件时用的扩展名；没有扩展名就按 jpg 兜底。 */
export function coverExtOf(path: string): string {
  return extname(path).replace(/^\./, '') || 'jpg'
}
