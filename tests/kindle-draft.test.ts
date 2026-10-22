import { describe, expect, it } from 'vitest'
import { buildKindleDraft } from '../electron/main/kindle/draft'
import type { KindleExtract } from '../electron/main/kindle/types'

function extract(overrides: Partial<KindleExtract> = {}): KindleExtract {
  return {
    metadata: { title: '测试书', author: '某人', publisher: null, language: 'zh', isbn: null },
    chapters: [
      { id: 'a', html: '<h1>第一章</h1><p>甲</p>' },
      { id: 'b', html: '<p>乙</p>' }
    ],
    toc: [],
    coverPath: null,
    ...overrides
  }
}

describe('buildKindleDraft', () => {
  it('按 spine 顺序生成章节，并抽出正文与标题', () => {
    const draft = buildKindleDraft(extract(), '/tmp/测试书.mobi', null)

    expect(draft.spine).toEqual(['chapters/00001.html', 'chapters/00002.html'])
    expect(draft.texts[0]?.text).toContain('第一章')
    expect(draft.texts[0]?.text).toContain('甲')
    expect(draft.texts[0]?.heading).toBe('第一章')
    expect(draft.htmlByEntry.get('chapters/00001.html')).toContain('<h1>第一章</h1>')
  })

  it('目录项映射到章节；映射不到的子目录被提升', () => {
    const draft = buildKindleDraft(
      extract({
        toc: [
          {
            label: '第一卷',
            id: null,
            children: [
              { label: '', id: 'a', children: [] },
              { label: '第二章', id: 'b', children: [] }
            ]
          }
        ]
      }),
      '/tmp/书.mobi',
      null
    )

    // 「第一卷」没有正文，子目录提上来；空标题用章节自己的标题兜底
    expect(draft.toc.map((node) => node.title)).toEqual(['第一章', '第二章'])
    expect(draft.toc[0]?.entry).toBe('chapters/00001.html')
    expect(draft.toc[1]?.entry).toBe('chapters/00002.html')
  })

  it('没有标题元数据时用文件名', () => {
    const draft = buildKindleDraft(
      extract({ metadata: { ...extract().metadata, title: '  ' } }),
      '/tmp/无名书.azw3',
      null
    )
    expect(draft.metadata.title).toBe('无名书')
  })

  it('封面原样带过去', () => {
    const cover = { data: Buffer.from([1, 2, 3]), ext: 'jpg' }
    const draft = buildKindleDraft(extract(), '/tmp/书.mobi', cover)
    expect(draft.cover).toBe(cover)
  })
})
