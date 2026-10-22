import { basename, extname } from 'node:path'
import type { EpubMetadata, SpineText, TocNode } from '../epub/types'
import { firstHeading, htmlToText } from '../epub/text'
import {
  GENERATED_CHAPTER_DIR,
  type GeneratedDraft
} from '../library/generated-importer'
import { wrapXhtml } from '../library/xhtml'
import type { KindleExtract, KindleRawTocItem } from './types'

/**
 * 把解包结果整理成通用导入器认识的形状：目录树 + spine + 每章纯文本/HTML。
 *
 * 目录项解析到哪一章就指向哪一章；解析不到（filepos 越界、目录损坏）时
 * 让 buildChapters 用正文标题兜底，保证正文不会漏读。
 */
export function buildKindleDraft(
  extract: KindleExtract,
  sourcePath: string,
  cover: { data: Buffer; ext: string } | null
): GeneratedDraft {
  const title = extract.metadata.title.trim() || basename(sourcePath, extname(sourcePath))

  const idToEntry = new Map<string, string>()
  const headingByEntry = new Map<string, string>()
  const spine: string[] = []
  const texts: SpineText[] = []
  const htmlByEntry = new Map<string, string>()

  extract.chapters.forEach((chapter, index) => {
    const entry = `${GENERATED_CHAPTER_DIR}/${String(index + 1).padStart(5, '0')}.html`
    const html = wrapXhtml(chapter.html)
    const heading = firstHeading(html)

    idToEntry.set(chapter.id, entry)
    if (heading) headingByEntry.set(entry, heading)
    spine.push(entry)
    texts.push({ entry, text: htmlToText(html), heading })
    htmlByEntry.set(entry, html)
  })

  return {
    metadata: { ...extract.metadata, title } as EpubMetadata,
    toc: toToc(extract.toc, idToEntry, headingByEntry),
    spine,
    texts,
    htmlByEntry,
    cover
  }
}

function toToc(
  items: KindleRawTocItem[],
  idToEntry: Map<string, string>,
  headingByEntry: Map<string, string>
): TocNode[] {
  const out: TocNode[] = []

  for (const item of items) {
    const entry = item.id ? idToEntry.get(item.id) : undefined
    const children = toToc(item.children, idToEntry, headingByEntry)

    if (!entry) {
      // 这一级目录没有可跳转的章节，但子目录可能有效：把子目录提上来
      out.push(...children)
      continue
    }

    out.push({
      title: item.label.trim() || headingByEntry.get(entry) || '未命名章节',
      entry,
      children
    })
  }

  return out
}
