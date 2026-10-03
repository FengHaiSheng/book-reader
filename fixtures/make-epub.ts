import { createWriteStream } from 'node:fs'
import { ZipFile } from 'yazl'

export type EpubFiles = Record<string, string | Buffer>

/** 把一组文件打成一个 epub（zip）。mimetype 必须是第一个且不压缩，规范如此。 */
export async function writeEpub(target: string, files: EpubFiles): Promise<void> {
  const zip = new ZipFile()
  const names = Object.keys(files)
  for (const name of names) {
    const content = files[name]!
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8')
    zip.addBuffer(buffer, name, name === 'mimetype' ? { compress: false } : undefined)
  }
  await new Promise<void>((resolve, reject) => {
    zip.outputStream.pipe(createWriteStream(target)).on('close', resolve).on('error', reject)
    zip.end()
  })
}

const CONTAINER = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`

/** 正常中文小说：EPUB2 + NCX，两章，封面是假字节。 */
export function novelFiles(): EpubFiles {
  return {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': CONTAINER,
    'OEBPS/cover.jpg': Buffer.from('fake-jpeg-bytes'),
    'OEBPS/content.opf': `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>河边的月亮</dc:title>
    <dc:creator>测试作者</dc:creator>
    <dc:publisher>示例出版社</dc:publisher>
    <dc:language>zh-CN</dc:language>
    <dc:identifier id="bookid">urn:isbn:9787000000001</dc:identifier>
    <meta name="cover" content="cover-img"/>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="cover-img" href="cover.jpg" media-type="image/jpeg"/>
    <item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="c1"/>
    <itemref idref="c2"/>
  </spine>
</package>`,
    'OEBPS/toc.ncx': `<?xml version="1.0"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <navMap>
    <navPoint id="n1"><navLabel><text>第一章 河边</text></navLabel><content src="ch1.xhtml"/></navPoint>
    <navPoint id="n2"><navLabel><text>第二章 夏夜</text></navLabel><content src="ch2.xhtml"/></navPoint>
  </navMap>
</ncx>`,
    'OEBPS/ch1.xhtml': `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一章</title></head>
<body><h1>第一章 河边</h1>
<p>月色沉入河底，量子纠缠的影子在水面碎成一片。</p>
<p>他把手插进外套口袋，听见远处有人喊他的名字。</p></body></html>`,
    'OEBPS/ch2.xhtml': `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第二章</title></head>
<body><h1>第二章 夏夜</h1>
<p>蝉声一直响到后半夜，月光把瓦片照得发白。</p></body></html>`
  }
}

/**
 * 多级目录的技术书：EPUB3 + nav.xhtml，三层目录；
 * 故意带三处缺陷——XHTML 未闭合、封面声明的图片并不存在、spine 里有一篇不在目录中。
 */
export function nestedTocFiles(): EpubFiles {
  return {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': CONTAINER,
    'OEBPS/content.opf': `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>深入理解定位</dc:title>
    <dc:creator>技术作者</dc:creator>
    <dc:language>zh-CN</dc:language>
    <dc:identifier id="bookid">urn:uuid:0f1b</dc:identifier>
    <meta name="cover" content="cover-img"/>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="cover-img" href="images/cover.png" media-type="image/png"/>
    <item id="c1" href="text/part1/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="text/part1/ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="c3" href="text/part2/ch3.xhtml" media-type="application/xhtml+xml"/>
    <item id="appendix" href="text/appendix.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="c1"/>
    <itemref idref="c2"/>
    <itemref idref="c3"/>
    <itemref idref="appendix"/>
  </spine>
</package>`,
    'OEBPS/nav.xhtml': `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<body><nav epub:type="toc"><ol>
  <li><a href="text/part1/ch1.xhtml">第一篇 坐标</a>
    <ol><li><a href="text/part1/ch2.xhtml">第 1 节 笛卡尔</a>
      <ol><li><a href="text/part2/ch3.xhtml">第 1 目 极坐标</a></li></ol>
    </li></ol>
  </li>
</ol></nav></body></html>`,
    'OEBPS/text/part1/ch1.xhtml': '<html><body><h1>第一篇 坐标</h1><p>定位的第一步是把位置写成数字。</p>',
    'OEBPS/text/part1/ch2.xhtml': '<html><body><h1>第 1 节 笛卡尔</h1><p>笛卡尔坐标系用两根轴描述平面上的点。</p></body></html>',
    'OEBPS/text/part2/ch3.xhtml': '<html><body><h1>第 1 目 极坐标</h1><p>极坐标用半径与角度描述同一个点。</p></body></html>',
    'OEBPS/text/appendix.xhtml': '<html><body><h1>附录 术语表</h1><p>锚点：页面内的定位标记。</p></body></html>'
  }
}

/** 畸形书：container.xml 指向一个并不存在的 OPF。 */
export function missingOpfFiles(): EpubFiles {
  return {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': CONTAINER,
    'OEBPS/ch1.xhtml': '<html><body><p>正文</p></body></html>'
  }
}

/**
 * 骨架安全测试用的一本书：第一章里塞进内联脚本、外链脚本与一张图片。
 * 期望行为——脚本一次都不执行，图片正常显示（图片能否真的解码由 Task 8 的 secureFiles 负责）。
 */
export function scriptedFiles(): EpubFiles {
  const files = novelFiles()
  files['OEBPS/ch1.xhtml'] = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一章</title>
<link rel="stylesheet" href="style.css"/>
</head>
<body><h1>第一章 河边</h1>
<p>月色沉入河底，量子纠缠的影子在水面碎成一片。</p>
<img src="images/dot.jpg" alt="一个点"/>
<script>document.title = '脚本执行了'; window.__pwned = true;</script>
<script src="evil.js"></script>
</body></html>`
  files['OEBPS/evil.js'] = 'window.__pwned = true'
  files['OEBPS/style.css'] = 'body { --from-book: 1; }'
  files['OEBPS/images/dot.jpg'] = Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0xff, 0xd9])
  return files
}

/**
 * 分页测试书：第一章长到一定会跨好几页，第二章短到只有一页。
 * 分页、翻章边界、进度这些事，只有在内容超出一屏时才有东西可测。
 * 目录与书名沿用 `novelFiles()`，所以既有的断言不受影响。
 */
export function longBookFiles(): EpubFiles {
  const files = novelFiles()
  const sentence = '河面上浮着一层薄薄的雾，像是有人把整条河搬进了梦里。'
  const paragraphs = Array.from(
    { length: 60 },
    (_, index) => `<p>第 ${index + 1} 段。${sentence.repeat(3)}</p>`
  ).join('\n')

  files['OEBPS/ch1.xhtml'] = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一章 河边</title></head>
<body><h1>第一章 河边</h1>
${paragraphs}</body></html>`

  files['OEBPS/ch2.xhtml'] = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第二章 夏夜</title></head>
<body><h1>第二章 夏夜</h1>
<p>蝉声一直响到后半夜，月光把瓦片照得发白。</p></body></html>`

  return files
}

/**
 * 安全验收用的书：书里同时塞了内联脚本、外链脚本、一张图片和一条书内样式。
 *
 * 与 `scriptedFiles()` 的区别在图片：那一本用的是占位字节，`naturalWidth` 恒为 0，
 * 因此只能证明「脚本没跑」，证明不了「图片显示了」。这里换成真正可解码的 1×1 GIF，
 * 断言才能落到 `naturalWidth === 1`。
 */
export function secureFiles(): EpubFiles {
  const files = scriptedFiles()
  delete files['OEBPS/images/dot.jpg']

  files['OEBPS/ch1.xhtml'] = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一章</title>
<link rel="stylesheet" href="style.css"/>
</head>
<body><h1 id="book-h">第一章 河边</h1>
<p id="book-p">月色沉入河底，量子纠缠的影子在水面碎成一片。</p>
<img id="book-img" src="images/dot.gif" alt="一个点"/>
<script>window.__pwned = true; document.body.setAttribute('data-pwned', '1');</script>
<script src="evil.js"></script>
</body></html>`

  // 书内样式表必须生效（spec §3.4：书自己的样式优先，主题只覆盖阅读相关的部分）
  files['OEBPS/style.css'] = '#book-h { color: rgb(1, 2, 3); }'
  files['OEBPS/images/dot.gif'] = Buffer.from(
    'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    'base64'
  )
  return files
}
