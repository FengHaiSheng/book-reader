import { describe, expect, it } from 'vitest'
import { rewriteResourceLinks, splitHtmlBook } from '../electron/main/htmlz/parse'

describe('splitHtmlBook', () => {
  it('按 h1/h2 切章，标题前的内容算前言', () => {
    const chapters = splitHtmlBook(
      '<html><body><p>封面文字</p><h1>第一章</h1><p>甲</p><h2>第二节</h2><p>乙</p></body></html>'
    )

    expect(chapters.map((chapter) => chapter.title)).toEqual(['前言', '第一章', '第二节'])
    expect(chapters[1]?.body).toContain('<p>甲</p>')
  })

  it('没有标题时退回单章', () => {
    const chapters = splitHtmlBook('<html><body><p>只有正文。</p></body></html>')
    expect(chapters).toHaveLength(1)
    expect(chapters[0]?.title).toBe('正文')
  })
})

describe('rewriteResourceLinks', () => {
  const resources = new Map([['images/a.jpg', '../media/a.jpg'], ['style.css', '../media/style.css']])

  it('把 zip 内资源改成 media 相对路径', () => {
    const html = '<p><img src="images/a.jpg"/><link href="style.css"/></p>'
    const out = rewriteResourceLinks(html, '', resources)

    expect(out).toContain('src="../media/a.jpg"')
    expect(out).toContain('href="../media/style.css"')
  })

  it('外链、data URL 与锚点原样保留', () => {
    const html =
      '<a href="https://example.com">x</a><img src="data:image/png;base64,AA"/><a href="#top">top</a>'
    expect(rewriteResourceLinks(html, '', resources)).toBe(html)
  })

  it('CSS 里的 url() 也改写', () => {
    const out = rewriteResourceLinks('<style>body{background:url("images/a.jpg")}</style>', '', resources)
    expect(out).toContain('url("../media/a.jpg")')
  })
})
