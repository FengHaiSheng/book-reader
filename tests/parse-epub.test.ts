import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { missingOpfFiles, nestedTocFiles, novelFiles, writeEpub } from '../fixtures/make-epub'
import { extractBookTexts } from '../electron/main/epub/extract-book'
import { loadToc, readEpubInfo } from '../electron/main/epub/parse'
import { buildChapters } from '../electron/main/epub/chapters'
import { buildChunks } from '../electron/main/epub/chunks'

const dir = mkdtempSync(join(tmpdir(), 'book-read-fixtures-'))
const novel = join(dir, 'novel.epub')
const nested = join(dir, 'nested.epub')
const broken = join(dir, 'broken.epub')

beforeAll(async () => {
  await writeEpub(novel, novelFiles())
  await writeEpub(nested, nestedTocFiles())
  await writeEpub(broken, missingOpfFiles())
})

describe('readEpubInfo', () => {
  it('抽出元数据并按 spine 顺序给出正文 entry', async () => {
    const info = await readEpubInfo(novel)
    expect(info.metadata.title).toBe('河边的月亮')
    expect(info.metadata.author).toBe('测试作者')
    expect(info.metadata.isbn).toBe('9787000000001')
    expect(info.spineEntries).toEqual(['OEBPS/ch1.xhtml', 'OEBPS/ch2.xhtml'])
    expect(info.coverEntry).toBe('OEBPS/cover.jpg')
    expect(info.tocSource).toEqual({ kind: 'ncx', entry: 'OEBPS/toc.ncx' })
  })

  it('EPUB3 书用 properties=nav 的那篇当目录来源', async () => {
    const info = await readEpubInfo(nested)
    expect(info.tocSource).toEqual({ kind: 'nav', entry: 'OEBPS/nav.xhtml' })
    expect(info.coverEntry).toBe('OEBPS/images/cover.png')
  })

  it('缺 OPF 时抛可读错误', async () => {
    await expect(readEpubInfo(broken)).rejects.toMatchObject({ code: 'EPUB_PARSE_FAILED' })
  })
})

describe('loadToc', () => {
  it('NCX 书产出两层目录', async () => {
    const info = await readEpubInfo(novel)
    const toc = await loadToc(novel, info)
    expect(toc.map((node) => node.title)).toEqual(['第一章 河边', '第二章 夏夜'])
  })

  it('nav 书产出三层目录', async () => {
    const info = await readEpubInfo(nested)
    const toc = await loadToc(nested, info)
    expect(toc[0]?.title).toBe('第一篇 坐标')
    expect(toc[0]?.children[0]?.title).toBe('第 1 节 笛卡尔')
    expect(toc[0]?.children[0]?.children[0]?.title).toBe('第 1 目 极坐标')
  })
})

describe('extractBookTexts', () => {
  it('按传入顺序返回纯文本，并带上文档标题', async () => {
    const info = await readEpubInfo(novel)
    const texts = await extractBookTexts(novel, info.spineEntries)
    expect(texts.map((item) => item.entry)).toEqual(info.spineEntries)
    expect(texts[0]?.text).toContain('月色沉入河底')
    expect(texts[0]?.text).toContain('量子纠缠')
    expect(texts[0]?.heading).toBe('第一章 河边')
  })

  it('声明的封面不存在时不抛错，只是读不到', async () => {
    const info = await readEpubInfo(nested)
    const found = await extractBookTexts(nested, ['OEBPS/images/cover.png'])
    expect(found).toEqual([])
  })
})

describe('整本书的章节与 chunk', () => {
  it('技术书的章节树深度为 0/1/2，且附录被补成平级章节', async () => {
    const info = await readEpubInfo(nested)
    const toc = await loadToc(nested, info)
    const texts = await extractBookTexts(nested, info.spineEntries)
    const chapters = buildChapters(toc, info.spineEntries, texts)

    expect(chapters.map((row) => [row.title, row.depth, row.orderIndex])).toEqual([
      ['第一篇 坐标', 0, 0],
      ['第 1 节 笛卡尔', 1, 1],
      ['第 1 目 极坐标', 2, 2],
      ['附录 术语表', 0, 3]
    ])
  })

  it('小说每章都能切出 chunk，且 chunk 文本能找回原句', async () => {
    const info = await readEpubInfo(novel)
    const texts = await extractBookTexts(novel, info.spineEntries)
    const chunks = texts.flatMap((item) => buildChunks(item.text))
    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks.some((chunk) => chunk.text.includes('量子纠缠'))).toBe(true)
  })
})
