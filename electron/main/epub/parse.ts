import { appError } from '@shared/errors'
import { parseOpf, parseContainer } from './opf'
import { parseNav, parseNcx } from './toc'
import { dirOf } from './entry-path'
import { readEntries } from './zip'
import type { EpubMetadata, TocNode } from './types'

export type EpubInfo = {
  metadata: EpubMetadata
  coverEntry: string | null
  /** 只含 linear 不为 false 的项，按 spine 顺序 */
  spineEntries: string[]
  tocSource: { kind: 'nav' | 'ncx'; entry: string } | null
}

const CONTAINER_ENTRY = 'META-INF/container.xml'
const decoder = new TextDecoder('utf-8')

async function readText(zipPath: string, entry: string): Promise<string> {
  const files = await readEntries(zipPath, [entry])
  const buffer = files.get(entry)
  if (!buffer) {
    throw appError('EPUB_PARSE_FAILED', `这个 epub 缺少必需文件：${entry}`)
  }
  return decoder.decode(buffer)
}

export async function readEpubInfo(zipPath: string): Promise<EpubInfo> {
  const opfEntry = parseContainer(await readText(zipPath, CONTAINER_ENTRY))
  const opf = parseOpf(await readText(zipPath, opfEntry), opfEntry)

  const navItem = opf.manifest.find((item) => item.properties.split(/\s+/).includes('nav'))
  const ncxItem = opf.ncxId
    ? opf.manifest.find((item) => item.id === opf.ncxId)
    : opf.manifest.find((item) => item.mediaType === 'application/x-dtbncx+xml')

  const tocSource: EpubInfo['tocSource'] = navItem
    ? { kind: 'nav', entry: navItem.entry }
    : ncxItem
      ? { kind: 'ncx', entry: ncxItem.entry }
      : null

  return {
    metadata: opf.metadata,
    coverEntry: opf.coverEntry,
    // 非线性的 spine 项不进阅读流，因此也不参与正文抽取
    spineEntries: opf.spine.filter((item) => item.linear).map((item) => item.entry),
    tocSource
  }
}

export async function loadToc(zipPath: string, info: EpubInfo): Promise<TocNode[]> {
  if (!info.tocSource) return []
  const baseDir = dirOf(info.tocSource.entry)
  const source = await readText(zipPath, info.tocSource.entry)
  return info.tocSource.kind === 'nav' ? parseNav(source, baseDir) : parseNcx(source, baseDir)
}

/** 整本书纯文本的总长度，用于 books.total_chars。 */
export function totalChars(texts: { text: string }[]): number {
  return texts.reduce((sum, item) => sum + item.text.length, 0)
}
