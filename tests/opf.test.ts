import { describe, expect, it } from 'vitest'
import { parseContainer, parseOpf } from '../electron/main/epub/opf'

const CONTAINER = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`

const OPF = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>河边的月亮</dc:title>
    <dc:creator>测试作者</dc:creator>
    <dc:publisher>示例出版社</dc:publisher>
    <dc:language>zh-CN</dc:language>
    <dc:identifier id="bookid" opf:scheme="ISBN">9787000000001</dc:identifier>
    <meta name="cover" content="cover-img"/>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="cover-img" href="images/cover.jpg" media-type="image/jpeg"/>
    <item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="c1"/>
    <itemref idref="c2" linear="no"/>
  </spine>
</package>`

describe('parseContainer', () => {
  it('取出 OPF 的路径', () => {
    expect(parseContainer(CONTAINER)).toBe('OEBPS/content.opf')
  })

  it('只有一层 rootfile 时也能取到', () => {
    expect(
      parseContainer('<container><rootfiles><rootfile full-path="a.opf"/></rootfiles></container>')
    ).toBe('a.opf')
  })

  it('缺少 rootfile 时报 EPUB_PARSE_FAILED', () => {
    expect(() => parseContainer('<container/>')).toThrowError(/EPUB_PARSE_FAILED|不是合法的 epub/)
  })
})

describe('parseOpf', () => {
  const opf = parseOpf(OPF, 'OEBPS/content.opf')

  it('抽出元数据', () => {
    expect(opf.metadata.title).toBe('河边的月亮')
    expect(opf.metadata.author).toBe('测试作者')
    expect(opf.metadata.publisher).toBe('示例出版社')
    expect(opf.metadata.language).toBe('zh-CN')
    expect(opf.metadata.isbn).toBe('9787000000001')
  })

  it('dc:identifier 写成 urn:isbn: 前缀时也能取出 ISBN', () => {
    const withUrn = OPF.replace('9787000000001', 'urn:isbn:9787000000001')
    expect(parseOpf(withUrn, 'OEBPS/content.opf').metadata.isbn).toBe('9787000000001')
  })

  it('manifest 的 href 已按 OPF 目录解析成 zip entry 名', () => {
    expect(opf.manifest.find((item) => item.id === 'c2')?.entry).toBe('OEBPS/text/ch2.xhtml')
    expect(opf.manifest.find((item) => item.id === 'cover-img')?.entry).toBe(
      'OEBPS/images/cover.jpg'
    )
  })

  it('spine 按顺序解析，并保留 linear=false', () => {
    expect(opf.spine).toEqual([
      { entry: 'OEBPS/ch1.xhtml', linear: true },
      { entry: 'OEBPS/text/ch2.xhtml', linear: false }
    ])
  })

  it('记录 ncx 的 manifest id', () => {
    expect(opf.ncxId).toBe('ncx')
  })

  it('spine 里有 manifest 中不存在的 idref 时跳过，不抛错', () => {
    const broken = parseOpf(
      '<package><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/><itemref idref="ghost"/></spine></package>'
    )
    expect(broken.spine).toEqual([{ entry: 'a.xhtml', linear: true }])
  })

  it('没有 dc:title 时回落到「未命名书籍」', () => {
    const noTitle = parseOpf('<package><metadata/><manifest/><spine/></package>')
    expect(noTitle.metadata.title).toBe('未命名书籍')
  })

  it('抽出封面 entry', () => {
    expect(opf.coverEntry).toBe('OEBPS/images/cover.jpg')
  })
})
