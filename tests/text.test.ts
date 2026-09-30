import { describe, expect, it } from 'vitest'
import { firstHeading, htmlToText } from '../electron/main/epub/text'

describe('htmlToText', () => {
  it('块级元素之间断行，行内元素不断行', () => {
    expect(
      htmlToText('<body><p>第一段</p><p>第二段</p></body>')
    ).toBe('第一段\n第二段')
  })

  it('行内标签不产生换行', () => {
    expect(htmlToText('<body><p>前<em>中</em>后</p></body>')).toBe('前中后')
  })

  it('br 断行', () => {
    expect(htmlToText('<body><p>上<br/>下</p></body>')).toBe('上\n下')
  })

  it('丢掉 script 与 style 里的内容', () => {
    expect(
      htmlToText('<body><style>p{color:red}</style><script>alert(1)</script><p>正文</p></body>')
    ).toBe('正文')
  })

  it('把连续空白与全角空格塌缩成一个半角空格', () => {
    expect(htmlToText('<body><p>甲    乙\u3000丙</p></body>')).toBe('甲 乙 丙')
  })

  it('去掉空行，不留连续换行', () => {
    expect(htmlToText('<body><p>甲</p><p> </p><p></p><p>乙</p></body>')).toBe('甲\n乙')
  })

  it('解码 HTML 实体', () => {
    expect(htmlToText('<body><p>&lt;引号&gt; &amp; &quot;x&quot;</p></body>')).toBe(
      '<引号> & "x"'
    )
  })

  it('不合规的 XHTML 不抛错，尽量抽出文本', () => {
    const broken = '<html><body><p>未闭合的段落<div>另起一段</div>'
    expect(htmlToText(broken)).toBe('未闭合的段落\n另起一段')
  })

  it('空文档返回空串', () => {
    expect(htmlToText('')).toBe('')
  })
})

describe('firstHeading', () => {
  it('优先取 h1–h6', () => {
    expect(firstHeading('<html><head><title>页标题</title></head><body><h2>章标题</h2></body></html>')).toBe('章标题')
  })

  it('没有标题元素时取 doc title', () => {
    expect(firstHeading('<html><head><title>页标题</title></head><body><p>正文</p></body></html>')).toBe('页标题')
  })

  it('都没有时返回 null', () => {
    expect(firstHeading('<html><body><p>正文</p></body></html>')).toBeNull()
  })
})
