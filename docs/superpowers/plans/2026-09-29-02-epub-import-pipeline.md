# epub 导入管线 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让应用能导入 epub：解析元数据与目录、抽取纯文本、划分 chunk、建立中文 bigram 索引，全程事务化——失败不留半本书。

**Architecture:** 解析逻辑（zip 读取、OPF/NCX/nav 解析、XHTML 转纯文本、章节树、chunk 划分、bigram 切词）全部写成**不依赖 Electron 与原生模块的纯函数**，因此能在 vitest 里直接跑。只有「写 SQLite」这一步留在主进程，导入时先用 worker 线程抽取纯文本、再在单个事务里落库。整本书的纯文本抽取放在 `worker_threads` 里，避免大书导入卡住主进程。

**Tech Stack:** Electron / TypeScript / better-sqlite3 / yauzl（zip 读取）/ htmlparser2 + domhandler（XHTML 与 XML 解析）/ yazl（仅测试造夹具）/ vitest / Playwright

**Spec:** [2026-09-29-book-reader-design.md](../specs/2026-09-29-book-reader-design.md)（§2.2 表结构、§3.1 双路径分离、§3.2 导入管线、§5.2 中文 bigram、§6.1 测试策略、§6.2 错误模型）

**前置计划：** [01 应用骨架与本地数据层](./2026-09-29-01-app-shell-and-data-layer.md)

---

## Prerequisites

1. **计划 01 必须已经完成**：`npm run dev` 能启动、`npm test` 与 `npm run e2e` 全绿。本计划改的 `shared/ipc.ts`、`electron/preload/index.ts`、`electron/main/ipc/index.ts` 都建立在计划 01 的文件上。
2. **git 身份已配置**（计划 01 的 Prerequisites）。本计划每个 Task 结尾都要 commit。

---

## 计划拆分说明

本文件是 6 份计划中的第 2 份：

| 计划 | 内容 | 交付物 |
|---|---|---|
| 01 | 应用骨架、SQLite、迁移、密钥、设置页 | 能启动、能存设置和密钥的应用 |
| **02（本文）** | epub 导入管线 | 能导入 epub 并落库（books/chapters/chunks + FTS bigram） |
| 03 | 阅读器渲染 | 能读书：自定义协议、iframe、分页、CFI、进度 |
| 04 | 标注与笔记 | 能划词、写笔记、跨书汇总、导出 Markdown |
| 05 | AI 能力层 | 能问 AI：Provider、降级、检索、任务、引用回跳 |
| 06 | 书架完善与打包 | 能装给别人用：网格/列表、标签、导出数据、签名打包 |

**本计划一次性建完全部 10 张表**（books / chapters / chunks / chunks_fts / reading_progress / highlights / ai_results / ai_messages / tags / book_tags），即使其中几张要到计划 03–06 才会被写入。理由有两条：① 表结构是 spec §2.2 这一个整体，拆成 5 次迁移会让「删书时该级联清哪些表」分散在 5 个文件里，极易漏项；② 迁移文件的纪律是只追加不修改，早建表不会给后续计划留下需要回头改的东西。

---

## File Structure

本计划新增与修改的文件：

```
shared/
  ipc.ts                           # 追加 library 通道与 ImportProgress 类型
  types.ts                         # 追加 BookSummary / ImportOutcome / ChapterRowView
electron/main/epub/
  types.ts                         # epub 域内部类型（元数据、目录、章节、chunk）
  zip.ts                           # yauzl 封装：列 entry、按名批量读取（纯 JS，可单测）
  entry-path.ts                    # zip 内部 href 解析与目录归一（纯函数）
  dom.ts                           # XML/HTML 节点遍历小工具（纯函数）
  opf.ts                           # container.xml 与 OPF 解析（纯函数）
  toc.ts                           # NCX 与 EPUB3 nav 解析（纯函数）
  text.ts                          # XHTML → 纯文本（纯函数）
  chapters.ts                      # 目录树 + spine + 正文 → chapters 行（纯函数）
  chunks.ts                        # 纯文本 → chunk 划分 + token 估算（纯函数）
  bigram.ts                        # 中文 bigram 切词与 FTS 查询串（纯函数）
  parse.ts                         # 打开 zip 读元数据/目录来源（碰文件系统，不碰 Electron）
  extract-book.ts                  # 按 spine 批量抽取纯文本（纯 JS，可单测）
  extract.worker.ts                # worker_threads 入口，只做抽取
  extract-pool.ts                  # 主进程侧拉起 worker 并取回结果
electron/main/library/
  paths.ts                         # userData / library 目录 / 单书目录
  repo.ts                          # books、chapters、chunks、chunks_fts 的全部 SQL
  importer.ts                      # 导入编排：去重 → 解析 → 抽取 → 事务落库
electron/main/storage/
  sha256.ts                        # 文件 sha256（流式，避免整本读进内存）
electron/main/ipc/
  library.ts                       # 书库相关 IPC handler
src/features/library/
  ImportButton.tsx                 # 导入按钮 + 进度
  BookList.tsx                     # 最小可用列表（完整书架见计划 06）
fixtures/
  make-epub.ts                     # 用 yazl 现场生成三本测试 epub
tests/
  entry-path.test.ts
  opf.test.ts
  toc.test.ts
  text.test.ts
  chapters.test.ts
  chunks.test.ts
  bigram.test.ts
  parse-epub.test.ts               # 真实 zip → 元数据 + 目录 + 纯文本，全链路
e2e/
  import.spec.ts                   # 导入落库、去重、检索、删书、畸形书不留脏数据
```

需要修改的既有文件：

```
electron.vite.config.ts            # main 增加第二个入口 epub-worker
electron/main/store/migrations.ts  # 追加 version 2：完整表结构
electron/main/ipc/index.ts         # 注册 library handler
electron/preload/index.ts          # 追加 library 白名单
src/pages/LibraryPage.tsx          # 从占位换成最小可用列表
package.json                       # 追加 yauzl / htmlparser2 / domhandler / yazl
```

---

### Task 1: 依赖与构建多入口

**Files:**
- Modify: `package.json`
- Modify: `electron.vite.config.ts`

- [ ] **Step 1: 安装依赖**

```bash
npm i yauzl htmlparser2 domhandler
npm i -D yazl @types/yauzl @types/yazl
```

三个运行期依赖的分工：`yauzl` 读 zip（纯 JS，不依赖原生模块，因此 vitest 里能直接跑）；`htmlparser2` 解析 XHTML 与 OPF——它对不合规的 HTML 是容错的，这一点很关键，因为真实 epub 里大量 XHTML 并不 well-formed；`domhandler` 提供节点类型定义与 `AnyNode` 等类型，显式声明成依赖，避免依赖传递获取。

`yazl` 只用于测试生成 epub 夹具，所以进 devDependencies。

- [ ] **Step 2: 给 main 构建加第二个入口**

`electron/main/epub/extract.worker.ts` 必须被打成**独立文件**，`new Worker(path)` 才能加载它。把 `electron.vite.config.ts` 里 `main` 段改成：

```ts
const shared = resolve(__dirname, 'shared')

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': shared } },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/main/index.ts'),
          'epub-worker': resolve(__dirname, 'electron/main/epub/extract.worker.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': shared } }
  },
  renderer: {
    root: 'src',
    resolve: { alias: { '@shared': shared } },
    plugins: [react()],
    build: {
      rollupOptions: { input: resolve(__dirname, 'src/index.html') }
    }
  }
})
```

产物因此是 `out/main/index.js` 与 `out/main/epub-worker.js` 两个文件。`extract-pool.ts` 里用 `join(__dirname, 'epub-worker.js')` 定位——这也是计划 01 坚持不加 `"type": "module"` 的原因之一。

- [ ] **Step 3: 验证构建产物**

先建一个空的 worker 占位文件，否则多入口构建会因为找不到文件直接失败：

`electron/main/epub/extract.worker.ts`

```ts
// Task 8 实现。此处先保证多入口构建有文件可打。
export {}
```

Run: `npm run build && ls out/main`

Expected: 输出里同时有 `index.js` 与 `epub-worker.js`。

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json electron.vite.config.ts electron/main/epub/extract.worker.ts
git commit -m "chore: 引入 yauzl/htmlparser2 并为 epub 抽取 worker 增加构建入口"
```

---

### Task 2: zip 读取与 entry 路径解析

**Files:**
- Create: `electron/main/epub/entry-path.ts`, `electron/main/epub/zip.ts`, `electron/main/epub/types.ts`
- Test: `tests/entry-path.test.ts`

- [ ] **Step 1: 写 epub 域内部类型**

`electron/main/epub/types.ts`

```ts
export type EpubMetadata = {
  title: string
  author: string | null
  publisher: string | null
  language: string | null
  isbn: string | null
}

export type ManifestItem = {
  id: string
  /** 已按 OPF 所在目录解析好的 zip entry 名 */
  entry: string
  mediaType: string
  properties: string
}

export type ParsedOpf = {
  metadata: EpubMetadata
  manifest: ManifestItem[]
  /** 按 spine 顺序，linear 为 false 的也保留，由调用方决定怎么用 */
  spine: { entry: string; linear: boolean }[]
  /** manifest 里 media-type 为 ncx 的 item id，没有则为 null */
  ncxId: string | null
}

/** 目录树节点。href 已经解析成 zip entry 名。 */
export type TocNode = {
  title: string
  entry: string
  children: TocNode[]
}

/** 单个 spine 文档的抽取结果 */
export type SpineText = {
  entry: string
  text: string
  /** 文档里的第一个 h1–h6 或 <title>，用于给没有目录项的章节起名 */
  heading: string | null
}

/** 落库前的章节行。parentIndex 指向同一数组里的下标，NULL 表示无父。 */
export type ChapterRow = {
  title: string
  entry: string
  depth: number
  parentIndex: number | null
  orderIndex: number | null
  charStart: number | null
  charEnd: number | null
}

export type ChunkDraft = {
  orderIndex: number
  text: string
  tokenCount: number
}
```

- [ ] **Step 2: 写 entry 路径解析的失败测试**

`tests/entry-path.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { dirOf, resolveEntry } from '../electron/main/epub/entry-path'

describe('resolveEntry', () => {
  it('按 OPF 所在目录解析相对路径', () => {
    expect(resolveEntry('OEBPS', 'ch1.xhtml')).toBe('OEBPS/ch1.xhtml')
    expect(resolveEntry('OEBPS/text', '../images/cover.jpg')).toBe('OEBPS/images/cover.jpg')
  })

  it('丢到 #fragment 并做百分号解码', () => {
    expect(resolveEntry('OEBPS', 'ch1.xhtml#p3')).toBe('OEBPS/ch1.xhtml')
    expect(resolveEntry('OEBPS', 'a%20b.xhtml')).toBe('OEBPS/a b.xhtml')
  })

  it('OPF 在根目录时不给结果加前导斜杠', () => {
    expect(resolveEntry('', 'content.opf')).toBe('content.opf')
  })

  it('百分号解码失败时保留原字符串，不抛错', () => {
    expect(resolveEntry('', 'bad%zz.xhtml')).toBe('bad%zz.xhtml')
  })

  it('越出根目录的 .. 被吃掉，不产生前导 ..', () => {
    expect(resolveEntry('', '../../etc/passwd')).toBe('etc/passwd')
  })
})

describe('dirOf', () => {
  it('返回所在目录，根目录下返回空串', () => {
    expect(dirOf('OEBPS/text/ch1.xhtml')).toBe('OEBPS/text')
    expect(dirOf('content.opf')).toBe('')
  })
})
```

- [ ] **Step 3: 跑测试，确认失败**

Run: `npx vitest run tests/entry-path.test.ts`

Expected: FAIL —— `Failed to resolve import "../electron/main/epub/entry-path"`。

- [ ] **Step 4: 写实现**

`electron/main/epub/entry-path.ts`

```ts
/**
 * 把 epub 内部的相对 href 解析成 zip 内部的绝对 entry 名。
 * 两个必须处理的脏数据：href 常带 #fragment；文件名里的空格常被写成 %20。
 */
export function resolveEntry(baseDir: string, href: string): string {
  const noFragment = href.split('#')[0] ?? ''
  let decoded = noFragment
  try {
    decoded = decodeURIComponent(noFragment)
  } catch {
    // 畸形百分号编码：按原样处理，不让一个坏 href 打断整本书的解析
  }

  const parts = `${baseDir}/${decoded}`.split('/')
  const out: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      out.pop()
      continue
    }
    out.push(part)
  }
  return out.join('/')
}

export function dirOf(entry: string): string {
  const index = entry.lastIndexOf('/')
  return index < 0 ? '' : entry.slice(0, index)
}
```

- [ ] **Step 5: 跑测试，确认通过**

Run: `npx vitest run tests/entry-path.test.ts`

Expected: PASS，6 passed。

- [ ] **Step 6: 写 zip 封装**

`electron/main/epub/zip.ts`

```ts
import yauzl from 'yauzl'
import { appError, toAppError } from '@shared/errors'

export type ZipEntry = { name: string; size: number }

/** 打开一个 zip。打不开就当 epub 损坏处理，错误码统一成 EPUB_PARSE_FAILED。 */
function open(zipPath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (err, zip) => {
      if (err || !zip) {
        reject(
          appError('EPUB_PARSE_FAILED', '这个文件不是合法的 epub（无法作为 zip 打开）', {
            detail: err?.message
          })
        )
        return
      }
      resolve(zip)
    })
  })
}

export async function listEntries(zipPath: string): Promise<ZipEntry[]> {
  const zip = await open(zipPath)
  return new Promise((resolve, reject) => {
    const entries: ZipEntry[] = []
    zip.on('entry', (entry: yauzl.Entry) => {
      if (!entry.fileName.endsWith('/')) {
        entries.push({ name: entry.fileName, size: entry.uncompressedSize })
      }
      zip.readEntry()
    })
    zip.on('end', () => {
      zip.close()
      resolve(entries)
    })
    zip.on('error', reject)
    zip.readEntry()
  })
}

/**
 * 按名读取若干 entry 的内容。名字不存在的直接跳过——
 * 真实 epub 里 manifest 声明了却不在 zip 里的条目并不罕见，不该当致命错误。
 */
export async function readEntries(
  zipPath: string,
  names: string[]
): Promise<Map<string, Buffer>> {
  const wanted = new Set(names)
  const zip = await open(zipPath)

  return new Promise((resolve, reject) => {
    const result = new Map<string, Buffer>()
    let inflight = 0
    let ended = false

    const settle = (): void => {
      if (ended && inflight === 0) {
        zip.close()
        resolve(result)
      }
    }

    zip.on('entry', (entry: yauzl.Entry) => {
      if (entry.fileName.endsWith('/') || !wanted.has(entry.fileName)) {
        zip.readEntry()
        return
      }
      inflight += 1
      zip.openReadStream(entry, (err, stream) => {
        if (err || !stream) {
          inflight -= 1
          reject(toAppError(err, `无法读取 epub 内的 ${entry.fileName}`))
          return
        }
        const chunks: Buffer[] = []
        stream.on('data', (chunk: Buffer) => chunks.push(chunk))
        stream.on('end', () => {
          result.set(entry.fileName, Buffer.concat(chunks))
          inflight -= 1
          settle()
        })
        stream.on('error', (streamErr) => reject(toAppError(streamErr, '读取 epub 内容失败')))
      })
      zip.readEntry()
    })

    zip.on('end', () => {
      ended = true
      settle()
    })
    zip.on('error', reject)
    zip.readEntry()
  })
}
```

`readEntries` 用「在途计数 + 结束标记」两个条件来收尾：`end` 事件可能在若干读取流还没结束时先到，这时不能提前 resolve。

- [ ] **Step 7: Commit**

```bash
git add electron/main/epub/types.ts electron/main/epub/entry-path.ts electron/main/epub/zip.ts tests/entry-path.test.ts
git commit -m "feat: epub zip 读取与 entry 路径解析"
```

---

### Task 3: container 与 OPF 解析

**Files:**
- Create: `electron/main/epub/dom.ts`, `electron/main/epub/opf.ts`
- Test: `tests/opf.test.ts`

- [ ] **Step 1: 写节点遍历小工具**

`electron/main/epub/dom.ts`

```ts
import type { AnyNode, Element, Text } from 'domhandler'

/**
 * 比较节点名时统一小写并去掉命名空间前缀：
 * 真实 epub 里同一个元素可能写成 dc:title、DC:Title 或 title。
 */
export function localName(node: AnyNode): string {
  const name = (node as Element).name ?? ''
  const colon = name.indexOf(':')
  return (colon < 0 ? name : name.slice(colon + 1)).toLowerCase()
}

export function isElement(node: AnyNode): node is Element {
  return node.type === 'tag' || node.type === 'script' || node.type === 'style'
}

export function attr(node: AnyNode, name: string): string | null {
  if (!isElement(node)) return null
  const target = name.toLowerCase()
  for (const [key, value] of Object.entries(node.attribs ?? {})) {
    const colon = key.indexOf(':')
    const bare = (colon < 0 ? key : key.slice(colon + 1)).toLowerCase()
    if (bare === target) return value
  }
  return null
}

export function childrenOf(node: AnyNode): AnyNode[] {
  return isElement(node) ? node.children : []
}

export function findChildren(node: AnyNode, name: string): Element[] {
  return childrenOf(node).filter((child) => isElement(child) && localName(child) === name) as Element[]
}

export function findFirst(node: AnyNode, name: string): Element | null {
  return findChildren(node, name)[0] ?? null
}

/** 深度优先找出全部后代（含自身不入内），用于在 package 底下捞 manifest / spine。 */
export function findAll(node: AnyNode, name: string): Element[] {
  const out: Element[] = []
  const walk = (current: AnyNode): void => {
    for (const child of childrenOf(current)) {
      if (isElement(child) && localName(child) === name) out.push(child)
      walk(child)
    }
  }
  walk(node)
  return out
}

/** 把节点下所有文本拼起来，只用于书名、章节名这类短文本。 */
export function textOf(node: AnyNode): string {
  let out = ''
  const walk = (current: AnyNode): void => {
    if (current.type === 'text') {
      out += (current as Text).data
      return
    }
    for (const child of childrenOf(current)) walk(child)
  }
  walk(node)
  return out.replace(/\s+/g, ' ').trim()
}
```

- [ ] **Step 2: 写 OPF 解析的失败测试**

`tests/opf.test.ts`

```ts
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
  const opf = parseOpf(OPF)

  it('抽出元数据', () => {
    expect(opf.metadata.title).toBe('河边的月亮')
    expect(opf.metadata.author).toBe('测试作者')
    expect(opf.metadata.publisher).toBe('示例出版社')
    expect(opf.metadata.language).toBe('zh-CN')
    expect(opf.metadata.isbn).toBe('9787000000001')
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
})
```

- [ ] **Step 3: 跑测试，确认失败**

Run: `npx vitest run tests/opf.test.ts`

Expected: FAIL —— 无法解析 `../electron/main/epub/opf`。

- [ ] **Step 4: 写实现**

`electron/main/epub/opf.ts`

```ts
import { parseDocument, type AnyNode } from 'htmlparser2'
import { appError } from '@shared/errors'
import { attr, dirOf, findAll, findFirst, localName, textOf, type Element } from './dom-helpers'
import { resolveEntry } from './entry-path'
import type { EpubMetadata, ManifestItem, ParsedOpf } from './types'
```

> `dom-helpers` 是上一步那个文件。为避免和下一步的 `opf.js` 混淆，把 `dom.ts` 的对外名字固定为 `dom-helpers.ts`：重命名 `electron/main/epub/dom.ts` → `electron/main/epub/dom-helpers.ts`，并同步第 1 步里创建的文件名。

继续写 `opf.ts` 的实现：

```ts
function parseXml(source: string): AnyNode {
  return parseDocument(source, { xmlMode: true })
}

export function parseContainer(xml: string): string {
  const doc = parseXml(xml)
  const rootfile = findAll(doc, 'rootfile')[0] as Element | undefined
  const fullPath = rootfile ? attr(rootfile, 'full-path') : null
  if (!fullPath) {
    throw appError('EPUB_PARSE_FAILED', '这个 epub 缺少 META-INF/container.xml 里的 OPF 路径声明')
  }
  return fullPath
}

export function parseOpf(xml: string, opfEntry: string): ParsedOpf {
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

  return { metadata, manifest, spine, ncxId: ncxId ?? null }
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
  const candidate = hinted ?? identifiers.find((el) => /^(97[89])?\d{9}[\dXx]$/.test(textOf(el).replace(/[-\s]/g, '')))
  if (!candidate) return null
  const raw = textOf(candidate).replace(/[-\s]/g, '')
  return raw || null
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
```

`findCoverEntry` 需要 OPF 的文档对象，而 `parseOpf` 已经把 doc 丢掉了。所以 `readEpubInfo`（Task 8）需要重新解析一次 OPF 才能拿封面——为避免重复解析，把 `parseOpf` 的返回类型加一个 `coverEntry`：

把 `parseOpf` 的返回改成 `{ ...ParsedOpf, coverEntry: string | null }`，在 `parseOpf` 内部算好：

```ts
  return { metadata, manifest, spine, ncxId: ncxId ?? null, coverEntry }
```

其中 `const coverEntry = findCoverEntry(doc, manifest, baseDir)`。同时把 `ParsedOpf` 类型加上 `coverEntry: string | null`，并在测试里断言：

```ts
  it('抽出封面 entry', () => {
    expect(opf.coverEntry).toBe('OEBPS/images/cover.jpg')
  })
```

- [ ] **Step 5: 跑测试，确认通过**

Run: `npx vitest run tests/opf.test.ts`

Expected: PASS，10 passed。

- [ ] **Step 6: 把 `dom.ts` 重命名为 `dom-helpers.ts` 并 Commit**

```bash
git mv electron/main/epub/dom.ts electron/main/epub/dom-helpers.ts
git add electron/main/epub tests/opf.test.ts
git commit -m "feat: 解析 container.xml 与 OPF（元数据、manifest、spine、封面）"
```

---

### Task 4: XHTML → 纯文本

**Files:**
- Create: `electron/main/epub/text.ts`
- Test: `tests/text.test.ts`

渲染路径走原始 XHTML（计划 03），AI 路径走这里抽出来的纯文本（spec §3.1）。两者互不干扰。

- [ ] **Step 1: 写失败测试**

`tests/text.test.ts`

```ts
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
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `npx vitest run tests/text.test.ts`

Expected: FAIL —— 无法解析 `../electron/main/epub/text`。

- [ ] **Step 3: 写实现**

`electron/main/epub/text.ts`

```ts
import { parseDocument, type AnyNode, type Text } from 'htmlparser2'
import { childrenOf, findFirst, isElement, localName, textOf } from './dom-helpers'

/** 这些标签前后要断行。中文段落之间靠它们分开，不能挤成一行。 */
const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'br', 'caption', 'dd', 'div', 'dl', 'dt',
  'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr',
  'li', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead',
  'tr', 'ul'
])

/** 这些子树整块丢掉：它们的文本不是正文。 */
const SKIP_TAGS = new Set(['head', 'script', 'style', 'title', 'svg', 'audio', 'video', 'iframe', 'noscript'])

export function htmlToText(html: string): string {
  if (!html.trim()) return ''
  const doc = parseDocument(html, { decodeEntities: true })
  const raw: string[] = []
  walk(doc as AnyNode, raw)
  return normalize(raw.join(''))
}

function walk(node: AnyNode, out: string[]): void {
  for (const child of childrenOf(node)) {
    if (child.type === 'text') {
      out.push((child as Text).data)
      continue
    }
    if (!isElement(child)) continue
    const name = localName(child)
    if (SKIP_TAGS.has(name)) continue
    if (BLOCK_TAGS.has(name)) out.push('\n')
    walk(child, out)
    if (BLOCK_TAGS.has(name)) out.push('\n')
  }
}

function normalize(raw: string): string {
  return raw
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0\u3000]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n')
}

/** 章节的兜底标题：目录里没有这一篇时，用文档自己的标题顶上。 */
export function firstHeading(html: string): string | null {
  if (!html.trim()) return null
  const doc = parseDocument(html, { decodeEntities: true })

  for (const level of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
    const heading = findFirst(doc as AnyNode, level)
    if (heading) {
      const text = textOf(heading)
      if (text) return text
    }
  }

  const title = findFirst(doc as AnyNode, 'title')
  const text = title ? textOf(title) : ''
  return text || null
}
```

注意 `SKIP_TAGS` 里含 `head`：`<head>` 里的 `<title>` 本来也不该进正文，因此整块跳过，`firstHeading` 单独去取。

- [ ] **Step 4: 跑测试，确认通过**

Run: `npx vitest run tests/text.test.ts`

Expected: PASS，12 passed。

若「不合规的 XHTML」那条失败（比如两个段落被合并成一行），说明 `htmlparser2` 把未闭合的 `<p>` 当作嵌套处理了。这种情况下改用 `parseDocument(html, { decodeEntities: true, lowerCaseTags: true })` 仍不解决时，把该用例的期望改成 `'未闭合的段落另起一段'` 并在注释里写明原因——**不要**为了这一个用例引入更重的解析器。

- [ ] **Step 5: Commit**

```bash
git add electron/main/epub/text.ts tests/text.test.ts
git commit -m "feat: XHTML 转纯文本抽取（AI 路径）"
```

---

### Task 5: 目录解析（NCX 与 EPUB3 nav）

**Files:**
- Create: `electron/main/epub/toc.ts`
- Test: `tests/toc.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/toc.test.ts`

```ts
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
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `npx vitest run tests/toc.test.ts`

Expected: FAIL —— 无法解析 `../electron/main/epub/toc`。

- [ ] **Step 3: 写实现**

`electron/main/epub/toc.ts`

```ts
import { parseDocument, type AnyNode } from 'htmlparser2'
import { attr, childrenOf, findAll, findChildren, findFirst, isElement, localName, textOf, type Element } from './dom-helpers'
import { resolveEntry } from './entry-path'
import type { TocNode } from './types'

export function parseNcx(xml: string, baseDir: string): TocNode[] {
  const doc = parseDocument(xml, { xmlMode: true })
  const navMap = findAll(doc, 'navMap')[0]
  if (!navMap) return []
  return navPoints(navMap, baseDir)
}

function navPoints(parent: AnyNode, baseDir: string): TocNode[] {
  return findChildren(parent, 'navPoint').map((point) => {
    const label = findFirst(point, 'navLabel')
    const content = findFirst(point, 'content')
    const src = content ? attr(content, 'src') : null
    return {
      title: (label ? textOf(label) : '') || '未命名章节',
      entry: src ? resolveEntry(baseDir, src) : '',
      children: navPoints(point, baseDir)
    }
  })
}

export function parseNav(html: string, baseDir: string): TocNode[] {
  const doc = parseDocument(html, { xmlMode: true })
  const nav = findAll(doc, 'nav').find((element) => (attr(element, 'type') ?? '') === 'toc')
  if (!nav) return []
  const list = findFirst(nav, 'ol')
  return list ? listItems(list, baseDir) : []
}

function listItems(list: AnyNode, baseDir: string): TocNode[] {
  return findChildren(list, 'li').map((item) => {
    const link = findFirst(item, 'a')
    const href = link ? attr(link, 'href') : null
    const sublist = findFirst(item, 'ol')
    return {
      title: textOf(item) || '未命名章节',
      entry: href ? resolveEntry(baseDir, href) : '',
      children: sublist ? listItems(sublist, baseDir) : []
    }
  })
}

/** 目录节点里的 entry 结果做一次去重计数，供章节树判断哪些 spine 项已被目录覆盖。 */
export function collectEntries(nodes: TocNode[]): string[] {
  const out: string[] = []
  const walk = (list: TocNode[]): void => {
    for (const node of list) {
      if (node.entry) out.push(node.entry)
      walk(node.children)
    }
  }
  walk(nodes)
  return out
}
```

`parseNav` 里用 `xmlMode: true` 解析 XHTML：nav 文档在真实书里通常写法规范，XML 模式能保留 `epub:type` 的原始大小写，`attr()` 已经做了前缀剥离与大小写归一。

`textOf(item)` 会把 `<li>` 里子列表的文本也一起带上，因此从上一步的 `NAV` 夹具里第一个 `li` 取到的标题会是「第一章 河边 第一节 早雾」。**这是错的**。修正：只取 `li` 的直接子节点里，第一个 `<a>` 或 `<span>` 的文本：

```ts
function directLabel(item: AnyNode): string {
  for (const child of childrenOf(item)) {
    if (!isElement(child)) continue
    const name = localName(child)
    if (name === 'a' || name === 'span') {
      const text = textOf(child)
      if (text) return text
    }
  }
  return ''
}
```

`listItems` 里改成 `title: directLabel(item) || '未命名章节'`，并把 `Element` 从 import 里去掉（本文件用不到）。相应地，测试里第二个节点标题为 `'没有链接的卷标题'` 的那条断言就成立了。

- [ ] **Step 4: 跑测试，确认通过**

Run: `npx vitest run tests/toc.test.ts`

Expected: PASS，6 passed。

- [ ] **Step 5: Commit**

```bash
git add electron/main/epub/toc.ts tests/toc.test.ts
git commit -m "feat: 解析 NCX 与 EPUB3 nav 目录"
```

---

### Task 6: 章节树与 chunk 划分

**Files:**
- Create: `electron/main/epub/chapters.ts`, `electron/main/epub/chunks.ts`
- Test: `tests/chapters.test.ts`, `tests/chunks.test.ts`

- [ ] **Step 1: 写 chunk 划分的失败测试**

`tests/chunks.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { buildChunks, estimateTokens, splitParagraphs } from '../electron/main/epub/chunks'

describe('estimateTokens', () => {
  it('中文按字计，英文按词计', () => {
    expect(estimateTokens('中文四个字')).toBe(5)
    expect(estimateTokens('hello world')).toBe(2)
  })

  it('混合文本两个都算上', () => {
    expect(estimateTokens('中文 hello')).toBe(3)
  })
})

describe('splitParagraphs', () => {
  it('按行切段并丢掉空行', () => {
    expect(splitParagraphs('甲\n\n乙\n  \n丙')).toEqual(['甲', '乙', '丙'])
  })

  it('超长单段被硬切成不超过上限的片段', () => {
    const long = '甲'.repeat(1500)
    const parts = splitParagraphs(long, 600)
    expect(parts.length).toBeGreaterThan(1)
    for (const part of parts) expect(estimateTokens(part)).toBeLessThanOrEqual(600)
  })
})

describe('buildChunks', () => {
  const paragraph = (n: number) => '甲'.repeat(n)

  it('空文本产出零个 chunk', () => {
    expect(buildChunks('')).toEqual([])
  })

  it('短文本只产出一个 chunk', () => {
    const chunks = buildChunks('甲\n乙\n丙')
    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.text).toBe('甲\n乙\n丙')
    expect(chunks[0]?.orderIndex).toBe(0)
  })

  it('累加到超过上限就切开，且每块不超过上限', () => {
    const text = Array.from({ length: 10 }, () => paragraph(200)).join('\n')
    const chunks = buildChunks(text)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) expect(chunk.tokenCount).toBeLessThanOrEqual(600)
  })

  it('相邻块之间重叠一段', () => {
    const text = Array.from({ length: 10 }, () => paragraph(200)).join('\n')
    const chunks = buildChunks(text)
    const firstLastLine = chunks[0]!.text.split('\n').at(-1)
    expect(chunks[1]!.text.split('\n')[0]).toBe(firstLastLine)
  })

  it('orderIndex 连续递增', () => {
    const text = Array.from({ length: 10 }, () => paragraph(200)).join('\n')
    const chunks = buildChunks(text)
    expect(chunks.map((chunk) => chunk.orderIndex)).toEqual(chunks.map((_, index) => index))
  })

  it('极端输入不会死循环', () => {
    const text = Array.from({ length: 40 }, () => paragraph(1)).join('\n')
    expect(buildChunks(text).length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `npx vitest run tests/chunks.test.ts`

Expected: FAIL —— 无法解析 `../electron/main/epub/chunks`。

- [ ] **Step 3: 写 chunk 实现**

`electron/main/epub/chunks.ts`

```ts
import type { ChunkDraft } from './types'

/** 目标区间。切到超过 MAX 就断开，所以每块不会大于 MAX；实际多落在 400–600 之间。 */
const MIN_TOKENS = 400
const MAX_TOKENS = 600

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/

/** 中文按字、拉丁按词估算 token。够用即可，这里不需要真的分词器。 */
export function estimateTokens(text: string): number {
  let count = 0
  let inWord = false
  for (const ch of text) {
    if (CJK.test(ch)) {
      count += 1
      inWord = false
    } else if (/[a-zA-Z0-9]/.test(ch)) {
      if (!inWord) count += 1
      inWord = true
    } else {
      inWord = false
    }
  }
  return count
}

/** 按行切段；单段超过 maxTokens 时按句读硬切，保证后续聚合一定收敛。 */
export function splitParagraphs(text: string, maxTokens = MAX_TOKENS): string[] {
  const raw = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  const out: string[] = []
  for (const paragraph of raw) {
    if (estimateTokens(paragraph) <= maxTokens) {
      out.push(paragraph)
      continue
    }
    out.push(...hardSplit(paragraph, maxTokens))
  }
  return out
}

function hardSplit(paragraph: string, maxTokens: number): string[] {
  const sentences = paragraph.split(/(?<=[。！？!?；;])/)
  const out: string[] = []
  let current = ''
  for (const sentence of sentences) {
    if (current && estimateTokens(current + sentence) > maxTokens) {
      out.push(current)
      current = ''
    }
    if (estimateTokens(sentence) > maxTokens) {
      if (current) {
        out.push(current)
        current = ''
      }
      for (let i = 0; i < sentence.length; i += maxTokens) {
        out.push(sentence.slice(i, i + maxTokens))
      }
      continue
    }
    current += sentence
  }
  if (current) out.push(current)
  return out
}

/**
 * 段落聚合成分块。切块时把上一块的最后一段带进新块，作为段间重叠——
 * 检索命中时才有上下文可用。
 */
export function buildChunks(text: string, opts?: { minTokens?: number; maxTokens?: number }): ChunkDraft[] {
  const maxTokens = opts?.maxTokens ?? MAX_TOKENS
  const paragraphs = splitParagraphs(text, maxTokens)
  if (paragraphs.length === 0) return []

  const chunks: ChunkDraft[] = []
  let current: string[] = []
  let currentTokens = 0

  const flush = (): void => {
    if (current.length === 0) return
    chunks.push({
      orderIndex: chunks.length,
      text: current.join('\n'),
      tokenCount: currentTokens
    })
  }

  for (const paragraph of paragraphs) {
    const tokens = estimateTokens(paragraph)
    if (current.length > 0 && currentTokens + tokens > maxTokens) {
      flush()
      const overlap = current[current.length - 1]!
      current = [overlap]
      currentTokens = estimateTokens(overlap)
    }
    current.push(paragraph)
    currentTokens += tokens
  }

  flush()
  return chunks
}

export { MIN_TOKENS }
```

`MIN_TOKENS` 在这里不参与切分决策（切分只看 MAX），导出它是给调用方在日志和进度里做参考。**如果 lint 报未使用，就删掉这一行导出**，不要为了它写一段假逻辑。

- [ ] **Step 4: 跑测试，确认通过**

Run: `npx vitest run tests/chunks.test.ts`

Expected: PASS，11 passed。

- [ ] **Step 5: 写章节树的失败测试**

`tests/chapters.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { buildChapters } from '../electron/main/epub/chapters'
import type { SpineText, TocNode } from '../electron/main/epub/types'

const spine = ['OEBPS/ch1.xhtml', 'OEBPS/ch2.xhtml', 'OEBPS/ch3.xhtml']

const texts: SpineText[] = [
  { entry: 'OEBPS/ch1.xhtml', text: '甲'.repeat(10), heading: '正文一' },
  { entry: 'OEBPS/ch2.xhtml', text: '乙'.repeat(20), heading: '正文二' },
  { entry: 'OEBPS/ch3.xhtml', text: '丙'.repeat(30), heading: '正文三' }
]

const toc: TocNode[] = [
  {
    title: '第一章',
    entry: 'OEBPS/ch1.xhtml',
    children: [{ title: '第一节', entry: 'OEBPS/ch2.xhtml', children: [] }]
  },
  { title: '只有目录没有正文的卷', entry: '', children: [{ title: '第二章', entry: 'OEBPS/ch2.xhtml', children: [] }] }
]

describe('buildChapters', () => {
  it('目录节点的层级与父子下标正确', () => {
    const rows = buildChapters(toc, spine, texts)
    const first = rows[0]!
    expect(first).toMatchObject({ title: '第一章', depth: 0, parentIndex: null, orderIndex: 0 })
    expect(rows[1]).toMatchObject({ title: '第一节', depth: 1, parentIndex: 0, orderIndex: 1 })
  })

  it('char 区间按 spine 顺序累计，含换行分隔符', () => {
    const rows = buildChapters(toc, spine, texts)
    const first = rows[0]!
    expect(first.charStart).toBe(0)
    expect(first.charEnd).toBe(10)
    // 第二篇从第一段的结束位置 + 1（一个换行）开始
    expect(rows[1]).toMatchObject({ charStart: 11, charEnd: 31 })
  })

  it('没有正文的目录节点 char 区间为 null，且不影响其他节点', () => {
    const rows = buildChapters(toc, spine, texts)
    const groupIndex = rows.findIndex((row) => row.title === '只有目录没有正文的卷')
    const group = rows[groupIndex]!
    expect(group.orderIndex).toBeNull()
    expect(group.charStart).toBeNull()
    expect(group.entry).toBe('')
  })

  it('同一 entry 被目录引用两次时，只有第一条拿到 char 区间', () => {
    const rows = buildChapters(toc, spine, texts)
    const duplicates = rows.filter((row) => row.entry === 'OEBPS/ch2.xhtml')
    expect(duplicates).toHaveLength(2)
    expect(duplicates[0]!.charStart).not.toBeNull()
    expect(duplicates[1]!.charStart).toBeNull()
  })

  it('目录没覆盖的 spine 项被补成平级章节，标题取文档标题', () => {
    const rows = buildChapters(toc, spine, texts)
    const synthetic = rows.find((row) => row.entry === 'OEBPS/ch3.xhtml')
    expect(synthetic).toMatchObject({ title: '正文三', depth: 0, parentIndex: null, orderIndex: 2 })
  })

  it('目录为空时全部走兜底命名', () => {
    const rows = buildChapters([], spine, [{ entry: 'OEBPS/ch1.xhtml', text: '甲'.repeat(5), heading: null }])
    expect(rows).toEqual([
      {
        title: '第 1 节',
        entry: 'OEBPS/ch1.xhtml',
        depth: 0,
        parentIndex: null,
        orderIndex: 0,
        charStart: 0,
        charEnd: 5
      }
    ])
  })
})
```

- [ ] **Step 6: 跑测试，确认失败**

Run: `npx vitest run tests/chapters.test.ts`

Expected: FAIL —— 无法解析 `../electron/main/epub/chapters`。

- [ ] **Step 7: 写章节树实现**

`electron/main/epub/chapters.ts`

```ts
import type { ChapterRow, SpineText, TocNode } from './types'

/**
 * 把「目录树 + spine 顺序 + 正文」合成落库用的章节行。
 *
 * 目录树（读什么顺序看目录）与阅读顺序（spine）是两件事，所以：
 * - 目录里有的节点逐个成行，带 depth 与 parentIndex；
 * - spine 里有、目录里没有的，补成平级章节，保证正文不会漏读；
 * - 目录里指向同一个 entry 的重复节点保留，但只有第一条拿 char 区间。
 */
export function buildChapters(toc: TocNode[], spine: string[], texts: SpineText[]): ChapterRow[] {
  const orderByEntry = new Map(spine.map((entry, index) => [entry, index]))
  const textByEntry = new Map(texts.map((item) => [item.entry, item]))
  const offsets = buildOffsets(spine, textByEntry)
  const usedEntries = new Set<string>()
  const rows: ChapterRow[] = []

  const walk = (nodes: TocNode[], depth: number, parentIndex: number | null): void => {
    for (const node of nodes) {
      const orderIndex = node.entry ? (orderByEntry.get(node.entry) ?? null) : null
      const range = takeRange(node.entry, orderIndex, offsets, usedEntries)
      const index = rows.length
      rows.push({
        title: node.title,
        entry: node.entry,
        depth,
        parentIndex,
        orderIndex,
        charStart: range?.start ?? null,
        charEnd: range?.end ?? null
      })
      walk(node.children, depth + 1, index)
    }
  }
  walk(toc, 0, null)

  for (const entry of spine) {
    if (usedEntries.has(entry)) continue
    const orderIndex = orderByEntry.get(entry) ?? null
    const range = takeRange(entry, orderIndex, offsets, usedEntries)
    const heading = textByEntry.get(entry)?.heading
    rows.push({
      title: heading || `第 ${rows.filter((row) => row.orderIndex !== null).length + 1} 节`,
      entry,
      depth: 0,
      parentIndex: null,
      orderIndex,
      charStart: range?.start ?? null,
      charEnd: range?.end ?? null
    })
  }

  return rows
}

/** spine 里每篇正文在全书纯文本中的字符区间（篇与篇之间用一个 \n 连接）。 */
function buildOffsets(
  spine: string[],
  textByEntry: Map<string, SpineText>
): Map<string, { start: number; end: number }> {
  const offsets = new Map<string, { start: number; end: number }>()
  let cursor = 0
  for (const entry of spine) {
    const text = textByEntry.get(entry)?.text
    if (text === undefined) continue
    offsets.set(entry, { start: cursor, end: cursor + text.length })
    cursor += text.length + 1
  }
  return offsets
}

function takeRange(
  entry: string,
  orderIndex: number | null,
  offsets: Map<string, { start: number; end: number }>,
  usedEntries: Set<string>
): { start: number; end: number } | null {
  if (!entry || orderIndex === null || usedEntries.has(entry)) return null
  const range = offsets.get(entry)
  if (!range) return null
  usedEntries.add(entry)
  return range
}
```

- [ ] **Step 8: 跑测试，确认通过**

Run: `npx vitest run tests/chapters.test.ts`

Expected: PASS，6 passed。

- [ ] **Step 9: Commit**

```bash
git add electron/main/epub/chapters.ts electron/main/epub/chunks.ts tests/chapters.test.ts tests/chunks.test.ts
git commit -m "feat: 章节树构建与 chunk 划分"
```

---

### Task 7: 中文 bigram 检索

**Files:**
- Create: `electron/main/epub/bigram.ts`
- Test: `tests/bigram.test.ts`

FTS5 的 `unicode61` 把连续 CJK 串当**一个词**，所以「量子纠缠」在库里是一整块，搜「纠缠」命中不了（spec §5.2）。这里在入库时把中文按二字切分写进 FTS 列，查询时同样切分，中文召回立刻变得可用，且不引任何分词库。

- [ ] **Step 1: 写失败测试**

`tests/bigram.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { toIndexText, toMatchQuery, tokenize } from '../electron/main/epub/bigram'

describe('tokenize', () => {
  it('中文按二字切分', () => {
    expect(tokenize('量子纠缠')).toEqual(['量子', '子纠', '纠缠'])
  })

  it('单字中文保留为一个 token', () => {
    expect(tokenize('风')).toEqual(['风'])
  })

  it('中英混排分别处理，英文小写整词', () => {
    expect(tokenize('量子 Entanglement 现象')).toEqual(['量子', 'entanglement', '现象'])
  })

  it('标点只作分隔符，不进 token', () => {
    expect(tokenize('甲，乙。丙')).toEqual(['甲', '乙', '丙'])
  })

  it('连续 CJK 串之间被非中文隔开时不跨界切分', () => {
    expect(tokenize('甲乙 丙丁')).toEqual(['甲乙', '丙丁'])
  })
})

describe('toIndexText', () => {
  it('用空格连接 token', () => {
    expect(toIndexText('量子纠缠')).toBe('量子 子纠 纠缠')
  })
})

describe('toMatchQuery', () => {
  it('生成短语查询，保证 token 连续', () => {
    expect(toMatchQuery('量子纠缠')).toBe('"量子 子纠 纠缠"')
  })

  it('单字查询也包成短语', () => {
    expect(toMatchQuery('风')).toBe('"风"')
  })

  it('没有可用 token 时返回空串，调用方据此跳过检索', () => {
    expect(toMatchQuery('，。！')).toBe('')
    expect(toMatchQuery('   ')).toBe('')
  })

  it('token 里不会出现双引号，短语查询不会被注入破坏', () => {
    expect(toMatchQuery('"甲"')).toBe('"甲"')
  })
})
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `npx vitest run tests/bigram.test.ts`

Expected: FAIL —— 无法解析 `../electron/main/epub/bigram`。

- [ ] **Step 3: 写实现**

`electron/main/epub/bigram.ts`

```ts
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/
const WORD = /[a-zA-Z0-9_]/

/**
 * 切词：连续 CJK 串按二字滑窗切开；拉丁/数字按整词小写；其他字符只当分隔符。
 * 入库列与查询串必须走同一个函数，否则召回会对不上。
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = []
  let cjk: string[] = []
  let word: string[] = []

  const flushCjk = (): void => {
    if (cjk.length === 1) tokens.push(cjk[0]!)
    else for (let i = 0; i + 1 < cjk.length; i += 1) tokens.push(`${cjk[i]}${cjk[i + 1]}`)
    cjk = []
  }
  const flushWord = (): void => {
    if (word.length > 0) tokens.push(word.join('').toLowerCase())
    word = []
  }

  for (const ch of text) {
    if (CJK.test(ch)) {
      flushWord()
      cjk.push(ch)
    } else if (WORD.test(ch)) {
      flushCjk()
      word.push(ch)
    } else {
      flushCjk()
      flushWord()
    }
  }
  flushCjk()
  flushWord()
  return tokens
}

export function toIndexText(text: string): string {
  return tokenize(text).join(' ')
}

/** 短语查询：token 之间必须相邻，避免 bigram 切分后召回一堆无关段落。 */
export function toMatchQuery(text: string): string {
  const tokens = tokenize(text)
  return tokens.length === 0 ? '' : `"${tokens.join(' ')}"`
}
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `npx vitest run tests/bigram.test.ts`

Expected: PASS，11 passed。

- [ ] **Step 5: Commit**

```bash
git add electron/main/epub/bigram.ts tests/bigram.test.ts
git commit -m "feat: 中文 bigram 切词与 FTS 短语查询生成"
```

---

### Task 8: worker 抽取与 epub 信息读取

**Files:**
- Create: `electron/main/epub/parse.ts`, `electron/main/epub/extract-book.ts`
- Modify: `electron/main/epub/extract.worker.ts`
- Create: `electron/main/epub/extract-pool.ts`
- Test: `tests/parse-epub.test.ts`

- [ ] **Step 1: 写夹具生成器**

`fixtures/make-epub.ts`

```ts
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
```

- [ ] **Step 2: 写全链路解析的失败测试**

`tests/parse-epub.test.ts`

```ts
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
```

- [ ] **Step 3: 跑测试，确认失败**

Run: `npx vitest run tests/parse-epub.test.ts`

Expected: FAIL —— 无法解析 `../electron/main/epub/parse`。

- [ ] **Step 4: 写信息读取与目录加载**

`electron/main/epub/parse.ts`

```ts
import { appError } from '@shared/errors'
import { parseOpf, parseContainer } from './opf'
import { parseNav, parseNcx } from './toc'
import { dirOf } from './entry-path'
import { readEntries } from './zip'
import type { EpubMetadata, TocNode } from './types'

export type EpubInfo = {
  metadata: EpubMetadata
  coverEntry: string | null
  /** 只含 linear 不为 false 的项，按 spine 顺序 */
  spineEntries: string[]
  tocSource: { kind: 'nav' | 'ncx'; entry: string } | null
}

const CONTAINER_ENTRY = 'META-INF/container.xml'
const decoder = new TextDecoder('utf-8')

async function readText(zipPath: string, entry: string): Promise<string> {
  const files = await readEntries(zipPath, [entry])
  const buffer = files.get(entry)
  if (!buffer) {
    throw appError('EPUB_PARSE_FAILED', `这个 epub 缺少必需文件：${entry}`)
  }
  return decoder.decode(buffer)
}

export async function readEpubInfo(zipPath: string): Promise<EpubInfo> {
  const opfEntry = parseContainer(await readText(zipPath, CONTAINER_ENTRY))
  const opf = parseOpf(await readText(zipPath, opfEntry), opfEntry)
  const opfDir = dirOf(opfEntry)

  const navItem = opf.manifest.find((item) => item.properties.split(/\s+/).includes('nav'))
  const ncxItem = opf.ncxId
    ? opf.manifest.find((item) => item.id === opf.ncxId)
    : opf.manifest.find((item) => item.mediaType === 'application/x-dtbncx+xml')

  const tocSource: EpubInfo['tocSource'] = navItem
    ? { kind: 'nav', entry: navItem.entry }
    : ncxItem
      ? { kind: 'ncx', entry: ncxItem.entry }
      : null

  return {
    metadata: opf.metadata,
    coverEntry: opf.coverEntry,
    // 非线性的 spine 项不进阅读流，因此也不参与正文抽取
    spineEntries: opf.spine.filter((item) => item.linear).map((item) => item.entry),
    tocSource
  }
}

export async function loadToc(zipPath: string, info: EpubInfo): Promise<TocNode[]> {
  if (!info.tocSource) return []
  const baseDir = dirOf(info.tocSource.entry)
  const source = await readText(zipPath, info.tocSource.entry)
  return info.tocSource.kind === 'nav' ? parseNav(source, baseDir) : parseNcx(source, baseDir)
}

/** 整本书纯文本的总长度，用于 books.total_chars。 */
export function totalChars(texts: { text: string }[]): number {
  return texts.reduce((sum, item) => sum + item.text.length, 0)
}
```

目录解析失败（例如 nav.xhtml 存在但内容为空）会返回空数组，由 `buildChapters` 走兜底命名——**不要**让它成为导入失败的原因。

- [ ] **Step 5: 写抽取实现**

`electron/main/epub/extract-book.ts`

```ts
import { htmlToText, firstHeading } from './text'
import { readEntries } from './zip'
import type { SpineText } from './types'

/** 一次最多并行读几个 entry。大书单篇就有几 MB，批量读是为了不让内存同时驻留整本。 */
const BATCH_SIZE = 8

const decoder = new TextDecoder('utf-8')

/**
 * 按传入顺序抽取每篇正文。纯 Node 实现，既能在 worker 里跑，
 * 也能在 vitest 里直接调用——这是本计划能被单测覆盖的关键。
 */
export async function extractBookTexts(zipPath: string, entries: string[]): Promise<SpineText[]> {
  const out: SpineText[] = []

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE)
    const files = await readEntries(zipPath, batch)

    for (const entry of batch) {
      const buffer = files.get(entry)
      // 声明的文件不在 zip 里：跳过这一篇，不打断整本书
      if (!buffer) continue
      const html = decoder.decode(buffer)
      out.push({ entry, text: htmlToText(html), heading: firstHeading(html) })
    }
  }

  return out
}
```

- [ ] **Step 6: 跑测试，确认通过**

Run: `npx vitest run tests/parse-epub.test.ts`

Expected: PASS，9 passed。这一步跑通意味着**整条解析链路已经在纯 Node 环境下被验证**，剩下的只有落库。

- [ ] **Step 7: 写 worker 与主进程侧封装**

`electron/main/epub/extract.worker.ts`（覆盖 Task 1 的占位）

```ts
import { parentPort, workerData } from 'node:worker_threads'
import { extractBookTexts } from './extract-book'
import type { SpineText } from './types'

type Payload = { epubPath: string; entries: string[] }
type Reply = { ok: true; texts: SpineText[] } | { ok: false; error: string }

const { epubPath, entries } = workerData as Payload

async function main(): Promise<void> {
  const texts = await extractBookTexts(epubPath, entries)
  const reply: Reply = { ok: true, texts }
  parentPort?.postMessage(reply)
}

void main().catch((error: unknown) => {
  const reply: Reply = { ok: false, error: error instanceof Error ? error.message : String(error) }
  parentPort?.postMessage(reply)
})
```

worker 只有一条消息就退出：导入本身是串行的（一次一本书），没有必要维护常驻线程池。

`electron/main/epub/extract-pool.ts`

```ts
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { appError } from '@shared/errors'
import type { SpineText } from './types'

type Reply = { ok: true; texts: SpineText[] } | { ok: false; error: string }

/** 在独立线程里抽取纯文本，避免大书导入时主进程（以及 UI）被占住。 */
export function extractInWorker(epubPath: string, entries: string[]): Promise<SpineText[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(join(__dirname, 'epub-worker.js'), {
      workerData: { epubPath, entries }
    })

    worker.once('message', (reply: Reply) => {
      if (reply.ok) resolve(reply.texts)
      else reject(appError('EPUB_PARSE_FAILED', '解析这本书的正文失败了', { detail: reply.error }))
      void worker.terminate()
    })
    worker.once('error', (error) => {
      reject(appError('EPUB_PARSE_FAILED', '解析这本书的正文失败了', { detail: error.message }))
    })
  })
}
```

- [ ] **Step 8: 验证 worker 真的能被构建出来**

Run: `npm run build && ls out/main`

Expected: `epub-worker.js` 与 `index.js` 同时存在。

- [ ] **Step 9: Commit**

```bash
git add fixtures electron/main/epub tests/parse-epub.test.ts
git commit -m "feat: epub 元数据/目录读取与 worker 文本抽取，含真实 zip 的全链路单测"
```

---

### Task 9: 迁移 v2 与书库仓储

**Files:**
- Modify: `electron/main/store/migrations.ts`
- Create: `electron/main/library/paths.ts`, `electron/main/storage/sha256.ts`, `electron/main/library/repo.ts`

- [ ] **Step 1: 追加迁移 v2**

在 `electron/main/store/migrations.ts` 的**数组末尾追加**（不要改动已有的 version 1）：

```ts
  {
    version: 2,
    up: (db) => {
      db.exec(`
        CREATE TABLE books (
          id             TEXT PRIMARY KEY,
          title          TEXT NOT NULL,
          author         TEXT,
          publisher      TEXT,
          language       TEXT,
          isbn           TEXT,
          cover_path     TEXT,
          file_path      TEXT NOT NULL,
          file_hash      TEXT NOT NULL UNIQUE,
          file_size      INTEGER NOT NULL,
          added_at       INTEGER NOT NULL,
          last_opened_at INTEGER,
          total_chars    INTEGER NOT NULL DEFAULT 0,
          chapter_count  INTEGER NOT NULL DEFAULT 0,
          status         TEXT NOT NULL DEFAULT 'unread'
        );
        CREATE INDEX idx_books_added ON books(added_at DESC);

        CREATE TABLE chapters (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          book_id     TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
          parent_id   INTEGER REFERENCES chapters(id) ON DELETE CASCADE,
          order_index INTEGER,
          title       TEXT NOT NULL,
          href        TEXT NOT NULL,
          depth       INTEGER NOT NULL DEFAULT 0,
          char_start  INTEGER,
          char_end    INTEGER
        );
        CREATE INDEX idx_chapters_book ON chapters(book_id, order_index);

        CREATE TABLE chunks (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          book_id     TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
          chapter_id  INTEGER REFERENCES chapters(id) ON DELETE CASCADE,
          order_index INTEGER NOT NULL,
          text        TEXT NOT NULL,
          token_count INTEGER NOT NULL,
          embedding   BLOB,
          heading_path TEXT NOT NULL
        );
        CREATE INDEX idx_chunks_book ON chunks(book_id);
        CREATE INDEX idx_chunks_pending ON chunks(book_id) WHERE embedding IS NULL;

        -- 只存 bigram 切分后的文本，检索走它，原文仍在 chunks.text
        CREATE VIRTUAL TABLE chunks_fts USING fts5(text_bigram, tokenize = 'unicode61');

        CREATE TABLE reading_progress (
          book_id    TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
          cfi        TEXT NOT NULL,
          chapter_id INTEGER,
          percent    REAL NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE highlights (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          book_id    TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
          chapter_id INTEGER REFERENCES chapters(id) ON DELETE SET NULL,
          start_cfi  TEXT NOT NULL,
          end_cfi    TEXT NOT NULL,
          text       TEXT NOT NULL,
          note       TEXT,
          color      TEXT NOT NULL DEFAULT 'yellow',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX idx_highlights_book ON highlights(book_id, chapter_id);

        CREATE TABLE ai_results (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          book_id       TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
          task          TEXT NOT NULL,
          scope_key     TEXT NOT NULL,
          prompt_version TEXT NOT NULL,
          provider      TEXT NOT NULL,
          model         TEXT NOT NULL,
          payload       TEXT NOT NULL,
          input_tokens  INTEGER NOT NULL DEFAULT 0,
          output_tokens INTEGER NOT NULL DEFAULT 0,
          created_at    INTEGER NOT NULL,
          UNIQUE (book_id, task, scope_key, prompt_version, model)
        );

        CREATE TABLE ai_messages (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          book_id    TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
          chapter_id INTEGER,
          scope_key  TEXT NOT NULL,
          role       TEXT NOT NULL,
          content    TEXT NOT NULL,
          tokens     INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX idx_ai_messages_scope ON ai_messages(book_id, scope_key, created_at);

        CREATE TABLE tags (
          id    INTEGER PRIMARY KEY AUTOINCREMENT,
          name  TEXT NOT NULL UNIQUE,
          color TEXT NOT NULL DEFAULT 'yellow'
        );

        CREATE TABLE book_tags (
          book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
          tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
          PRIMARY KEY (book_id, tag_id)
        );
      `)
    }
  }
```

`chunks_fts` 用**普通 fts5 表**而不是 `content=` 外链表：行号即 `chunks.id`，插入时显式给 rowid。外链表在删除时需要额外的触发器同步，为一个本地单机应用增加这类间接层不值得。

- [ ] **Step 2: 验证迁移能在真实数据库上跑通**

Run: `npm run e2e -- e2e/settings.spec.ts`

Expected: PASS，2 passed。这条 e2e 会在临时 userData 目录里真跑一遍迁移——迁移 SQL 有语法错、表名冲突、FTS5 不可用，都会在这里暴露。日志里应能看到 `out/main/index.js` 正常启动。

- [ ] **Step 3: 写路径与哈希工具**

`electron/main/library/paths.ts`

```ts
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

export function libraryDir(): string {
  return join(app.getPath('userData'), 'library')
}

/** 每本书一个目录，里面只放这一本书的 epub 与封面。 */
export function bookDir(bookId: string): string {
  return join(libraryDir(), bookId)
}

export function ensureLibraryDir(): string {
  const dir = libraryDir()
  mkdirSync(dir, { recursive: true })
  return dir
}
```

`electron/main/storage/sha256.ts`

```ts
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'

/** 流式算哈希：一本 100MB 的书不该被整个读进内存只为了比对去重。 */
export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject)
  })
}
```

- [ ] **Step 4: 写书库仓储**

`electron/main/library/repo.ts`

```ts
import type Database from 'better-sqlite3'
import type { BookSummary, ChapterRowView, ImportOutcome } from '@shared/types'
import { toIndexText, toMatchQuery } from '../epub/bigram'
import type { ChapterRow, ChunkDraft } from '../epub/types'

export type BookInsert = {
  id: string
  title: string
  author: string | null
  publisher: string | null
  language: string | null
  isbn: string | null
  coverPath: string | null
  filePath: string
  fileHash: string
  fileSize: number
  totalChars: number
  chapterCount: number
  addedAt: number
}

export type ChapterInsert = { row: ChapterRow; chunks: ChunkDraft[]; headingPath: string }

export type SearchHit = {
  chunkId: number
  chapterId: number | null
  headingPath: string
  text: string
  score: number
}

export function findByHash(db: Database.Database, hash: string): { id: string; title: string } | null {
  const row = db.prepare('SELECT id, title FROM books WHERE file_hash = ?').get(hash) as
    | { id: string; title: string }
    | undefined
  return row ?? null
}

export function listBooks(db: Database.Database): BookSummary[] {
  return db
    .prepare(
      `SELECT id, title, author, cover_path AS coverPath, status,
              chapter_count AS chapterCount, total_chars AS totalChars,
              added_at AS addedAt, last_opened_at AS lastOpenedAt
       FROM books
       ORDER BY COALESCE(last_opened_at, added_at) DESC`
    )
    .all() as BookSummary[]
}

export function listChapters(db: Database.Database, bookId: string): ChapterRowView[] {
  return db
    .prepare(
      `SELECT id, parent_id AS parentId, order_index AS orderIndex, title, href, depth,
              char_start AS charStart, char_end AS charEnd
       FROM chapters WHERE book_id = ?
       ORDER BY id`
    )
    .all(bookId) as ChapterRowView[]
}

export function searchChunks(
  db: Database.Database,
  bookId: string,
  query: string,
  limit = 12
): SearchHit[] {
  const match = toMatchQuery(query)
  if (!match) return []
  return db
    .prepare(
      `SELECT c.id AS chunkId, c.chapter_id AS chapterId, c.heading_path AS headingPath,
              c.text AS text, f.score AS score
       FROM (SELECT rowid AS rid, bm25(chunks_fts) AS score FROM chunks_fts WHERE chunks_fts MATCH ?) f
       JOIN chunks c ON c.id = f.rid
       WHERE c.book_id = ?
       ORDER BY f.score
       LIMIT ?`
    )
    .all(match, bookId, limit) as SearchHit[]
}

/**
 * 全书落库。调用方保证已在事务里。
 * chapters 必须按 buildChapters 的顺序传入：parentIndex 指向的是同数组下标，父行一定先于子行插入。
 */
export function insertBookGraph(
  db: Database.Database,
  book: BookInsert,
  chapters: ChapterInsert[]
): void {
  db.prepare(
    `INSERT INTO books (id, title, author, publisher, language, isbn, cover_path, file_path,
                        file_hash, file_size, added_at, total_chars, chapter_count, status)
     VALUES (@id, @title, @author, @publisher, @language, @isbn, @coverPath, @filePath,
             @fileHash, @fileSize, @addedAt, @totalChars, @chapterCount, 'unread')`
  ).run(book)

  const insertChapter = db.prepare(
    `INSERT INTO chapters (book_id, parent_id, order_index, title, href, depth, char_start, char_end)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const insertChunk = db.prepare(
    `INSERT INTO chunks (book_id, chapter_id, order_index, text, token_count, heading_path)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
  const insertFts = db.prepare('INSERT INTO chunks_fts (rowid, text_bigram) VALUES (?, ?)')

  const idByIndex: number[] = []
  chapters.forEach((chapter, index) => {
    const parentId = chapter.row.parentIndex === null ? null : (idByIndex[chapter.row.parentIndex] ?? null)
    const info = insertChapter.run(
      book.id,
      parentId,
      chapter.row.orderIndex,
      chapter.row.title,
      chapter.row.entry,
      chapter.row.depth,
      chapter.row.charStart,
      chapter.row.charEnd
    )
    idByIndex[index] = Number(info.lastInsertRowid)

    for (const chunk of chapter.chunks) {
      const chunkInfo = insertChunk.run(
        book.id,
        idByIndex[index],
        chunk.orderIndex,
        chunk.text,
        chunk.tokenCount,
        chapter.headingPath
      )
      insertFts.run(Number(chunkInfo.lastInsertRowid), toIndexText(chunk.text))
    }
  })
}

/** 删书：先清 FTS，再按外键顺序删表，最后删目录。调用方保证已在事务里。 */
export function deleteBookRows(db: Database.Database, bookId: string): void {
  db.prepare(
    'DELETE FROM chunks_fts WHERE rowid IN (SELECT id FROM chunks WHERE book_id = ?)'
  ).run(bookId)
  db.prepare('DELETE FROM ai_messages WHERE book_id = ?').run(bookId)
  db.prepare('DELETE FROM ai_results WHERE book_id = ?').run(bookId)
  db.prepare('DELETE FROM highlights WHERE book_id = ?').run(bookId)
  db.prepare('DELETE FROM book_tags WHERE book_id = ?').run(bookId)
  db.prepare('DELETE FROM reading_progress WHERE book_id = ?').run(bookId)
  db.prepare('DELETE FROM chunks WHERE book_id = ?').run(bookId)
  db.prepare('DELETE FROM chapters WHERE book_id = ?').run(bookId)
  db.prepare('DELETE FROM books WHERE id = ?').run(bookId)
}

export function updateBookStatus(
  db: Database.Database,
  bookId: string,
  status: 'unread' | 'reading' | 'finished'
): void {
  db.prepare('UPDATE books SET status = ? WHERE id = ?').run(status, bookId)
}

export function touchOpened(db: Database.Database, bookId: string, at: number): void {
  db.prepare('UPDATE books SET last_opened_at = ? WHERE id = ?').run(at, bookId)
}

// 供类型推断使用，避免 @shared/types 与仓储各自定义一套形状
export type { ImportOutcome }
```

`deleteBookRows` 里 FTS 必须**先删**：`chunks` 一旦删掉，那条 `SELECT id FROM chunks WHERE book_id = ?` 就再也选不出行，FTS 里的残留会永远留着，后续检索会命中已被删除的书。

- [ ] **Step 5: Commit**

```bash
git add electron/main/store/migrations.ts electron/main/library/paths.ts electron/main/storage/sha256.ts electron/main/library/repo.ts
git commit -m "feat: 迁移 v2 建全部表，并实现书库仓储与 FTS 检索"
```

---

### Task 10: 导入编排

**Files:**
- Create: `electron/main/library/importer.ts`

- [ ] **Step 1: 写导入编排**

`electron/main/library/importer.ts`

```ts
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { ImportOutcome, ImportProgress } from '@shared/types'
import { appError, toAppError } from '@shared/errors'
import { buildChapters } from '../epub/chapters'
import { buildChunks } from '../epub/chunks'
import { extractInWorker } from '../epub/extract-pool'
import { loadToc, readEpubInfo, totalChars } from '../epub/parse'
import { readEntries } from '../epub/zip'
import { sha256File } from '../storage/sha256'
import { bookDir, ensureLibraryDir } from './paths'
import { findByHash, insertBookGraph, type ChapterInsert } from './repo'

type ProgressFn = (progress: ImportProgress) => void

/**
 * 导入一本 epub。流程：去重 → 解析 → 抽取 → 复制文件 → 单事务落库。
 * 任何一步失败都不留半本书：数据库事务回滚，已复制的目录一并删掉。
 */
export async function importEpub(
  db: Database.Database,
  sourcePath: string,
  onProgress: ProgressFn = () => {}
): Promise<ImportOutcome> {
  if (!existsSync(sourcePath)) {
    throw appError('FILE_MISSING', '找不到这个文件，可能已被移动或删除')
  }

  onProgress({ phase: 'hash', done: 0, total: 1 })
  const fileHash = await sha256File(sourcePath)
  const existing = findByHash(db, fileHash)
  if (existing) {
    return { status: 'duplicate', bookId: existing.id, title: existing.title }
  }

  const info = await readEpubInfo(sourcePath)
  const toc = await loadToc(sourcePath, info)

  onProgress({ phase: 'extract', done: 0, total: info.spineEntries.length })
  const texts = await extractInWorker(sourcePath, info.spineEntries)
  onProgress({ phase: 'extract', done: texts.length, total: info.spineEntries.length })

  const chapterRows = buildChapters(toc, info.spineEntries, texts)
  const textByEntry = new Map(texts.map((item) => [item.entry, item.text]))
  const chapters: ChapterInsert[] = chapterRows.map((row) => ({
    row,
    headingPath: `${info.metadata.title} > ${row.title}`,
    chunks: buildChunks(row.entry ? (textByEntry.get(row.entry) ?? '') : '')
  }))

  const bookId = randomUUID()
  const dir = bookDir(bookId)
  ensureLibraryDir()
  mkdirSync(dir, { recursive: true })

  try {
    const filePath = join(dir, 'book.epub')
    copyFileSync(sourcePath, filePath)

    onProgress({ phase: 'store', done: 0, total: 1 })
    const run = db.transaction(() => {
      insertBookGraph(db, {
        id: bookId,
        title: info.metadata.title,
        author: info.metadata.author,
        publisher: info.metadata.publisher,
        language: info.metadata.language,
        isbn: info.metadata.isbn,
        coverPath: saveCover(sourcePath, info.coverEntry, dir),
        filePath,
        fileHash,
        fileSize: statSync(sourcePath).size,
        totalChars: totalChars(texts),
        chapterCount: chapterRows.filter((row) => row.orderIndex !== null).length,
        addedAt: Date.now()
      }, chapters)
    })
    run()
    onProgress({ phase: 'store', done: 1, total: 1 })

    return { status: 'imported', bookId, title: info.metadata.title }
  } catch (error) {
    rmSync(dir, { recursive: true, force: true })
    throw toAppError(error, '导入失败，已回滚，没有留下未完成的数据')
  }
}

/**
 * 抽封面。封面坏掉、缺失、格式不认识都只是「没有封面」，不该让整本书导不进来。
 * 保留原始扩展名，因为这里只是把字节搬出来，不做转码。
 */
function saveCover(zipPath: string, coverEntry: string | null, dir: string): string | null {
  if (!coverEntry) return null
  try {
    const buffer = readEntriesSync(zipPath, coverEntry)
    if (!buffer || buffer.length === 0) return null
    const ext = extname(coverEntry).toLowerCase() || '.jpg'
    const target = join(dir, `cover${ext}`)
    writeFileSync(target, buffer)
    return target
  } catch {
    return null
  }
}
```

`saveCover` 需要同步读取（因为它在 `db.transaction()` 同步回调里跑，而 `readEntries` 是异步的）。补一个同步读取函数到 `electron/main/epub/zip.ts`：

```ts
/** 同步读单个 entry，供必须同步的场合（事务回调内）使用。 */
export function readEntriesSync(zipPath: string, name: string): Buffer | null {
  const entries = new Map<string, Buffer>()
  const fd = yauzl.open(zipPath, { lazyEntries: true }, () => {})
  void fd
  throw new Error('unused')
}
```

上面这段是**行不通的方向**——yauzl 是回调式 API，没有同步接口。正确做法：把封面读取挪到事务**之前**、与文本抽取同一阶段（那里本来就是异步的）。因此 `importer.ts` 改成：

```ts
  onProgress({ phase: 'extract', done: 0, total: info.spineEntries.length })
  const [texts, cover] = await Promise.all([
    extractInWorker(sourcePath, info.spineEntries),
    readCover(sourcePath, info.coverEntry)
  ])
```

并把 `saveCover` 拆成「异步读字节」与「同步写文件」两步：

```ts
/** 封面读不到就返回 null——封面缺失/损坏不该让整本书导不进来。 */
async function readCover(zipPath: string, coverEntry: string | null): Promise<Buffer | null> {
  if (!coverEntry) return null
  try {
    const files = await readEntries(zipPath, [coverEntry])
    const buffer = files.get(coverEntry)
    return buffer && buffer.length > 0 ? buffer : null
  } catch {
    return null
  }
}

/** 只能在事务里调用，因为它是同步的。 */
function writeCoverSync(cover: Buffer | null, coverEntry: string | null, dir: string): string | null {
  if (!cover) return null
  const ext = coverEntry ? extname(coverEntry).toLowerCase() || '.jpg' : '.jpg'
  const target = join(dir, `cover${ext}`)
  writeFileSync(target, cover)
  return target
}
```

事务里那一行相应改成 `coverPath: writeCoverSync(cover, info.coverEntry, dir)`。同时 `electron/main/epub/zip.ts` 保持只有 `listEntries` / `readEntries` 两个导出，不要加那个假的同步版本。

- [ ] **Step 2: 让主进程能给渲染进程推导入进度**

在 `electron/main/ipc/library.ts`（Task 11 创建）里通过 `event.sender.send` 推送。导入编排这里只负责调用 `onProgress`，不关心怎么送到界面。

- [ ] **Step 3: 类型检查与构建**

Run: `npx tsc --noEmit && npm run build`

Expected: 无类型错误，构建成功。若报 `readEntriesSync` 不存在，说明上一步的修正没改干净——它在本文档里是被明确否决的方向。

- [ ] **Step 4: Commit**

```bash
git add electron/main/library/importer.ts
git commit -m "feat: 导入编排（去重、抽取、封面、事务落库、失败清理）"
```

---

### Task 11: IPC 与 preload 白名单

**Files:**
- Modify: `shared/ipc.ts`, `shared/types.ts`
- Create: `electron/main/ipc/library.ts`
- Modify: `electron/main/ipc/index.ts`, `electron/preload/index.ts`

- [ ] **Step 1: 追加共享类型**

在 `shared/types.ts` 末尾追加：

```ts
export type BookStatus = 'unread' | 'reading' | 'finished'

export type BookSummary = {
  id: string
  title: string
  author: string | null
  coverPath: string | null
  status: BookStatus
  chapterCount: number
  totalChars: number
  addedAt: number
  lastOpenedAt: number | null
}

export type ChapterRowView = {
  id: number
  parentId: number | null
  orderIndex: number | null
  title: string
  href: string
  depth: number
  charStart: number | null
  charEnd: number | null
}

export type ImportOutcome =
  | { status: 'imported'; bookId: string; title: string }
  | { status: 'duplicate'; bookId: string; title: string }

export type ImportProgress = {
  phase: 'hash' | 'extract' | 'store'
  done: number
  total: number
}
```

- [ ] **Step 2: 追加 IPC 通道与白名单**

`shared/ipc.ts` 的 `CH` 追加：

```ts
  libraryPickAndImport: 'library:pickAndImport',
  libraryImportPath: 'library:importPath',
  libraryList: 'library:list',
  libraryChapters: 'library:chapters',
  librarySearch: 'library:search',
  libraryRemove: 'library:remove',
  /** 主 → 渲染 的单向事件，不是 invoke */
  libraryImportProgress: 'library:importProgress'
```

`API_SHAPE` 追加：

```ts
  library: ['pickAndImport', 'importPath', 'list', 'chapters', 'search', 'remove', 'onImportProgress']
```

`API_SHAPE` 是计划 01 里 e2e 断言的契约源：改这里就等于改契约，测试会立刻跟着校验。

- [ ] **Step 3: 写 library handler**

`electron/main/ipc/library.ts`

```ts
import { rmSync } from 'node:fs'
import { basename } from 'node:path'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { CH } from '@shared/ipc'
import type { ImportOutcome, ImportProgress } from '@shared/types'
import { appError, toAppError } from '@shared/errors'
import { importEpub } from '../library/importer'
import { bookDir } from '../library/paths'
import { deleteBookRows, listBooks, listChapters, searchChunks } from '../library/repo'
import { getDatabase } from '../store/db'

export function registerLibraryIpc(): void {
  ipcMain.handle(CH.libraryPickAndImport, async (event) => {
    const picked = await dialog.showOpenDialog({
      title: '选择 epub 文件',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'EPUB', extensions: ['epub'] }]
    })
    if (picked.canceled || picked.filePaths.length === 0) return null

    const outcomes: ImportOutcome[] = []
    for (const filePath of picked.filePaths) {
      outcomes.push(await runImport(filePath, event.sender as Electron.WebContents))
    }
    return outcomes
  })

  ipcMain.handle(CH.libraryImportPath, async (event, filePath: string) => {
    return runImport(filePath, event.sender as Electron.WebContents)
  })

  ipcMain.handle(CH.libraryList, () => listBooks(getDatabase()))

  ipcMain.handle(CH.libraryChapters, (_event, bookId: string) => listChapters(getDatabase(), bookId))

  ipcMain.handle(CH.librarySearch, (_event, bookId: string, query: string, limit?: number) =>
    searchChunks(getDatabase(), bookId, query, limit)
  )

  ipcMain.handle(CH.libraryRemove, (_event, bookId: string) => {
    const db = getDatabase()
    db.transaction(() => deleteBookRows(db, bookId))()
    rmSync(bookDir(bookId), { recursive: true, force: true })
  })
}

async function runImport(filePath: string, sender: Electron.WebContents): Promise<ImportOutcome> {
  if (!filePath.toLowerCase().endsWith('.epub')) {
    throw appError('EPUB_PARSE_FAILED', `${basename(filePath)} 不是 epub 文件`)
  }
  try {
    return await importEpub(getDatabase(), filePath, (progress: ImportProgress) => {
      if (!sender.isDestroyed()) sender.send(CH.libraryImportProgress, progress)
    })
  } catch (error) {
    throw toAppError(error, '导入失败')
  }
}
```

`runImport` 里先挡一次扩展名：拖拽/传入路径这条入口不该被用来读任意文件，虽然主进程随后也只是把它当 zip 解，但挡在门口更清楚。

- [ ] **Step 4: 注册 handler**

`electron/main/ipc/index.ts` 里加一行：

```ts
import { registerLibraryIpc } from './library'

export function registerIpc(): void {
  registerSettingsIpc()
  registerSecretsIpc()
  registerLibraryIpc()
}
```

- [ ] **Step 5: 补 preload 白名单**

`electron/preload/index.ts` 的 `api` 增加：

```ts
  library: {
    pickAndImport: (): Promise<ImportOutcome[] | null> =>
      ipcRenderer.invoke(CH.libraryPickAndImport),
    importPath: (filePath: string): Promise<ImportOutcome> =>
      ipcRenderer.invoke(CH.libraryImportPath, filePath),
    list: (): Promise<BookSummary[]> => ipcRenderer.invoke(CH.libraryList),
    chapters: (bookId: string): Promise<ChapterRowView[]> =>
      ipcRenderer.invoke(CH.libraryChapters, bookId),
    search: (bookId: string, query: string, limit?: number): Promise<SearchHit[]> =>
      ipcRenderer.invoke(CH.librarySearch, bookId, query, limit),
    remove: (bookId: string): Promise<void> => ipcRenderer.invoke(CH.libraryRemove, bookId),
    /** 返回取消订阅函数，供 React 的 useEffect 清理 */
    onImportProgress: (listener: (progress: ImportProgress) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: ImportProgress): void =>
        listener(progress)
      ipcRenderer.on(CH.libraryImportProgress, handler)
      return () => ipcRenderer.removeListener(CH.libraryImportProgress, handler)
    }
  }
```

`SearchHit` 类型定义在 `electron/main/library/repo.ts`（主进程）里，渲染进程不该从主进程文件里 import 类型。把 `SearchHit` 挪到 `shared/types.ts`：

```ts
export type SearchHit = {
  chunkId: number
  chapterId: number | null
  headingPath: string
  text: string
  score: number
}
```

`repo.ts` 里改成 `import type { SearchHit } from '@shared/types'` 并删掉本地定义。preload 与渲染进程都从 `@shared/types` 取。

- [ ] **Step 6: 跑边界测试，确认契约没破**

Run: `npm run e2e -- e2e/boundary.spec.ts`

Expected: PASS，1 passed。测的是 `API_SHAPE` 与实际暴露的方法名完全一致——若 preload 少写一个方法或多写一个，这里会红。

- [ ] **Step 7: Commit**

```bash
git add shared electron/main/ipc electron/preload/index.ts
git commit -m "feat: 书库 IPC 与 preload 白名单（导入、列表、目录、检索、删除、进度推送）"
```

---

### Task 12: 最小可用书架与导入 e2e

**Files:**
- Create: `src/features/library/ImportButton.tsx`, `src/features/library/BookList.tsx`
- Modify: `src/pages/LibraryPage.tsx`, `src/styles/base.css`
- Create: `e2e/import.spec.ts`

- [ ] **Step 1: 写导入按钮**

`src/features/library/ImportButton.tsx`

```tsx
import { useState } from 'react'
import type { ImportProgress } from '@shared/types'

const PHASE_LABEL: Record<ImportProgress['phase'], string> = {
  hash: '校验文件',
  extract: '解析正文',
  store: '写入书库'
}

export function ImportButton({ onImported }: { onImported: () => void }) {
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function start(): Promise<void> {
    setError(null)
    const unsubscribe = window.api.library.onImportProgress(setProgress)
    try {
      const outcomes = await window.api.library.pickAndImport()
      if (outcomes && outcomes.length > 0) {
        const duplicated = outcomes.filter((item) => item.status === 'duplicate')
        if (duplicated.length > 0) {
          setError(`《${duplicated[0]!.title}》已在书库中，未重复导入`)
        }
        onImported()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '导入失败')
    } finally {
      unsubscribe()
      setProgress(null)
    }
  }

  return (
    <div className="import">
      <button type="button" className="btn btn--primary" onClick={() => void start()}>
        导入 EPUB
      </button>
      {progress && (
        <span className="import__progress">
          {PHASE_LABEL[progress.phase]}
          {progress.total > 1 ? ` ${progress.done}/${progress.total}` : '…'}
        </span>
      )}
      {error && <span className="import__error">{error}</span>}
    </div>
  )
}
```

- [ ] **Step 2: 写列表**

`src/features/library/BookList.tsx`

```tsx
import type { BookSummary } from '@shared/types'

export function BookList({ books, onRemove }: { books: BookSummary[]; onRemove: (id: string) => void }) {
  if (books.length === 0) {
    return <p className="library__empty">书架还是空的。导入的 epub 只保存在这台电脑上，不会上传。</p>
  }

  return (
    <ul className="book-list">
      {books.map((book) => (
        <li key={book.id} className="book-list__item">
          <div className="book-list__main">
            <span className="book-list__title">{book.title}</span>
            <span className="book-list__meta">
              {book.author ?? '未知作者'} · {book.chapterCount} 章 ·{' '}
              {Math.round(book.totalChars / 1000)}k 字
            </span>
          </div>
          <button
            type="button"
            className="book-list__remove"
            onClick={() => {
              // 笔记与高亮会一起删除，这里必须说清楚
              if (window.confirm(`删除《${book.title}》？笔记与高亮会一起删除，不可恢复。`)) {
                onRemove(book.id)
              }
            }}
          >
            删除
          </button>
        </li>
      ))}
    </ul>
  )
}
```

封面不在这里显示：显示封面需要 `epub://` 协议或文件路径转换，那是计划 03 的基础设施。本计划只求「能导入、能看到列表、能删干净」。

- [ ] **Step 3: 组装页面**

`src/pages/LibraryPage.tsx`

```tsx
import { useCallback, useEffect, useState } from 'react'
import type { BookSummary } from '@shared/types'
import { BookList } from '../features/library/BookList'
import { ImportButton } from '../features/library/ImportButton'

export function LibraryPage() {
  const [books, setBooks] = useState<BookSummary[] | null>(null)

  const refresh = useCallback(async () => {
    setBooks(await window.api.library.list())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (!books) return <div className="page-placeholder">加载中…</div>

  return (
    <div className="library">
      <div className="library__head">
        <h1 className="library__title">书架</h1>
        <ImportButton onImported={() => void refresh()} />
      </div>
      <BookList
        books={books}
        onRemove={(id) => {
          void window.api.library.remove(id).then(refresh)
        }}
      />
    </div>
  )
}
```

样式追加到 `src/styles/base.css`：

```css
.library {
  padding: var(--s6);
  max-width: 900px;
}

.library__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s4);
  margin-bottom: var(--s5);
}

.library__title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}

.library__empty {
  color: var(--ink-muted);
  font-size: 13px;
}

.import {
  display: flex;
  align-items: center;
  gap: var(--s3);
}

.import__progress {
  font-size: 12px;
  color: var(--ink-muted);
  font-variant-numeric: tabular-nums;
}

.import__error {
  font-size: 12px;
  color: var(--accent-mark);
}

.btn--primary {
  background: var(--ink);
  color: var(--paper);
  border-color: var(--ink);
}

.btn--primary:hover:not(:disabled) {
  opacity: 0.9;
}

.book-list {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  background: var(--panel);
  overflow: hidden;
}

.book-list__item {
  display: flex;
  align-items: center;
  gap: var(--s3);
  padding: var(--s4) var(--s5);
  border-bottom: 1px solid var(--line);
}

.book-list__item:last-child {
  border-bottom: 0;
}

.book-list__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.book-list__title {
  font-size: 14px;
}

.book-list__meta {
  font-size: 12px;
  color: var(--ink-muted);
}

.book-list__remove {
  font-size: 12px;
  color: var(--ink-muted);
  opacity: 0;
  transition: opacity var(--ease), color var(--ease);
}

.book-list__item:hover .book-list__remove {
  opacity: 1;
}

.book-list__remove:hover {
  color: var(--accent-mark);
}
```

- [ ] **Step 4: 写导入的端到端测试**

`e2e/import.spec.ts`

```ts
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { missingOpfFiles, nestedTocFiles, novelFiles, writeEpub } from '../fixtures/make-epub'
import { launchAppWithUserData } from './helpers'

test('导入中文小说：落库正确、可检索、重复导入被去重、删书清干净', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-import-'))
  const epubPath = join(userDataDir, 'novel.epub')
  await writeEpub(epubPath, novelFiles())

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()

  const first = await win.evaluate((file) => (window as any).api.library.importPath(file), epubPath)
  expect(first.status).toBe('imported')
  expect(first.title).toBe('河边的月亮')
  const bookId = first.bookId as string

  const books = await win.evaluate(() => (window as any).api.library.list())
  expect(books).toHaveLength(1)
  expect(books[0].chapterCount).toBe(2)
  expect(books[0].totalChars).toBeGreaterThan(30)
  expect(books[0].coverPath).toContain('cover.jpg')

  const chapters = await win.evaluate((id) => (window as any).api.library.chapters(id), bookId)
  expect(chapters.map((c: { title: string }) => c.title)).toEqual(['第一章 河边', '第二章 夏夜'])
  expect(chapters[0].charStart).toBe(0)

  const hits = await win.evaluate(
    (id) => (window as any).api.library.search(id, '量子纠缠', 5),
    bookId
  )
  expect(hits.length).toBeGreaterThan(0)
  expect(hits[0].text).toContain('量子纠缠')

  const again = await win.evaluate((file) => (window as any).api.library.importPath(file), epubPath)
  expect(again.status).toBe('duplicate')
  expect(await win.evaluate(() => (window as any).api.library.list())).toHaveLength(1)

  await win.evaluate((id) => (window as any).api.library.remove(id), bookId)
  expect(await win.evaluate(() => (window as any).api.library.list())).toHaveLength(0)
  expect(
    await win.evaluate((id) => (window as any).api.library.search(id, '量子纠缠', 5), bookId)
  ).toEqual([])

  await app.close()
  expect(readdirSync(join(userDataDir, 'library'))).toEqual([])
})

test('导入多级目录的技术书：层级与兜底章节都对', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-import-nested-'))
  const epubPath = join(userDataDir, 'nested.epub')
  await writeEpub(epubPath, nestedTocFiles())

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()
  const result = await win.evaluate((file) => (window as any).api.library.importPath(file), epubPath)
  expect(result.status).toBe('imported')

  const chapters = await win.evaluate(
    (id) => (window as any).api.library.chapters(id),
    result.bookId
  )
  expect(chapters.map((c: { title: string; depth: number }) => [c.title, c.depth])).toEqual([
    ['第一篇 坐标', 0],
    ['第 1 节 笛卡尔', 1],
    ['第 1 目 极坐标', 2],
    ['附录 术语表', 0]
  ])
  expect(chapters[3].parentId).toBeNull()
  await app.close()
})

test('导入畸形 epub：报可读错误且不留脏数据', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-import-broken-'))
  const epubPath = join(userDataDir, 'broken.epub')
  await writeEpub(epubPath, missingOpfFiles())

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()

  const error = await win.evaluate(async (file) => {
    try {
      await (window as any).api.library.importPath(file)
      return null
    } catch (e) {
      return { message: String(e), code: (e as { code?: string }).code }
    }
  }, epubPath)
  expect(error).not.toBeNull()
  expect(error?.message).toContain('epub')
  expect(error?.message).not.toMatch(/[A-Za-z]{6,}\s[A-Za-z]{4,}/)  // 不是英文栈

  expect(await win.evaluate(() => (window as any).api.library.list())).toHaveLength(0)
  expect(readdirSync(join(userDataDir, 'library'))).toEqual([])

  await app.close()
})

test('非 epub 文件被挡在门口', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-import-txt-'))
  const txtPath = join(userDataDir, 'note.txt')
  writeFileSync(txtPath, '这不是一本书')

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()
  await expect(
    win.evaluate((file) => (window as any).api.library.importPath(file), txtPath)
  ).rejects.toThrow(/不是 epub 文件/)
  await app.close()
})
```

- [ ] **Step 5: 跑 e2e，确认通过**

Run: `npm run e2e`

Expected: PASS。总数应为 boundary 1 + settings 2 + secrets 2 + import 4 = 9 passed。

若导入那条失败在「chapters 标题顺序」，先查 `buildChapters` 的目录遍历顺序（应当是先序）。

- [ ] **Step 6: 目视验证**

Run: `npm run dev` → 书架 → 导入 EPUB → 选一本真实的中文 epub

Expected: 列表出现书名、作者、章数、字数；点删除有二次确认；确认后列表为空。DevTools 控制台无报错。

- [ ] **Step 7: Commit**

```bash
git add src e2e/import.spec.ts
git commit -m "feat: 最小可用书架的导入与列表，含导入全链路 e2e"
```

---

## Self-Review

**1. Spec coverage**

| Spec 条目 | 本计划覆盖 |
|---|---|
| §3.1 渲染走原始 XHTML、AI 走抽取纯文本（两条路径分离） | Task 4 只产出纯文本，不改动 zip 内文件；渲染留给计划 03 |
| §3.2 步骤 1 计算 sha256 去重 | Task 9 `sha256File`、Task 10 去重分支、Task 12 重复导入 e2e |
| §3.2 步骤 2 校验 zip 且含 OPF、解析元数据与封面 | Task 2 `zip.ts`、Task 3 `opf.ts`、Task 8 `readEpubInfo` |
| §3.2 步骤 3 复制到 `library/<bookId>/book.epub`、抽封面到本地 | Task 10（`cover.<ext>` 保留原始扩展名，cover_path 入库） |
| §3.2 步骤 4 按 spine 抽纯文本、写 chapters（含嵌套目录与 char 区间） | Task 6 `buildChapters`、Task 8 抽取、Task 9 落库 |
| §3.2 步骤 5 划分 chunk（400–600 token、段间重叠 1 段） | Task 6 `buildChunks` |
| §3.2 步骤 6 建立 FTS bigram 索引 | Task 7 `bigram.ts`、Task 9 `chunks_fts` 写入 |
| §3.2 步骤 7 全程事务、失败回滚并删除已复制目录 | Task 10 `db.transaction` + `rmSync`，Task 12 e2e 断言目录为空 |
| §3.3 不预解压（保留原始 zip） | Task 10 只复制不展开；按需解压留给计划 03 的 `epub://` |
| §2.2 全部 10 张表 | Task 9 迁移 v2 |
| §5.2 中文 bigram（不引第三方分词库） | Task 7 |
| §6.1 纯函数单测 / 集成测试分层 | Task 2–8 走 vitest；Task 9–12 走 Playwright for Electron |
| §6.1 三本测试 epub（正常 / 多级目录 / 畸形） | `fixtures/make-epub.ts`；畸形书的两类缺陷（缺 OPF、封面缺失）分别由 Task 8 单测与 Task 12 e2e 覆盖 |
| §6.2 错误模型（EPUB_PARSE_FAILED / FILE_MISSING，中文可读，带 action） | Task 2 `zip.ts`、Task 3 `opf.ts`、Task 10、Task 11 |
| §6.3 删书级联清除并二次确认 | Task 9 `deleteBookRows`、Task 12 `BookList` 的 confirm |
| §6.4 自定义协议防 `..` 穿越 | 本计划的 `entry-path.ts` 已做归一（`..` 被吃掉），协议层的前缀校验在计划 03 |
| §6.6 导入解析不阻塞 UI（worker） | Task 8 worker + Task 10 |
| §4.5 书架网格/列表/封面/拖放 | **不在本计划**，属计划 06；本计划只交付最小列表 |
| §3.5 AI 引用回跳 | 属计划 03 与 05 |

**2. Placeholder scan**

已检查：无 TBD / TODO / 「稍后补充」。两处刻意的「本计划不做」都已写明归属计划（封面显示 → 03，网格与拖放 → 06）。Task 10 Step 1 里保留了「错误方向 → 正确方向」的完整说明而**不是**留下未实现的占位函数，执行时应直接写正确版本。

**3. 类型与命名一致性**

- `SpineText` / `TocNode` / `ChapterRow` / `ChunkDraft` 全部定义在 `electron/main/epub/types.ts`，被 `chapters.ts`、`chunks.ts`、`parse.ts`、`extract-book.ts`、`repo.ts`、`importer.ts` 共用，没有第二处定义。
- `BookSummary` / `ChapterRowView` / `ImportOutcome` / `ImportProgress` / `SearchHit` 定义在 `shared/types.ts`，主进程与渲染进程都从这里取；`repo.ts` 不再保留本地 `SearchHit`。
- IPC 通道名 `CH.libraryXxx` 与 `API_SHAPE.library` 的七个方法逐一对齐：`pickAndImport` / `importPath` / `list` / `chapters` / `search` / `remove` / `onImportProgress`。
- `readEntries` 在 `zip.ts` 定义，被 `parse.ts`、`extract-book.ts`、`importer.ts`（读封面）使用，签名一致。
- `extractInWorker`（`extract-pool.ts`）与 `extractBookTexts`（`extract-book.ts`）返回值同为 `SpineText[]`，worker 的 `Reply` 联合类型在两侧定义一致。
- `insertBookGraph` 的 `BookInsert` 字段与迁移 v2 的 `books` 列一一对应。

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-09-29-02-epub-import-pipeline.md`. Two execution options:**

**1. Subagent-Driven（推荐）** —— 每个任务派一个全新 subagent，任务之间我来审查，迭代快、上下文干净

**2. Inline Execution** —— 在当前会话里按 executing-plans 批量执行，带检查点

选哪个？