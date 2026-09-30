import { describe, expect, it } from 'vitest'
import { parseNav, parseNcx } from '../electron/main/epub/toc'

const NCX = `<?xml version="1.0"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <navMap>
    <navPoint id="n1">
      <navLabel><text>第一章 河边</text></navLabel>
      <content src="ch1.xhtml"/>
      <navPoint id="n1-1">
        <navLabel><text>第一节 早雾</text></navLabel>
        <content src="ch1.xhtml#s1"/>
      </navPoint>
    </navPoint>
    <navPoint id="n2">
      <navLabel><text>第二章 夏夜</text></navLabel>
      <content src="text/ch2.xhtml"/>
    </navPoint>
  </navMap>
</ncx>`

const NAV = `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body>
    <nav epub:type="toc">
      <h1>目录</h1>
      <ol>
        <li><a href="ch1.xhtml">第一章 河边</a>
          <ol><li><a href="ch1.xhtml#s1">第一节 早雾</a></li></ol>
        </li>
        <li><span>没有链接的卷标题</span>
          <ol><li><a href="ch2.xhtml">第二章 夏夜</a></li></ol>
        </li>
      </ol>
    </nav>
    <nav epub:type="landmarks"><ol><li><a href="cover.xhtml">封面</a></li></ol></nav>
  </body>
</html>`

describe('parseNcx', () => {
  it('按层级还原目录树，href 解析为 entry', () => {
    expect(parseNcx(NCX, 'OEBPS')).toEqual([
      {
        title: '第一章 河边',
        entry: 'OEBPS/ch1.xhtml',
        children: [{ title: '第一节 早雾', entry: 'OEBPS/ch1.xhtml', children: [] }]
      },
      { title: '第二章 夏夜', entry: 'OEBPS/text/ch2.xhtml', children: [] }
    ])
  })

  it('没有 navMap 时返回空数组', () => {
    expect(parseNcx('<ncx/>', '')).toEqual([])
  })

  it('缺 navLabel 的 navPoint 标题回落到「未命名章节」', () => {
    const tree = parseNcx('<ncx><navMap><navPoint><content src="a.xhtml"/></navPoint></navMap></ncx>', '')
    expect(tree).toEqual([{ title: '未命名章节', entry: 'a.xhtml', children: [] }])
  })
})

describe('parseNav', () => {
  it('只取 epub:type=toc 的那个 nav', () => {
    const tree = parseNav(NAV, 'OEBPS')
    expect(tree.map((node) => node.title)).toEqual(['第一章 河边', '没有链接的卷标题'])
    expect(tree[0]?.children[0]?.entry).toBe('OEBPS/ch1.xhtml')
  })

  it('没有链接的 li 保留为分组节点，entry 为空串', () => {
    expect(parseNav(NAV, 'OEBPS')[1]?.entry).toBe('')
    expect(parseNav(NAV, 'OEBPS')[1]?.children).toHaveLength(1)
  })

  it('没有 toc 类型的 nav 时返回空数组', () => {
    expect(parseNav('<html><body><nav epub:type="landmarks"><ol><li><a href="a">x</a></li></ol></nav></body></html>', '')).toEqual([])
  })
})
