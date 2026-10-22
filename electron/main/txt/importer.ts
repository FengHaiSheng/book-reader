import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import type Database from 'better-sqlite3'
import type { ImportOutcome, ImportProgress } from '@shared/types'
import type { SpineText, TocNode } from '../epub/types'
import {
  GENERATED_CHAPTER_DIR,
  importGeneratedBook,
  type GeneratedDraft
} from '../library/generated-importer'
import { decodeTxt, splitTxtChapters } from './parse'
import { escapeHtml, wrapXhtml } from '../library/xhtml'

type ProgressFn = (progress: ImportProgress) => void

/**
 * 导入 txt：解码 → 按标题行分章 → 生成 XHTML → 与 epub/pdf 共用落库与阅读链路。
 * 原文件留作底稿，之后原位置的文件移动或删除都不影响阅读。
 */
export async function importTxt(
  db: Database.Database,
  sourcePath: string,
  onProgress: ProgressFn = () => {}
): Promise<ImportOutcome> {
  return importGeneratedBook(
    db,
    sourcePath,
    'txt',
    async (): Promise<GeneratedDraft> => {
      const chapters = splitTxtChapters(decodeTxt(await readFile(sourcePath)))

      const toc: TocNode[] = []
      const spine: string[] = []
      const texts: SpineText[] = []
      const htmlByEntry = new Map<string, string>()

      chapters.forEach((chapter, index) => {
        const entry = `${GENERATED_CHAPTER_DIR}/${String(index + 1).padStart(5, '0')}.html`
        toc.push({ title: chapter.title, entry, children: [] })
        spine.push(entry)
        texts.push({ entry, text: chapter.text, heading: chapter.title })
        htmlByEntry.set(entry, renderChapter(chapter.title, chapter.text))
      })

      return {
        metadata: {
          title: basename(sourcePath, extname(sourcePath)) || '未命名书籍',
          author: null,
          publisher: null,
          language: null,
          isbn: null
        },
        toc,
        spine,
        texts,
        htmlByEntry,
        cover: null
      }
    },
    onProgress
  )
}

function renderChapter(title: string, text: string): string {
  const paragraphs = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('\n')

  return wrapXhtml(`<h2>${escapeHtml(title)}</h2>${paragraphs}`, title)
}
