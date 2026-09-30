import { parseDocument } from 'htmlparser2'
import { appError } from '@shared/errors'
import { attr, findAll, textOf, type AnyNode, type Element } from './dom-helpers'
import { dirOf, resolveEntry } from './entry-path'
import type { EpubMetadata, ManifestItem, ParsedOpf } from './types'

function parseXml(source: string): AnyNode {
  return parseDocument(source, { xmlMode: true })
}

export function parseContainer(xml: string): string {
  const doc = parseXml(xml)
  const rootfile = findAll(doc, 'rootfile')[0] as Element | undefined
  const fullPath = rootfile ? attr(rootfile, 'full-path') : null
  if (!fullPath) {
    throw appError(
      'EPUB_PARSE_FAILED',
      '这个文件不是合法的 epub：缺少 META-INF/container.xml 里的 OPF 路径声明'
    )
  }
  return fullPath
}

export function parseOpf(xml: string, opfEntry = ''): ParsedOpf & { coverEntry: string | null } {
  const doc = parseXml(xml)
  const baseDir = dirOf(opfEntry)

  const metadata = parseMetadata(doc)
  const manifest = parseManifest(doc, baseDir)
  const byId = new Map(manifest.map((item) => [item.id, item]))

  const spineEl = findAll(doc, 'spine')[0]
  const spine: ParsedOpf['spine'] = []
  if (spineEl) {
    for (const itemref of findAll(spineEl, 'itemref')) {
      const idref = attr(itemref, 'idref')
      const item = idref ? byId.get(idref) : undefined
      if (!item) continue // 声明了却不在 manifest 里的 idref：跳过，不让它毁掉整本书
      spine.push({ entry: item.entry, linear: attr(itemref, 'linear') !== 'no' })
    }
  }

  const ncxId = attr(spineEl ?? doc, 'toc')

  const coverEntry = findCoverEntry(doc, manifest, baseDir)

  return { metadata, manifest, spine, ncxId: ncxId ?? null, coverEntry }
}

function parseMetadata(doc: AnyNode): EpubMetadata {
  const title = firstText(doc, ['title'])
  const identifier = pickIsbn(doc)
  return {
    title: title ?? '未命名书籍',
    author: firstText(doc, ['creator']),
    publisher: firstText(doc, ['publisher']),
    language: firstText(doc, ['language']),
    isbn: identifier
  }
}

/** 依次找 dc:title / title，取第一个非空文本。 */
function firstText(doc: AnyNode, names: string[]): string | null {
  for (const name of names) {
    for (const element of findAll(doc, name)) {
      const text = textOf(element)
      if (text) return text
    }
  }
  return null
}

/** ISBN 优先看 opf:scheme / id 里带 isbn 的那条 dc:identifier，其次是长得像 ISBN 的文本。 */
function pickIsbn(doc: AnyNode): string | null {
  const identifiers = findAll(doc, 'identifier')
  const hinted = identifiers.find((el) => {
    const hint = `${attr(el, 'scheme') ?? ''} ${attr(el, 'id') ?? ''}`.toLowerCase()
    return hint.includes('isbn')
  })
  const candidate =
    hinted ?? identifiers.find((el) => /^(97[89])?\d{9}[\dXx]$/.test(stripIsbnDecoration(textOf(el))))
  if (!candidate) return null
  const raw = stripIsbnDecoration(textOf(candidate))
  return raw || null
}

/** 真书常写 urn:isbn:9787…，剥掉这类前缀只留 ISBN 本体，否则这个字段永远是空。 */
function stripIsbnDecoration(text: string): string {
  return text.trim().replace(/^urn:isbn:/i, '').replace(/[-\s]/g, '')
}

function parseManifest(doc: AnyNode, baseDir: string): ManifestItem[] {
  return findAll(doc, 'item')
    .map((item) => {
      const id = attr(item, 'id')
      const href = attr(item, 'href')
      if (!id || !href) return null
      return {
        id,
        entry: resolveEntry(baseDir, href),
        mediaType: (attr(item, 'media-type') ?? '').toLowerCase(),
        properties: attr(item, 'properties') ?? ''
      }
    })
    .filter((item): item is ManifestItem => item !== null)
}

/** 封面优先取 properties 里声明 cover-image 的项，其次取 meta[name=cover] 指向的项。 */
export function findCoverEntry(doc: AnyNode, manifest: ManifestItem[], baseDir: string): string | null {
  const declared = manifest.find((item) => item.properties.includes('cover-image'))
  if (declared) return declared.entry

  const metaCover = findAll(doc, 'meta').find((el) => attr(el, 'name') === 'cover')
  const contentId = metaCover ? attr(metaCover, 'content') : null
  const byId = contentId ? manifest.find((item) => item.id === contentId) : undefined
  if (byId) return byId.entry

  const guessed = manifest.find(
    (item) => item.mediaType.startsWith('image/') && /cover/i.test(item.entry)
  )
  return guessed?.entry ?? null
}

export { parseXml, type Element }
