import { describe, expect, it } from 'vitest'
import { buildPdfDraft } from '../electron/main/pdf/chapters'
import type { PdfBlock, PdfExtract, PdfOutlineEntry } from '../electron/main/pdf/extract'

function extract(pages: string[][], outline: PdfOutlineEntry[] = []): PdfExtract {
  return {
    title: null,
    author: null,
    language: null,
    pageCount: pages.length,
    pages: pages.map((blocks) => blocks.map<PdfBlock>((text) => ({ kind: 'p', text }))),
    outline
  }
}

function pages(count: number): string[][] {
  return Array.from({ length: count }, (_, index) => [`第 ${index + 1} 页正文`])
}

describe('buildPdfDraft', () => {
  it('没有目录时每 10 页一章，entry 连续编号', () => {
    const draft = buildPdfDraft(extract(pages(25)))

    expect(draft.spine).toEqual(['pdf/00001.html', 'pdf/00002.html', 'pdf/00003.html'])
    expect(draft.toc.map((node) => node.title)).toEqual(['第 1–10 页', '第 11–20 页', '第 21–25 页'])
    expect(draft.texts[2]?.text).toBe('第 21 页正文\n第 22 页正文\n第 23 页正文\n第 24 页正文\n第 25 页正文')
  })

  it('全是图片的页组不生成空章节', () => {
    const source = pages(25)
    for (let index = 10; index < 20; index += 1) source[index] = []
    const draft = buildPdfDraft(extract(source))

    expect(draft.spine).toEqual(['pdf/00001.html', 'pdf/00002.html'])
    expect(draft.toc.map((node) => node.title)).toEqual(['第 1–10 页', '第 21–25 页'])
  })

  it('按书签分章，同页的后续目录项只当目录节点', () => {
    const draft = buildPdfDraft(
      extract(pages(20), [
        { title: '封面', page: 1, depth: 0 },
        { title: '版权', page: 1, depth: 0 },
        { title: '第一章', page: 5, depth: 0 },
        { title: '第一节', page: 5, depth: 1 },
        { title: '第二章', page: 12, depth: 0 }
      ])
    )

    expect(draft.spine).toEqual(['pdf/00001.html', 'pdf/00002.html', 'pdf/00003.html'])
    expect(draft.texts[0]?.text.split('\n')).toEqual([
      '第 1 页正文',
      '第 2 页正文',
      '第 3 页正文',
      '第 4 页正文'
    ])
    expect(draft.texts[1]?.text.split('\n')).toEqual(Array.from({ length: 7 }, (_, i) => `第 ${i + 5} 页正文`))
    expect(draft.texts[2]?.text.split('\n')).toHaveLength(9)

    const [first, second, third] = draft.toc
    expect([first?.title, second?.title, third?.title]).toEqual(['封面', '版权', '第一章'])
    expect(second?.entry).toBe('')
    expect(third?.children.map((node) => node.title)).toEqual(['第一节'])
    expect(third?.children[0]?.entry).toBe('')
  })

  it('目录第一条之前的内容补成开篇', () => {
    const draft = buildPdfDraft(
      extract(pages(6), [
        { title: '第一章', page: 3, depth: 0 },
        { title: '第二章', page: 5, depth: 0 }
      ])
    )

    expect(draft.toc.map((node) => node.title)).toEqual(['开篇', '第一章', '第二章'])
    expect(draft.texts[0]?.text.split('\n')).toEqual(['第 1 页正文', '第 2 页正文'])
  })

  it('一页文字都没有时不给可读章节，由导入层报扫描件', () => {
    const draft = buildPdfDraft(extract([[], [], []]))
    expect(draft.spine).toEqual([])
    expect(draft.texts).toEqual([])
  })
})
