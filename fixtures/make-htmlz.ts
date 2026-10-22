import { writeEpub, type EpubFiles } from './make-epub'

/** HTMLZ 就是普通 zip：index.html + metadata.opf + 资源，用同一个写 zip 的工具即可。 */
export async function writeHtmlz(target: string, files: EpubFiles): Promise<void> {
  await writeEpub(target, files)
}

/** 8×12 的纯色 PNG，浏览器能解码，用来验证图片确实被复制到 media/。 */
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAMCAIAAADQ/GvKAAAAEklEQVR4nGPItjLCihhGJdARAFcNUKHg/FojAAAAAElFTkSuQmCC',
  'base64'
)

export function htmlzFiles(): EpubFiles {
  return {
    'index.html': `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>示例合集</title></head>
<body>
<h1>第一章 河边</h1>
<p>河边的月色很好。他想起量子纠缠这个比喻。</p>
<p><img src="images/flow.png" alt="河水"/></p>
<h2>第二章 夏夜</h2>
<p>夏夜里他读完了那本书。</p>
</body></html>`,
    'metadata.opf': `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>河边的两章</dc:title>
    <dc:creator>测试作者</dc:creator>
    <dc:language>zh-CN</dc:language>
    <dc:identifier id="bookid">urn:isbn:9787000000002</dc:identifier>
    <meta name="cover" content="cover-img"/>
  </metadata>
  <manifest>
    <item id="cover-img" href="cover.jpg" media-type="image/jpeg"/>
    <item id="flow" href="images/flow.png" media-type="image/png"/>
  </manifest>
  <spine/>
</package>`,
    'cover.jpg': TINY_PNG,
    'images/flow.png': TINY_PNG
  }
}
