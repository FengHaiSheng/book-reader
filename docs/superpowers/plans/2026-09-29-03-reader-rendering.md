# 阅读器渲染 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让应用能真正读书：按需解压章节、把书内排版原样渲染进隔离的 iframe、用 CSS 多栏分页、以 CFI 记录与恢复阅读位置、目录与排版面板可用、窗口自适应（对开双页 / 窄侧栏 / 降级明说）。

**Architecture:** 章节文档走「同源无脚本文档」路线——从 `epub://` 协议取原始 XHTML，在渲染进程用 DOMParser 摘掉脚本类节点、注入 `<base>`（把书内相对路径指到 `epub://`）、注入 `<meta http-equiv="Content-Security-Policy">` 与主题样式，再用 Blob URL 喂给 iframe。同源换来三件事：父文档能注入样式、能算 Range↔CFI、能读选区；无脚本 + CSP 保住 `src/none` 的安全底线。分页不靠 JS 逐字测量，而是 `column-width` + 固定页高交给 CSS 多栏，父文档只做「测量内容总宽 → 换算页数 → 设 scrollLeft」。

**Tech Stack:** Electron / React / TypeScript / yauzl（沿用计划 02）/ foliate-js 的 `epubcfi.js`（仅取 CFI 纯函数）/ vitest / Playwright

**Spec:** [2026-09-29-book-reader-design.md](../specs/2026-09-29-book-reader-design.md)（§3.3 自定义协议、§3.4 渲染、§4.2 桌面端结构语言、§4.3 自适应、§4.4 排版可调、§6.4 安全清单、§8 开放问题 1 与 3）

**前置计划：** [01 应用骨架与本地数据层](./2026-09-29-01-app-shell-and-data-layer.md) · [02 epub 导入管线](./2026-09-29-02-epub-import-pipeline.md)

---

## Prerequisites

1. **计划 01 与 02 必须已经完成**：`npm test`、`npm run e2e` 全绿，能导入 epub 并在书架看到条目。本计划改的 `shared/ipc.ts`、`shared/types.ts`、`electron/preload/index.ts`、`src/index.html`、`electron/main/index.ts`、`fixtures/make-epub.ts` 都建立在它们之上。
2. **git 身份已配置**（计划 01 的 Prerequisites）。本计划每个 Task 结尾都要 commit。
3. 执行到 Task 6 之后需要**目视确认分页**，请在能看见窗口的环境执行（`npm run dev`）。

---

## 计划拆分说明

本文件是 6 份计划中的第 3 份：

| 计划 | 内容 | 交付物 |
|---|---|---|
| 01 | 应用骨架、SQLite、迁移、密钥、设置页 | 能启动、能存设置和密钥的应用 |
| 02 | epub 导入管线 | 能导入 epub 并落库（books/chapters/chunks + FTS bigram） |
| **03（本文）** | 阅读器渲染 | 能读书：自定义协议、iframe、分页、CFI、进度 |
| 04 | 标注与笔记 | 能划词、写笔记、跨书汇总、导出 Markdown |
| 05 | AI 能力层 | 能问 AI：Provider、降级、检索、任务、引用回跳 |
| 06 | 书架完善与打包 | 能装给别人用：网格/列表、标签、导出数据、签名打包 |

依赖关系：04 依赖本文的 CFI 与选区管道；05 依赖本文的「章节 DOM + CFI」才能做引用回跳。因此本文的两个产物——`paginator.ts` 的 CFI 换算与 `document.ts` 的同源章节文档——是全项目的定位基础，改动前先看 04、05 有没有在用。

---

## 决策记录：渲染引擎选型（spec §8 开放问题 1、3）

spec §3.4 写的是「渲染库**倾向** foliate-js」，并把它列为进实现前要解决的第 1 个开放问题。本文档在这里把它定下来。

**结论：不用 foliate-js 的整库渲染（`view.js` / `paginator.js`），只取它的 `epubcfi.js` 这个纯函数模块；iframe 宿主、分页、定位、进度全部自研。**

三条可以自己核对理由：

1. **安全：走 foliate-js 就拿不到 `script-src 'none'`。** foliate-js 的 README「Security」一节原文说明：它把章节内容用 **blob: 同源 URL** 喂给 iframe，因此「不可能安全地隔离脚本内容」，并且「因 WebKit Bug 218086，iframe 必须带 `allow-scripts`，sandbox 形同虚设」。而 spec §6.4 的硬要求是章节文档 `script-src 'none'`，书是外来文件，执行它等于允许任意代码在渲染进程里跑。我们的做法是构造一个**无脚本的同源文档**，并用三道锁固定它：主进程剥离 `script` 节点、文档内 `<meta http-equiv>` 声明 CSP、`epub://` 响应头也带 CSP。三道锁都建立在「文档由我们自己生成、不经过第三方装载器」这个前提上。
2. **与既有数据层的对齐成本。** 我们需要 `chapters` 表（`href` / `order_index` / char 区间）与 zip entry 双向对应、`epub://` 按需解压单个 entry（spec §3.3）、以及计划 05 的引用回跳要在章内 DOM 里匹配 chunk 前 30 个字符。foliate-js 自带一套 zip.js + book 接口（README「Archived Files」一节），接进去要么放弃 §3.3 的自定义协议，要么写一层 loader 把 yauzl 伪装成它的接口——复杂度只是换了个位置。
3. **API 稳定性。** README 原文：「this library itself is, however, not stable. Expect it to break and the API to change at any time. Use at your own risk.」把整本书的渲染押在一个自述不稳定的库上，升级一次就可能全线返工。

**保留它的 CFI 实现。** `foliate-js@1.0.1` 的 `epubcfi.js` 是零依赖、纯函数、MIT 的 ESM 模块（仓库内仅此一个文件），正好覆盖 spec §6.1 点名单测的「CFI 计算」。本文只用它五个导出：`parse` / `fromRange` / `toRange` / `joinIndir` / `fake`。不引入 `view.js`，也就不会带进 zip.js 那一套。

**与 spec §3.4「iframe 与 React 用 postMessage 通信」的一处字面偏差（明说）。** 那条要求成立的前提是 iframe 里跑着一段脚本。本文把 `script-src 'none'` 定为硬约束，iframe 内**不允许有任何脚本**，postMessage 这条路物理上不存在。因此改用同源 DOM 事件：父文档直接监听 iframe 的 `selectionchange` / `click` / 滚动。隔离性没有下降——父文档本来就能访问这个同源 iframe 的 DOM，postMessage 只是多一层序列化。这是本计划唯一与 spec 字面不一致的地方，其余全部按 spec 执行。

**spec §8 开放问题 3（每行字数与分页的相互作用）的解法：** 改字号、改每行字数、改窗口尺寸，都不试图「保持页码」，而是记住当前页左上角的 CFI，重排后用 CFI 重新定位（Task 6 的 `reanchor`）。CFI 是结构化的 DOM 路径，与分行无关，所以重排后依然指向同一句话。

---

## File Structure

本计划新增的文件：

```
shared/
  csp.ts                          # 章节文档的 CSP，协议响应头与文档 meta 共用同一份字符串
electron/main/epub/
  epub-url.ts                     # epub:// 的解析与校验（纯函数，可单测）
  protocol.ts                     # 注册 scheme 权限 + protocol.handle 按需解压单 entry
electron/main/reader/
  repo.ts                         # reading_progress 读写 + 打开一本书所需的查询
electron/main/ipc/
  reader.ts                       # reader:open / reader:saveProgress
src/
  foliate-js.d.ts                 # epubcfi.js 的类型声明
  features/reader/
    document.ts                   # 章节原始 XHTML → 无脚本、带 base/CSP/主题的同源文档
    layout.ts                     # 排版计算：版心宽、对开、页高、翻页步长、降级判定（纯函数）
    theme.ts                      # 按偏好生成注入用的 CSS（纯函数）
    paginator.ts                  # 测量、翻页、CFI ↔ 页码、重排后重锚
    TocPanel.tsx                  # 本书目录（阅读器左栏）
    TypographyPanel.tsx           # Aa 排版面板
    ReaderPage.tsx                # 阅读器整页：宿主、状态机、键盘、链接拦截、进度落库
tests/
  epub-url.test.ts
  prefs.test.ts
  reader-layout.test.ts
e2e/
  protocol.spec.ts                # epub:// 只服务本书目录里的静态资源
  reader.spec.ts                  # 打开书、翻页、书内脚本不执行、进度重启后仍在
```

需要修改的既有文件：

```
shared/types.ts                   # 追加 PREFS_LIMITS / clampPrefs / ReaderBook 等
shared/ipc.ts                     # 追加 reader 通道与 settings 偏好的两条通道
electron/main/index.ts            # ready 前注册 scheme，ready 后挂协议 handler
electron/main/store/settings.ts   # 追加 writePrefs；readPrefs 改用 clampPrefs
electron/main/ipc/settings.ts     # 追加偏好读写 handler
electron/main/ipc/index.ts        # 注册 reader handler
electron/preload/index.ts         # 追加 reader 与偏好的白名单
electron/main/library/repo.ts     # （不改）——阅读进度不复用它，单独放 reader/repo.ts
src/index.html                    # CSP 放开 epub: 与 blob: 框架
src/App.tsx                       # 阅读器作为沉浸式全屏视图
src/pages/LibraryPage.tsx         # 接「打开」回调
src/features/library/BookList.tsx # 每本书加「打开」
src/styles/base.css               # 阅读器样式
fixtures/make-epub.ts             # 追加带脚本与图片的测试书
package.json                      # 追加 foliate-js
```

---

### Task 1: `epub://` 协议与渲染边界的第一道锁

自定义协议是本计划的地基：章节文档、图片、字体、书内 CSS 全部从它来。这个 Task 同时把「哪些 entry 允许被服务」钉成可测试的规则。

**Files:**
- Create: `shared/csp.ts`
- Create: `electron/main/epub/epub-url.ts`
- Create: `electron/main/epub/protocol.ts`
- Create: `tests/epub-url.test.ts`, `e2e/protocol.spec.ts`
- Modify: `electron/main/index.ts`, `src/index.html`, `fixtures/make-epub.ts`

- [ ] **Step 1: 写章节文档的 CSP 常量**

新建 `shared/csp.ts`：

```ts
/**
 * 章节文档的内容安全策略。
 *
 * 书是外来文件——执行它等于允许任意代码在渲染进程里跑，所以这一层必须最严：
 * 只留样式与静态资源，脚本、表单、网络连接、嵌套框架一律关死。
 *
 * 两处在用，必须是同一份字符串：
 * - `epub://` 返回 xhtml 时的响应头（挡住「万一被直接导航过去」）；
 * - 注入章节文档 head 的 <meta http-equiv="Content-Security-Policy">。
 */
export const CHAPTER_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "style-src 'unsafe-inline' epub:",
  "img-src epub: data: blob:",
  "font-src epub: data:",
  "media-src epub: blob:",
  "frame-src 'none'",
  "object-src 'none'",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri epub:"
].join('; ')
```

`base-uri epub:` 是必须的，否则我们注入的 `<base href="epub://...">` 会被自己拒掉，书内所有相对路径一起失效。

- [ ] **Step 2: 写 URL 解析的失败测试**

新建 `tests/epub-url.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { isBookId, mimeFor, normalizeEntry, parseEpubUrl } from '../electron/main/epub/epub-url'

const ID = '7c1f0e4a-9b2d-4f6e-8a31-5d0c2b7e9f10'

describe('parseEpubUrl', () => {
  it('解析出 bookId 与 entry', () => {
    expect(parseEpubUrl(`epub://${ID}/OEBPS/text/ch1.xhtml`)).toEqual({
      bookId: ID,
      entry: 'OEBPS/text/ch1.xhtml'
    })
  })

  it('百分号转义会被解码', () => {
    expect(parseEpubUrl(`epub://${ID}/OEBPS/%E7%AC%AC1%E7%AB%A0.xhtml`)?.entry).toBe(
      'OEBPS/第1章.xhtml'
    )
  })

  it('bookId 不是 uuid 就拒绝', () => {
    expect(parseEpubUrl(`epub://not-a-uuid/OEBPS/ch1.xhtml`)).toBeNull()
    expect(parseEpubUrl('epub:///OEBPS/ch1.xhtml')).toBeNull()
  })

  it('不是 epub 协议就拒绝', () => {
    expect(parseEpubUrl(`https://${ID}/OEBPS/ch1.xhtml`)).toBeNull()
    expect(parseEpubUrl('not a url')).toBeNull()
  })

  it('空路径与坏转义都拒绝', () => {
    expect(parseEpubUrl(`epub://${ID}/`)).toBeNull()
    expect(parseEpubUrl(`epub://${ID}/OEBPS/%zz.xhtml`)).toBeNull()
  })
})

describe('normalizeEntry', () => {
  it('吃掉多余的 / 与 .', () => {
    expect(normalizeEntry('OEBPS/./text//ch1.xhtml')).toBe('OEBPS/text/ch1.xhtml')
  })

  it('拒绝穿越、绝对路径、反斜杠与 NUL', () => {
    expect(normalizeEntry('OEBPS/../../etc/passwd')).toBeNull()
    expect(normalizeEntry('/etc/passwd')).toBeNull()
    expect(normalizeEntry('OEBPS\\ch1.xhtml')).toBeNull()
    expect(normalizeEntry('OEBPS/ch1\0.xhtml')).toBeNull()
    expect(normalizeEntry('')).toBeNull()
    expect(normalizeEntry('./')).toBeNull()
  })
})

describe('mimeFor', () => {
  it('认识阅读需要的类型', () => {
    expect(mimeFor('OEBPS/ch1.xhtml')).toBe('application/xhtml+xml')
    expect(mimeFor('OEBPS/style.css')).toBe('text/css')
    expect(mimeFor('OEBPS/img/FIG1.PNG')).toBe('image/png')
    expect(mimeFor('OEBPS/fonts/x.woff2')).toBe('font/woff2')
  })

  it('认不出的一律返回 null —— 书内 js 就是靠这条挡住的', () => {
    expect(mimeFor('OEBPS/evil.js')).toBeNull()
    expect(mimeFor('OEBPS/content.opf')).toBeNull()
    expect(mimeFor('OEBPS/toc.ncx')).toBeNull()
    expect(mimeFor('OEBPS/noext')).toBeNull()
  })
})

describe('isBookId', () => {
  it('只认导入时生成的 uuid', () => {
    expect(isBookId(ID)).toBe(true)
    expect(isBookId(ID.toUpperCase())).toBe(false)
    expect(isBookId('7c1f0e4a9b2d4f6e8a315d0c2b7e9f10')).toBe(false)
  })
})
```

- [ ] **Step 3: 跑测试，确认失败**

Run: `npx vitest run tests/epub-url.test.ts`

Expected: FAIL —— 无法解析 `../electron/main/epub/epub-url`。

- [ ] **Step 4: 写 URL 解析实现**

新建 `electron/main/epub/epub-url.ts`：

```ts
/**
 * epub://<bookId>/<entry> 的解析与校验。
 *
 * 纯函数、不依赖 electron，因此能在 vitest 里直接跑——协议层最需要被测试的就是这里的判断。
 */

export const EPUB_SCHEME = 'epub'

/** 导入时用的是 randomUUID()，这里只认这一种形状 */
const BOOK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export type EpubUrl = { bookId: string; entry: string }

export function isBookId(value: string): boolean {
  return BOOK_ID.test(value)
}

/**
 * 解析一个 epub:// 请求。
 *
 * 安全上真正的保证是**结构性的**：文件路径只由 bookId 决定
 * （`library/<bookId>/book.epub`），entry 只用来在 zip 里查条目，
 * 从不参与文件系统路径拼接，所以 entry 就算带穿越也出不了这一本书。
 * 下面这些校验是第二道防线，不是唯一那道。
 */
export function parseEpubUrl(url: string): EpubUrl | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${EPUB_SCHEME}:`) return null
  if (!isBookId(parsed.hostname)) return null

  let pathname: string
  try {
    pathname = decodeURIComponent(parsed.pathname)
  } catch {
    // `%zz` 这类坏转义会让 decodeURIComponent 抛错
    return null
  }

  const entry = normalizeEntry(pathname.replace(/^\/+/, ''))
  if (!entry) return null
  return { bookId: parsed.hostname, entry }
}

/**
 * 归一化 zip 内部路径：`.` 与空段丢掉，`..`、反斜杠、NUL、绝对路径一律拒绝。
 *
 * 注意 `..` 是拒绝而不是化解：合法 epub 的 manifest 里不会出现它，
 * 出现了就是有人在试探。URL 解析本身也会先化解 `..`（所以经 URL 走进来的
 * 穿越路径到不了这里），保留这条是为了函数被直接调用时同样安全。
 */
export function normalizeEntry(entry: string): string | null {
  if (!entry || entry.includes('\\') || entry.includes('\0')) return null
  if (entry.startsWith('/')) return null

  const segments: string[] = []
  for (const segment of entry.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') return null
    segments.push(segment)
  }
  return segments.length > 0 ? segments.join('/') : null
}

const MIME: Record<string, string> = {
  '.xhtml': 'application/xhtml+xml',
  '.html': 'application/xhtml+xml',
  '.htm': 'application/xhtml+xml',
  '.css': 'text/css',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4'
}

/**
 * 认得出的类型才服务，认不出的返回 null 由调用方拒绝。
 * 白名单而不是黑名单：书内的 `.js` 因此根本不会被递到渲染进程手里。
 */
export function mimeFor(entry: string): string | null {
  const dot = entry.lastIndexOf('.')
  if (dot < 0) return null
  return MIME[entry.slice(dot).toLowerCase()] ?? null
}
```

- [ ] **Step 5: 跑测试，确认通过**

Run: `npx vitest run tests/epub-url.test.ts`

Expected: PASS，13 passed。

- [ ] **Step 6: 写协议注册与按需解压**

新建 `electron/main/epub/protocol.ts`：

```ts
import { join } from 'node:path'
import { protocol } from 'electron'
import { CHAPTER_CSP } from '@shared/csp'
import { bookDir } from '../library/paths'
import { readEntries } from './zip'
import { EPUB_SCHEME, mimeFor, parseEpubUrl } from './epub-url'

/**
 * 登记 epub:// 的权限。**必须在 app ready 之前调用**，否则拿不到 standard / secure 这些权限。
 *
 * standard 让 `epub://<bookId>/a/b` 能按「主机名 + 路径」解析（否则整串都会当成 host）；
 * supportFetchAPI 让渲染进程能 fetch 它；corsEnabled 让 `Access-Control-Allow-Origin` 生效
 * ——字体与跨源样式表都要求 CORS，缺了这条书里的 @font-face 会静默失败。
 */
export function registerEpubScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: EPUB_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
    }
  ])
}

/**
 * 挂上实际的读取。按需解压单个 entry，不预解压整本书（spec §3.3）。
 */
export function handleEpubProtocol(): void {
  protocol.handle(EPUB_SCHEME, async (request) => {
    const target = parseEpubUrl(request.url)
    if (!target) return new Response(null, { status: 400 })

    const mime = mimeFor(target.entry)
    if (!mime) return new Response(null, { status: 403 })

    try {
      const files = await readEntries(join(bookDir(target.bookId), 'book.epub'), [target.entry])
      const buffer = files.get(target.entry)
      if (!buffer) return new Response(null, { status: 404 })

      const headers: Record<string, string> = {
        'Content-Type': mime,
        'Access-Control-Allow-Origin': '*'
      }
      // 章节文档正常由渲染进程 fetch 回来自己加工；万一被直接导航到这里，响应头里的 CSP 也挡住脚本
      if (mime === 'application/xhtml+xml') headers['Content-Security-Policy'] = CHAPTER_CSP
      return new Response(buffer, { headers })
    } catch {
      // 书不存在、目录被删、zip 损坏：对渲染进程来说都是 404，不需要区分
      return new Response(null, { status: 404 })
    }
  })
}
```

`readEntries` 是计划 02 里已有的导出（`electron/main/epub/zip.ts`），查不到的 entry 不会抛错、只是不在返回的 Map 里，所以 404 分支能正常走到。

- [ ] **Step 7: 接进主进程**

`electron/main/index.ts` 整份替换成：

```ts
import { app, BrowserWindow } from 'electron'
import { handleEpubProtocol, registerEpubScheme } from './epub/protocol'
import { createMainWindow } from './window'

// 协议权限必须在 app ready 之前登记，放在最外层
registerEpubScheme()

// 单实例锁：第二次启动时聚焦已有窗口，而不是开出第二个库
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    handleEpubProtocol()
    createMainWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
```

- [ ] **Step 8: 放开渲染进程的 CSP**

`src/index.html` 整份替换成：

```html
<!DOCTYPE html>
<html lang="zh-CN" data-theme="light">
  <head>
    <meta charset="UTF-8" />
    <!--
      比计划 01 多了三处，都是章节文档要用到的：
      - img-src / style-src / font-src / connect-src 放开 epub:：书里的图片、样式表、字体都从自定义协议来；
      - frame-src blob:：章节文档以 Blob URL 装进 iframe；
      - connect-src 的 ws://localhost:* 只为 dev 的 Vite HMR，生产环境用不到。
      章节文档自己还有更严的 CHAPTER_CSP（script-src 'none'），这里的 'self' 是给它兜底。
    -->
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' epub:; img-src 'self' data: epub:; font-src 'self' data: epub:; media-src 'self' epub:; frame-src 'self' blob:; connect-src 'self' epub: ws://localhost:*"
    />
    <title>书架</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 9: 追加一本带脚本的测试书**

在 `fixtures/make-epub.ts` 末尾追加（复用 `novelFiles()`，只替换第一章并补上脚本与图片）：

```ts
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
```

`novelFiles()` 返回的是普通对象，可以就地改键。第一章的 entry 名与图片目录都沿用它的约定（`OEBPS/ch1.xhtml`、`OEBPS/images/`），因此 `../images/...` 这类相对路径的解析也有了真实样本。

- [ ] **Step 10: 写协议 e2e**

新建 `e2e/protocol.spec.ts`：

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { scriptedFiles, writeEpub } from '../fixtures/make-epub'
import { launchAppWithUserData } from './helpers'

test('epub:// 只服务本书目录里的静态资源', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-protocol-'))
  const epubPath = join(userDataDir, 'scripted.epub')
  await writeEpub(epubPath, scriptedFiles())

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()
  const imported = await win.evaluate(
    (file) => (window as any).api.library.importPath(file),
    epubPath
  )
  const bookId = imported.bookId as string

  const probe = await win.evaluate(async (id) => {
    const get = async (url: string) => {
      try {
        const res = await fetch(url)
        return { status: res.status, type: res.headers.get('content-type') ?? '' }
      } catch (e) {
        return { status: -1, type: String(e) }
      }
    }
    return {
      chapter: await get(`epub://${id}/OEBPS/ch1.xhtml`),
      css: await get(`epub://${id}/OEBPS/style.css`),
      image: await get(`epub://${id}/OEBPS/images/dot.jpg`),
      script: await get(`epub://${id}/OEBPS/evil.js`),
      otherBook: await get(`epub://11111111-2222-3333-4444-555555555555/OEBPS/ch1.xhtml`),
      badHost: await get(`epub://not-a-uuid/OEBPS/ch1.xhtml`),
      missing: await get(`epub://${id}/OEBPS/nope.xhtml`)
    }
  }, bookId)

  expect(probe.chapter.status).toBe(200)
  expect(probe.chapter.type).toContain('xhtml')
  expect(probe.css.status).toBe(200)
  expect(probe.image.status).toBe(200)
  // 书内脚本永远拿不到
  expect(probe.script.status).toBe(403)
  // 换一个合法 uuid 也读不到这本书 —— 路径只由 bookId 决定
  expect(probe.otherBook.status).toBe(404)
  expect(probe.badHost.status).toBe(400)
  expect(probe.missing.status).toBe(404)

  await app.close()
})
```

- [ ] **Step 11: 跑 e2e，确认通过**

Run: `npm run e2e -- e2e/protocol.spec.ts`

Expected: PASS，1 passed。若 `chapter.status` 是 -1，说明 scheme 权限登记晚了或 `handle` 没挂上——检查 `registerEpubScheme()` 是否在模块顶层、`handleEpubProtocol()` 是否在 `whenReady` 里。

- [ ] **Step 12: Commit**

```bash
git add shared/csp.ts electron/main/epub/epub-url.ts electron/main/epub/protocol.ts electron/main/index.ts src/index.html fixtures/make-epub.ts tests/epub-url.test.ts e2e/protocol.spec.ts
git commit -m "feat: epub:// 自定义协议按需解压，只服务本书目录内的静态资源"
```

---

### Task 2: 阅读偏好的规范化与读写

排版面板与设置页共用同一份偏好。这个 Task 先把「越界值夹回范围」做成共享纯函数，再把偏好的读写从 `getAll`/`set` 的字符串搬运升级成类型化的两条通道。

**Files:**
- Create: `tests/prefs.test.ts`
- Modify: `shared/types.ts`, `shared/ipc.ts`, `electron/main/store/settings.ts`, `electron/main/ipc/settings.ts`, `electron/preload/index.ts`

- [ ] **Step 1: 写失败测试**

新建 `tests/prefs.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFS, clampPrefs } from '../shared/types'

describe('clampPrefs', () => {
  it('把越界值夹回范围', () => {
    expect(clampPrefs({ charsPerLine: 200 }).charsPerLine).toBe(48)
    expect(clampPrefs({ charsPerLine: 3 }).charsPerLine).toBe(24)
    expect(clampPrefs({ fontSize: 99 }).fontSize).toBe(24)
    expect(clampPrefs({ fontSize: 2 }).fontSize).toBe(15)
    expect(clampPrefs({ lineHeight: 9 }).lineHeight).toBe(2.2)
    expect(clampPrefs({ lineHeight: 0.1 }).lineHeight).toBe(1.5)
  })

  it('坏值与缺省值回落到默认', () => {
    expect(clampPrefs({})).toEqual(DEFAULT_PREFS)
    expect(clampPrefs({ font: 'mono' as never }).font).toBe('serif')
    expect(clampPrefs({ theme: 'sepia' as never }).theme).toBe('light')
    expect(clampPrefs({ fontSize: Number.NaN }).fontSize).toBe(DEFAULT_PREFS.fontSize)
    expect(clampPrefs({ charsPerLine: '34' as never }).charsPerLine).toBe(DEFAULT_PREFS.charsPerLine)
  })

  it('合法值原样保留', () => {
    const wanted = {
      font: 'sans',
      fontSize: 21,
      charsPerLine: 40,
      lineHeight: 2,
      theme: 'dark'
    } as const
    expect(clampPrefs(wanted)).toEqual(wanted)
  })
})
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `npx vitest run tests/prefs.test.ts`

Expected: FAIL —— `clampPrefs` 不是 `../shared/types` 的导出。

- [ ] **Step 3: 写共享的夹取逻辑**

在 `shared/types.ts` 末尾追加（`READING_PREFS` / `ReadingPrefs` 已经在该文件里，`DEFAULT_PREFS` 就在它下面）：

```ts
/**
 * 用户可调项的边界。UI 的滑块范围与主进程的落库校验共用这一份，
 * 避免出现「界面能拖到 60 字、存进去被截成 48」这种两边不一致。
 */
export const PREFS_LIMITS = {
  fontSize: [15, 24],
  charsPerLine: [24, 48],
  lineHeight: [1.5, 2.2]
} as const

/** 把任意输入夹进合法范围；类型不对或不是有限数就回落默认值。渲染进程与主进程都调它。 */
export function clampPrefs(input: Partial<ReadingPrefs>): ReadingPrefs {
  return {
    font: input.font === 'sans' ? 'sans' : DEFAULT_PREFS.font,
    fontSize: clampNumber(input.fontSize, PREFS_LIMITS.fontSize, DEFAULT_PREFS.fontSize),
    charsPerLine: clampNumber(
      input.charsPerLine,
      PREFS_LIMITS.charsPerLine,
      DEFAULT_PREFS.charsPerLine
    ),
    lineHeight: clampNumber(input.lineHeight, PREFS_LIMITS.lineHeight, DEFAULT_PREFS.lineHeight),
    theme: input.theme === 'dark' ? 'dark' : DEFAULT_PREFS.theme
  }
}

function clampNumber(value: unknown, [min, max]: readonly [number, number], fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `npx vitest run tests/prefs.test.ts`

Expected: PASS，3 passed。

- [ ] **Step 5: 让设置仓储用同一份夹取逻辑**

改 `electron/main/store/settings.ts`：把 `readPrefs` 换成下面这版，删掉文件里本地的 `clampNumber`，并追加 `writePrefs`。

```ts
/** 读到脏数据或缺失字段时回落到默认值，不让一个坏值把阅读器界面搞崩 */
export function readPrefs(db: Database.Database): ReadingPrefs {
  const raw = getAll(db).prefs
  if (!raw) return { ...DEFAULT_PREFS }

  let parsed: Partial<ReadingPrefs>
  try {
    parsed = JSON.parse(raw) as Partial<ReadingPrefs>
  } catch {
    return { ...DEFAULT_PREFS }
  }
  return clampPrefs(parsed)
}

/** 写偏好统一过一遍 clampPrefs：界面传来的值不可信，越界值不该落库。 */
export function writePrefs(db: Database.Database, input: Partial<ReadingPrefs>): ReadingPrefs {
  const prefs = clampPrefs(input)
  set(db, 'prefs', JSON.stringify(prefs))
  return prefs
}
```

文件顶部的 `@shared/types` 导入补上 `clampPrefs`（`DEFAULT_PREFS`、`ReadingPrefs` 已在）。两处夹取逻辑合并成一份，这是本步的重点，不要留下第二份 `clampNumber`。

- [ ] **Step 6: 加两条偏好通道**

`shared/ipc.ts` 的 `CH` 追加：

```ts
  settingsGetPrefs: 'settings:getPrefs',
  settingsSetPrefs: 'settings:setPrefs',
```

`API_SHAPE` 的 settings 改成：

```ts
  settings: ['getAll', 'set', 'getPrefs', 'setPrefs'],
```

`electron/main/ipc/settings.ts` 追加两条 handler（导入补上 `readPrefs` / `writePrefs` 与 `ReadingPrefs` 类型）：

```ts
  ipcMain.handle(CH.settingsGetPrefs, () => readPrefs(getDatabase()))
  ipcMain.handle(CH.settingsSetPrefs, (_event, prefs: Partial<ReadingPrefs>) =>
    writePrefs(getDatabase(), prefs)
  )
```

- [ ] **Step 7: 补 preload 白名单**

`electron/preload/index.ts` 的 `settings` 对象里追加（导入补上 `ReadingPrefs` 类型）：

```ts
    getPrefs: (): Promise<ReadingPrefs> => ipcRenderer.invoke(CH.settingsGetPrefs),
    setPrefs: (prefs: Partial<ReadingPrefs>): Promise<ReadingPrefs> =>
      ipcRenderer.invoke(CH.settingsSetPrefs, prefs),
```

- [ ] **Step 8: 跑边界测试，确认契约没破**

Run: `npm run e2e -- e2e/boundary.spec.ts`

Expected: PASS，1 passed。`API_SHAPE` 与 preload 暴露的方法名必须完全一致，少写一个 `getPrefs` 这里就会红。

- [ ] **Step 9: Commit**

```bash
git add shared/types.ts shared/ipc.ts electron/main/store/settings.ts electron/main/ipc/settings.ts electron/preload/index.ts tests/prefs.test.ts
git commit -m "feat: 阅读偏好的共享夹取逻辑与类型化读写通道"
```

---

### Task 3: 打开一本书：阅读状态仓储与 IPC

读一本书要一次拿到三样东西：书名作者、目录、上次读到哪里。分三次 IPC 会让开书出现可见的空白跳变，所以合并成一次 `reader.open`。

**Files:**
- Create: `electron/main/reader/repo.ts`, `electron/main/ipc/reader.ts`
- Create: `e2e/reader.spec.ts`
- Modify: `shared/types.ts`, `shared/ipc.ts`, `electron/main/ipc/index.ts`, `electron/preload/index.ts`

- [ ] **Step 1: 追加共享类型**

在 `shared/types.ts` 末尾追加：

```ts
/** 阅读器需要的一章。只带渲染与定位要用的字段，正文不在这里 —— 正文按需从 epub:// 取。 */
export type ReaderChapter = {
  id: number
  parentId: number | null
  title: string
  /** zip entry 名；目录里只有分组、没有正文的节点是空串 */
  href: string
  depth: number
  /** 在 spine 中的下标，用来拼 CFI 的第一段；没有正文时为 null */
  spineIndex: number | null
}

export type ReaderProgress = {
  cfi: string
  chapterId: number | null
  percent: number
  updatedAt: number
}

export type ReaderBook = {
  id: string
  title: string
  author: string | null
  chapters: ReaderChapter[]
  progress: ReaderProgress | null
}

export type ProgressInput = {
  bookId: string
  cfi: string
  /** 定位失败时允许为 null —— 进度仍要存，下次至少能跳回这一章开头 */
  chapterId: number | null
  percent: number
}
```

- [ ] **Step 2: 写阅读状态仓储**

新建 `electron/main/reader/repo.ts`：

```ts
import type Database from 'better-sqlite3'
import type { ProgressInput, ReaderBook, ReaderChapter, ReaderProgress } from '@shared/types'
import { touchOpened } from '../library/repo'

/**
 * 阅读器打开一本书需要的全部数据。
 *
 * 顺带更新 last_opened_at：书架按它排序，点开一本书就应该在书架上顶。
 */
export function openBook(db: Database.Database, bookId: string, now: number): ReaderBook | null {
  const book = db.prepare('SELECT id, title, author FROM books WHERE id = ?').get(bookId) as
    | { id: string; title: string; author: string | null }
    | undefined
  if (!book) return null

  touchOpened(db, bookId, now)

  return {
    id: book.id,
    title: book.title,
    author: book.author,
    chapters: listReaderChapters(db, bookId),
    progress: readProgress(db, bookId)
  }
}

/** 按 id 升序即「目录先序」：计划 02 的 buildChapters 是先序写入的，父行一定先于子行。 */
export function listReaderChapters(db: Database.Database, bookId: string): ReaderChapter[] {
  return db
    .prepare(
      `SELECT id, parent_id AS parentId, title, href, depth, order_index AS spineIndex
       FROM chapters WHERE book_id = ?
       ORDER BY id`
    )
    .all(bookId) as ReaderChapter[]
}

export function readProgress(db: Database.Database, bookId: string): ReaderProgress | null {
  const row = db
    .prepare(
      `SELECT cfi, chapter_id AS chapterId, percent, updated_at AS updatedAt
       FROM reading_progress WHERE book_id = ?`
    )
    .get(bookId) as ReaderProgress | undefined
  return row ?? null
}

/**
 * 进度是覆盖写的：一本书只留一条，翻页时高频调用也不该让表长大。
 *
 * 同时把 books.status 从 unread 推成 reading；读到 99% 以上记 finished。
 * 已经是 finished 的书不再回退状态——重读一遍不该让它从书架的「读完了」里消失。
 */
export function saveProgress(db: Database.Database, input: ProgressInput, now: number): void {
  db.prepare(
    `INSERT INTO reading_progress (book_id, cfi, chapter_id, percent, updated_at)
     VALUES (@bookId, @cfi, @chapterId, @percent, @now)
     ON CONFLICT(book_id) DO UPDATE SET
       cfi = excluded.cfi,
       chapter_id = excluded.chapter_id,
       percent = excluded.percent,
       updated_at = excluded.updated_at`
  ).run({ ...input, now })

  db.prepare("UPDATE books SET status = ? WHERE id = ? AND status <> 'finished'").run(
    input.percent >= 0.99 ? 'finished' : 'reading',
    input.bookId
  )
}
```

- [ ] **Step 3: 写 reader IPC**

新建 `electron/main/ipc/reader.ts`：

```ts
import { ipcMain } from 'electron'
import { CH } from '@shared/ipc'
import type { ProgressInput, ReaderBook } from '@shared/types'
import { openBook, saveProgress } from '../reader/repo'
import { getDatabase } from '../store/db'

export function registerReaderIpc(): void {
  ipcMain.handle(
    CH.readerOpen,
    (_event, bookId: string): ReaderBook | null => openBook(getDatabase(), bookId, Date.now())
  )

  ipcMain.handle(CH.readerSaveProgress, (_event, input: ProgressInput) => {
    saveProgress(getDatabase(), input, Date.now())
  })
}
```

`electron/main/ipc/index.ts` 加上一行调用：

```ts
import { registerReaderIpc } from './reader'
```

并在 `registerIpc()` 里追加 `registerReaderIpc()`（放在 `registerLibraryIpc()` 之后）。

- [ ] **Step 4: 追加通道与白名单**

`shared/ipc.ts` 的 `CH` 追加：

```ts
  readerOpen: 'reader:open',
  readerSaveProgress: 'reader:saveProgress',
```

`API_SHAPE` 追加：

```ts
  reader: ['open', 'saveProgress'],
```

`electron/preload/index.ts` 的 `api` 里追加（`@shared/types` 的导入补上 `ProgressInput`、`ReaderBook`）：

```ts
  reader: {
    open: (bookId: string): Promise<ReaderBook | null> => ipcRenderer.invoke(CH.readerOpen, bookId),
    saveProgress: (input: ProgressInput): Promise<void> =>
      ipcRenderer.invoke(CH.readerSaveProgress, input)
  },
```

- [ ] **Step 5: 写进度往返的 e2e**

新建 `e2e/reader.spec.ts`：

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { novelFiles, writeEpub } from '../fixtures/make-epub'
import { launchAppWithUserData } from './helpers'

test('打开一本书返回目录与空进度，存进去的进度能读回来，删书连进度一起清', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-reader-'))
  const epubPath = join(userDataDir, 'novel.epub')
  await writeEpub(epubPath, novelFiles())

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()
  const imported = await win.evaluate(
    (file) => (window as any).api.library.importPath(file),
    epubPath
  )
  const bookId = imported.bookId as string

  const opened = await win.evaluate((id) => (window as any).api.reader.open(id), bookId)
  expect(opened.title).toBe('河边的月亮')
  expect(opened.author).toBe('测试作者')
  expect(opened.chapters.map((c: { title: string }) => c.title)).toEqual(['第一章 河边', '第二章 夏夜'])
  expect(opened.chapters[0].spineIndex).toBe(0)
  expect(opened.chapters[0].href).toBe('OEBPS/ch1.xhtml')
  expect(opened.progress).toBeNull()

  await win.evaluate(
    (id) =>
      (window as any).api.reader.saveProgress({
        bookId: id,
        cfi: 'epubcfi(/6/2!/4/2/1:0)',
        chapterId: 2,
        percent: 0.4
      }),
    bookId
  )

  const again = await win.evaluate((id) => (window as any).api.reader.open(id), bookId)
  expect(again.progress.cfi).toBe('epubcfi(/6/2!/4/2/1:0)')
  expect(again.progress.chapterId).toBe(2)
  expect(again.progress.percent).toBeCloseTo(0.4, 5)

  const books = await win.evaluate(() => (window as any).api.library.list())
  expect(books[0].status).toBe('reading')
  expect(books[0].lastOpenedAt).not.toBeNull()

  await win.evaluate((id) => (window as any).api.library.remove(id), bookId)
  expect(await win.evaluate((id) => (window as any).api.reader.open(id), bookId)).toBeNull()

  await app.close()
})
```

`chapterId: 2` 是 `chapters` 表自增主键，第一本测试书的两章分别是 1 与 2。最后一条断言用的是「书没了就是 null」，顺带证明 `reading_progress` 随书级联删除后不会再被读出来。

- [ ] **Step 6: 跑 e2e，确认通过**

Run: `npm run e2e -- e2e/reader.spec.ts`

Expected: PASS，1 passed。若 `opened.chapters[0].spineIndex` 是 null，说明 `order_index` 没写进去，回头查计划 02 的 `insertBookGraph`。

- [ ] **Step 7: 跑边界测试，确认契约没破**

Run: `npm run e2e -- e2e/boundary.spec.ts`

Expected: PASS，1 passed。

- [ ] **Step 8: Commit**

```bash
git add shared electron/main/reader electron/main/ipc electron/preload/index.ts e2e/reader.spec.ts
git commit -m "feat: 阅读状态仓储与 reader.open / saveProgress 通道"
```

---

### Task 4: 把章节 XHTML 变成无脚本的同源文档

这是安全与渲染的交汇点：**文档由我们生成，不经过第三方装载器**，所以三道锁（摘脚本、文档内 meta CSP、协议响应头 CSP）都成立。

**Files:**
- Create: `src/foliate-js.d.ts`, `src/features/reader/document.ts`
- Modify: `package.json`

- [ ] **Step 1: 装 CFI 模块**

```bash
npm i foliate-js@1.0.1
```

只装、不用整库。我们只 import `foliate-js/epubcfi.js` 一个文件（零依赖、纯函数），**不要** import `view.js`——那会把 zip.js 与一整套渲染器带进来，与本文的决策记录相悖。

- [ ] **Step 2: 写类型声明**

新建 `src/foliate-js.d.ts`：

```ts
/**
 * foliate-js 是纯 .js 无类型声明，这里只声明我们真正用到的五个导出。
 * 多声明等于给未来埋一个「以为有类型保护」的坑，所以不补它其余的部分。
 */
declare module 'foliate-js/epubcfi.js' {
  export type CfiPart = { index: number; id?: string; offset?: number }

  /** 折叠的 CFI 是「各层路径」的数组；区间 CFI 是带 start/end 的对象 */
  export type ParsedCfi =
    | CfiPart[][]
    | { parent: CfiPart[][]; start: CfiPart[][]; end: CfiPart[][] }

  export function parse(cfi: string): ParsedCfi
  export function joinIndir(...xs: string[]): string
  export function fromRange(range: Range): string
  export function toRange(doc: Document, parts: CfiPart[][]): Range
  export const fake: {
    fromIndex(index: number): string
    toIndex(parts: CfiPart[][]): number
  }
}
```

- [ ] **Step 3: 写章节文档准备**

新建 `src/features/reader/document.ts`：

```ts
import { CHAPTER_CSP } from '@shared/csp'

const XHTML_NS = 'http://www.w3.org/1999/xhtml'

/** 能执行代码、能发起外部请求、能把文档导航走的节点，整类摘掉 */
const FORBIDDEN = ['script', 'iframe', 'frame', 'object', 'embed', 'template', 'applet']

export type PreparedChapter = {
  html: string
  /** 解析与序列化用同一套规则，输出类型必须跟着走 */
  mime: 'application/xhtml+xml' | 'text/html'
}

/**
 * 把从 epub:// 取回的原始章节 XHTML 加工成一个可以安全放进 iframe 的同源文档。
 *
 * 同源是功能前提：父文档要能读它的 DOM，才能注入排版样式、算 CFI、读选区。
 * 无脚本是安全前提：书是外来文件，spec §6.4 要求章节文档 `script-src 'none'`。
 */
export function prepareChapter(input: {
  html: string
  /** epub://<bookId>/<本章所在目录>/ —— 书内所有相对路径都靠它解析 */
  baseHref: string
  /** 排版与主题样式，写进 <style id="reader-theme"> */
  themeCss: string
}): PreparedChapter {
  const { doc, mime } = parse(input.html)

  strip(doc)

  const head = ensureHead(doc, mime)
  // <base> 必须排在 head 最前：它之后出现的相对路径才按 epub:// 解析
  head.prepend(make(doc, mime, 'base', { href: input.baseHref }))
  head.append(
    make(doc, mime, 'meta', { 'http-equiv': 'Content-Security-Policy', content: CHAPTER_CSP })
  )

  const style = make(doc, mime, 'style', { id: 'reader-theme' })
  style.textContent = input.themeCss
  head.append(style)

  return { html: new XMLSerializer().serializeToString(doc), mime }
}

/**
 * 优先按 XHTML（XML）解析：epub 的章节本来是 XML，XML 解析不会像 HTML 解析那样
 * 自作主张地补 `<p>`、丢标签、改结构。
 *
 * 但真实 epub 里不合规的 XHTML 相当常见，所以退回容错的 HTML 解析；
 * 此时输出也标成 text/html —— 解析与序列化必须同一套规则，否则 XML 序列化出的
 * 自闭合标签（`<div/>`）会被 HTML 解析器当成「未闭合」，后面的内容全被吞进去。
 */
function parse(html: string): { doc: Document; mime: PreparedChapter['mime'] } {
  const parser = new DOMParser()
  const xml = parser.parseFromString(html, 'application/xhtml+xml')
  if (xml.getElementsByTagName('parsererror').length === 0) {
    return { doc: xml, mime: 'application/xhtml+xml' }
  }
  return { doc: parser.parseFromString(html, 'text/html'), mime: 'text/html' }
}

function strip(doc: Document): void {
  for (const name of FORBIDDEN) {
    for (const node of Array.from(doc.getElementsByTagName(name))) node.remove()
  }

  // 书自带的 CSP 声明会挡我们的注入样式；refresh 能把文档直接导航走，绕开所有定位逻辑
  for (const meta of Array.from(doc.getElementsByTagName('meta'))) {
    const equiv = meta.getAttribute('http-equiv')?.toLowerCase()
    if (equiv === 'refresh' || equiv === 'content-security-policy') meta.remove()
  }

  // 只留样式表：rel 为 preload / prefetch / dns-prefetch 的都会发起我们不需要的请求
  for (const link of Array.from(doc.getElementsByTagName('link'))) {
    if ((link.getAttribute('rel') ?? '').toLowerCase() !== 'stylesheet') link.remove()
  }

  // 书里写死的 base 会顶掉我们注入的那个
  for (const base of Array.from(doc.getElementsByTagName('base'))) base.remove()
}

function ensureHead(doc: Document, mime: PreparedChapter['mime']): Element {
  const existing = doc.getElementsByTagName('head')[0]
  if (existing) return existing
  const head = make(doc, mime, 'head', {})
  const root = doc.documentElement
  root.insertBefore(head, root.firstChild)
  return head
}

/** XML 文档里建的节点必须带命名空间，否则序列化出来是另一个命名空间的元素 */
function make(
  doc: Document,
  mime: PreparedChapter['mime'],
  name: string,
  attrs: Record<string, string>
): Element {
  const el =
    mime === 'application/xhtml+xml' ? doc.createElementNS(XHTML_NS, name) : doc.createElement(name)
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value)
  return el
}

/**
 * 章节文档用 Blob URL 装进 iframe：blob: 与创建它的文档同源，
 * 因此父文档能读它的 DOM。用完记得 `URL.revokeObjectURL`。
 */
export function chapterBlobUrl(prepared: PreparedChapter): string {
  return URL.createObjectURL(new Blob([prepared.html], { type: prepared.mime }))
}
```

- [ ] **Step 4: 类型检查**

Run: `npx tsc --noEmit`

Expected: 无错误。若报找不到 `foliate-js/epubcfi.js` 的类型，说明 `src/foliate-js.d.ts` 没被 `tsconfig.json` 的 `include`（`"src"`）覆盖。

这一层没法用 vitest 测——`DOMParser`、`XMLSerializer`、`Blob` 都要真实 DOM。它的验收放在 Task 8 的 e2e：脚本一定不执行、书内图片一定显示、书内样式表一定生效。

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/foliate-js.d.ts src/features/reader/document.ts
git commit -m "feat: 章节 XHTML 加工为无脚本同源文档，引入 CFI 纯函数模块"
```

---

### Task 5: 排版计算（纯函数）

版心宽 = 每行字数 × 字号，这是 spec §4.4 的公式；窗口不够宽时要按上限显示并**明说**被压过。这些判断全部是纯计算，先单测锁死，再让界面去消费。

**Files:**
- Create: `src/features/reader/layout.ts`, `src/features/reader/theme.ts`
- Create: `tests/reader-layout.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `tests/reader-layout.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFS } from '../shared/types'
import { COLUMN_GAP, PAGE_PAD_Y, computeLayout } from '../src/features/reader/layout'

const prefs = { ...DEFAULT_PREFS }

describe('computeLayout', () => {
  it('宽窗口上对开双页，版心宽 = 每行字数 × 字号', () => {
    const layout = computeLayout({
      windowWidth: 2000,
      containerWidth: 1600,
      containerHeight: 900,
      prefs
    })
    expect(layout.columns).toBe(2)
    expect(layout.columnWidth).toBe(34 * 19)
    expect(layout.frameWidth).toBe(646 * 2 + COLUMN_GAP)
    expect(layout.pageHeight).toBe(900 - 2 * PAGE_PAD_Y)
    expect(layout.step).toBe((646 + COLUMN_GAP) * 2)
    expect(layout.charsPerLine).toBe(34)
    expect(layout.clamped).toBe(false)
    expect(layout.fontSizeClamped).toBe(false)
  })

  it('中等宽度是单栏，多余宽度留在纸面上而不是拉长行宽', () => {
    // 窗口 1400（< SPREAD_WIDTH 1900）但正文区有 1160 —— 对开与否看窗口，不看正文区
    const layout = computeLayout({
      windowWidth: 1400,
      containerWidth: 1160,
      containerHeight: 800,
      prefs
    })
    expect(layout.columns).toBe(1)
    expect(layout.columnWidth).toBe(646)
    expect(layout.frameWidth).toBe(646)
    expect(layout.clamped).toBe(false)
    expect(layout.fontSizeClamped).toBe(false)
  })

  it('窄窗口压行宽，clamped 为真，界面据此明说降级', () => {
    // 600 - 96 = 504 可用；504 / 17 = 29 字 < 设定 34 字
    const layout = computeLayout({
      windowWidth: 800,
      containerWidth: 600,
      containerHeight: 700,
      prefs
    })
    expect(layout.fontSize).toBe(17)
    expect(layout.fontSizeClamped).toBe(true)
    expect(layout.charsPerLine).toBe(29)
    expect(layout.clamped).toBe(true)
  })

  it('用户字号本来就小于等于降级值时不算降级', () => {
    const layout = computeLayout({
      windowWidth: 800,
      containerWidth: 600,
      containerHeight: 700,
      prefs: { ...prefs, fontSize: 16 }
    })
    expect(layout.fontSize).toBe(16)
    expect(layout.fontSizeClamped).toBe(false)
  })

  it('改字号会改变版心宽，改行距不会', () => {
    const big = computeLayout({
      windowWidth: 2000,
      containerWidth: 2000,
      containerHeight: 900,
      prefs: { ...prefs, fontSize: 24 }
    })
    expect(big.columnWidth).toBe(34 * 24)
    expect(big.charsPerLine).toBe(34)

    const loose = computeLayout({
      windowWidth: 2000,
      containerWidth: 2000,
      containerHeight: 900,
      prefs: { ...prefs, lineHeight: 2.2 }
    })
    expect(loose.columnWidth).toBe(646)
  })

  it('退化输入不崩，且给出版心下限', () => {
    const layout = computeLayout({ windowWidth: 1, containerWidth: 1, containerHeight: 1, prefs })
    expect(layout.columnWidth).toBe(120)
    expect('pages' in layout).toBe(false) // 页数由分页器量出来，不在这里算
    expect(layout.pageHeight).toBe(120)
  })
})
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `npx vitest run tests/reader-layout.test.ts`

Expected: FAIL —— 无法解析 `../src/features/reader/layout`。

- [ ] **Step 3: 写排版计算**

新建 `src/features/reader/layout.ts`：

```ts
import type { ReadingPrefs } from '@shared/types'

/**
 * 纸面留白。这一圈是**屏幕空间**的留白，不参与分栏 —— 也就是说 iframe（正文区）
 * 的尺寸就是纯文字区域，视觉上的页边距由外面的纸面提供。
 */
export const PAGE_PAD_X = 48
export const PAGE_PAD_Y = 40

/** 相邻两栏之间的间隙。改它必须同步改 theme.ts 里的 column-gap，两处只能有一个来源 */
export const COLUMN_GAP = 48

/** 窗口窄到这个宽度以下：侧栏收成图标栏、字号降级（.uicraft.md 的自适应表） */
export const NARROW_WIDTH = 840
/** 窗口够宽就上对开双页（.uicraft.md 的自适应表） */
export const SPREAD_WIDTH = 1900
/** 窄窗口下的实际字号 */
export const NARROW_FONT_SIZE = 17
/** 版心宽的兜底下限，避免退化输入算出负数或 0 */
const MIN_COLUMN_WIDTH = 120

export type ReaderLayout = {
  /** 一屏几栏 */
  columns: 1 | 2
  /** 单个版心宽（像素） */
  columnWidth: number
  /** 正文区总宽 = 一屏内所有栏加间隙 */
  frameWidth: number
  /** 一屏的高度 */
  pageHeight: number
  /** 翻一次页横向移动多少像素 */
  step: number
  /** 实际使用的字号 */
  fontSize: number
  /** 实际能放下的每行字数 */
  charsPerLine: number
  /** 用户设定的每行字数被窗口宽度压过了 —— 界面必须明说，不许静默降级 */
  clamped: boolean
  /** 字号被降级了 */
  fontSizeClamped: boolean
}

/**
 * 按窗口宽度与正文区尺寸算出版式。
 *
 * 纯函数、不碰 DOM：所有「窗口不够宽怎么办」的判断都在这里，界面只负责把
 * clamped / fontSizeClamped 显示出来。
 *
 * 两个宽度分工不同，不能混用：
 * - windowWidth 决定 .uicraft.md 的自适应断点（对开、字号降级）—— 那一列说的是**窗口**；
 * - containerWidth 是正文区（纸面）的真实宽度，决定版心宽能分到多少。
 *
 * 为什么必须分开：阅读器左栏占掉 248px，窗口 1900 时正文区只有 1652。
 * 若拿正文区去比 SPREAD_WIDTH，窗口再宽也上不了对开。
 */
export function computeLayout(input: {
  windowWidth: number
  containerWidth: number
  containerHeight: number
  prefs: ReadingPrefs
}): ReaderLayout {
  const { windowWidth, containerWidth, containerHeight, prefs } = input

  // 让位顺序（.uicraft.md）：对开 → 单栏 → 降字号
  const fontSizeClamped = windowWidth < NARROW_WIDTH && prefs.fontSize > NARROW_FONT_SIZE
  const fontSize = fontSizeClamped ? NARROW_FONT_SIZE : prefs.fontSize

  const columns: 1 | 2 = windowWidth >= SPREAD_WIDTH ? 2 : 1
  const pageHeight = Math.max(MIN_COLUMN_WIDTH, Math.round(containerHeight - PAGE_PAD_Y * 2))
  const textWidth = Math.max(MIN_COLUMN_WIDTH, Math.round(containerWidth - PAGE_PAD_X * 2))

  // 版心宽 = 每行字数 × 字号（中文一字宽约等于字号）
  const wanted = Math.round(prefs.charsPerLine * fontSize)
  const available = Math.floor((textWidth - COLUMN_GAP * (columns - 1)) / columns)
  const columnWidth = Math.max(MIN_COLUMN_WIDTH, Math.min(wanted, available))
  const charsPerLine = Math.floor(columnWidth / fontSize)

  return {
    columns,
    columnWidth,
    // 必须反算回「正好 columns 栏」的宽度：给多了浏览器会自己多开一栏，页数就全错了
    frameWidth: (columnWidth + COLUMN_GAP) * columns - COLUMN_GAP,
    pageHeight,
    step: (columnWidth + COLUMN_GAP) * columns,
    fontSize,
    charsPerLine,
    clamped: charsPerLine < prefs.charsPerLine,
    fontSizeClamped
  }
}
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `npx vitest run tests/reader-layout.test.ts`

Expected: PASS，6 passed。

- [ ] **Step 5: 写注入样式**

新建 `src/features/reader/theme.ts`：

```ts
import type { ReadingPrefs } from '@shared/types'
import { COLUMN_GAP, type ReaderLayout } from './layout'

/** 与 tokens.css 保持一致的两套字体栈。iframe 里拿不到父文档的 CSS 变量，所以这里写死字面量 */
const SERIF = "'Source Han Serif SC', 'Noto Serif SC', 'Songti SC', SimSun, serif"
const SANS = "'PingFang SC', 'Microsoft YaHei', system-ui, -apple-system, 'Segoe UI', sans-serif"

/** 明暗两套纸面配色，与 tokens.css 的 --paper / --ink 对应 */
const PAPER = {
  light: { bg: '#fcfaf6', ink: '#2b2723' },
  dark: { bg: '#211e1b', ink: '#e6e0d8' }
} as const

export function readerFontStack(font: ReadingPrefs['font']): string {
  return font === 'serif' ? SERIF : SANS
}

/**
 * 注入章节文档的样式。
 *
 * 只覆盖「阅读相关」的东西：字号、行距、颜色、字体、分栏。
 * 书的排版（段落缩进、居中、标题层级、图片尺寸）一律不动 —— spec §3.4 要求书自己的样式优先。
 */
export function buildReaderCss(layout: ReaderLayout, prefs: ReadingPrefs): string {
  const { bg, ink } = PAPER[prefs.theme]
  return `html {
  height: ${layout.pageHeight}px;
  /* 翻页靠 body 的 translateX 驱动，滚动条本身不该出现 */
  overflow: hidden;
  background: ${bg};
  color: ${ink};
}
body {
  margin: 0;
  padding: 0;
  height: ${layout.pageHeight}px;
  box-sizing: border-box;
  column-width: ${layout.columnWidth}px;
  column-gap: ${COLUMN_GAP}px;
  /* auto 而不是默认的 balance：按页高往下排，排满自动开下一栏 */
  column-fill: auto;
  font-family: ${readerFontStack(prefs.font)};
  font-size: ${layout.fontSize}px;
  line-height: ${prefs.lineHeight};
  color: ${ink};
  background: ${bg};
  text-align: justify;
  overflow-wrap: break-word;
}
img, svg, video {
  max-width: 100%;
  height: auto;
}
a {
  color: inherit;
  text-decoration: underline;
}
::selection {
  background: color-mix(in srgb, ${ink} 18%, transparent);
}` 
}
```

- [ ] **Step 6: 跑全部单测**

Run: `npm test`

Expected: PASS。总数应为计划 01–03 的所有单测（本文新增 `epub-url` 13 条、`prefs` 3 条、`reader-layout` 6 条）。

- [ ] **Step 7: Commit**

```bash
git add src/features/reader/layout.ts src/features/reader/theme.ts tests/reader-layout.test.ts
git commit -m "feat: 版式计算与注入样式（版心宽、对开、降级判定）"
```

---

### Task 6: 分页器与最小可读阅读器

一章一 iframe，翻页靠给正文加一个负的 `translateX`。位置的真身是位移量（px）而不是页码，这样重排时能按比例保住位置、再用 CFI 纠正一次。

**Files:**
- Create: `src/features/reader/paginator.ts`, `src/features/reader/ReaderPage.tsx`
- Modify: `src/App.tsx`, `src/pages/LibraryPage.tsx`, `src/features/library/BookList.tsx`, `src/styles/base.css`, `fixtures/make-epub.ts`, `e2e/reader.spec.ts`

- [ ] **Step 1: 写分页器**

新建 `src/features/reader/paginator.ts`：

```ts
import { fake, fromRange, joinIndir, parse, toRange, type CfiPart } from 'foliate-js/epubcfi.js'
import type { ReaderLayout } from './layout'

/** 取页首位置时探的坐标：正文区左上角往里缩一点，保证落在第一行文字里 */
const PROBE_X = 2
const PROBE_Y = 2

/**
 * 一章的分页与定位。
 *
 * 排版交给 CSS 多栏：章节文档是一个固定页高、`column-fill: auto` 的多栏容器，
 * 内容横向溢出到看不见的地方。翻页就是给 body 加一个负的 translateX ——
 * 不逐字测量，也不去加宽 iframe（加宽了浏览器会自己多开一栏，页数就全错了）。
 *
 * 位置的真身是 `offset`（当前位移，像素），页码由它除以步长换算出来。
 * 这样重排时只要把 offset 按新步长缩放一次、再用 CFI 纠正一次，
 * 就不会出现「读到第 8 页，改个字号跳回第 1 页」。
 *
 * 用 translate 而不是 scrollLeft，是因为 XHTML 章节可能被解析成 XML 文档，
 * 而 XML 文档没有 `document.scrollingElement`，滚动语义不可靠。
 */
export class ChapterPaginator {
  private pagination: ReaderLayout
  private offset = 0

  constructor(
    private readonly doc: Document,
    pagination: ReaderLayout,
    /** 本章在 spine 中的下标，用来拼 CFI 的第一段 */
    private readonly spineIndex: number
  ) {
    this.pagination = pagination
    this.apply()
  }

  private get step(): number {
    return this.pagination.step
  }

  private apply(): void {
    const body = this.doc.body
    if (!body) return
    body.style.transform = this.offset === 0 ? '' : `translateX(${-this.offset}px)`
  }

  /** 位移落位并夹在 [0, 最后一页]，防止翻过头出现空白页 */
  private settle(offset: number): void {
    const max = Math.max(0, (this.pages - 1) * this.step)
    this.offset = Math.min(Math.max(0, offset), max)
    this.apply()
  }

  /**
   * 内容的真实总宽。
   *
   * `scrollWidth` 在 Chromium 上是否把多栏溢出的列算进来并不稳定，
   * 所以同时看最后一个元素的右边界，取大者。两个量都是「客户端坐标之差」，
   * 与当前 translate 无关。
   */
  private contentWidth(): number {
    const body = this.doc.body
    if (!body) return this.pagination.frameWidth
    const last = body.lastElementChild
    const fromLast = last
      ? last.getBoundingClientRect().right - body.getBoundingClientRect().left
      : 0
    return Math.max(this.pagination.frameWidth, body.scrollWidth, fromLast)
  }

  get pages(): number {
    return Math.max(1, Math.ceil(this.contentWidth() / this.step))
  }

  get page(): number {
    return Math.round(this.offset / this.step)
  }

  goToPage(page: number): void {
    this.settle(page * this.step)
  }

  /** 返回是否真的翻了页；到边界返回 false，由调用方决定要不要换章 */
  next(): boolean {
    if (this.page >= this.pages - 1) return false
    this.goToPage(this.page + 1)
    return true
  }

  prev(): boolean {
    if (this.page <= 0) return false
    this.goToPage(this.page - 1)
    return true
  }

  /** 本章内的阅读比例（0–1）：翻到本章最后一页即为 1 */
  chapterFraction(): number {
    return (this.page + 1) / this.pages
  }

  /**
   * 当前页左上角那个字的位置。
   *
   * 用 `caretRangeFromPoint` 而不是数元素：分栏之后一个元素可能被拆到两页，
   * 只有「屏幕左上角是什么字」才是与页面对应的真实锚点。
   */
  currentCfi(): string {
    return joinIndir(fake.fromIndex(this.spineIndex), fromRange(this.pageStartRange()))
  }

  private pageStartRange(): Range {
    const hit = this.doc.caretRangeFromPoint(PROBE_X, PROBE_Y)
    if (hit) return hit
    const fallback = this.doc.createRange()
    const body = this.doc.body
    if (body) fallback.selectNodeContents(body)
    fallback.collapse(true)
    return fallback
  }

  /** CFI 可能带 `!`（spine 段）也可能是区间；这里只取本章文档内的那一段 */
  private localParts(cfi: string): CfiPart[][] | null {
    try {
      const parsed = parse(cfi)
      const indirection = Array.isArray(parsed) ? parsed : parsed.start
      const local = indirection[indirection.length - 1]
      return local ? [local] : null
    } catch {
      return null
    }
  }

  /** 把 rect 从「视口坐标」换算成「内容坐标」 */
  private contentLeftOf(rect: DOMRect): number {
    return rect.left + this.offset
  }

  private settleAt(contentX: number): void {
    this.settle(Math.floor(contentX / this.step) * this.step)
  }

  /** 把定位点移到 CFI 所在页；CFI 坏掉或找不到节点时返回 false，由调用方兜底 */
  goToCfi(cfi: string): boolean {
    const parts = this.localParts(cfi)
    if (!parts) return false
    let range: Range
    try {
      range = toRange(this.doc, parts)
    } catch {
      return false
    }
    this.settleAt(this.contentLeftOf(range.getBoundingClientRect()))
    return true
  }

  /** 跳到某个元素（书内锚点链接用）；找不到返回 false */
  goToElement(id: string): boolean {
    const element = this.doc.getElementById(id)
    if (!element) return false
    const range = this.doc.createRange()
    range.selectNode(element)
    this.settleAt(this.contentLeftOf(range.getBoundingClientRect()))
    return true
  }

  /**
   * 重排：字号、行距、每行字数、窗口大小变了都走这里。
   *
   * 顺序不能反 —— 调用方必须先把 iframe 尺寸与文档内样式改好，再调它，
   * 否则量到的是旧版式的坐标。
   */
  relayout(pagination: ReaderLayout): void {
    const anchor = this.currentCfi()
    const carried = this.offset * (this.step > 0 ? pagination.step / this.step : 1)
    this.pagination = pagination
    // 锚点定位失败时退化成按比例换算的位置，绝不无声地回到第一页
    if (!this.goToCfi(anchor)) this.settle(carried)
  }
}
```

三个容易踩的点，都已在代码里避开：

1. `toRange(doc, parts)` 内部取 `parts[0]` 作为起点路径。若把 `parse(cfi)` 的完整结果（含 `!` 之前的 spine 段）直接传进去，它会拿 `/6/2` 去章节文档里找节点，必然定位失败。所以 `localParts` 只回传 `!` 之后的那一段。
2. `fake.fromIndex(i)` 产出的是 `epubcfi(/6/2)`（**不含** `!`），`joinIndir` 负责补 `!` 拼接，别手写。
3. `scrollWidth` 对多栏溢出的支持不可靠，所以 `contentWidth()` 同时取「最后一个元素的右边界」。

- [ ] **Step 2: 写阅读器**

新建 `src/features/reader/ReaderPage.tsx`：

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReadingPrefs, ReaderBook } from '@shared/types'
import { chapterBlobUrl, prepareChapter } from './document'
import { computeLayout, type ReaderLayout } from './layout'
import { ChapterPaginator } from './paginator'
import { buildReaderCss } from './theme'

/** macOS 上是原生红绿灯占着左上角，标题栏内容要让位 */
const IS_MAC = navigator.userAgent.includes('Mac')
const BAR_PAD_LEFT = IS_MAC ? 78 : 12

/**
 * 章节文档的 base：`epub://<bookId>/<本章所在目录>/`。
 *
 * 这里不复用主进程的 `dirOf`：那一个处理的是 zip entry 名（可能含 `..`），
 * 这一个处理的是 URL，交给标准 URL API 处理 `../` 与编码更可靠。
 */
function chapterBaseHref(bookId: string, entry: string): string {
  const url = new URL(`epub://${bookId}/${entry}`)
  return url.href.slice(0, url.href.lastIndexOf('/') + 1)
}

export function ReaderPage({ bookId, onExit }: { bookId: string; onExit: () => void }) {
  const [book, setBook] = useState<ReaderBook | null>(null)
  const [prefs, setPrefs] = useState<ReadingPrefs | null>(null)
  const [missing, setMissing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [chapterIndex, setChapterIndex] = useState(0)
  const [size, setSize] = useState({ width: 0, height: 0 })
  /** 每换一章 +1，用来触发「重排 → 定位」这条链 */
  const [docVersion, setDocVersion] = useState(0)
  const [page, setPage] = useState(1)
  const [pageCount, setPageCount] = useState(1)

  const stageRef = useRef<HTMLDivElement | null>(null)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const paginatorRef = useRef<ChapterPaginator | null>(null)
  /** 新文档载入后要跳到的位置：恢复进度用 cfi，往回翻章用 edge */
  const pendingRef = useRef<{ cfi?: string; edge?: 'end' } | null>(null)

  /**
   * 版式只在这里算。`windowWidth` 与 `size` 分开传：断点说的是窗口宽度，
   * 而正文区因为左栏被占掉，比窗口窄。
   */
  const layoutRef = useRef<ReaderLayout | null>(null)
  const prefsRef = useRef<ReadingPrefs | null>(null)
  const windowWidth = useWindowWidth()

  /** 只有带正文的节点才进阅读流：目录里的分组节点 href 是空串 */
  const readable = useMemo(() => book?.chapters.filter((item) => item.href !== '') ?? [], [book])

  const layout = useMemo(() => {
    if (!prefs || size.width <= 0 || size.height <= 0) return null
    return computeLayout({
      windowWidth,
      containerWidth: size.width,
      containerHeight: size.height,
      prefs
    })
  }, [prefs, size, windowWidth])

  const canLoad = book !== null && prefs !== null && layout !== null

  // 必须排在载入章节的 effect 之前：同一个 commit 里 ref 先写、再被读到
  useEffect(() => {
    layoutRef.current = layout
    prefsRef.current = prefs
  }, [layout, prefs])

  // ① 开书：书名、目录、上次读到哪里，一次拿齐
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const [opened, saved] = await Promise.all([
          window.api.reader.open(bookId),
          window.api.settings.getPrefs()
        ])
        if (!alive) return
        if (!opened) {
          setMissing(true)
          return
        }
        setPrefs(saved)
        setBook(opened)
        const list = opened.chapters.filter((item) => item.href !== '')
        const found = opened.progress
          ? list.findIndex((item) => item.id === opened.progress?.chapterId)
          : -1
        setChapterIndex(found >= 0 ? found : 0)
        // 定位失败时停在章首即可：进度仍然指向这一章，不会跳到别处
        pendingRef.current = opened.progress ? { cfi: opened.progress.cfi } : null
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : '打开失败')
      }
    })()
    return () => {
      alive = false
    }
  }, [bookId])

  // ② 量正文区。首次同步量一次，之后交给 ResizeObserver
  useEffect(() => {
    const stage = stageRef.current
    if (!stage || !book) return
    const measure = (): void => {
      const rect = stage.getBoundingClientRect()
      setSize({ width: rect.width, height: rect.height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [book])

  // ③ 取回本章 XHTML、加工成无脚本同源文档、装进 iframe、建分页器
  useEffect(() => {
    const pagination = layoutRef.current
    const readingPrefs = prefsRef.current
    const iframe = iframeRef.current
    const chapter = book ? readable[chapterIndex] : undefined
    if (!canLoad || !book || !pagination || !readingPrefs || !iframe || !chapter) return

    let cancelled = false
    let blobUrl: string | null = null
    paginatorRef.current = null

    void (async () => {
      try {
        const response = await fetch(`epub://${book.id}/${chapter.href}`)
        if (!response.ok) throw new Error(`取不到章节内容（HTTP ${response.status}）`)
        const prepared = prepareChapter({
          html: await response.text(),
          baseHref: chapterBaseHref(book.id, chapter.href),
          themeCss: buildReaderCss(pagination, readingPrefs)
        })
        if (cancelled) return

        blobUrl = chapterBlobUrl(prepared)
        const loaded = new Promise<void>((resolve, reject) => {
          iframe.addEventListener('load', () => resolve(), { once: true })
          iframe.addEventListener('error', () => reject(new Error('章节文档没有加载成功')), {
            once: true
          })
        })
        // 尺寸必须在文档载入前定好，否则分页器量到的是错的版式
        iframe.style.width = `${pagination.frameWidth}px`
        iframe.style.height = `${pagination.pageHeight}px`
        iframe.src = blobUrl
        await loaded
        if (cancelled) return

        const doc = iframe.contentDocument
        if (!doc || !doc.body) throw new Error('本章没有正文')

        // 等字体就位再分页：字体晚到会让行高变化，页数就白算了
        await doc.fonts.ready
        if (cancelled) return

        paginatorRef.current = new ChapterPaginator(
          doc,
          pagination,
          chapter.spineIndex ?? chapterIndex
        )
        setError(null)
        setDocVersion((value) => value + 1)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '章节打开失败')
      }
    })()

    return () => {
      cancelled = true
      paginatorRef.current = null
      // Blob URL 不撤销就是内存泄漏，一章一个
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
  }, [canLoad, book, readable, chapterIndex])

  // ④ 版式变化：先尺寸 → 再文档内样式 → 再重排 → 最后上报页数。这个顺序是硬约束
  useEffect(() => {
    const iframe = iframeRef.current
    const paginator = paginatorRef.current
    if (!iframe || !paginator || !layout || !prefs) return

    iframe.style.width = `${layout.frameWidth}px`
    iframe.style.height = `${layout.pageHeight}px`
    const style = iframe.contentDocument?.getElementById('reader-theme')
    if (style) style.textContent = buildReaderCss(layout, prefs)
    paginator.relayout(layout)

    setPage(paginator.page + 1)
    setPageCount(paginator.pages)
  }, [layout, prefs, docVersion])

  // ⑤ 新文档就位后再跳位置。必须排在 ④ 之后，否则会用旧版式的页码
  useEffect(() => {
    const paginator = paginatorRef.current
    const pending = pendingRef.current
    if (!paginator || !pending) return
    pendingRef.current = null
    if (pending.cfi) {
      paginator.goToCfi(pending.cfi)
    } else if (pending.edge === 'end') {
      paginator.goToPage(paginator.pages - 1)
    }
    setPage(paginator.page + 1)
    setPageCount(paginator.pages)
  }, [docVersion])

  // 阅读器自带主题：跟着偏好切，不污染一级页面的主题
  useEffect(() => {
    if (prefs) document.documentElement.dataset.theme = prefs.theme
  }, [prefs])

  const turn = useCallback(
    (direction: 1 | -1) => {
      const paginator = paginatorRef.current
      if (!paginator) return
      if (direction === 1 ? paginator.next() : paginator.prev()) {
        setPage(paginator.page + 1)
        setPageCount(paginator.pages)
        return
      }
      const target = chapterIndex + direction
      if (target < 0 || target >= readable.length) return
      // 往前翻章落到章首（新分页器本来就在章首），往回翻章要落到章尾
      pendingRef.current = direction === -1 ? { edge: 'end' } : null
      setChapterIndex(target)
    },
    [chapterIndex, readable.length]
  )

  /** 键盘要在两个文档上都听：焦点在 iframe 里时父文档收不到 keydown */
  const onKeyRef = useRef<(event: KeyboardEvent) => void>(() => {})
  useEffect(() => {
    onKeyRef.current = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        event.preventDefault()
        turn(1)
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault()
        turn(-1)
      } else if (event.key === 'Escape') {
        event.preventDefault()
        onExit()
      }
    }
  })

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => onKeyRef.current(event)
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    const doc = iframeRef.current?.contentDocument
    if (!doc) return
    const handler = (event: KeyboardEvent): void => onKeyRef.current(event)
    doc.addEventListener('keydown', handler)
    return () => doc.removeEventListener('keydown', handler)
  }, [docVersion])

  if (missing) {
    return (
      <div className="reader">
        <div className="reader__bar" style={{ paddingLeft: BAR_PAD_LEFT }}>
          <button type="button" className="btn" onClick={onExit}>
            返回书架
          </button>
        </div>
        <p className="reader__status">这本书不在书库里，可能已经被删除了。</p>
      </div>
    )
  }

  return (
    <div className="reader">
      <div className="reader__bar" style={{ paddingLeft: BAR_PAD_LEFT }}>
        <button type="button" className="btn" onClick={onExit}>
          返回书架
        </button>
        <span className="reader__title">{book?.title ?? '正在打开…'}</span>
        <span className="reader__chapter">{readable[chapterIndex]?.title ?? ''}</span>
        <span className="reader__spacer" />
        <button type="button" className="btn" onClick={() => turn(-1)}>
          上一页
        </button>
        <span className="reader__page">
          {page} / {pageCount}
        </span>
        <button type="button" className="btn" onClick={() => turn(1)}>
          下一页
        </button>
      </div>
      <div className="reader__body">
        <div className="reader__stage" ref={stageRef}>
          {error && <p className="reader__status">{error}</p>}
          <div className="reader__frame">
            <iframe
              ref={iframeRef}
              className="reader__view"
              title={book?.title ?? '正文'}
              // 第四道锁：即便 CSP 与摘脚本都失效，沙箱也不给脚本执行的机会。
              // allow-same-origin 是功能前提（父文档要读它的 DOM），且不再放开其他任何一项
              sandbox="allow-same-origin"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

/** 窗口宽度：`computeLayout` 的断点看的是窗口，不是正文区 */
function useWindowWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth)
  useEffect(() => {
    const onResize = (): void => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return width
}
```

- [ ] **Step 3: 把阅读器接到 App 最外层**

`src/App.tsx` 改成：

```tsx
import { useState } from 'react'
import { TitleBar } from './shell/TitleBar'
import { Sidebar, type PageId } from './shell/Sidebar'
import { LibraryPage } from './pages/LibraryPage'
import { NotesPage } from './pages/NotesPage'
import { SettingsPage } from './pages/SettingsPage'
import { ReaderPage } from './features/reader/ReaderPage'
import './styles/base.css'

const TITLES: Record<PageId, string> = {
  library: '书架',
  notes: '笔记',
  settings: '设置'
}

export default function App() {
  const [page, setPage] = useState<PageId>('library')
  const [reading, setReading] = useState<string | null>(null)

  // 阅读器是沉浸式全屏（spec §4.1），它自带标题栏与返回入口，不叠在外壳里
  if (reading) return <ReaderPage bookId={reading} onExit={() => setReading(null)} />

  return (
    <div className="app">
      <TitleBar title={TITLES[page]} />
      <div className="body">
        <Sidebar current={page} onSelect={setPage} />
        <main className="content">
          {page === 'library' && <LibraryPage onOpen={setReading} />}
          {page === 'notes' && <NotesPage />}
          {page === 'settings' && <SettingsPage />}
        </main>
      </div>
    </div>
  )
}
```

退出阅读器时 `LibraryPage` 会重新挂载并重新拉列表，`last_opened_at` 的变化自然反映出来——不需要额外的刷新信号。

- [ ] **Step 4: 给每本书加「打开」**

`src/features/library/BookList.tsx` 的签名与列表项改成（其余部分不动）：

```tsx
export function BookList({
  books,
  onOpen,
  onRemove
}: {
  books: BookSummary[]
  onOpen: (id: string) => void
  onRemove: (id: string) => void
}) {
```

每个 `<li>` 里，把书名和元信息包在一个按钮里，让整块可点：

```tsx
          <button type="button" className="book-list__open" onClick={() => onOpen(book.id)}>
            <span className="book-list__title">{book.title}</span>
            <span className="book-list__meta">
              {book.author ?? '未知作者'} · {book.chapterCount} 章 ·{' '}
              {Math.round(book.totalChars / 1000)}k 字
            </span>
          </button>
          <button type="button" className="btn" onClick={() => onOpen(book.id)}>
            打开
          </button>
```

`onOpen` 写在两处是刻意的：整块可点符合桌面端习惯，「打开」按钮则是可被测试与朗读定位的明确标签。

- [ ] **Step 5: 书架页把 onOpen 透传下去**

`src/pages/LibraryPage.tsx` 的签名与 `BookList` 调用改成：

```tsx
export function LibraryPage({ onOpen }: { onOpen: (id: string) => void }) {
```

```tsx
      <BookList
        books={books}
        onOpen={onOpen}
        onRemove={(id) => {
          void window.api.library.remove(id).then(refresh)
        }}
      />
```

- [ ] **Step 6: 加阅读器样式**

追加到 `src/styles/base.css` 末尾：

```css
.reader {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--shell);
}

.reader__bar {
  flex: 0 0 44px;
  display: flex;
  align-items: center;
  gap: var(--s3);
  padding-right: var(--s3);
  background: var(--shell);
  border-bottom: 1px solid var(--line);
  user-select: none;
  -webkit-app-region: drag;
}

.reader__bar > * {
  -webkit-app-region: no-drag;
}

.reader__title {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.reader__chapter {
  font-size: 13px;
  color: var(--ink-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.reader__spacer {
  flex: 1;
}

.reader__page {
  font-size: 12px;
  color: var(--ink-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.reader__body {
  flex: 1;
  display: flex;
  min-height: 0;
}

.reader__stage {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

/* 纸面：正文区四周的一圈，也是「三层表面」里的内容面 */
.reader__frame {
  background: var(--paper);
  border: 1px solid var(--line);
  box-shadow: var(--shadow-sheet);
  overflow: hidden;
}

.reader__view {
  display: block;
  border: 0;
}

.reader__status {
  margin: 0;
  padding: var(--s6);
  color: var(--ink-muted);
  font-size: 13px;
}

.book-list__open {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.book-list__open:hover .book-list__title {
  color: var(--accent-link);
}
```

- [ ] **Step 7: 加一本长章测试书**

在 `fixtures/make-epub.ts` 末尾追加：

```ts
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
```

- [ ] **Step 8: 写打开书与翻页的 e2e**

`e2e/reader.spec.ts` 末尾追加（文件顶部的 import 补上 `longBookFiles`）：

```ts
/** 从工具条上的「1 / 12」里读出总页数 */
async function readPageCount(win: import('playwright').Page): Promise<number> {
  const text = await win.locator('.reader__page').innerText()
  return Number(text.split('/')[1]!.trim())
}

test('打开一本书：正文渲染出来、能翻页、到边界停在原地', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-page-'))
  const epubPath = join(userDataDir, 'long.epub')
  await writeEpub(epubPath, longBookFiles())

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()
  await win.evaluate((file) => (window as any).api.library.importPath(file), epubPath)

  await win.getByRole('button', { name: '打开' }).click()
  await expect(win.locator('.reader')).toBeVisible()
  await expect(win.locator('.reader__chapter')).toHaveText('第一章 河边')

  // 长章必须跨页，否则这个测试什么也没证明
  const total = await readPageCount(win)
  expect(total).toBeGreaterThan(1)
  await expect(win.locator('.reader__page')).toHaveText(`1 / ${total}`)

  await win.getByRole('button', { name: '下一页' }).click()
  await expect(win.locator('.reader__page')).toHaveText(`2 / ${total}`)

  // 翻页是正文真的位移了：body 的 translateX 变成负的
  const shifted = await win.evaluate(() => {
    const doc = (document.querySelector('iframe') as HTMLIFrameElement).contentDocument!
    return Math.round(new DOMMatrix(getComputedStyle(doc.body).transform).m41)
  })
  expect(shifted).toBeLessThan(0)

  await win.getByRole('button', { name: '上一页' }).click()
  await expect(win.locator('.reader__page')).toHaveText(`1 / ${total}`)
  // 已经是第一页，再往前应该停在原地（换章是 Task 7 的事）
  await win.getByRole('button', { name: '上一页' }).click()
  await expect(win.locator('.reader__page')).toHaveText(`1 / ${total}`)

  // 键盘也要能用
  await win.locator('.reader__stage').click()
  await win.keyboard.press('ArrowRight')
  await expect(win.locator('.reader__page')).toHaveText(`2 / ${total}`)

  await app.close()
})
```

- [ ] **Step 9: 跑类型检查与全部单测**

Run: `npx tsc --noEmit`

Expected: 无错误。

Run: `npm test`

Expected: PASS，全部单测通过（本 Task 不新增单测：分页器与 ReaderPage 都依赖真实 DOM 与布局引擎，只能由 e2e 覆盖）。

- [ ] **Step 10: 跑 e2e**

Run: `npm run e2e -- e2e/reader.spec.ts`

Expected: PASS，2 passed（Task 3 的进度往返 + 本 Task 的翻页）。

若 `total` 是 1，说明分栏没生效——检查 iframe 的宽度是否被设成了 `layout.frameWidth`（不是容器宽度），以及注入样式里 `body` 的 `column-fill` 是不是 `auto`。

- [ ] **Step 11: Commit**

```bash
git add src/features/reader/paginator.ts src/features/reader/ReaderPage.tsx src/App.tsx src/pages/LibraryPage.tsx src/features/library/BookList.tsx src/styles/base.css fixtures/make-epub.ts e2e/reader.spec.ts
git commit -m "feat: 分页器与最小可读阅读器（多栏分页、翻页、键盘、边界停住）"
```

---

### Task 7: 目录、链接拦截与进度

目录只是入口，真正的麻烦是链接：书内的 `<a href>` 如果放行，iframe 会自己导航走，正文当场丢；书外的链接又必须交给系统浏览器，不能让它在我们窗口里打开。

**Files:**
- Create: `src/features/reader/TocPanel.tsx`, `src/features/reader/links.ts`
- Create: `electron/main/ipc/shell.ts`, `tests/links.test.ts`
- Modify: `src/features/reader/ReaderPage.tsx`, `src/styles/base.css`
- Modify: `shared/ipc.ts`, `electron/main/ipc/index.ts`, `electron/preload/index.ts`
- Modify: `e2e/reader.spec.ts`

- [ ] **Step 1: 写失败测试**

新建 `tests/links.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { classifyLink } from '../src/features/reader/links'

const BOOK = '11111111-2222-3333-4444-555555555555'
const BASE = `epub://${BOOK}/OEBPS/text/`

describe('classifyLink', () => {
  it('同文档锚点', () => {
    expect(classifyLink('#note1', BASE, BOOK)).toEqual({ kind: 'anchor', fragment: 'note1' })
  })

  it('同章文件带锚点', () => {
    expect(classifyLink('ch1.xhtml#note1', BASE, BOOK)).toEqual({
      kind: 'chapter',
      entry: 'OEBPS/text/ch1.xhtml',
      fragment: 'note1'
    })
  })

  it('相对路径里的 .. 按 URL 语义化解', () => {
    expect(classifyLink('../images/cover.jpg', BASE, BOOK)).toEqual({
      kind: 'chapter',
      entry: 'OEBPS/images/cover.jpg',
      fragment: ''
    })
    // 走出书目录的路径照样会被解析出来，但它匹配不上任何一章，等于被忽略
    expect(classifyLink('../../secrets.json', BASE, BOOK)).toEqual({
      kind: 'chapter',
      entry: 'secrets.json',
      fragment: ''
    })
  })

  it('百分号转义会解码', () => {
    expect(classifyLink('%E7%AC%AC%E4%B8%80%E7%AB%A0.xhtml', BASE, BOOK)).toEqual({
      kind: 'chapter',
      entry: '第一章.xhtml',
      fragment: ''
    })
  })

  it('外链交给系统浏览器', () => {
    expect(classifyLink('https://example.com/a?b=1', BASE, BOOK)).toEqual({
      kind: 'external',
      url: 'https://example.com/a?b=1'
    })
  })

  it('别的书、别的协议、空链接一律忽略', () => {
    expect(
      classifyLink(`epub://22222222-2222-3333-4444-555555555555/OEBPS/ch1.xhtml`, BASE, BOOK)
    ).toEqual({ kind: 'ignore' })
    expect(classifyLink('file:///etc/passwd', BASE, BOOK)).toEqual({ kind: 'ignore' })
    expect(classifyLink('javascript:alert(1)', BASE, BOOK)).toEqual({ kind: 'ignore' })
    expect(classifyLink('   ', BASE, BOOK)).toEqual({ kind: 'ignore' })
  })
})
```

Note：`javscript:` 之类的危险协议能在这里被判掉，是因为**先分类、再决定要不要交给系统**——白名单在 `classifyLink` 里，不在调用处。

- [ ] **Step 2: 跑测试，确认失败**

Run: `npx vitest run tests/links.test.ts`

Expected: FAIL —— 找不到模块 `../src/features/reader/links`。

- [ ] **Step 3: 写链接分类**

新建 `src/features/reader/links.ts`：

```ts
/** 书内一个 `href` 的去向 */
export type LinkTarget =
  | { kind: 'anchor'; fragment: string }
  | { kind: 'chapter'; entry: string; fragment: string }
  | { kind: 'external'; url: string }
  | { kind: 'ignore' }

/**
 * 判断书内一个 `href` 指向哪里。
 *
 * `base` 必须与注入章节文档的 `<base>` 完全一致（`epub://<bookId>/<本章目录>/`），
 * 这样 `../`、百分号转义、`#fragment` 的语义与浏览器自己的解析结果一致。
 *
 * 为什么标准库能替代主进程的 `resolveEntry`：那一条处理的是 zip entry 名，
 * 语义是「在一棵目录树里往上走」；这一条处理的是 URL，`new URL` 就是权威实现，
 * 而且它天然把 `javascript:` / `file:` 这类协议留在「不认识」那一档。
 */
export function classifyLink(href: string, base: string, bookId: string): LinkTarget {
  const trimmed = href.trim()
  if (trimmed === '') return { kind: 'ignore' }
  if (trimmed.startsWith('#')) return { kind: 'anchor', fragment: trimmed.slice(1) }

  let url: URL
  try {
    url = new URL(trimmed, base)
  } catch {
    return { kind: 'ignore' }
  }

  if (url.protocol === 'http:' || url.protocol === 'https:') {
    return { kind: 'external', url: url.href }
  }
  if (url.protocol !== 'epub:' || url.hostname !== bookId) return { kind: 'ignore' }

  return {
    kind: 'chapter',
    entry: decodeURIComponent(url.pathname.replace(/^\//, '')),
    fragment: url.hash.replace(/^#/, '')
  }
}
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `npx vitest run tests/links.test.ts`

Expected: PASS，6 passed。

- [ ] **Step 5: 加外链通道**

书内点击外链要交给系统浏览器，但渲染进程没有 `shell`。新增一条**经过白名单校验**的通道——只放行 http/https，避免书里塞一个 `file://` 就能把系统叫起来。

新建 `electron/main/ipc/shell.ts`：

```ts
import { ipcMain, shell } from 'electron'
import { CH } from '@shared/ipc'

/**
 * 把外链交给系统浏览器。
 *
 * 只认 http/https：书是外来文件，不该有本事让应用去打开 file:// 或任意自定义协议。
 * 校验不通过就静默返回——书里的链接不值得弹错误框打断阅读。
 */
export function registerShellIpc(): void {
  ipcMain.handle(CH.shellOpenExternal, async (_event, url: string) => {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return
    await shell.openExternal(parsed.href)
  })
}
```

`electron/main/ipc/index.ts` 里加 `import { registerShellIpc } from './shell'`，并在 `registerIpc()` 末尾追加 `registerShellIpc()`。

`shared/ipc.ts` 的 `CH` 追加：

```ts
  shellOpenExternal: 'shell:openExternal',
```

`API_SHAPE` 追加：

```ts
  shell: ['openExternal'],
```

`electron/preload/index.ts` 的 `api` 里追加：

```ts
  shell: {
    openExternal: (url: string): Promise<void> =>
      ipcRenderer.invoke(CH.shellOpenExternal, url)
  },
```

- [ ] **Step 6: 写目录面板**

新建 `src/features/reader/TocPanel.tsx`：

```tsx
import type { ReaderChapter } from '@shared/types'

/**
 * 本书目录（阅读器左栏）。
 *
 * 缩进用 `depth` 而不是树形递归：计划 02 的 `buildChapters` 已经把层级压平并带上了 depth，
 * 这里再建一次树等于把同一件事做两遍。
 *
 * 分组节点（`href` 为空，代表「部/卷」）不可点：它们没有正文可去，
 * 做成可点会让用户点了没反应，比置灰更糟。
 */
export function TocPanel({
  chapters,
  currentId,
  onSelect
}: {
  chapters: ReaderChapter[]
  currentId: number | null
  onSelect: (chapterId: number) => void
}) {
  return (
    <nav className="toc" aria-label="本书目录">
      <ul className="toc__list">
        {chapters.map((chapter) => {
          const grouped = chapter.href === ''
          const reading = chapter.id === currentId
          return (
            <li key={chapter.id}>
              <button
                type="button"
                className={`toc__item${reading ? ' toc__item--active' : ''}${
                  grouped ? ' toc__item--group' : ''
                }`}
                style={{ paddingLeft: 12 + chapter.depth * 12 }}
                aria-current={reading ? 'location' : undefined}
                disabled={grouped}
                onClick={() => onSelect(chapter.id)}
              >
                {chapter.title}
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
```

- [ ] **Step 7: 阅读器接上目录、链接与进度**

`src/features/reader/ReaderPage.tsx` 按下面的顺序改。每一处都给出了替换目标与新代码。

① 导入区追加两行（放在 `./theme` 之后）：

```tsx
import { classifyLink } from './links'
import { TocPanel } from './TocPanel'
```

② `pendingRef` 的类型加上 `fragment`：

```tsx
  /** 新文档载入后要跳到的位置：恢复进度用 cfi，书内锚点用 fragment，往回翻章用 edge */
  const pendingRef = useRef<{ cfi?: string; fragment?: string; edge?: 'end' } | null>(null)
```

③ effect ⑤（新文档就位后再跳位置）的分支改成：

```tsx
    if (pending.cfi) {
      paginator.goToCfi(pending.cfi)
    } else if (pending.edge === 'end') {
      paginator.goToPage(paginator.pages - 1)
    } else if (pending.fragment) {
      // 锚点找不到就停在章首：链接至少把用户带到了对的那一章
      paginator.goToElement(pending.fragment)
    }
```

④ 在 `turn` 之后追加「跳章」「处理链接」「存进度」三块：

```tsx
  const goToChapterById = useCallback(
    (chapterId: number) => {
      const index = readable.findIndex((item) => item.id === chapterId)
      if (index < 0 || index === chapterIndex) return
      pendingRef.current = null
      setChapterIndex(index)
    },
    [readable, chapterIndex]
  )

  /** 处理书内的一次链接点击：内链自己跳，外链交系统，其余忽略 */
  const openLink = useCallback(
    (href: string, currentEntry: string) => {
      if (!book) return
      const target = classifyLink(href, chapterBaseHref(book.id, currentEntry), book.id)

      if (target.kind === 'anchor') {
        paginatorRef.current?.goToElement(target.fragment)
        return
      }
      if (target.kind === 'external') {
        void window.api.shell.openExternal(target.url)
        return
      }
      if (target.kind === 'ignore') return

      const index = readable.findIndex((item) => item.href === target.entry)
      if (index < 0) return
      if (index === chapterIndex) {
        // 同一章里跳锚点：不值得重新载一遍文档
        if (target.fragment) paginatorRef.current?.goToElement(target.fragment)
        return
      }
      pendingRef.current = target.fragment ? { fragment: target.fragment } : null
      setChapterIndex(index)
    },
    [book, readable, chapterIndex]
  )

  /**
   * 落库当前位置。
   *
   * 全书进度按「可读章节数」折算，不按字数 —— 正文没有全量分页统计，
   * 拿字数当分母只会造出一个看着精确、实际是猜的百分比。
   */
  const saveNow = useCallback(() => {
    const paginator = paginatorRef.current
    const chapter = readable[chapterIndex]
    if (!book || !paginator || !chapter) return
    const share = 1 / Math.max(1, readable.length)
    void window.api.reader.saveProgress({
      bookId: book.id,
      cfi: paginator.currentCfi(),
      chapterId: chapter.id,
      percent: Math.min(1, chapterIndex * share + paginator.chapterFraction() * share)
    })
  }, [book, readable, chapterIndex])

  const saveNowRef = useRef(saveNow)
  useEffect(() => {
    saveNowRef.current = saveNow
  }, [saveNow])

  // 翻页/换章后延迟落库：每翻一页写一次 IPC 没有意义
  useEffect(() => {
    if (!book) return
    const timer = window.setTimeout(() => saveNowRef.current(), 600)
    return () => window.clearTimeout(timer)
  }, [book, page, chapterIndex, docVersion])

  // 防抖窗口内直接退出（关窗、Cmd+Q）会丢掉最后一次翻页，所以失焦时补一次
  useEffect(() => {
    const flush = (): void => saveNowRef.current()
    window.addEventListener('blur', flush)
    return () => window.removeEventListener('blur', flush)
  }, [])

  const exit = useCallback(() => {
    saveNow()
    onExit()
  }, [saveNow, onExit])
```

⑤ `onKeyRef` 里的 `Escape` 改成调用 `exit`，并把 `exit` 放进依赖（这个 effect 没有依赖数组，每次渲染都会刷新闭包，所以照写即可）：

```tsx
      } else if (event.key === 'Escape') {
        event.preventDefault()
        exit()
      }
```

⑥ 在「键盘要在两个文档上都听」那段之前，追加点击拦截：

```tsx
  /**
   * 拦下正文里的每一次链接点击。
   *
   * 放行就等于让 iframe 自己导航走 —— 正文当场丢失，而且会把远程页面装进我们的窗口。
   * 注意这里不能用 `instanceof Element`：事件对象来自 iframe 的 realm，
   * 跨 realm 的 instanceof 恒为 false，只能按方法是否存在来判。
   */
  useEffect(() => {
    const doc = iframeRef.current?.contentDocument
    const currentEntry = readable[chapterIndex]?.href
    if (!doc || !currentEntry) return

    const handler = (event: Event): void => {
      const node = event.target as { closest?: (selector: string) => Element | null } | null
      const href = node?.closest?.('a[href]')?.getAttribute('href')
      if (!href) return
      event.preventDefault()
      openLink(href, currentEntry)
    }

    doc.addEventListener('click', handler)
    return () => doc.removeEventListener('click', handler)
  }, [docVersion, readable, chapterIndex, openLink])
```

⑦ JSX：返回按钮改调 `exit`，并把目录放进正文左侧。

```tsx
        <button type="button" className="btn" onClick={exit}>
          返回书架
        </button>
```

```tsx
      <div className="reader__body">
        <TocPanel
          chapters={book?.chapters ?? []}
          currentId={readable[chapterIndex]?.id ?? null}
          onSelect={goToChapterById}
        />
        <div className="reader__stage" ref={stageRef}>
```

- [ ] **Step 8: 加目录样式**

追加到 `src/styles/base.css` 末尾：

```css
.toc {
  flex: 0 0 248px;
  background: var(--panel);
  border-right: 1px solid var(--line);
  padding: var(--s2) 0;
  overflow-y: auto;
}

.toc__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

/* 左内边距由组件按 depth 内联给，这里的 12px 只是兜底 */
.toc__item {
  display: block;
  width: 100%;
  min-height: 30px;
  padding: 6px 12px;
  border: 0;
  background: none;
  color: var(--ink);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.toc__item:hover:not(:disabled) {
  background: var(--hover);
}

.toc__item--active {
  background: var(--active);
  font-weight: 600;
}

.toc__item--group {
  color: var(--ink-muted);
  font-size: 12px;
  font-weight: 600;
  cursor: default;
}
```

- [ ] **Step 9: 写换章与进度恢复的 e2e**

`e2e/reader.spec.ts` 末尾追加：

```ts
test('目录换章、翻到章尾进下一章，进度在重启后仍在', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-resume-'))
  const epubPath = join(userDataDir, 'long.epub')
  await writeEpub(epubPath, longBookFiles())

  let app = await launchAppWithUserData(userDataDir)
  let win = await app.firstWindow()
  await win.evaluate((file) => (window as any).api.library.importPath(file), epubPath)
  await win.getByRole('button', { name: '打开' }).click()
  await expect(win.locator('.reader__chapter')).toHaveText('第一章 河边')

  // 目录换章：第二章只有一页
  await win.getByRole('button', { name: '第二章 夏夜' }).click()
  await expect(win.locator('.reader__chapter')).toHaveText('第二章 夏夜')
  await expect(win.locator('.reader__page')).toHaveText('1 / 1')

  // 回到第一章，翻到第 2 页
  await win.getByRole('button', { name: '第一章 河边' }).click()
  await expect(win.locator('.reader__chapter')).toHaveText('第一章 河边')
  await win.getByRole('button', { name: '下一页' }).click()
  const total = await readPageCount(win)
  await expect(win.locator('.reader__page')).toHaveText(`2 / ${total}`)

  // 翻到章尾再往前翻，应该进第二章
  for (let index = 2; index < total; index += 1) {
    await win.getByRole('button', { name: '下一页' }).click()
  }
  await expect(win.locator('.reader__page')).toHaveText(`${total} / ${total}`)
  await win.getByRole('button', { name: '下一页' }).click()
  await expect(win.locator('.reader__chapter')).toHaveText('第二章 夏夜')

  // 往回翻也应该回到第一章的最后一页
  await win.getByRole('button', { name: '上一页' }).click()
  await expect(win.locator('.reader__chapter')).toHaveText('第一章 河边')
  await expect(win.locator('.reader__page')).toHaveText(`${total} / ${total}`)

  // 停在第 2 页，等防抖落库后退出
  await win.getByRole('button', { name: '上一页' }).click()
  await win.getByRole('button', { name: '上一页' }).click()
  await expect(win.locator('.reader__page')).toHaveText('2 / ' + total)
  await win.waitForTimeout(900)
  await win.getByRole('button', { name: '返回书架' }).click()
  await expect(win.locator('.reader')).toBeHidden()

  // 重启：位置必须还在第一章第 2 页
  await app.close()
  app = await launchAppWithUserData(userDataDir)
  win = await app.firstWindow()
  await win.getByRole('button', { name: '打开' }).click()
  await expect(win.locator('.reader__chapter')).toHaveText('第一章 河边')
  await expect(win.locator('.reader__page')).toHaveText(`2 / ${total}`)

  await app.close()
})
```

`${total} / ${total}` 之外的那一处用了字符串拼接，是为了提醒：`total` 是变量，断言里必须拼进去。

- [ ] **Step 10: 跑单测与 e2e**

Run: `npm test`

Expected: PASS，新增 `links` 6 条。

Run: `npm run e2e -- e2e/reader.spec.ts`

Expected: PASS，3 passed。若「往回翻回到第一章最后一页」失败，检查 `pendingRef` 的 `edge: 'end'` 分支是否真的执行到了 —— 它依赖 effect ⑤ 排在 effect ④ 之后。

- [ ] **Step 11: Commit**

```bash
git add src/features/reader/TocPanel.tsx src/features/reader/links.ts src/features/reader/ReaderPage.tsx src/styles/base.css shared/ipc.ts electron/main/ipc/index.ts electron/main/ipc/shell.ts electron/preload/index.ts tests/links.test.ts e2e/reader.spec.ts
git commit -m "feat: 目录面板、书内链接拦截与阅读进度落库恢复"
```

---

### Task 8: Aa 排版面板、降级明说与安全收尾

前七个 Task 让书能读，这一个让书读得舒服，并把 spec 里两条硬规则落到界面上：**每行字数可调**（§4.4）与**降级必须明说**（§0 硬规则 2，§4.4）。最后用一本带脚本的测试书把 §6.4 的四道锁一次性验穿。

**Files:**
- Create: `src/features/reader/TypographyPanel.tsx`
- Modify: `src/features/reader/ReaderPage.tsx`
- Modify: `src/styles/base.css`
- Modify: `fixtures/make-epub.ts`（追加 `secureFiles()`）
- Modify: `e2e/reader.spec.ts`

- [ ] **Step 1: 写排版面板**

新建 `src/features/reader/TypographyPanel.tsx`：

```tsx
import { PREFS_LIMITS, type ReadingPrefs } from '@shared/types'
import type { ReaderLayout } from './layout'

/**
 * Aa 排版面板。
 *
 * 与设置页的「阅读偏好」共用同一份 `ReadingPrefs`（spec §4.6），所以这里只负责发出增量改动，
 * 落库、夹取、失败回滚都归调用方。
 *
 * 三件事值得说明：
 * 1. 滑块的 min/max/step 全部来自 `PREFS_LIMITS`，与主进程落库时的校验是同一份常量。
 *    两边各写一份，迟早会出现「界面能拖到 60 字、存进去被截成 48」。
 * 2. 「每行字数」是独立控件，不是字号的副产物（spec §4.4）：字号大了想放大、一行太长了想收窄，
 *    是两个不同的诉求。
 * 3. slider 的 value 用 `prefs.*`（用户设定值）而不是 `layout.*`（实际生效值）。
 *    版心宽被窗口压窄时，滑块不该自己滑回去 —— 否则用户会以为是自己拖错了，
 *    实际生效值显示在标签里（`layout.charsPerLine`），降级提示在阅读器条上。
 */
export function TypographyPanel({
  prefs,
  layout,
  onChange,
  onClose
}: {
  prefs: ReadingPrefs
  layout: ReaderLayout
  onChange: (patch: Partial<ReadingPrefs>) => void
  onClose: () => void
}) {
  const [minFontSize, maxFontSize] = PREFS_LIMITS.fontSize
  const [minChars, maxChars] = PREFS_LIMITS.charsPerLine
  const [minLineHeight, maxLineHeight] = PREFS_LIMITS.lineHeight

  return (
    <aside className="typo" aria-label="排版">
      <div className="typo__head">
        <span className="typo__title">排版</span>
        <button type="button" className="btn" onClick={onClose}>
          收起
        </button>
      </div>

      <div className="typo__field">
        <span className="typo__label">字体</span>
        <div className="typo__segment" role="group" aria-label="字体">
          <button
            type="button"
            className={`typo__option${prefs.font === 'serif' ? ' typo__option--on' : ''}`}
            aria-pressed={prefs.font === 'serif'}
            onClick={() => onChange({ font: 'serif' })}
          >
            宋体
          </button>
          <button
            type="button"
            className={`typo__option${prefs.font === 'sans' ? ' typo__option--on' : ''}`}
            aria-pressed={prefs.font === 'sans'}
            onClick={() => onChange({ font: 'sans' })}
          >
            黑体
          </button>
        </div>
      </div>

      <div className="typo__field">
        <label className="typo__label" htmlFor="prefs-fontSize">
          字号 · 实际 {layout.fontSize}
          {layout.fontSizeClamped ? `（设定 ${prefs.fontSize}）` : ''}
        </label>
        <input
          id="prefs-fontSize"
          type="range"
          min={minFontSize}
          max={maxFontSize}
          step={1}
          value={prefs.fontSize}
          onChange={(event) => onChange({ fontSize: Number(event.target.value) })}
        />
      </div>

      <div className="typo__field">
        <label className="typo__label" htmlFor="prefs-charsPerLine">
          每行字数 · 实际 {layout.charsPerLine}
          {layout.clamped ? `（设定 ${prefs.charsPerLine}）` : ''}
        </label>
        <input
          id="prefs-charsPerLine"
          type="range"
          min={minChars}
          max={maxChars}
          step={1}
          value={prefs.charsPerLine}
          onChange={(event) => onChange({ charsPerLine: Number(event.target.value) })}
        />
      </div>

      <div className="typo__field">
        <label className="typo__label" htmlFor="prefs-lineHeight">
          行距 · {prefs.lineHeight}
        </label>
        <input
          id="prefs-lineHeight"
          type="range"
          min={minLineHeight}
          max={maxLineHeight}
          step={0.05}
          value={prefs.lineHeight}
          onChange={(event) => onChange({ lineHeight: Number(event.target.value) })}
        />
      </div>

      <div className="typo__field">
        <span className="typo__label">主题</span>
        <div className="typo__segment" role="group" aria-label="主题">
          <button
            type="button"
            className={`typo__option${prefs.theme === 'light' ? ' typo__option--on' : ''}`}
            aria-pressed={prefs.theme === 'light'}
            onClick={() => onChange({ theme: 'light' })}
          >
            亮
          </button>
          <button
            type="button"
            className={`typo__option${prefs.theme === 'dark' ? ' typo__option--on' : ''}`}
            aria-pressed={prefs.theme === 'dark'}
            onClick={() => onChange({ theme: 'dark' })}
          >
            暗
          </button>
        </div>
      </div>
    </aside>
  )
}
```

`PREFS_LIMITS` 是 `as const`，解构出来是 `readonly [15, 24]` 这类元组，直接喂给 `min` / `max` 即可，不需要再手写一遍数字。

- [ ] **Step 2: 加样式**

追加到 `src/styles/base.css` 末尾：

```css
/* 降级提示条：常驻在工具条下方，不做成可关闭的 toast —— 它是状态，不是事件 */
.reader__degrade {
  margin: 0;
  padding: 6px var(--s3);
  background: var(--panel);
  border-bottom: 1px solid var(--line);
  color: var(--ink-muted);
  font-size: 12px;
}

.typo {
  flex: 0 0 248px;
  display: flex;
  flex-direction: column;
  gap: var(--s4);
  padding: var(--s3);
  background: var(--panel);
  border-left: 1px solid var(--line);
  overflow-y: auto;
}

.typo__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.typo__title {
  font-size: 13px;
  font-weight: 600;
}

.typo__field {
  display: flex;
  flex-direction: column;
  gap: var(--s2);
}

.typo__label {
  font-size: 12px;
  color: var(--ink-muted);
  font-variant-numeric: tabular-nums;
}

.typo__field input[type='range'] {
  width: 100%;
  accent-color: var(--ink);
}

.typo__segment {
  display: flex;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  overflow: hidden;
}

.typo__option {
  flex: 1;
  min-height: 28px;
  border: 0;
  background: none;
  color: var(--ink-muted);
  font-size: 12px;
  cursor: pointer;
}

.typo__option--on {
  background: var(--active);
  color: var(--ink);
  font-weight: 600;
}
```

- [ ] **Step 3: 阅读器接上排版面板与降级提示**

`src/features/reader/ReaderPage.tsx` 按下面五处改。

① 导入区追加一行（放在 `./TocPanel` 之后）：

```tsx
import { TypographyPanel } from './TypographyPanel'
```

② 在 `const [pageCount, setPageCount] = useState(1)` 之后追加一个状态：

```tsx
  const [panelOpen, setPanelOpen] = useState(false)
```

③ 把 Task 7 里那个 `exit` 整块替换成下面这段（含新增的偏好落库）。位置就在原来的 `exit` 定义处：

```tsx
  /** 待落库的偏好改动：拖滑块期间累积，防抖 300ms 后一次写回，不每动一下就发一次 IPC */
  const pendingPrefsRef = useRef<Partial<ReadingPrefs>>({})
  const prefsTimerRef = useRef<number | null>(null)

  const flushPrefs = useCallback((): void => {
    if (prefsTimerRef.current !== null) {
      window.clearTimeout(prefsTimerRef.current)
      prefsTimerRef.current = null
    }
    const patch = pendingPrefsRef.current
    pendingPrefsRef.current = {}
    if (Object.keys(patch).length === 0) return
    // 主进程会夹取区间，它回传的才是权威值（滑块的 min/max 只是 UI 约束，不是保证）
    void window.api.settings.setPrefs(patch).then((saved) => {
      // 落库期间用户又动了滑块：以他的新值为准，别把滑块拽回去
      if (Object.keys(pendingPrefsRef.current).length === 0) setPrefs(saved)
    })
  }, [])

  const applyPrefs = useCallback(
    (patch: Partial<ReadingPrefs>): void => {
      // 乐观更新：拖滑块必须跟手，等 IPC 回来再改会顿
      setPrefs((current) => (current ? { ...current, ...patch } : current))
      pendingPrefsRef.current = { ...pendingPrefsRef.current, ...patch }
      if (prefsTimerRef.current !== null) window.clearTimeout(prefsTimerRef.current)
      prefsTimerRef.current = window.setTimeout(flushPrefs, 300)
    },
    [flushPrefs]
  )

  /**
   * 退出前把偏好与阅读位置都补一次。
   *
   * 两者都是防抖写库，用户改完字号立刻按返回（或直接关窗）会落在防抖窗口里，
   * 不补这一次就白改了。
   */
  const exit = useCallback(() => {
    flushPrefs()
    saveNow()
    onExit()
  }, [flushPrefs, saveNow, onExit])
```

④ 在「防抖窗口内直接退出（关窗、Cmd+Q）会丢掉最后一次翻页」那个 effect 之后追加一个卸载兜底：

```tsx
  // 卸载时补一次：防抖窗口内直接关窗，偏好改动不能丢
  useEffect(
    () => () => {
      flushPrefs()
    },
    [flushPrefs]
  )
```

⑤ JSX 三处：工具条加「排版」按钮、工具条下方加降级提示、正文区右侧加面板。

工具条里，把 `下一页` 那个按钮之后补一个按钮：

```tsx
        <button type="button" className="btn" onClick={() => turn(1)}>
          下一页
        </button>
        <button type="button" className="btn" onClick={() => setPanelOpen((open) => !open)}>
          排版
        </button>
```

工具条与 `.reader__body` 之间插入提示条（spec §4.4 的原文口径：**必须明说，不能静默降级**）：

```tsx
      {layout?.clamped && (
        <p className="reader__degrade" role="status">
          窗口宽度只够 {layout.charsPerLine} 字／行，已按上限显示
          {layout.fontSizeClamped && `；字号已从 ${prefs?.fontSize} 降到 ${layout.fontSize} 显示`}
        </p>
      )}
```

`.reader__body` 内部，`</div>` 收掉 `.reader__stage` 之后、`</div>` 收掉 `.reader__body` 之前插入面板：

```tsx
        {panelOpen && prefs && layout && (
          <TypographyPanel
            prefs={prefs}
            layout={layout}
            onChange={applyPrefs}
            onClose={() => setPanelOpen(false)}
          />
        )}
```

用条件渲染而不是 CSS 隐藏：隐藏的元素仍在 DOM 里，`getByLabel('#prefs-fontSize')` 这类选择器会同时命中隐藏的那一份，测试会变得难以理解。

- [ ] **Step 4: 加一本「有脚本、有真图片」的测试书**

在 `fixtures/make-epub.ts` 末尾追加：

```ts
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
```

- [ ] **Step 5: 写安全 e2e**

`e2e/reader.spec.ts` 顶部的 import 行补上 `secureFiles`：

```ts
import { longBookFiles, secureFiles, writeEpub } from '../fixtures/make-epub'
```

在文件末尾追加（含一个共用的探针函数，Step 7 也会用它）：

```ts
/**
 * 从父页面里探一眼章节文档的内部。
 *
 * 能这么读，正是因为 iframe 的 sandbox 里有 allow-same-origin —— 这是**功能前提**
 * （父文档要读它的 DOM 才能分页与画高亮），不是安全让步：脚本仍被 CSP 与摘除挡在门外，
 * 下面每一条断言都在验这一点。
 */
async function readChapterDom(win: import('playwright').Page) {
  return win.evaluate(() => {
    const frame = document.querySelector('iframe.reader__view') as HTMLIFrameElement | null
    const doc = frame?.contentDocument ?? null
    const image = doc?.querySelector('#book-img') as HTMLImageElement | null
    const heading = doc?.querySelector('#book-h') as HTMLElement | null
    return {
      sandbox: frame?.getAttribute('sandbox') ?? null,
      scriptCount: doc ? doc.getElementsByTagName('script').length : -1,
      pwned: (frame?.contentWindow as unknown as { __pwned?: boolean } | null)?.__pwned ?? null,
      bodyPwned: doc?.body?.getAttribute('data-pwned') ?? null,
      imgSrc: image?.getAttribute('src') ?? null,
      imgComplete: image?.complete ?? null,
      imgNaturalWidth: image?.naturalWidth ?? null,
      headingColor: heading ? getComputedStyle(heading).color : null,
      bodyFontSize: doc?.body ? getComputedStyle(doc.body).fontSize : null
    }
  })
}

test('书内脚本一律不执行，书内图片与样式照常生效', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-secure-'))
  const epubPath = join(userDataDir, 'secure.epub')
  await writeEpub(epubPath, secureFiles())

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()
  await win.evaluate((file) => (window as any).api.library.importPath(file), epubPath)

  await win.getByRole('button', { name: '打开' }).click()
  await expect(win.locator('.reader__chapter')).toHaveText('第一章 河边')

  // 图片解码完成是异步的，先等到 complete 再一次性取样
  await win.waitForFunction(() => {
    const frame = document.querySelector('iframe.reader__view') as HTMLIFrameElement | null
    const image = frame?.contentDocument?.querySelector('#book-img') as HTMLImageElement | null
    return image?.complete === true
  })

  const dom = await readChapterDom(win)

  // 四道锁：摘 script 节点 → 文档内 meta CSP → 协议响应头 → iframe sandbox
  expect(dom.sandbox).toBe('allow-same-origin')
  expect(dom.scriptCount).toBe(0)
  expect(dom.pwned).toBeNull()
  expect(dom.bodyPwned).toBeNull()

  // 反面：不能为了安全把书读废 —— 图片要显示、书内样式表要生效
  expect(dom.imgSrc).toBe('images/dot.gif')
  expect(dom.imgComplete).toBe(true)
  expect(dom.imgNaturalWidth).toBe(1)
  expect(dom.headingColor).toBe('rgb(1, 2, 3)')

  await app.close()
})
```

不要断言 `doc.title`：这份文档是按 `application/xhtml+xml` 解析的，XML 文档的 `document.title` 恒为空串，断言它只会得到一个与安全无关的假失败。断言 `scriptCount === 0` 与 `__pwned` 未定义才是真凭据。

- [ ] **Step 6: 写降级提示 e2e**

`e2e/reader.spec.ts` 末尾追加：

```ts
test('窗口变窄时排版降级，界面明说而不是静默处理', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-degrade-'))
  const epubPath = join(userDataDir, 'long.epub')
  await writeEpub(epubPath, longBookFiles())

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()
  await win.evaluate((file) => (window as any).api.library.importPath(file), epubPath)
  await win.getByRole('button', { name: '打开' }).click()
  await expect(win.locator('.reader__chapter')).toHaveText('第一章 河边')

  // 默认 1440 宽：34 字放得下，不该有任何降级提示
  await expect(win.locator('.reader__degrade')).toBeHidden()

  // 900 仍高于 NARROW_WIDTH(840)：只该压「每行字数」，不该降字号。
  // 用 900 而不是贴着 840，是为了躲开 macOS 上窗口边框带来的几像素误差。
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]!.setSize(900, 700)
  })

  const notice = win.locator('.reader__degrade')
  await expect(notice).toBeVisible()
  await expect(notice).toContainText('字／行')
  await expect(notice).not.toContainText('字号已从')

  await app.close()
})
```

- [ ] **Step 7: 写排版面板 e2e（改字号 + 持久化）**

`e2e/reader.spec.ts` 末尾追加：

```ts
test('Aa 面板改字号立刻生效，重进应用后仍然是新值', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-typo-'))
  const epubPath = join(userDataDir, 'long.epub')
  await writeEpub(epubPath, longBookFiles())

  let app = await launchUserData(userDataDir)
  let win = await app.firstWindow()
  await win.evaluate((file) => (window as any).api.library.importPath(file), epubPath)
  await win.getByRole('button', { name: '打开' }).click()
  await expect(win.locator('.reader__chapter')).toHaveText('第一章 河边')

  // 默认字号 19，面板没打开时没有滑块可拖
  expect((await readChapterDom(win)).bodyFontSize).toBe('19px')
  await win.getByRole('button', { name: '排版' }).click()

  // step=1，按一次右键就是 +1
  await win.locator('#prefs-fontSize').focus()
  await win.keyboard.press('ArrowRight')
  await expect.poll(async () => (await readChapterDom(win)).bodyFontSize).toBe('20px')

  // 等过 300ms 的防抖窗口，再退出
  await win.waitForTimeout(500)
  await win.getByRole('button', { name: '返回书架' }).click()
  await expect(win.locator('.reader')).toBeHidden()
  await app.close()

  // 重启：偏好存在 settings 表里，与书无关
  app = await launchUserData(userDataDir)
  win = await app.firstWindow()
  await win.getByRole('button', { name: '打开' }).click()
  await expect(win.locator('.reader__chapter')).toHaveText('第一章 河边')
  await expect.poll(async () => (await readChapterDom(win)).bodyFontSize).toBe('20px')

  await app.close()
})
```

注意这里是 `launchUserData`，不是 Task 6/7 用的 `launchAppWithUserData`——按计划 02 里 `e2e/helpers.ts` 的实际命名填，写的时候对一眼，两处必须一致。

- [ ] **Step 8: 跑单测、类型检查与 e2e**

Run: `npm test`

Expected: PASS（本 Task 不新增单测：面板与降级都是 DOM 行为，只能由 e2e 覆盖）。

Run: `npx tsc --noEmit`

Expected: 无错误。

Run: `npm run e2e -- e2e/reader.spec.ts`

Expected: PASS，6 passed（Task 3 的进度往返 + 翻页 + 目录换章与重启恢复 + 脚本不执行 + 降级提示 + 面板改字号持久化）。

若「脚本不执行」失败在 `scriptCount`，说明 `prepareChapter` 的摘除漏了某个位置（例如只摘了 `body` 下的，没摘 `head` 里的）；若失败在 `naturalWidth`，先确认 CSS 里的 `img { max-width: 100% }` 没有把它压成 0 宽——1×1 的图在 `4rem` 之类尺寸下仍是 1。

- [ ] **Step 9: Commit**

```bash
git add src/features/reader/TypographyPanel.tsx src/features/reader/ReaderPage.tsx src/styles/base.css fixtures/make-epub.ts e2e/reader.spec.ts
git commit -m "feat: Aa 排版面板、排版降级明说与书内脚本不执行的安全验收"
```

---

## Self-Review

### 1. Spec 覆盖表

| spec 章节 | 要求 | 落在哪个 Task |
|---|---|---|
| §2.2 | `reading_progress` 表读写（cfi / chapter_id / percent / updated_at） | Task 3 |
| §2.3 | 密钥不入库、数据层不引入向量库 | 不在本文范围（计划 01 / 05） |
| §3.3 | 不预解压，`epub://<bookId>/<entry>` 按需解压单个 entry | Task 1 |
| §3.3 | 路径前缀校验，拒绝 `..` 穿越；封面例外 | Task 1（`normalizeEntry` + 单测） |
| §3.4 | 单章单 iframe，翻章即换文档 | Task 6（`chapterIndex` → 重新载文档） |
| §3.4 | 分页用 CSS 多栏，不做 JS 逐字测量 | Task 5（`computeLayout`）+ Task 6（`ChapterPaginator` 只量不逐字） |
| §3.4 | 注入 `<style id="reader-theme">`，主题只覆盖阅读相关部分 | Task 5（`buildReaderCss`）+ Task 6（effect ④ 写 `textContent`） |
| §3.4 | 定位用 CFI，不用字符偏移 | Task 3（落库字段）+ Task 6（`currentCfi` / `goToCfi`） |
| §3.4 | 高亮用 CSS Custom Highlight API，不插 `<mark>` | **计划 04**（本文不涉及高亮） |
| §3.4 | iframe 内不引入 Node 能力、不执行书内脚本 | Task 1（CSP + MIME 白名单）+ Task 4（摘 script）+ Task 6（sandbox）+ Task 8（e2e 验证） |
| §3.4 | 渲染库倾向 foliate-js，实现前做技术验证 | 文首「决策记录」：只取 `epubcfi.js`，并给出三条否决整库的理由 |
| §4.1 | 阅读器是沉浸式全屏，不是第四个 tab | Task 6（`App.tsx` 用 `reading` 状态整体替换页面） |
| §4.3 | 面板先退让、正文优先；超上限交给对开双页 | Task 5（`windowWidth` 判对开）+ Task 6（`ResizeObserver` 重排） |
| §4.4 | 每行字数 24–48 独立控件，默认 34 | Task 2（`PREFS_LIMITS` / `clampPrefs`）+ Task 8（面板滑块） |
| §4.4 | 版心宽 = 每行字数 × 字号 | Task 5（`wanted = charsPerLine * fontSize`，并有单测） |
| §4.4 | 降级必须在界面上明说，不许静默 | Task 5（`clamped` / `fontSizeClamped`）+ Task 8（提示条 + e2e） |
| §4.6 | 阅读器 Aa 面板与设置页共用同一份偏好 | Task 2（同一组通道）+ Task 8（`applyPrefs` 走 `settings.setPrefs`） |
| §3.5 | AI 引用回跳：匹配文本定位、失败退化为跳章并明说 | **计划 05**（本文只提供 `goToCfi` / `goToElement` 两个原语） |
| §6.4 | 渲染安全清单 | Task 1 / 4 / 6 / 8（四道锁 + e2e） |
| §6.7 | 验收标准中与阅读相关部分 | Task 6 / 7 / 8 的 e2e |

### 2. 两处有意偏离，都是有理由的

**① `§3.4` 说「iframe 与 React 用 postMessage 通信」，本文改成了「同源 DOM 直接访问」。** 理由写在文首的决策记录里：`script-src 'none'` 是硬约束，而 postMessage 必须由脚本监听；要在 iframe 里放脚本，就得把 `script-src` 放开一条口子，那是拿安全换便利。同源 + sandbox 已经满足「iframe 内不引入 Node 能力、不执行书内脚本」这条真正的要求，所以偏离的只是手段。这不是偷偷改掉的——它写在决策记录里，需要时可以查。

**② `.uicraft.md` 的「窗口 <840 → 侧栏收成 56px 图标栏」在阅读器里不可达。** `electron/main/window.ts` 设了 `minWidth: 840`，所以窗口永远进不了那个区间。但 `computeLayout` 里的窄屏分支**必须保留**：窗口 840 时读者打开 248px 的 Aa 面板，正文区只剩 592，仍然需要压行宽、降字号。也就是说这条断点在阅读器里的真实触发条件是「正文区被面板挤到 840 以下」，而 `layout.ts` 用的是 `windowWidth` 判对开、`containerWidth` 算版心宽，两者分工已经能覆盖这个场景。侧栏本身的收窄属于一级页面的事，留到**计划 06**。

### 3. 占位符扫描

正文里没有 TBD / TODO / 「类似 Task N」/ 「自行补充」/ 「加上适当的错误处理」这类句子。每个 Step 的代码块都是可整段粘贴的完整实现；每个 Run 都写明了期望值，包括失败时先查哪里。

一处例外需要说明：Task 8 Step 7 提到 `launchUserData` 这个 helper 名字要与计划 02 的 `e2e/helpers.ts` 对齐。这是**刻意的**——helper 的权威定义在计划 02，本文引它而不是复制它，避免两处各存一份、改一处忘一处。执行到那一步时打开 `e2e/helpers.ts` 对一眼即可。

### 4. 命名与类型一致性

- `ReaderLayout` 的字段（`columns` / `columnWidth` / `frameWidth` / `pageHeight` / `step` / `fontSize` / `charsPerLine` / `clamped` / `fontSizeClamped`）在 Task 5 定义，Task 6、Task 8 使用，三处名称完全一致。
- `PREFS_LIMITS` / `clampPrefs` / `DEFAULT_PREFS` 在 Task 2 定义，Task 8 的 `TypographyPanel` 直接引用，没有重写一份区间。
- `pendingRef` 的形状在 Task 6 是 `{ cfi?, edge? }`，Task 7 扩成 `{ cfi?, fragment?, edge? }`，Task 8 不再改动。
- `ChapterPaginator` 的方法（`pages` / `page` / `goToPage` / `next` / `prev` / `chapterFraction` / `currentCfi` / `goToCfi` / `goToElement` / `relayout`）在 Task 6 定义，Task 7 的 `openLink` / `goToChapterById` 与 Task 8 都只调这些，没有新方法。
- `CH` 通道名三处同步：`shared/ipc.ts` 定义、`electron/main/ipc/*.ts` 注册、`electron/preload/index.ts` 暴露；`API_SHAPE` 作为 e2e 断言契约在计划 01 的 `boundary.spec.ts` 里逐名比对。

---

## Execution Handoff

**计划完成，已保存到 `docs/superpowers/plans/2026-09-29-03-reader-rendering.md`。两种执行方式：**

**1. Subagent-Driven（推荐）** —— 每个 Task 派一个全新的 subagent，Task 之间我来审查，迭代快、上下文干净。本计划的 Task 之间有明确顺序（1 → 8 层层依赖），很适合一个 Task 一个 subagent。

**2. Inline Execution** —— 在当前会话里按 `executing-plans` 批量执行，到检查点停下来给你看。

注意：本计划是 6 份里的第 3 份，**依赖计划 01 与 02 已经执行完**（尤其是 `CH` / `API_SHAPE` / `preload` 的白名单必须已经落地，否则本计划的每个 e2e 都会失败）。开工前先确认这两份的状态。
