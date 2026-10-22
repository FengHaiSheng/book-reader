import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import yauzl from 'yauzl'
import { createExtractorFromData, type FileHeader } from 'node-unrar-js'
import type Database from 'better-sqlite3'
import type { ImportOutcome, ImportProgress } from '@shared/types'
import { appError, toAppError } from '@shared/errors'
import { sha256File } from '../storage/sha256'
import { bookDir, ensureLibraryDir } from '../library/paths'
import { findByHash, insertBookGraph, type ChapterInsert } from '../library/repo'
import { listEntries, type ZipEntry } from '../epub/zip'
import { isComicPage, pageEntry, pageFileExt, pageFileName, sortPageNames } from './pages'

type ProgressFn = (progress: ImportProgress) => void

/** RAR 一次解出这么多页再落盘：整本一次解开会把几百 MB 图片同时留在内存里 */
const RAR_BATCH = 24

const MEDIA_DIR = 'media'

/**
 * 导入一本漫画（CBZ / CBR）。
 *
 * 与文字格式不同，漫画不生成章节 HTML：每一页就是一条 chapter，href 指向
 * `media/00001.jpg`，阅读端用图片浏览模式整页显示。全文检索与 AI 对漫画自然不适用，
 * 所以这里不建 chunks。
 *
 * 压缩格式按文件头判断而不是扩展名：`.cbr` 实际是 zip 的包很常见，反过来也有。
 */
export async function importComic(
  db: Database.Database,
  sourcePath: string,
  extension: 'cbz' | 'cbr',
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
  const mediaDir = join(dir, MEDIA_DIR)
  mkdirSync(mediaDir, { recursive: true })

  try {
    onProgress({ phase: 'extract', done: 0, total: 1 })
    const pages = await extractPages(sourcePath, mediaDir, onProgress)
    if (pages.length === 0) {
      throw appError('BOOK_PARSE_FAILED', '这个文件里没有可显示的图片页面，可能不是漫画压缩包')
    }

    const title = basename(sourcePath, extname(sourcePath)).trim() || '未命名漫画'
    const coverPath = writeCover(mediaDir, dir, pages[0]!)

    onProgress({ phase: 'store', done: 0, total: 1 })
    copyFileSync(sourcePath, join(dir, `book.${extension}`))

    const chapters: ChapterInsert[] = pages.map((name, index) => ({
      row: {
        title: `第 ${index + 1} 页`,
        entry: pageEntry(name),
        depth: 0,
        parentIndex: null,
        orderIndex: index,
        charStart: null,
        charEnd: null
      },
      // 漫画没有可检索的正文，不建 chunk；全文搜索与 AI 自然不覆盖这类书
      chunks: [],
      headingPath: `${title} > 第 ${index + 1} 页`
    }))

    db.transaction(() => {
      insertBookGraph(
        db,
        {
          id: bookId,
          title,
          author: null,
          publisher: null,
          language: null,
          isbn: null,
          coverPath,
          filePath: join(dir, `book.${extension}`),
          fileHash,
          fileSize: statSync(sourcePath).size,
          totalChars: 0,
          chapterCount: pageCount(chapters),
          addedAt: Date.now(),
          kind: 'comic'
        },
        chapters
      )
    })()

    onProgress({ phase: 'store', done: 1, total: 1 })
    return { status: 'imported', bookId, title }
  } catch (error) {
    rmSync(dir, { recursive: true, force: true })
    throw toAppError(error, '导入失败，已回滚，没有留下未完成的数据')
  }
}

/** 有正文的章节数（分组节点 orderIndex 为空，漫画这里全是有序页） */
function pageCount(chapters: ChapterInsert[]): number {
  return chapters.filter((chapter) => chapter.row.orderIndex !== null).length
}

/**
 * 把压缩包里的图片按页写进 media/，返回按页序排好的文件名。
 *
 * 落盘之后的文件名是 `00001.jpg` 这种固定形状，所以最终顺序以目录里的实际文件为准：
 * 个别图片坏掉被跳过时，不会在页码里留一个洞。
 */
async function extractPages(
  sourcePath: string,
  mediaDir: string,
  onProgress: ProgressFn
): Promise<string[]> {
  const head = readFileSync(sourcePath).subarray(0, 8)
  const isRar = head.subarray(0, 7).toString('latin1') === 'Rar!\x1A\x07'

  if (isRar) {
    await extractRarPages(sourcePath, mediaDir, onProgress)
  } else {
    await extractZipPages(sourcePath, mediaDir, onProgress)
  }

  return readdirSync(mediaDir)
    .filter((name) => isComicPage(name))
    .sort()
}

function writePage(mediaDir: string, index: number, name: string, bytes: Uint8Array): boolean {
  const ext = pageFileExt(name, bytes)
  if (!ext) return false
  writeFileSync(join(mediaDir, pageFileName(index, ext)), bytes)
  return true
}

/** 只认 zip 的流式读取：一次只在内存里放一页，不把整本漫画读进来 */
async function extractZipPages(
  zipPath: string,
  mediaDir: string,
  onProgress: ProgressFn
): Promise<void> {
  let entries: ZipEntry[]
  try {
    entries = await listEntries(zipPath)
  } catch (error) {
    // listEntries 的口径是 epub，这里换成漫画的说法，别让用户以为自己的书是坏 epub
    throw appError('BOOK_PARSE_FAILED', '这个文件既不是 zip 也不是 rar，不像一份 CBZ / CBR 漫画', {
      detail: error instanceof Error ? error.message : String(error)
    })
  }

  const names = sortPageNames(
    entries.filter((entry) => isComicPage(entry.name)).map((entry) => entry.name)
  )
  if (names.length === 0) return

  // 页码按自然排序的位置定，而不是按压缩包里的条目顺序
  const position = new Map(names.map((name, index) => [name, index + 1]))
  let done = 0

  await new Promise<void>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (err, zip) => {
      if (err || !zip) {
        reject(
          appError('BOOK_PARSE_FAILED', '这个 CBZ 打不开，文件可能已经损坏', {
            detail: err?.message
          })
        )
        return
      }

      let settled = false
      const finish = (fn: () => void): void => {
        if (settled) return
        settled = true
        zip.close()
        fn()
      }

      zip.on('entry', (entry: yauzl.Entry) => {
        const index = position.get(entry.fileName)
        if (index === undefined) {
          zip.readEntry()
          return
        }
        zip.openReadStream(entry, (streamErr, stream) => {
          if (streamErr || !stream) {
            finish(() => reject(toAppError(streamErr, `读不出 ${entry.fileName}`)))
            return
          }
          const chunks: Buffer[] = []
          stream.on('data', (chunk: Buffer) => chunks.push(chunk))
          stream.on('end', () => {
            if (settled) return
            try {
              writePage(mediaDir, index, entry.fileName, Buffer.concat(chunks))
            } catch (writeErr) {
              finish(() => reject(writeErr))
              return
            }
            done += 1
            onProgress({ phase: 'extract', done, total: names.length })
            zip.readEntry()
          })
          stream.on('error', (streamErr) => {
            finish(() => reject(toAppError(streamErr, `读不出 ${entry.fileName}`)))
          })
        })
      })

      zip.on('end', () => finish(resolve))
      zip.on('error', (zipErr) => finish(() => reject(zipErr)))
      zip.readEntry()
    })
  })
}

/** RAR 走官方 unrar 的 wasm 实现，按批解压以控制内存 */
async function extractRarPages(
  sourcePath: string,
  mediaDir: string,
  onProgress: ProgressFn
): Promise<void> {
  const raw = readFileSync(sourcePath)
  const data = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer

  let extractor: Awaited<ReturnType<typeof createExtractorFromData>>
  let listed: FileHeader[]
  try {
    extractor = await createExtractorFromData({ data })
    listed = [...extractor.getFileList().fileHeaders]
  } catch (error) {
    // 文件头能认出是 rar，但内容损坏 / 不完整：说清是哪一步失败，别落到通用的「导入失败」
    throw appError('BOOK_PARSE_FAILED', '这个 CBR 打不开，文件可能已经损坏', {
      detail: error instanceof Error ? error.message : String(error)
    })
  }

  const names = sortPageNames(listed.filter(isPageHeader).map((header) => header.name))
  const wanted = new Set(names)

  let index = 0
  let done = 0
  for (let start = 0; start < names.length; start += RAR_BATCH) {
    const batch = names.slice(start, start + RAR_BATCH)
    let extracted: ReturnType<typeof extractor.extract>
    try {
      extracted = extractor.extract({ files: batch })
    } catch (error) {
      throw appError('BOOK_PARSE_FAILED', '这个 CBR 里的图片解不出来，文件可能已经损坏', {
        detail: error instanceof Error ? error.message : String(error)
      })
    }
    // 必须把生成器走到尾：不遍历完，unrar 的 C++ 对象不会被释放
    for (const file of extracted.files) {
      const bytes = file.extraction
      if (!bytes || !wanted.has(file.fileHeader.name)) continue
      index += 1
      writePage(mediaDir, index, file.fileHeader.name, bytes)
      done += 1
      onProgress({ phase: 'extract', done, total: Math.max(names.length, done) })
    }
  }
}

function isPageHeader(header: FileHeader): boolean {
  return !header.flags.directory && isComicPage(header.name)
}

/** 封面就是第一页：直接复制一份，书架上不再单独生成缩略图 */
function writeCover(mediaDir: string, dir: string, pageName: string): string {
  const ext = extname(pageName).replace(/^\./, '') || 'jpg'
  const target = join(dir, `cover.${ext}`)
  copyFileSync(join(mediaDir, pageName), target)
  return target
}
