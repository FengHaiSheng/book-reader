# 标注与笔记 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让笔记成为一等公民：划词即标注、批注可编辑、点高亮能改能删、跨书汇总可筛选、右栏当场看原文上下文、导出 Markdown 带预览。

**Architecture:** 标注位置的**真身是 CFI 对**（`start_cfi` / `end_cfi`），永不向正文 DOM 插 `<mark>`——插标签会改动书的结构，已存下来的 CFI 会跟着漂移（spec §3.4）。书内高亮用 CSS Custom Highlight API 在章节文档的 Window 上注册 Range，视觉上等价于 `background-color`，结构上零改动。落库、跨书汇总、上下文匹配、Markdown 生成全在主进程；渲染进程只拿数据、只做筛选与分组这类纯计算。笔记页是不依赖阅读器的独立三栏页面，右栏的上下文在**本章的 chunk 里就地匹配**，不解析全书。

**Tech Stack:** Electron / React / TypeScript / better-sqlite3 / foliate-js(`epubcfi.js`) / vitest / Playwright

**Spec:** [2026-09-29-book-reader-design.md](../specs/2026-09-29-book-reader-design.md)

参考计划：[01 应用骨架与数据层](./2026-09-29-01-app-shell-and-data-layer.md) · [02 epub 导入管线](./2026-09-29-02-epub-import-pipeline.md) · [03 阅读器渲染](./2026-09-29-03-reader-rendering.md)

---

## Prerequisites

本计划是 6 份里的第 4 份，**依赖计划 01–03 已经执行完**。开工前先确认：

1. `npm test` 全绿，`npm run e2e` 全绿。
2. `shared/ipc.ts` 的 `CH` 里已有 `settingsGetPrefs` / `readerOpen` / `readerSaveProgress`；`API_SHAPE` 里已有 `settings` / `secrets` / `library` / `reader`。
3. `src/features/reader/paginator.ts` 里的 `localParts` 目前是 private 方法。

**会碰到计划 03 产物的两处改动（预期内，不是返工）：**

- Task 1 把 `ChapterPaginator.localParts` 抽成 `cfi.ts` 里的公共函数——计划 05 的引用回跳也要用它，留在 class 的 private 里没法共用。
- Task 5 给 `ReaderPage` 增加 `target` prop、把 `App.tsx` 的 `reading` 状态从 `string | null` 换成 `ReadingTarget | null`——「从笔记回到原文」必须能指定落点。

**git 身份**：如果计划 01 执行时没配过，先 `git config user.name` / `git config user.email`，否则本计划每个 commit 都会失败。

---

## 计划拆分说明

| 计划 | 内容 | 交付物 |
|---|---|---|
| 01–03 | 骨架与数据层 / 导入管线 / 阅读器渲染 | 能读书 |
| **04（本文）** | 标注、批注、笔记页、导出 Markdown | 能划词、写笔记、跨书汇总、导出 |
| 05 | AI 能力层 | 能问 AI：Provider、降级、检索、任务、引用回跳 |
| 06 | 书架完善与打包 | 能装给别人用：网格/列表、标签、导出数据、签名打包 |

本计划**有意不做**的三件事（都在 `design/mockups/notes.html` 里出现过，但不属于 spec §4.5 的范围）：

1. **笔记搜索框**——spec §4.5 没提，且需要先定「搜高亮文本 / 批注 / 章节名」的口径，留给后续版本。
2. **排序控件（按书中位置 / 按添加时间）**——本计划固定按「最近加入的书在前，书内按章节顺序」。多一个下拉只增加状态，不增加能力。
3. **每本书拆成独立文件导出**——一次导出成一个 `.md`，按书分节。多文件导出要先定目录选择与命名规则，不值得在这一期承担。

分组头的**封面缩略图**也不做：真实封面渲染归计划 06（spec §4.5 的「按真实装帧渲染」），这里只放书名与条数，避免先画一个假占位再换掉。

---

## File Structure

新增文件与各自职责：

```
shared/
  highlights.ts                    # 高亮配色枚举、中文标签、注册名、长度上限、纯校验
electron/main/notes/
  context.ts                       # 在章节正文里定位选中文本并切出前后文（纯函数，可单测）
  repo.ts                          # highlights 的全部 SQL：本章读写、跨书汇总、上下文原料
  export.ts                        # 高亮 → Markdown（纯函数，可单测）
electron/main/ipc/
  notes.ts                         # notes:* 全部 handler
src/features/reader/
  cfi.ts                           # 选区 ↔ CFI 对、CFI 对 ↔ Range、命中判定（共用）
  highlights.ts                    # 把高亮注册进章节文档的 CSS.highlights
  SelectionToolbar.tsx             # 划词浮条
  HighlightPopover.tsx             # 点已有高亮：改色 / 写批注 / 删除
src/features/notes/
  group.ts                         # 筛选、分组、计数（纯函数，可单测）
  NotesFilters.tsx                 # 左栏：类型 + 按书（含计数）
  NoteCard.tsx                     # 单条笔记卡
  NoteContextPanel.tsx             # 右栏：原文上下文 + 回到原文 / 复制
  ExportPopover.tsx                # 导出浮层（含预览）
tests/
  highlights.test.ts               # 配色、上限、注册名、选区文本归一
  notes-context.test.ts            # locate / sliceContext
  notes-export.test.ts             # buildMarkdown
  notes-group.test.ts              # applyFilter / groupByBook / 计数 / 选中项兜底
e2e/
  highlight.spec.ts                # 划词建高亮、不插 mark、改色、写批注、点高亮
  notes.spec.ts                    # 跨书汇总、类型筛选、右栏上下文、回到原文
  export.spec.ts                   # 预览内容、真写到文件
```

需要修改的既有文件：

```
shared/types.ts                    # 追加 Highlight 系与 ReadingTarget
shared/ipc.ts                      # 追加 notes 通道与 API_SHAPE.notes
electron/main/ipc/index.ts         # 注册 notes handler
electron/preload/index.ts          # 追加 notes 白名单
src/features/reader/paginator.ts   # localParts 改为从 ./cfi 导入
src/features/reader/theme.ts       # 追加 ::highlight() 配色规则
src/features/reader/ReaderPage.tsx # 划词、浮条、高亮渲染、点高亮、target 落点
src/shell/TitleBar.tsx             # 加 #titlebar-tools 槽位，给导出浮层用 portal 挂进来
src/App.tsx                        # reading 换成 ReadingTarget；笔记页接「回到原文」
src/pages/NotesPage.tsx            # 由占位换成三栏
src/styles/base.css                # 浮条、popover、笔记页三栏样式
```

---

### Task 1: 高亮配色契约与 CFI 工具

把「CFI 怎么算」集中到一个模块。计划 03 已经在 `ChapterPaginator` 里写过一遍 `localParts`，这里把它抽出来共用，顺便让 `localParts` 的逻辑只有一份。

**Files:**
- Create: `shared/highlights.ts`, `src/features/reader/cfi.ts`, `tests/highlights.test.ts`
- Modify: `src/features/reader/paginator.ts`

- [ ] **Step 1: 写配色契约**

`shared/highlights.ts`：

```ts
/**
 * 高亮底色只有这四种，与 .uicraft.md 的 `--hl-*` 一一对应。
 * 顺序即界面上色点的顺序。
 */
export const HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink'] as const

export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number]

export const DEFAULT_HIGHLIGHT_COLOR: HighlightColor = 'yellow'

/** 色点的无障碍标签与 tooltip */
export const HIGHLIGHT_COLOR_LABELS: Record<HighlightColor, string> = {
  yellow: '黄',
  green: '绿',
  blue: '蓝',
  pink: '粉'
}

/**
 * 一次标注最多 2000 字。
 * 「全选整章」是真实会发生的手势，若不管，highlights 表里会躺进一条真的没有意义的数据。
 */
export const MAX_HIGHLIGHT_CHARS = 2000

/** 批注上限。一万字足够写读书笔记，再长就该去写文档了 */
export const MAX_NOTE_CHARS = 10000

/**
 * 注册进 `CSS.highlights` 的名字。
 *
 * 它和注入样式里的 `::highlight(名字)` 是一对契约，两处必须同时改，
 * 所以放在这里由双方 import，而不是各自写一遍字符串。
 */
export function highlightRegistryName(color: HighlightColor): string {
  return `hl-${color}`
}

export function isHighlightColor(value: unknown): value is HighlightColor {
  return typeof value === 'string' && (HIGHLIGHT_COLORS as readonly string[]).includes(value)
}

/** 渲染进程与主进程都挡一次：非法颜色落回默认色，不抛错也不写脏数据 */
export function normalizeColor(value: unknown): HighlightColor {
  return isHighlightColor(value) ? value : DEFAULT_HIGHLIGHT_COLOR
}

/** 选中文本入库前压掉空白：跨段的选区里全是换行与缩进，留着只会拖累检索与匹配 */
export function normalizeSpan(text: string): string {
  return text.replace(/[\s\u3000]+/g, ' ').trim()
}

/** 批注：空串与纯空白都算「没有批注」，统一成 null，筛选才有一个明确的口径 */
export function normalizeNote(text: string | null | undefined): string | null {
  if (text == null) return null
  const trimmed = text.replace(/\r\n/g, '\n').trim()
  return trimmed === '' ? null : trimmed.slice(0, MAX_NOTE_CHARS)
}
```

- [ ] **Step 2: 写失败的测试**

`tests/highlights.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import {
  HIGHLIGHT_COLORS,
  MAX_NOTE_CHARS,
  highlightRegistryName,
  isHighlightColor,
  normalizeColor,
  normalizeNote,
  normalizeSpan
} from '../shared/highlights'

describe('highlightRegistryName', () => {
  it('四种颜色各有一个稳定名字，且不与 UI 的 CSS 类重名', () => {
    expect(HIGHLIGHT_COLORS.map(highlightRegistryName)).toEqual([
      'hl-yellow',
      'hl-green',
      'hl-blue',
      'hl-pink'
    ])
  })
})

describe('normalizeColor', () => {
  it('合法颜色原样返回', () => {
    expect(normalizeColor('pink')).toBe('pink')
  })

  it('非法值与缺失都落回默认色，不抛错', () => {
    expect(normalizeColor('red')).toBe('yellow')
    expect(normalizeColor(undefined)).toBe('yellow')
    expect(normalizeColor(7)).toBe('yellow')
  })

  it('isHighlightColor 只认这四种', () => {
    expect(isHighlightColor('green')).toBe(true)
    expect(isHighlightColor('Green')).toBe(false)
  })
})

describe('normalizeSpan', () => {
  it('换行与全角空格压成单个半角空格', () => {
    expect(normalizeSpan('  月色沉入\n河底\u3000量子纠缠  ')).toBe('月色沉入 河底 量子纠缠')
  })
})

describe('normalizeNote', () => {
  it('空白批注等同没有批注', () => {
    expect(normalizeNote('   \n  ')).toBeNull()
    expect(normalizeNote(null)).toBeNull()
    expect(normalizeNote(undefined)).toBeNull()
  })

  it('保留换行，去掉首尾空白，超长截断', () => {
    expect(normalizeNote('  第一行\n第二行  ')).toBe('第一行\n第二行')
    expect(normalizeNote('字'.repeat(MAX_NOTE_CHARS + 50))).toHaveLength(MAX_NOTE_CHARS)
  })
})
```

- [ ] **Step 3: 跑它，确认通过**

Run: `npx vitest run tests/highlights.test.ts`

Expected: PASS，8 passed。若 `MAX_NOTE_CHARS` 那两条红了，检查 `normalizeNote` 是先 trim 还是先 slice。

- [ ] **Step 4: 写 CFI 工具**

`src/features/reader/cfi.ts`：

```ts
import { fake, fromRange, joinIndir, parse, toRange, type CfiPart } from 'foliate-js/epubcfi.js'
import { MAX_HIGHLIGHT_CHARS, normalizeSpan } from '@shared/highlights'

/** 一段标注的 CFI 对，与 highlights 表的 start_cfi / end_cfi 一一对应 */
export type CfiSpan = {
  startCfi: string
  endCfi: string
  text: string
}

/**
 * CFI 可能带 `!`（spine 段）也可能是区间；这里只取「本章文档内」的那一段。
 *
 * 不能把 `parse` 的完整结果交给 `toRange`：它会拿 `/6/2` 去章节文档里找节点，必然定位失败。
 */
export function localParts(cfi: string): CfiPart[][] | null {
  try {
    const parsed = parse(cfi)
    const indirection = Array.isArray(parsed) ? parsed : parsed.start
    const local = indirection[indirection.length - 1]
    return local ? [local] : null
  } catch {
    return null
  }
}

/** 文档里的一个点 → 带 spine 段的 CFI */
export function pointCfi(doc: Document, node: Node, offset: number, spineIndex: number): string {
  const range = doc.createRange()
  range.setStart(node, offset)
  range.collapse(true)
  return joinIndir(fake.fromIndex(spineIndex), fromRange(range))
}

/**
 * 选区 → CFI 对。
 *
 * 这里**不**检查长度上限：选太长的提示要由界面明说（spec 的「降级要明说」），
 * 静默返回 null 会让用户以为选中失效了。上限由 `MAX_HIGHLIGHT_CHARS` 在调用处判。
 */
export function spanFromSelection(doc: Document, range: Range, spineIndex: number): CfiSpan | null {
  const text = normalizeSpan(range.toString())
  if (text === '') return null
  return {
    startCfi: pointCfi(doc, range.startContainer, range.startOffset, spineIndex),
    endCfi: pointCfi(doc, range.endContainer, range.endOffset, spineIndex),
    text
  }
}

/** CFI 对 → 本章文档里的 Range；任一端定位不到就返回 null，由调用方兜底 */
export function rangeFromSpan(doc: Document, startCfi: string, endCfi: string): Range | null {
  const startParts = localParts(startCfi)
  const endParts = localParts(endCfi)
  if (!startParts || !endParts) return null
  try {
    const start = toRange(doc, startParts)
    const end = toRange(doc, endParts)
    const range = doc.createRange()
    range.setStart(start.startContainer, start.startOffset)
    range.setEnd(end.startContainer, end.startOffset)
    return range
  } catch {
    return null
  }
}

/** 一个点是否落在某段区间里。用于「点已有高亮」——区间不是元素，挂不了事件，只能反着问 */
export function containsPoint(
  doc: Document,
  span: { startCfi: string; endCfi: string },
  node: Node,
  offset: number
): boolean {
  const range = rangeFromSpan(doc, span.startCfi, span.endCfi)
  if (!range) return false
  try {
    return range.isPointInRange(node, offset)
  } catch {
    // 节点已被换章/重排移除时 isPointInRange 会抛，按「不在区间里」处理
    return false
  }
}

/**
 * 选区的第一行矩形，给浮条当锚点。
 *
 * 分栏之后一个跨栏选区会有一串矩形，取第一个即可 —— 浮条跟着选区的起头走，
 * 比取整个选区的中心更符合直觉，也不会因为跨页而飘到正文区外面。
 */
export function anchorOf(range: Range): { x: number; y: number } | null {
  const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 || rect.height > 0)
  const first = rects[0]
  if (!first) return null
  return { x: first.left + first.width / 2, y: first.top }
}

export { MAX_HIGHLIGHT_CHARS }
```

- [ ] **Step 5: 改 `ChapterPaginator` 复用 `pointCfi` / `localParts`**

`src/features/reader/paginator.ts` 四处改动：

① 顶部 import 换成（`parse` / `fake` / `fromRange` / `joinIndir` 都不再直接需要，`CfiPart` 也不再需要——`localParts` 搬走了）：

```ts
import { toRange } from 'foliate-js/epubcfi.js'
import type { ReaderLayout } from './layout'
import { localParts, pointCfi } from './cfi'
```

② `currentCfi()` 改成：

```ts
  currentCfi(): string {
    const range = this.pageStartRange()
    return pointCfi(this.doc, range.startContainer, range.startOffset, this.spineIndex)
  }
```

③ 删掉整个 `private localParts(cfi: string)` 方法（连同它上面那两行注释）。

④ `goToCfi` 里的 `this.localParts(cfi)` 改成 `localParts(cfi)`。

- [ ] **Step 6: 类型检查与全量单测**

Run: `npx tsc --noEmit && npm test`

Expected: 无类型错误；单测总数 = 计划 01–03 的数量 + 8。若 `paginator.ts` 报「未使用的导入 `toRange`」，说明 `goToCfi` 里被误删了，那里仍然需要它。

- [ ] **Step 7: 跑一遍阅读器 e2e，确认翻页与进度没被改坏**

Run: `npm run e2e -- e2e/reader.spec.ts`

Expected: PASS。`currentCfi` 的取值路径变了但语义没变；若报「进度读回来是 null」，先把 `currentCfi()` 的输出 `console.log` 出来，与改动前逐字比对——CFI 只要差一个字符，`goToCfi` 就会定位失败。

- [ ] **Step 8: Commit**

```bash
git add shared/highlights.ts src/features/reader/cfi.ts src/features/reader/paginator.ts tests/highlights.test.ts
git commit -m "feat: 高亮配色契约与 CFI 工具（选区取词、区间还原、命中判定）"
```

---

### Task 2: 标注仓储与上下文切片

**Files:**
- Create: `electron/main/notes/context.ts`, `electron/main/notes/repo.ts`, `tests/notes-context.test.ts`
- Modify: `shared/types.ts`

- [ ] **Step 1: 加类型**

`shared/types.ts` 追加（`ReadingTarget` 在 Task 5 用，一起写上省得再改一次文件）：

```ts
import type { HighlightColor } from './highlights'

export type Highlight = {
  id: number
  bookId: string
  chapterId: number | null
  startCfi: string
  endCfi: string
  /** 标注时的选中原文 */
  text: string
  /** 批注；null 表示只划了线没写批注 */
  note: string | null
  color: HighlightColor
  createdAt: number
  updatedAt: number
}

export type HighlightInput = {
  bookId: string
  chapterId: number | null
  startCfi: string
  endCfi: string
  text: string
  note?: string | null
  color?: HighlightColor
}

/** 只允许改这两项。位置与原文是既成事实，改位置等于重新标注 */
export type HighlightPatch = {
  note?: string | null
  color?: HighlightColor
}

/** 跨书汇总用：多带书名、章节名与在全书的相对位置 */
export type HighlightWithBook = Highlight & {
  bookTitle: string
  chapterTitle: string | null
  /** 0–1，按「本章是可读章节里的第几章」折算，与阅读器的进度同一口径 */
  percent: number
}

/** 右栏的原文上下文 */
export type HighlightContext = {
  /** 是否在章节正文里重新定位到了这段文字 */
  located: boolean
  chapterTitle: string | null
  before: string
  /** 命中处的原文；located 为 false 时是库里存的那一份 */
  matched: string
  after: string
}

/** 阅读落点：从书架进来只有 bookId，从笔记「回到原文」进来带章节与位置 */
export type ReadingTarget = {
  bookId: string
  /** 指定时优先于上次进度 */
  chapterId: number | null
  /** 仅当 chapterId 不为 null 时有意义 */
  cfi: string | null
}

export type NotesExportOptions = {
  includeNotes: boolean
  includeLocation: boolean
  includeContext: boolean
}

export type NotesExportPreview = {
  markdown: string
  total: number
  /** 附上下文时，没能在chapter 正文里重新定位到的条数 —— 界面要明说 */
  unlocated: number
}
```

- [ ] **Step 2: 写上下文切片的失败测试**

`tests/notes-context.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { CONTEXT_RADIUS, locate, sliceContext } from '../electron/main/notes/context'

const CHAPTER = [
  '那种安静，他后来很少遇到了。现在他读电子书，手机就搁在右手边，屏幕朝下，但他知道它在。',
  '不是有什么必须处理的事情，只是那个动作本身已经长进了肌肉里。',
  '要把它拔出来，得费些力气。'
].join('\n')

describe('locate', () => {
  it('直接命中，返回原文坐标', () => {
    const span = locate(CHAPTER, '那个动作本身')
    expect(span).not.toBeNull()
    expect(CHAPTER.slice(span!.start, span!.end)).toBe('那个动作本身')
  })

  it('选中的文本带了换行与缩进，也能在正文里找到', () => {
    const span = locate(CHAPTER, '长进了肌肉里。\n  要把它拔出来')
    expect(span).not.toBeNull()
    expect(CHAPTER.slice(span!.start, span!.end)).toContain('要把它拔出来')
  })

  it('找不到与空串都返回 null', () => {
    expect(locate(CHAPTER, '这句话不在这一章里')).toBeNull()
    expect(locate(CHAPTER, '   ')).toBeNull()
    expect(locate(CHAPTER, '')).toBeNull()
  })
})

describe('sliceContext', () => {
  it('命中处给前后各一段，matched 是原文而不是查询串', () => {
    const slice = sliceContext(CHAPTER, '不是有什么必须处理的事情')
    expect(slice).not.toBeNull()
    expect(slice!.matched).toBe('不是有什么必须处理的事情')
    expect(slice!.before).toContain('那种安静')
    expect(slice!.after).toContain('要把它拔出来')
  })

  it('命中在文首时 before 是空串，不返回 undefined', () => {
    const slice = sliceContext(CHAPTER, '那种安静')
    expect(slice!.before).toBe('')
  })

  it('半径可调，取小值就只留一小截', () => {
    const slice = sliceContext(CHAPTER, '那个动作本身', 4)
    expect(slice!.before).toBe('只是')
    expect(slice!.after).toBe('已经长')
  })

  it('找不到返回 null', () => {
    expect(sliceContext(CHAPTER, '不存在的句子')).toBeNull()
  })

  it('默认半径是一个正数常量', () => {
    expect(CONTEXT_RADIUS).toBeGreaterThan(0)
  })
})
```

第 3 条测试里的 `before === '只是'` 是算出来的：命中点前 4 个字是「只是」，不是猜的。实现写完先跑一次，不符就核对半径是否按**字符**而不是按字节切。

- [ ] **Step 3: 写上下文切片**

`electron/main/notes/context.ts`：

```ts
export type ContextSlice = {
  before: string
  matched: string
  after: string
}

/** 命中处前后各取 160 字，大约是两三句，够判断这条笔记要不要留 */
export const CONTEXT_RADIUS = 160

export type Span = { start: number; end: number }

/**
 * 在章节正文里找一段选中的文字，返回它在正文里的真实坐标。
 *
 * 为什么不直接 `indexOf`：用户选中的文本跨段时带换行与缩进，与正文里的排布不完全一致；
 * chunk 是按 token 聚合的，段与段的接缝处还可能多一个空格。
 * 所以先两边都去掉空白再找，然后靠一张「去空白坐标 → 原文坐标」的表映射回去 ——
 * 这样返回的坐标能直接拿去切原文，切出来的是真正的那句话。
 */
export function locate(text: string, needle: string): Span | null {
  const target = needle.replace(/\s+/g, '')
  if (target === '') return null

  const map: number[] = []
  let flat = ''
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === undefined || /\s/.test(char)) continue
    flat += char
    map.push(i)
  }

  const at = flat.indexOf(target)
  if (at < 0) return null
  const start = map[at]
  const end = map[at + target.length - 1]
  if (start === undefined || end === undefined) return null
  return { start, end: end + 1 }
}

/**
 * 切出「命中处 + 前后各一段」。
 *
 * 定位失败返回 null —— 不做「假装成功」的兜底。跨 chunk 接缝的句子确实可能找不到，
 * 那时调用方明说「没能在本章正文里定位到这段文字」，比给一段不相干的上下文好。
 */
export function sliceContext(text: string, needle: string, radius = CONTEXT_RADIUS): ContextSlice | null {
  const span = locate(text, needle)
  if (!span) return null
  const start = Math.max(0, span.start - radius)
  const end = Math.min(text.length, span.end + radius)
  return {
    before: text.slice(start, span.start).trim(),
    matched: text.slice(span.start, span.end),
    after: text.slice(span.end, end).trim()
  }
}
```

- [ ] **Step 4: 跑它，确认通过**

Run: `npx vitest run tests/notes-context.test.ts`

Expected: PASS，9 passed。若「换行与缩进」那条红了，检查 `locate` 是否用了 `String.prototype.replace(/\s+/g, '')` 而不是 `trim()`。

- [ ] **Step 5: 写仓储**

`electron/main/notes/repo.ts`：

```ts
import type { Database } from 'better-sqlite3'
import { appError } from '@shared/errors'
import {
  MAX_HIGHLIGHT_CHARS,
  normalizeColor,
  normalizeNote,
  normalizeSpan
} from '@shared/highlights'
import type {
  Highlight,
  HighlightContext,
  HighlightInput,
  HighlightPatch,
  HighlightWithBook
} from '@shared/types'
import { sliceContext } from './context'

const COLUMNS = `id, book_id AS bookId, chapter_id AS chapterId,
  start_cfi AS startCfi, end_cfi AS endCfi, text, note, color,
  created_at AS createdAt, updated_at AS updatedAt`

/** 阅读器只要本章的：一章一个 iframe，注册别章的 Range 没有意义 */
export function listChapterHighlights(
  db: Database.Database,
  bookId: string,
  chapterId: number
): Highlight[] {
  return db
    .prepare(`SELECT ${COLUMNS} FROM highlights WHERE book_id = ? AND chapter_id = ? ORDER BY id`)
    .all(bookId, chapterId) as Highlight[]
}

export function getHighlight(db: Database.Database, id: number): Highlight | null {
  const row = db.prepare(`SELECT ${COLUMNS} FROM highlights WHERE id = ?`).get(id)
  return (row as Highlight | undefined) ?? null
}

export function createHighlight(
  db: Database.Database,
  input: HighlightInput,
  now: number
): Highlight {
  // 上限在渲染进程也已经拦过一次，这里是第二道锁：
  // IPC 是可以被直接调用的，边界校验不能只放在界面里。
  const text = normalizeSpan(input.text).slice(0, MAX_HIGHLIGHT_CHARS)
  if (text === '') throw appError('DB_ERROR', '选中的内容为空，没有可标注的文字')

  const info = db
    .prepare(
      `INSERT INTO highlights
         (book_id, chapter_id, start_cfi, end_cfi, text, note, color, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.bookId,
      input.chapterId,
      input.startCfi,
      input.endCfi,
      text,
      normalizeNote(input.note),
      normalizeColor(input.color),
      now,
      now
    )

  const created = getHighlight(db, Number(info.lastInsertRowid))
  if (!created) throw appError('DB_ERROR', '标注写入后读不回来')
  return created
}

/** 只改批注与颜色。没传的字段保持原值，传 null 表示「清空批注」 */
export function updateHighlight(
  db: Database.Database,
  id: number,
  patch: HighlightPatch,
  now: number
): Highlight | null {
  const current = getHighlight(db, id)
  if (!current) return null
  db.prepare('UPDATE highlights SET note = ?, color = ?, updated_at = ? WHERE id = ?').run(
    patch.note === undefined ? current.note : normalizeNote(patch.note),
    patch.color === undefined ? current.color : normalizeColor(patch.color),
    now,
    id
  )
  return getHighlight(db, id)
}

export function deleteHighlight(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM highlights WHERE id = ?').run(id)
}

/**
 * 跨书汇总。
 *
 * 排序固定为「最近加入的书在前，书内按章节顺序」：笔记页的分组头就是按这个顺序出的，
 * 不提供排序控件（见「计划拆分说明」）。
 *
 * `chapterOrdinal` 用 `c2.id <= c.id` 数可读章节：计划 02 是先序写入 chapters 的，
 * 所以自增 id 的顺序就是目录先序 —— 与 `listReaderChapters` 依赖的是同一条性质。
 */
export function listAllHighlights(db: Database.Database): HighlightWithBook[] {
  const rows = db
    .prepare(
      `SELECT ${COLUMNS},
              b.title AS bookTitle,
              c.title AS chapterTitle,
              (SELECT COUNT(*) FROM chapters c2
                WHERE c2.book_id = h.book_id AND c2.href <> '' AND c2.id <= c.id) AS chapterOrdinal,
              (SELECT COUNT(*) FROM chapters c3
                WHERE c3.book_id = h.book_id AND c3.href <> '') AS chapterTotal
       FROM highlights h
       JOIN books b ON b.id = h.book_id
       LEFT JOIN chapters c ON c.id = h.chapter_id
       ORDER BY b.added_at DESC, c.order_index, h.id`
    )
    .all() as (Highlight & {
    bookTitle: string
    chapterTitle: string | null
    chapterOrdinal: number
    chapterTotal: number
  })[]

  return rows.map((row) => {
    const total = Math.max(1, row.chapterTotal)
    const ordinal = Math.max(1, row.chapterOrdinal)
    return {
      id: row.id,
      bookId: row.bookId,
      chapterId: row.chapterId,
      startCfi: row.startCfi,
      endCfi: row.endCfi,
      text: row.text,
      note: row.note,
      color: row.color,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      bookTitle: row.bookTitle,
      chapterTitle: row.chapterTitle,
      percent: Math.min(1, (ordinal - 1) / total)
    }
  })
}

/**
 * 右栏的原文上下文。
 *
 * 章节正文只在 chunks 里，所以按 order_index 逐块找「哪个块含这句话」。
 * 块之间有一段重叠，命中可能落在重叠部分 —— 无所谓，取第一个命中的即可。
 * 全都没命中就退化成「只给标注时存下的原句」，located 为 false，界面要明说。
 */
export function highlightContext(db: Database.Database, id: number): HighlightContext {
  const highlight = getHighlight(db, id)
  if (!highlight) {
    return { located: false, chapterTitle: null, before: '', matched: '', after: '' }
  }

  const chapterTitle =
    highlight.chapterId === null ? null : (chapterTitleOf(db, highlight.chapterId) ?? null)

  if (highlight.chapterId !== null) {
    const chunks = db
      .prepare('SELECT text FROM chunks WHERE chapter_id = ? ORDER BY order_index')
      .all(highlight.chapterId) as { text: string }[]
    for (const chunk of chunks) {
      const slice = sliceContext(chunk.text, highlight.text)
      if (slice) return { located: true, chapterTitle, ...slice }
    }
  }

  return { located: false, chapterTitle, before: '', matched: highlight.text, after: '' }
}

function chapterTitleOf(db: Database.Database, chapterId: number): string | null {
  const row = db.prepare('SELECT title FROM chapters WHERE id = ?').get(chapterId)
  return row ? (row as { title: string }).title : null
}
```

- [ ] **Step 6: 类型检查**

Run: `npx tsc --noEmit`

Expected: 无错误。若 `shared/types.ts` 的 `import type { HighlightColor }` 报未使用，说明你没把 `color` 字段的类型写成 `HighlightColor`。

- [ ] **Step 7: Commit**

```bash
git add shared/types.ts electron/main/notes tests/notes-context.test.ts
git commit -m "feat: 标注仓储与原文上下文切片（跨书汇总、章节内就地定位）"
```

---

### Task 3: 标注 IPC 与 preload 白名单

**Files:**
- Create: `electron/main/ipc/notes.ts`
- Modify: `shared/ipc.ts`, `electron/main/ipc/index.ts`, `electron/preload/index.ts`

- [ ] **Step 1: 追加通道与契约**

`shared/ipc.ts` 的 `CH` 追加：

```ts
  notesListChapter: 'notes:listChapter',
  notesListAll: 'notes:listAll',
  notesCreate: 'notes:create',
  notesUpdate: 'notes:update',
  notesRemove: 'notes:remove',
  notesContext: 'notes:context'
```

`API_SHAPE` 追加：

```ts
  notes: ['listChapter', 'listAll', 'create', 'update', 'remove', 'context']
```

导出类通道（`notes:previewExport` / `notes:exportMarkdown`）在 Task 7 一起加，理由与做法都写在那一节：`boundary.spec.ts` 是整表比对的，中途只加一半会让测试红着过好几个 Task。

- [ ] **Step 2: 写 handler**

`electron/main/ipc/notes.ts`：

```ts
import { ipcMain } from 'electron'
import { CH } from '@shared/ipc'
import { appError, toAppError } from '@shared/errors'
import type { HighlightInput, HighlightPatch } from '@shared/types'
import {
  createHighlight,
  deleteHighlight,
  highlightContext,
  listAllHighlights,
  listChapterHighlights,
  updateHighlight
} from '../notes/repo'
import { getDatabase } from '../store/db'

export function registerNotesIpc(): void {
  ipcMain.handle(CH.notesListChapter, (_event, bookId: string, chapterId: number) =>
    listChapterHighlights(getDatabase(), bookId, chapterId)
  )

  ipcMain.handle(CH.notesListAll, () => listAllHighlights(getDatabase()))

  ipcMain.handle(CH.notesCreate, (_event, input: HighlightInput) => {
    try {
      return createHighlight(getDatabase(), input, Date.now())
    } catch (error) {
      // 必须抛 Error：Electron 只把 message 序列化给渲染进程，
      // 抛普通对象过去会变成一行 `[object Object]`，用户看不到任何有用信息。
      throw new Error(toAppError(error, '标注没有保存成功').message)
    }
  })

  ipcMain.handle(CH.notesUpdate, (_event, id: number, patch: HighlightPatch) =>
    updateHighlight(getDatabase(), id, patch, Date.now())
  )

  ipcMain.handle(CH.notesRemove, (_event, id: number) => {
    deleteHighlight(getDatabase(), id)
  })

  ipcMain.handle(CH.notesContext, (_event, id: number) => highlightContext(getDatabase(), id))
}

/** 供计划 07 之外的模块复用：把 AppError 转成能跨 IPC 的 Error */
export function toIpcError(error: unknown, fallback: string): Error {
  return new Error(toAppError(error, fallback).message)
}

export { appError }
```

最后两行只是为了让 `appError` 的导入不被 lint 判成未使用——本文件确实没用它。**更干净的做法是直接不导入**：写完 Step 5 跑一次 `npx tsc --noEmit`，如果报 `'appError' is declared but never read`，就把 `appError` 从 import 里删掉、并删掉上面那两行导出行，只保留 `toAppError`。

- [ ] **Step 3: 注册 handler**

`electron/main/ipc/index.ts`：

```ts
import { registerNotesIpc } from './notes'

export function registerIpc(): void {
  registerSettingsIpc()
  registerSecretsIpc()
  registerLibraryIpc()
  registerReaderIpc()
  registerNotesIpc()
}
```

- [ ] **Step 4: 补 preload 白名单**

`electron/preload/index.ts` 的 `api` 里追加（`@shared/types` 的导入补上 `Highlight`、`HighlightContext`、`HighlightInput`、`HighlightPatch`、`HighlightWithBook`）：

```ts
  notes: {
    listChapter: (bookId: string, chapterId: number): Promise<Highlight[]> =>
      ipcRenderer.invoke(CH.notesListChapter, bookId, chapterId),
    listAll: (): Promise<HighlightWithBook[]> => ipcRenderer.invoke(CH.notesListAll),
    create: (input: HighlightInput): Promise<Highlight> =>
      ipcRenderer.invoke(CH.notesCreate, input),
    update: (id: number, patch: HighlightPatch): Promise<Highlight | null> =>
      ipcRenderer.invoke(CH.notesUpdate, id, patch),
    remove: (id: number): Promise<void> => ipcRenderer.invoke(CH.notesRemove, id),
    context: (id: number): Promise<HighlightContext> =>
      ipcRenderer.invoke(CH.notesContext, id)
  },
```

- [ ] **Step 5: 跑边界测试，确认契约没破**

Run: `npx tsc --noEmit && npm run e2e -- e2e/boundary.spec.ts`

Expected: PASS，1 passed。这一条是整表比对：`notes` 少写一个方法、或者方法名与 `API_SHAPE` 不一致，都会在这里红。

- [ ] **Step 6: Commit**

```bash
git add shared/ipc.ts electron/main/ipc electron/preload/index.ts
git commit -m "feat: 标注 IPC 与 preload 白名单（本章读取、跨书汇总、增删改、上下文）"
```

---

### Task 4: 书内高亮渲染与划词浮条

本 Task 是这一期的核心：**不插 `<mark>` 也能把高亮画出来**，并且能点回去编辑。

**Files:**
- Create: `src/features/reader/highlights.ts`, `src/features/reader/SelectionToolbar.tsx`, `src/features/reader/HighlightPopover.tsx`, `e2e/highlight.spec.ts`
- Modify: `src/features/reader/theme.ts`, `src/features/reader/ReaderPage.tsx`, `src/styles/base.css`

- [ ] **Step 1: 给注入样式加高亮配色**

`src/features/reader/theme.ts` 顶部 import 区追加：

```ts
import { HIGHLIGHT_COLORS, highlightRegistryName } from '@shared/highlights'
```

文件里 `PAPER` 常量旁边追加：

```ts
/**
 * 高亮底色。与 .uicraft.md 的 `--hl-*` 取同一组值，但必须是字面量：
 * 这段 CSS 注入的是章节文档，那里的 `:root` 上没有我们的 Design Tokens。
 */
const HIGHLIGHT_BG: Record<ReadingPrefs['theme'], Record<string, string>> = {
  light: { yellow: '#f2e3a8', green: '#c9dfc4', blue: '#c6d6e8', pink: '#edcfd4' },
  dark: { yellow: '#4a4023', green: '#2f3e2c', blue: '#2a3644', pink: '#452f33' }
}

/** `::highlight()` 是按注册名上色的，所以四种颜色必须是四条规则 */
function highlightRules(theme: ReadingPrefs['theme']): string {
  const palette = HIGHLIGHT_BG[theme]
  return HIGHLIGHT_COLORS.map(
    (color) => `::highlight(${highlightRegistryName(color)}) {
  background-color: ${palette[color]};
  color: inherit;
}`
  ).join('\n')
}
```

`buildReaderCss` 的模板字符串末尾（`::selection` 那条规则之后、收尾反引号之前）追加：

```css
${highlightRules(prefs.theme)}
```

注意 `color: inherit` 是必须的：暗色主题下底色是深橄榄绿，正文本身是浅色，跟着底色反白会把字吃掉。

- [ ] **Step 2: 写高亮绘制**

`src/features/reader/highlights.ts`：

```ts
import { HIGHLIGHT_COLORS, highlightRegistryName, type HighlightColor } from '@shared/highlights'
import type { Highlight } from '@shared/types'
import { containsPoint, rangeFromSpan } from './cfi'

/** `CSS.highlights` 是类 Map 对象，不同 Electron 版本的类型声明不一定带，这里按最小形状断言 */
type HighlightRegistry = {
  delete: (name: string) => boolean
  set: (name: string, value: unknown) => void
}
type HighlightCtor = new (...ranges: Range[]) => unknown

type HighlightApi = { registry: HighlightRegistry; Ctor: HighlightCtor }

function apiOf(win: Window): HighlightApi | null {
  const css = (win as unknown as { CSS?: { highlights?: HighlightRegistry } }).CSS
  const Ctor = (win as unknown as { Highlight?: HighlightCtor }).Highlight
  if (!css?.highlights || typeof Ctor !== 'function') return null
  return { registry: css.highlights, Ctor }
}

/** 环境是否支持无侵入高亮。不支持时界面要明说，不能装作画上去了 */
export function supportsHighlights(win: Window): boolean {
  return apiOf(win) !== null
}

/**
 * 把本章高亮画上去。
 *
 * 关键在「不碰 DOM」：CSS Custom Highlight API 接受 Range 数组，由浏览器负责上色，
 * 书的 DOM 结构一个字节都不变，所以已存的 CFI 永远不会因为我们画高亮而漂移（spec §3.4）。
 * 用 Range 还要注意必须来自**同一个文档**，所以 `win` 与 `doc` 都从 iframe 取。
 *
 * 注册名按颜色分四组：一个注册名只能有一套样式，四种颜色就是四次注册。
 * 返回真正画上去的条数，0 表示本章没有高亮、或全部定位失败。
 */
export function paintHighlights(win: Window, doc: Document, list: readonly Highlight[]): number {
  const api = apiOf(win)
  if (!api) return 0
  clearHighlights(win)

  const byColor = new Map<HighlightColor, Range[]>()
  for (const item of list) {
    const range = rangeFromSpan(doc, item.startCfi, item.endCfi)
    if (!range) continue
    const bucket = byColor.get(item.color)
    if (bucket) bucket.push(range)
    else byColor.set(item.color, [range])
  }

  let painted = 0
  for (const [color, ranges] of byColor) {
    api.registry.set(highlightRegistryName(color), new api.Ctor(...ranges))
    painted += ranges.length
  }
  return painted
}

export function clearHighlights(win: Window): void {
  const api = apiOf(win)
  if (!api) return
  for (const color of HIGHLIGHT_COLORS) api.registry.delete(highlightRegistryName(color))
}

/**
 * 点到哪条高亮上。
 *
 * 区间不是元素，挂不了 click；只能反过来问「这个点落在哪条区间里」。
 * 从后往前遍历：重叠时让新标注赢，这与「新画的那条在最上层」的直觉一致。
 */
export function highlightAt(
  doc: Document,
  list: readonly Highlight[],
  node: Node,
  offset: number
): Highlight | null {
  for (let i = list.length - 1; i >= 0; i--) {
    const item = list[i]
    if (item && containsPoint(doc, item, node, offset)) return item
  }
  return null
}
```

- [ ] **Step 3: 写划词浮条**

`src/features/reader/SelectionToolbar.tsx`：

```tsx
import { MAX_HIGHLIGHT_CHARS, HIGHLIGHT_COLORS, HIGHLIGHT_COLOR_LABELS, type HighlightColor } from '@shared/highlights'

/** 浮条大致高度，用来判断往上放还是往下放 */
const TOOLBAR_HEIGHT = 40

export type SelectionState = {
  text: string
  startCfi: string
  endCfi: string
  /** 相对于 .reader__stage 的锚点横坐标（选区第一行的中点） */
  x: number
  /** 锚点的上沿 */
  y: number
  tooLong: boolean
}

export function SelectionToolbar({
  selection,
  onMark,
  onNote,
  onCopy,
  onAsk,
  onTranslate
}: {
  selection: SelectionState
  onMark: (color: HighlightColor) => void
  onNote: () => void
  onCopy: () => void
  /** 计划 05 接上。不传就不渲染按钮，避免出现点不动的空壳 */
  onAsk?: () => void
  onTranslate?: () => void
}) {
  // 贴到正文最上沿时，浮条往上放会被 .reader__stage 的 overflow 裁掉，翻到下面去
  const below = selection.y < TOOLBAR_HEIGHT + 12

  return (
    <div
      className={`sel-toolbar${below ? ' sel-toolbar--below' : ''}`}
      style={{ left: selection.x, top: selection.y }}
      role="toolbar"
      aria-label="标注选中的内容"
    >
      {selection.tooLong ? (
        <span className="sel-toolbar__warn">
          选中的内容共 {selection.text.length} 字，超过 {MAX_HIGHLIGHT_CHARS} 字上限，请选短一些再标注
        </span>
      ) : (
        <>
          {HIGHLIGHT_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className={`sel-dot sel-dot--${color}`}
              title={`标注为${HIGHLIGHT_COLOR_LABELS[color]}色`}
              aria-label={`标注为${HIGHLIGHT_COLOR_LABELS[color]}色`}
              onClick={() => onMark(color)}
            />
          ))}
          <span className="sel-toolbar__sep" />
          <button type="button" className="sel-toolbar__btn" onClick={onNote}>
            笔记
          </button>
          <button type="button" className="sel-toolbar__btn" onClick={onCopy}>
            复制
          </button>
          {onTranslate && (
            <button type="button" className="sel-toolbar__btn" onClick={onTranslate}>
              翻译
            </button>
          )}
          {onAsk && (
            <button type="button" className="sel-toolbar__btn sel-toolbar__btn--accent" onClick={onAsk}>
              问 AI
            </button>
          )}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 4: 写点高亮的浮层**

`src/features/reader/HighlightPopover.tsx`：

```tsx
import { useEffect, useRef, useState } from 'react'
import { HIGHLIGHT_COLORS, HIGHLIGHT_COLOR_LABELS, type HighlightColor } from '@shared/highlights'
import type { Highlight } from '@shared/types'

/** 浮层最大高度，ReaderPage 用它把落点夹在正文区里，避免贴底被裁 */
export const POPOVER_MAX_HEIGHT = 240

export function HighlightPopover({
  highlight,
  x,
  y,
  onColor,
  onSaveNote,
  onRemove,
  onClose
}: {
  highlight: Highlight
  x: number
  y: number
  onColor: (color: HighlightColor) => void
  onSaveNote: (note: string | null) => void
  onRemove: () => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState(highlight.note ?? '')
  const [confirming, setConfirming] = useState(false)
  const boxRef = useRef<HTMLDivElement | null>(null)

  // 换了一条高亮就重置草稿与二次确认，否则会把上一条的批注串过去
  useEffect(() => {
    setDraft(highlight.note ?? '')
    setConfirming(false)
  }, [highlight.id, highlight.note])

  // 点浮层外面关掉。用 mousedown 而不是 click：正文里的 click 已经被链接拦截用掉了
  useEffect(() => {
    const onDown = (event: MouseEvent): void => {
      if (!boxRef.current) return
      const target = event.target as Node | null
      if (target && !boxRef.current.contains(target)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])

  const dirty = draft.trim() !== (highlight.note ?? '')

  return (
    <div
      className="annot"
      ref={boxRef}
      style={{ left: x, top: y, maxHeight: POPOVER_MAX_HEIGHT }}
      role="dialog"
      aria-label="编辑标注"
    >
      <div className="annot__dots">
        {HIGHLIGHT_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            className={`sel-dot${highlight.color === color ? ' is-on' : ''} sel-dot--${color}`}
            title={`改成${HIGHLIGHT_COLOR_LABELS[color]}色`}
            aria-label={`改成${HIGHLIGHT_COLOR_LABELS[color]}色`}
            aria-pressed={highlight.color === color}
            onClick={() => onColor(color)}
          />
        ))}
        <span className="annot__spacer" />
        <button type="button" className="annot__x" onClick={onClose} aria-label="关闭">
          ×
        </button>
      </div>

      <p className="annot__quote">{highlight.text}</p>

      <textarea
        className="annot__note"
        value={draft}
        placeholder="写一句批注"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            onSaveNote(draft)
          }
        }}
      />

      <div className="annot__foot">
        <button
          type="button"
          className="annot__del"
          onClick={() => (confirming ? onRemove() : setConfirming(true))}
          onBlur={() => setConfirming(false)}
        >
          {confirming ? '确认删除' : '删除'}
        </button>
        <span className="annot__spacer" />
        <button
          type="button"
          className="btn btn--accent"
          disabled={!dirty}
          onClick={() => onSaveNote(draft)}
        >
          保存批注
        </button>
      </div>
    </div>
  )
}
```

删除做成两次点击而不是弹确认框：这个应用的语气是安静的，不该为一次删除打断阅读；但也不该一次误点就丢内容，所以给一次「确认删除」的机会。

- [ ] **Step 5: 把两个浮层接进阅读器**

`src/features/reader/ReaderPage.tsx` 四处改动。

① import 区追加：

```tsx
import { MAX_HIGHLIGHT_CHARS, normalizeSpan, type HighlightColor } from '@shared/highlights'
import type { Highlight } from '@shared/types'
import { anchorOf, spanFromSelection } from './cfi'
import { clearHighlights, highlightAt, paintHighlights, supportsHighlights } from './highlights'
import { HighlightPopover, POPOVER_MAX_HEIGHT } from './HighlightPopover'
import { SelectionToolbar, type SelectionState } from './SelectionToolbar'
```

② props 与 state 区追加（`target` 的完整接线在 Task 5，这里先把 state 与计算补上）：

```tsx
  const [highlights, setHighlights] = useState<Highlight[]>([])
  const [selection, setSelection] = useState<SelectionState | null>(null)
  const [active, setActive] = useState<{ highlight: Highlight; x: number; y: number } | null>(null)
  const [annotError, setAnnotError] = useState<string | null>(null)
  /** 当前环境不支持 CSS Custom Highlight API 时，界面上要明说，而不是静静地不画 */
  const [canHighlight, setCanHighlight] = useState(true)
```

③ 在「① 开书」effect 之前（`layoutRef` / `prefsRef` 那个 effect 之后）追加两个 effect：

```tsx
  const chapter = readable[chapterIndex] ?? null

  // ⑥ 取本章标注。换章、换书都要重取，翻页不用——标注是章级的
  useEffect(() => {
    if (!book || !chapter) {
      setHighlights([])
      return
    }
    let alive = true
    void window.api.notes
      .listChapter(book.id, chapter.id)
      .then((list) => {
        if (alive) setHighlights(list)
      })
      .catch((e: unknown) => {
        if (alive) setAnnotError(e instanceof Error ? e.message : '本章的标注没读出来')
      })
    return () => {
      alive = false
    }
  }, [book, chapter])

  // ⑦ 画高亮。文档换了、本章标注变了都要重画；翻页不用，Range 跟着 DOM 走，与 translateX 无关
  useEffect(() => {
    const win = iframeRef.current?.contentWindow
    const doc = iframeRef.current?.contentDocument
    if (!win || !doc) return
    if (!supportsHighlights(win)) {
      setCanHighlight(false)
      return
    }
    setCanHighlight(true)
    paintHighlights(win, doc, highlights)
    return () => clearHighlights(win)
  }, [highlights, docVersion])
```

④ 在「防抖落库」那一段之后追加划词与点击。**注意：`setSelection(null)` 必须在 effect 开头无条件执行**——换章后新文档没有选区，`selectionchange` 不会触发，浮条会原地留着指向上一章的坐标。

```tsx
  // ⑧ 划词：文档里任何一次选区变化都先落到 state，坐标换算到 .reader__stage 上
  useEffect(() => {
    const doc = iframeRef.current?.contentDocument
    const iframe = iframeRef.current
    const stage = stageRef.current
    if (!doc || !iframe || !stage || !chapter) return

    setSelection(null)

    const onSelectionChange = (): void => {
      const current = doc.getSelection()
      if (!current || current.rangeCount === 0 || current.isCollapsed) {
        setSelection(null)
        return
      }
      const range = current.getRangeAt(0)
      const anchor = anchorOf(range)
      if (!anchor) {
        setSelection(null)
        return
      }
      const span = spanFromSelection(doc, range, chapter.spineIndex ?? chapterIndex)
      if (!span) {
        setSelection(null)
        return
      }
      const iframeRect = iframe.getBoundingClientRect()
      const stageRect = stage.getBoundingClientRect()
      setSelection({
        ...span,
        tooLong: span.text.length > MAX_HIGHLIGHT_CHARS,
        x: iframeRect.left - stageRect.left + anchor.x,
        y: iframeRect.top - stageRect.top + anchor.y
      })
      setActive(null)
    }

    doc.addEventListener('selectionchange', onSelectionChange)
    return () => doc.removeEventListener('selectionchange', onSelectionChange)
  }, [docVersion, chapter, chapterIndex])
```

```tsx
  // ⑨ 点已有高亮。链接优先于标注：点链接是导航，不该被批注浮层抢走
  useEffect(() => {
    const doc = iframeRef.current?.contentDocument
    const iframe = iframeRef.current
    const stage = stageRef.current
    if (!doc || !iframe || !stage) return

    const onClick = (event: MouseEvent): void => {
      const node = event.target as { closest?: (selector: string) => Element | null } | null
      if (node?.closest?.('a[href]')) return

      const caret = doc.caretRangeFromPoint(event.clientX, event.clientY)
      if (!caret) {
        setActive(null)
        return
      }
      const hit = highlightAt(doc, highlights, caret.startContainer, caret.startOffset)
      if (!hit) {
        setActive(null)
        return
      }

      const range = rangeFromSpan(doc, hit.startCfi, hit.endCfi)
      const anchor = range ? anchorOf(range) : null
      const iframeRect = iframe.getBoundingClientRect()
      const stageRect = stage.getBoundingClientRect()
      const rawTop = iframeRect.top - stageRect.top + (anchor ? anchor.y : event.clientY)
      const left = iframeRect.left - stageRect.left + (anchor ? anchor.x : event.clientX)
      setSelection(null)
      setActive({
        highlight: hit,
        // 夹在正文区里：贴底时往上收，贴顶时往下放，避免被 .reader__stage 的 overflow 裁掉
        x: Math.min(Math.max(8, left), Math.max(8, stageRect.width - 8)),
        y: Math.min(Math.max(8, rawTop + 8), Math.max(8, stageRect.height - POPOVER_MAX_HEIGHT - 8))
      })
    }

    doc.addEventListener('click', onClick)
    return () => doc.removeEventListener('click', onClick)
  }, [docVersion, highlights])
```

⑤ 三段动作。放在 `exit` 之前：

```tsx
  const markSelection = useCallback(
    async (color: HighlightColor, withNote: boolean) => {
      if (!book || !chapter || !selection || selection.tooLong) return
      const anchor = { x: selection.x, y: selection.y }
      try {
        const created = await window.api.notes.create({
          bookId: book.id,
          chapterId: chapter.id,
          startCfi: selection.startCfi,
          endCfi: selection.endCfi,
          text: selection.text,
          note: null,
          color
        })
        setHighlights((list) => [...list, created])
        setAnnotError(null)
        setSelection(null)
        // 选区不清掉，下一次 selectionchange 会把浮条又唤醒
        iframeRef.current?.contentWindow?.getSelection()?.removeAllRanges()
        if (withNote) {
          setActive({
            highlight: created,
            x: Math.min(Math.max(8, anchor.x), 400),
            y: Math.min(Math.max(8, anchor.y + 8), Math.max(8, 400))
          })
        }
      } catch (e) {
        setAnnotError(e instanceof Error ? e.message : '标注没有保存成功')
      }
    },
    [book, chapter, selection]
  )

  const copySelection = useCallback(() => {
    if (!selection) return
    void navigator.clipboard.writeText(selection.text)
    setSelection(null)
    iframeRef.current?.contentWindow?.getSelection()?.removeAllRanges()
  }, [selection])

  const changeActiveColor = useCallback(
    async (color: HighlightColor) => {
      if (!active) return
      const updated = await window.api.notes.update(active.highlight.id, { color })
      if (!updated) return
      setHighlights((list) => list.map((item) => (item.id === updated.id ? updated : item)))
      setActive({ ...active, highlight: updated })
    },
    [active]
  )

  const saveActiveNote = useCallback(
    async (note: string | null) => {
      if (!active) return
      try {
        const updated = await window.api.notes.update(active.highlight.id, { note })
        if (!updated) return
        setHighlights((list) => list.map((item) => (item.id === updated.id ? updated : item)))
        setActive({ ...active, highlight: updated })
        setAnnotError(null)
      } catch (e) {
        setAnnotError(e instanceof Error ? e.message : '批注没有保存成功')
      }
    },
    [active]
  )

  const removeActive = useCallback(async () => {
    if (!active) return
    const id = active.highlight.id
    await window.api.notes.remove(id)
    setHighlights((list) => list.filter((item) => item.id !== id))
    setActive(null)
  }, [active])
```

⑥ 翻页时收掉浮条。`turn` 的两条分支各加一次 `setActive(null)`：

```tsx
  const turn = useCallback(
    (direction: 1 | -1) => {
      setActive(null)
      setSelection(null)
      const paginator = paginatorRef.current
      // ……以下保持计划 03 的原文不动
```

⑦ JSX。`.reader__body` 里 `.reader__stage` 内部、`</div>` 收掉 `.reader__frame` 之后插入两个浮层：

```tsx
          {selection && (
            <SelectionToolbar
              selection={selection}
              onMark={(color) => void markSelection(color, false)}
              onNote={() => void markSelection(DEFAULT_HIGHLIGHT_COLOR, true)}
              onCopy={copySelection}
            />
          )}
          {active && (
            <HighlightPopover
              highlight={active.highlight}
              x={active.x}
              y={active.y}
              onColor={(color) => void changeActiveColor(color)}
              onSaveNote={(note) => void saveActiveNote(note)}
              onRemove={() => void removeActive()}
              onClose={() => setActive(null)}
            />
          )}
```

`DEFAULT_HIGHLIGHT_COLOR` 也要加进 `@shared/highlights` 的 import。

在 `.reader__degrade` 那条提示之后插入标注相关的两条常驻提示：

```tsx
      {!canHighlight && docVersion > 0 && (
        <p className="reader__degrade" role="status">
          当前环境不支持无侵入高亮，书内标注只保存不显示；笔记页仍能看到全部内容。
        </p>
      )}
      {annotError && (
        <p className="reader__degrade reader__degrade--error" role="status">
          {annotError}
        </p>
      )}
```

`canHighlight` 初始值给 `true`：`CSS.highlights` 在 Electron 里一定存在，这条分支是给未来 Chromium 行为变化留的，不要在首帧就报一个假的降级。

- [ ] **Step 6: 加样式**

追加到 `src/styles/base.css` 末尾：

```css
/* ---- 划词浮条 ---- */
.sel-toolbar {
  position: absolute;
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 4px;
  max-width: 520px;
  padding: 6px 8px;
  background: var(--paper-raised);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-pop);
  white-space: nowrap;
  transform: translate(-50%, calc(-100% - 10px));
}

/* 贴到正文上沿时翻到选区下方 */
.sel-toolbar--below {
  transform: translate(-50%, 10px);
}

.sel-toolbar__sep {
  width: 1px;
  height: 18px;
  margin: 0 4px;
  background: var(--line);
}

.sel-toolbar__btn {
  height: 28px;
  padding: 0 8px;
  border-radius: var(--r-sm);
  font-size: 13px;
  color: var(--ink-muted);
  transition: background var(--ease), color var(--ease);
}

.sel-toolbar__btn:hover {
  background: var(--hover);
  color: var(--ink);
}

.sel-toolbar__btn--accent {
  color: var(--accent-mark);
}

.sel-toolbar__btn--accent:hover {
  background: color-mix(in srgb, var(--accent-mark) 12%, transparent);
  color: var(--accent-mark);
}

.sel-toolbar__warn {
  padding: 0 4px;
  font-size: 12px;
  color: var(--accent-mark);
  white-space: normal;
}

.sel-dot {
  width: 18px;
  height: 18px;
  border: 1px solid var(--line);
  border-radius: 50%;
  transition: transform var(--ease);
}

.sel-dot:hover {
  transform: scale(1.16);
}

.sel-dot.is-on {
  outline: 2px solid var(--ink);
  outline-offset: 1px;
}

.sel-dot--yellow { background: var(--hl-yellow); }
.sel-dot--green { background: var(--hl-green); }
.sel-dot--blue { background: var(--hl-blue); }
.sel-dot--pink { background: var(--hl-pink); }

/* ---- 点已有高亮的浮层 ---- */
.annot {
  position: absolute;
  z-index: 30;
  width: 300px;
  display: flex;
  flex-direction: column;
  gap: var(--s2);
  padding: var(--s3);
  overflow-y: auto;
  background: var(--paper-raised);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-pop);
}

.annot__dots {
  display: flex;
  align-items: center;
  gap: 6px;
}

.annot__spacer {
  flex: 1;
}

.annot__x {
  width: 22px;
  height: 22px;
  border-radius: var(--r-sm);
  color: var(--ink-muted);
  font-size: 16px;
  line-height: 1;
}

.annot__x:hover {
  background: var(--hover);
  color: var(--ink);
}

.annot__quote {
  margin: 0;
  padding-left: var(--s2);
  border-left: 2px solid var(--line);
  color: var(--ink-muted);
  font-size: 12px;
  line-height: 1.6;
  max-height: 72px;
  overflow: hidden;
}

.annot__note {
  min-height: 64px;
  padding: var(--s2);
  resize: vertical;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  color: var(--ink);
  font: inherit;
  font-size: 13px;
  line-height: 1.6;
}

.annot__foot {
  display: flex;
  align-items: center;
  gap: var(--s2);
}

.annot__del {
  height: 28px;
  padding: 0 8px;
  border-radius: var(--r-sm);
  color: var(--accent-mark);
  font-size: 12px;
}

.annot__del:hover {
  background: color-mix(in srgb, var(--accent-mark) 12%, transparent);
}

.reader__degrade--error {
  color: var(--accent-mark);
}
```

`.reader__stage` 也需要能承载绝对定位的浮条——它的定位上下文必须是 stage 而不是 `body`。在既有 `.reader__stage` 规则里补一行 `position: relative;`：

```css
.reader__stage {
  position: relative;
  /* ……以下保持计划 03 的原文不动 */
}

.btn--accent {
  color: var(--accent-mark);
}

.btn--accent:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent-mark) 12%, transparent);
}
```

`.btn--accent` 与 `.btn:disabled` 如果计划 03 的 Task 8 已经加过就不重复；加之前先 Grep 一下 `btn--accent`，有就只补缺的那几条。

- [ ] **Step 7: 写 e2e**

`e2e/highlight.spec.ts`：

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { novelFiles, writeEpub } from '../fixtures/make-epub'
import { launchAppWithUserData } from './helpers'

test('划词标注不插 mark、能改色、能写批注、能点回去', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-hl-'))
  const epubPath = join(userDataDir, 'novel.epub')
  await writeEpub(epubPath, novelFiles())

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()
  const bookId = await win.evaluate(async (file) => {
    const outcome = await (window as any).api.library.importPath(file)
    return outcome.bookId as string
  }, epubPath)

  await win.evaluate((id) => (window as any).api.reader.open(id), bookId)
  await win.reload()
  await win.locator('.book-list__open').first().click()
  await expect(win.locator('.reader__chapter')).toHaveText('第一章 河边')
  await win.locator('iframe.reader__view').waitFor()

  // 在章节文档里选前 8 个字。setSelection 会触发 selectionchange，React 那边据此弹浮条
  const picked = await win.evaluate(() => {
    const frame = document.querySelector('iframe.reader__view') as HTMLIFrameElement
    const doc = frame.contentDocument!
    const node = doc.querySelector('p')!.firstChild as Text
    const end = Math.min(8, node.length)
    const range = doc.createRange()
    range.setStart(node, 0)
    range.setEnd(node, end)
    const selection = doc.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    return node.nodeValue!.slice(0, end)
  })
  expect(picked).toBe('月色沉入河底，量')

  await expect(win.locator('.sel-toolbar')).toBeVisible()
  await win.locator('.sel-dot--green').click()

  // 高亮注册进了章节文档的 CSS.highlights，而不是插了 <mark>
  const painted = await win.evaluate(() => {
    const frame = document.querySelector('iframe.reader__view') as HTMLIFrameElement
    const css = (frame.contentWindow as any).CSS
    return {
      names: css?.highlights ? [...css.highlights.keys()] : [],
      marks: frame.contentDocument!.querySelectorAll('mark').length
    }
  })
  expect(painted.names).toEqual(['hl-green'])
  expect(painted.marks).toBe(0)

  // 点回高亮上：用这段话第 2 个字的坐标去点
  const point = await win.evaluate(() => {
    const frame = document.querySelector('iframe.reader__view') as HTMLIFrameElement
    const doc = frame.contentDocument!
    const node = doc.querySelector('p')!.firstChild as Text
    const range = doc.createRange()
    range.setStart(node, 2)
    range.setEnd(node, 3)
    const rect = range.getBoundingClientRect()
    const outer = frame.getBoundingClientRect()
    return {
      x: outer.left + rect.left + rect.width / 2,
      y: outer.top + rect.top + rect.height / 2
    }
  })
  await win.mouse.click(point.x, point.y)

  const pop = win.locator('.annot')
  await expect(pop).toBeVisible()
  await expect(pop.locator('.annot__quote')).toHaveText(picked)

  // 改色
  await pop.locator('.sel-dot--pink').click()
  await expect
    .poll(async () =>
      win.evaluate(async () => {
        const list = await (window as any).api.notes.listAll()
        return list[0]?.color
      })
    )
    .toBe('pink')

  // 写批注
  await pop.locator('.annot__note').fill('这一句是全书第一次写他的手机瘾')
  await pop.locator('button:has-text("保存批注")').click()
  await expect
    .poll(async () =>
      win.evaluate(async () => {
        const list = await (window as any).api.notes.listAll()
        return list[0]?.note
      })
    )
    .toBe('这一句是全书第一次写他的手机瘾')

  // 高亮随颜色改名重新注册，仍然没有 mark
  const after = await win.evaluate(() => {
    const frame = document.querySelector('iframe.reader__view') as HTMLIFrameElement
    const css = (frame.contentWindow as any).CSS
    return {
      names: css?.highlights ? [...css.highlights.keys()] : [],
      marks: frame.contentDocument!.querySelectorAll('mark').length
    }
  })
  expect(after.names).toEqual(['hl-pink'])
  expect(after.marks).toBe(0)

  await app.close()
})
```

最后三条断言里 `after.marks` 是这次改动的核心验收：**颜色换了、批注写了，正文结构仍然一个 `<mark>` 都没有**。

- [ ] **Step 8: 跑 e2e**

Run: `npm run e2e -- e2e/highlight.spec.ts`

Expected: PASS，1 passed。

排查指引：

- `.sel-toolbar` 一直不出现 → `selectionchange` 监听没挂上。确认 ⑧ 那个 effect 的依赖里有 `docVersion`，且它在「③ 装 iframe」之后注册（React 的 effect 按声明顺序跑，⑧ 必须写在 ③ 之后）。
- `.sel-toolbar` 出现但点在 stage 外面 → `anchorOf` 取的是 `getClientRects()` 的第 0 个；分栏后如果第 0 个矩形宽高都是 0，会退化成 null。检查过滤条件用的是 `width > 0 || height > 0`。
- `.annot` 不出现 → 点没落在区间里。核对 `rangeFromSpan` 用的是 `[localParts(cfi)]`，而不是 `parse(cfi)` 的完整结果。
- `painted.names` 是 `[]` → `paintHighlights` 拿到的 `win` 是父窗口。必须用 `iframe.contentWindow`，`CSS.highlights` 是每个 Window 各自一份的。

- [ ] **Step 9: 跑边界与阅读器 e2e，确认没改坏别的**

Run: `npm run e2e -- e2e/boundary.spec.ts e2e/reader.spec.ts`

Expected: 全 PASS。阅读器那条如果红了，重点看 ⑨ 那个 click 监听是否把计划 03 的链接拦截挡住了——两个监听都挂在同一个文档上，链接拦截先注册、先执行，本计划的 ⑨ 里又显式放行了 `a[href]`，两重保险。

- [ ] **Step 10: Commit**

```bash
git add shared src/features/reader src/styles/base.css e2e/highlight.spec.ts
git commit -m "feat: 划词浮条与 CSS Custom Highlight 书内高亮（不插 mark，可改色可批注可删）"
```

---

### Task 5: 「回到原文」的落点通路

笔记页要能把人送回书里。这需要 `App` 记住「打开哪本书的哪个位置」，所以先把通路打通，笔记页（Task 6）才有地方调用。

**Files:**
- Modify: `src/App.tsx`, `src/features/reader/ReaderPage.tsx`

- [ ] **Step 1: `ReaderPage` 接受落点**

`src/features/reader/ReaderPage.tsx`：

① props 签名改成：

```tsx
export function ReaderPage({
  bookId,
  target,
  onExit
}: {
  bookId: string
  /** 从笔记「回到原文」进来时指定落点；从书架进来传 null，沿用上次进度 */
  target?: ReadingTarget | null
  onExit: () => void
}) {
```

`ReadingTarget` 加进 `@shared/types` 的 import。

② 「① 开书」effect 里的定位段改成（原来那两行 `const found = ...` / `pendingRef.current = ...` 换掉）：

```tsx
        const list = opened.chapters.filter((item) => item.href !== '')
        // 指定了章节就用它，否则回到上次读到的位置
        const wanted = target?.chapterId ?? opened.progress?.chapterId ?? null
        const found = list.findIndex((item) => item.id === wanted)
        setChapterIndex(found >= 0 ? found : 0)
        // cfi 只在「确实要落在指定章节」时才跟着 target 走，
        // 否则会拿 A 章的 cfi 去定位 B 章，必然失败并退化成章首
        const cfi = target?.chapterId != null ? target.cfi : (opened.progress?.cfi ?? null)
        pendingRef.current = cfi ? { cfi } : null
```

③ 该 effect 的依赖数组 `[bookId]` 改成 `[bookId, target]`。

- [ ] **Step 2: `App` 换成带落点的状态**

`src/App.tsx`：

```tsx
import { useCallback, useState } from 'react'
import type { ReadingTarget } from '@shared/types'
// ……其余 import 保持计划 03 的原文

export default function App() {
  const [page, setPage] = useState<PageId>('library')
  const [reading, setReading] = useState<ReadingTarget | null>(null)

  const openBook = useCallback((bookId: string) => {
    setReading({ bookId, chapterId: null, cfi: null })
  }, [])

  if (reading) {
    return (
      <ReaderPage bookId={reading.bookId} target={reading} onExit={() => setReading(null)} />
    )
  }

  return (
    <div className="app">
      <TitleBar title={TITLES[page]} />
      <div className="body">
        <Sidebar current={page} onSelect={setPage} />
        <main className="content">
          {page === 'library' && <LibraryPage onOpen={openBook} />}
          {page === 'notes' && <NotesPage onOpenAt={setReading} />}
          {page === 'settings' && <SettingsPage />}
        </main>
      </div>
    </div>
  )
}
```

`openBook` 用 `useCallback` 不是为了性能：`target` 进了 `ReaderPage` 那个 effect 的依赖，每次渲染换一个新的对象字面量会让开书 effect 反复重跑，读一次书要重开好几次。所以要保证「同一个 target 引用只对应一次打开」。`setReading` 只在点「打开」与点「回到原文」时被调用，引用天然稳定。

`LibraryPage` 一行都不用改：它的 `onOpen: (id: string) => void` 与 `openBook` 的签名一致。

- [ ] **Step 3: `NotesPage` 先接受 prop（正文在 Task 6 写）**

`src/pages/NotesPage.tsx` 临时改成：

```tsx
import type { ReadingTarget } from '@shared/types'

export function NotesPage({ onOpenAt }: { onOpenAt: (target: ReadingTarget) => void }) {
  void onOpenAt
  return <div className="page-placeholder">笔记页将在本计划 Task 6 实现</div>
}
```

`void onOpenAt` 只是给 lint 一个交代，Task 6 会连这行一起删掉。

- [ ] **Step 4: 类型检查**

Run: `npx tsc --noEmit`

Expected: 无错误。若 `LibraryPage` 报 `onOpen` 类型不符，说明它的签名是 `(bookId: string, ...)` 之类更宽的形状，回计划 03 的 Task 6 Step 3 核一遍。

- [ ] **Step 5: 跑阅读器 e2e**

Run: `npm run e2e -- e2e/reader.spec.ts`

Expected: PASS。「从书架打开沿用上次进度」这条路径走的是 `target.chapterId === null` 分支，与改动前行为一致；若报进度丢失，检查 ② 里的三元条件是不是写成了 `target?.cfi ?? opened.progress?.cfi`。

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/pages/NotesPage.tsx src/features/reader/ReaderPage.tsx
git commit -m "feat: 阅读落点通路（App 持有 ReadingTarget，阅读器支持指定章节与位置）"
```

---

### Task 6: 笔记页三栏

**Files:**
- Create: `src/features/notes/group.ts`, `src/features/notes/NotesFilters.tsx`, `src/features/notes/NoteCard.tsx`, `src/features/notes/NoteContextPanel.tsx`, `tests/notes-group.test.ts`, `e2e/notes.spec.ts`
- Modify: `src/pages/NotesPage.tsx`, `src/styles/base.css`

- [ ] **Step 1: 写筛选与分组的失败测试**

`tests/notes-group.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import type { HighlightWithBook } from '../shared/types'
import {
  applyFilter,
  bookOptions,
  countsByKind,
  groupByBook,
  resolveSelection
} from '../src/features/notes/group'

function note(id: number, bookId: string, bookTitle: string, hasNote: boolean): HighlightWithBook {
  return {
    id,
    bookId,
    chapterId: id * 10,
    startCfi: `epubcfi(/6/${id * 2}!/4/2/1:0)`,
    endCfi: `epubcfi(/6/${id * 2}!/4/2/1:8)`,
    text: `第 ${id} 条原文`,
    note: hasNote ? `第 ${id} 条批注` : null,
    color: 'yellow',
    createdAt: id,
    updatedAt: id,
    bookTitle,
    chapterTitle: `第 ${id} 章`,
    percent: 0.5
  }
}

const NOTES = [
  note(1, 'b1', '深度工作', true),
  note(2, 'b1', '深度工作', false),
  note(3, 'b2', '思考，快与慢', false)
]

describe('applyFilter', () => {
  it('只按类型筛', () => {
    expect(applyFilter(NOTES, { kind: 'annotated', bookId: null }).map((n) => n.id)).toEqual([1])
    expect(applyFilter(NOTES, { kind: 'marked', bookId: null }).map((n) => n.id)).toEqual([2, 3])
    expect(applyFilter(NOTES, { kind: 'all', bookId: null })).toHaveLength(3)
  })

  it('类型与书籍同时生效', () => {
    expect(applyFilter(NOTES, { kind: 'marked', bookId: 'b1' }).map((n) => n.id)).toEqual([2])
  })
})

describe('countsByKind', () => {
  it('不选书时是全局计数', () => {
    expect(countsByKind(NOTES, null)).toEqual({ all: 3, marked: 2, annotated: 1 })
  })

  it('选了书，类型计数也只算这本书', () => {
    expect(countsByKind(NOTES, 'b1')).toEqual({ all: 2, marked: 1, annotated: 1 })
  })
})

describe('groupByBook', () => {
  it('保持传入顺序，同书的归到一组', () => {
    const groups = groupByBook(NOTES)
    expect(groups.map((g) => [g.bookTitle, g.count])).toEqual([
      ['深度工作', 2],
      ['思考，快与慢', 1]
    ])
  })
})

describe('bookOptions', () => {
  it('每本书一条，带条数', () => {
    expect(bookOptions(NOTES)).toEqual([
      { bookId: 'b1', bookTitle: '深度工作', count: 2 },
      { bookId: 'b2', bookTitle: '思考，快与慢', count: 1 }
    ])
  })
})

describe('resolveSelection', () => {
  it('选中的还在就保持不动', () => {
    expect(resolveSelection(NOTES, 3)).toBe(3)
  })

  it('选中的被筛掉了就落到第一条，避免右栏停在一个看不见的笔记上', () => {
    expect(resolveSelection([NOTES[0]!], 3)).toBe(1)
  })

  it('一条都没有时是 null', () => {
    expect(resolveSelection([], 3)).toBeNull()
  })
})
```

- [ ] **Step 2: 写筛选与分组**

`src/features/notes/group.ts`：

```ts
import type { HighlightWithBook } from '@shared/types'

export type NotesKind = 'all' | 'marked' | 'annotated'

export type NotesFilter = {
  kind: NotesKind
  /** null 表示不限定书籍 */
  bookId: string | null
}

export const KIND_LABELS: Record<NotesKind, string> = {
  all: '全部笔记',
  marked: '仅高亮',
  annotated: '仅有批注'
}

export type BookGroup = {
  bookId: string
  bookTitle: string
  count: number
  notes: HighlightWithBook[]
}

/**
 * 按书分组，**保持传入顺序**。
 *
 * 顺序由主进程的 SQL 定（最近加入的书在前），这里不再排一次——
 * 两处各排一次，早晚会不一致。
 */
export function groupByBook(notes: readonly HighlightWithBook[]): BookGroup[] {
  const groups: BookGroup[] = []
  const index = new Map<string, BookGroup>()
  for (const note of notes) {
    let group = index.get(note.bookId)
    if (!group) {
      group = { bookId: note.bookId, bookTitle: note.bookTitle, count: 0, notes: [] }
      index.set(note.bookId, group)
      groups.push(group)
    }
    group.notes.push(note)
    group.count += 1
  }
  return groups
}

export function applyFilter(
  notes: readonly HighlightWithBook[],
  filter: NotesFilter
): HighlightWithBook[] {
  return notes.filter((note) => {
    if (filter.bookId !== null && note.bookId !== filter.bookId) return false
    if (filter.kind === 'annotated') return note.note !== null
    if (filter.kind === 'marked') return note.note === null
    return true
  })
}

export type NoteCounts = { all: number; marked: number; annotated: number }

/** 侧栏的计数跟着书籍这一维走：选了某本书，类型计数也只算这本书 */
export function countsByKind(
  notes: readonly HighlightWithBook[],
  bookId: string | null
): NoteCounts {
  const scoped = bookId === null ? notes : notes.filter((note) => note.bookId === bookId)
  return {
    all: scoped.length,
    marked: scoped.filter((note) => note.note === null).length,
    annotated: scoped.filter((note) => note.note !== null).length
  }
}

export type BookOption = { bookId: string; bookTitle: string; count: number }

export function bookOptions(notes: readonly HighlightWithBook[]): BookOption[] {
  return groupByBook(notes).map(({ bookId, bookTitle, count }) => ({ bookId, bookTitle, count }))
}

/**
 * 选中项被筛掉之后要落到剩下的第一条。
 * 否则右栏会一直显示一条当前看不见的笔记，用户会以为筛选坏了。
 */
export function resolveSelection(
  notes: readonly HighlightWithBook[],
  selectedId: number | null
): number | null {
  if (selectedId !== null && notes.some((note) => note.id === selectedId)) return selectedId
  return notes[0]?.id ?? null
}
```

- [ ] **Step 3: 跑它，确认通过**

Run: `npx vitest run tests/notes-group.test.ts`

Expected: PASS，11 passed。

- [ ] **Step 4: 写左栏**

`src/features/notes/NotesFilters.tsx`：

```tsx
import type { HighlightWithBook } from '@shared/types'
import { KIND_LABELS, type BookOption, type NoteCounts, type NotesKind } from './group'

const KINDS: NotesKind[] = ['all', 'marked', 'annotated']

export function NotesFilters({
  counts,
  books,
  kind,
  bookId,
  onKind,
  onBook
}: {
  counts: NoteCounts
  books: BookOption[]
  kind: NotesKind
  bookId: string | null
  onKind: (kind: NotesKind) => void
  onBook: (bookId: string | null) => void
}) {
  return (
    <nav className="notes-side" aria-label="笔记筛选">
      <div className="notes-side__section">类型</div>
      <ul className="notes-side__list">
        {KINDS.map((item) => (
          <li key={item}>
            <button
              type="button"
              className={`notes-side__item${kind === item ? ' is-on' : ''}`}
              aria-pressed={kind === item}
              onClick={() => onKind(item)}
            >
              <span className="notes-side__label">{KIND_LABELS[item]}</span>
              <span className="notes-side__count">{counts[item]}</span>
            </button>
          </li>
        ))}
      </ul>

      <div className="notes-side__section">按书</div>
      <ul className="notes-side__list">
        <li>
          <button
            type="button"
            className={`notes-side__item${bookId === null ? ' is-on' : ''}`}
            aria-pressed={bookId === null}
            onClick={() => onBook(null)}
          >
            <span className="notes-side__label">全部书籍</span>
            <span className="notes-side__count">{books.reduce((sum, b) => sum + b.count, 0)}</span>
          </button>
        </li>
        {books.map((book) => (
          <li key={book.bookId}>
            <button
              type="button"
              className={`notes-side__item${bookId === book.bookId ? ' is-on' : ''}`}
              aria-pressed={bookId === book.bookId}
              title={book.bookTitle}
              onClick={() => onBook(book.bookId)}
            >
              <span className="notes-side__label">{book.bookTitle}</span>
              <span className="notes-side__count">{book.count}</span>
            </button>
          </li>
        ))}
      </ul>

      <div className="notes-side__foot">
        笔记存在本地 SQLite 数据库里，随书一起备份，不联网同步。
      </div>
    </nav>
  )
}

export type { HighlightWithBook }
```

- [ ] **Step 5: 写笔记卡**

`src/features/notes/NoteCard.tsx`：

```tsx
import { useEffect, useState } from 'react'
import type { HighlightWithBook } from '@shared/types'
import type { HighlightColor } from '@shared/highlights'

/** 相对时间：一周以内按天说，再久就说到日期为止 */
function relativeTime(at: number, now: number): string {
  const days = Math.floor((now - at) / 86_400_000)
  if (days <= 0) return '今天'
  if (days === 1) return '昨天'
  if (days < 7) return `${days} 天前`
  if (days < 30) return `${Math.floor(days / 7)} 周前`
  return new Date(at).toLocaleDateString('zh-CN')
}

export function NoteCard({
  note,
  selected,
  highlightColor,
  onSelect,
  onOpen,
  onSaveNote,
  onRemove
}: {
  note: HighlightWithBook
  selected: boolean
  /** 阅读器里刚改过色时用得上；不传就用笔记自己存的那个颜色 */
  highlightColor?: HighlightColor
  onSelect: () => void
  onOpen: () => void
  onSaveNote: (note: string | null) => void
  onRemove: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(note.note ?? '')
  const [confirming, setConfirming] = useState(false)

  // 换了一条笔记就重置编辑态与草稿，否则会把上一条的批注串过去
  useEffect(() => {
    setEditing(false)
    setConfirming(false)
    setDraft(note.note ?? '')
  }, [note.id, note.note])

  const color = highlightColor ?? note.color

  return (
    <article
      className={`note${selected ? ' note--sel' : ''}`}
      data-color={color}
      onClick={onSelect}
      aria-current={selected || undefined}
    >
      <blockquote className="note__quote">
        <p>{note.text}</p>
      </blockquote>

      {editing ? (
        <div className="note__editor">
          <textarea
            className="note__textarea"
            value={draft}
            autoFocus
            placeholder="写一句批注"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                onSaveNote(draft)
                setEditing(false)
              }
              if (event.key === 'Escape') setEditing(false)
            }}
          />
          <div className="note__editor-foot">
            <button
              type="button"
              className="act"
              onClick={() => {
                onSaveNote(null)
                setEditing(false)
              }}
            >
              清空批注
            </button>
            <span className="notes-side__spacer" />
            <button type="button" className="act" onClick={() => setEditing(false)}>
              取消
            </button>
            <button
              type="button"
              className="act act--accent"
              onClick={() => {
                onSaveNote(draft)
                setEditing(false)
              }}
            >
              保存
            </button>
          </div>
        </div>
      ) : (
        note.note && (
          <div className="note__memo">
            <span className="note__label">批注</span>
            {note.note}
          </div>
        )
      )}

      <div className="note__foot">
        <span>{note.chapterTitle ?? '未知章节'}</span>
        <span className="note__dot">·</span>
        <span>{Math.round(note.percent * 100)}%</span>
        <span className="note__dot">·</span>
        <span>{relativeTime(note.updatedAt, Date.now())}</span>
        <span className="note__spacer" />
        {!editing && (
          <button
            type="button"
            className="act"
            onClick={(event) => {
              event.stopPropagation()
              setEditing(true)
            }}
          >
            {note.note ? '改批注' : '写批注'}
          </button>
        )}
        <button
          type="button"
          className="act act--accent"
          onClick={(event) => {
            event.stopPropagation()
            onOpen()
          }}
        >
          回到原文
        </button>
        <button
          type="button"
          className="act"
          onClick={(event) => {
            event.stopPropagation()
            if (confirming) onRemove()
            else setConfirming(true)
          }}
          onBlur={() => setConfirming(false)}
        >
          {confirming ? '确认删除' : '删除'}
        </button>
      </div>
    </article>
  )
}
```

卡片上的按钮都要 `stopPropagation`：卡片本身是「选中」的热区，点按钮不该顺带换掉右栏。

- [ ] **Step 6: 写右栏**

`src/features/notes/NoteContextPanel.tsx`：

```tsx
import { useEffect, useState } from 'react'
import type { HighlightContext, HighlightWithBook } from '@shared/types'

export function NoteContextPanel({
  note,
  onOpen
}: {
  note: HighlightWithBook | null
  onOpen: () => void
}) {
  const [context, setContext] = useState<HighlightContext | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!note) {
      setContext(null)
      return
    }
    let alive = true
    setLoading(true)
    void window.api.notes
      .context(note.id)
      .then((result) => {
        if (alive) setContext(result)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [note])

  if (!note) {
    return (
      <aside className="notes-aside">
        <div className="notes-aside__empty">选中左边任意一条笔记，这里显示它在书里的原文上下文。</div>
      </aside>
    )
  }

  return (
    <aside className="notes-aside">
      <div className="notes-aside__head">
        <div className="notes-aside__kicker">所选笔记</div>
        <div className="notes-aside__book">{note.bookTitle}</div>
        <div className="notes-aside__loc">
          {note.chapterTitle ?? '未知章节'} · 全书 {Math.round(note.percent * 100)}%
        </div>
      </div>

      <div className="notes-aside__body">
        {loading && <p className="notes-aside__hint">正在取上下文…</p>}

        {!loading && context?.located && (
          <div className="ctx">
            {context.before && <p>{context.before}</p>}
            <p className="ctx__cur">{context.matched}</p>
            {context.after && <p>{context.after}</p>}
          </div>
        )}

        {!loading && context && !context.located && (
          <div className="ctx">
            <p className="ctx__cur">{context.matched}</p>
            <p className="notes-aside__hint">
              没能在本章正文里重新定位到这段文字（可能跨了分块边界，或原文已被改动），
              这里只显示标注时存下的原句。
            </p>
          </div>
        )}

        <div className="notes-aside__note">上下文只读取当前章节，不解析全书，所以切换笔记是即时的。</div>
      </div>

      <div className="notes-aside__foot">
        <button type="button" className="btn btn--accent" onClick={onOpen}>
          回到原文位置
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => void navigator.clipboard.writeText(note.text)}
        >
          复制
        </button>
      </div>
    </aside>
  )
}
```

「没能在本章正文里重新定位到这段文字」这句就是能力降级的落点（硬规则 2）：不在界面里假装成功，而是说清发生了什么。

- [ ] **Step 7: 组装三栏**

`src/pages/NotesPage.tsx`：

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { HighlightColor, HighlightWithBook, ReadingTarget } from '@shared/types'
import { NoteCard } from '../features/notes/NoteCard'
import { NoteContextPanel } from '../features/notes/NoteContextPanel'
import { NotesFilters } from '../features/notes/NotesFilters'
import {
  applyFilter,
  bookOptions,
  countsByKind,
  groupByBook,
  resolveSelection,
  type NotesKind
} from '../features/notes/group'

export function NotesPage({ onOpenAt }: { onOpenAt: (target: ReadingTarget) => void }) {
  const [notes, setNotes] = useState<HighlightWithBook[]>([])
  const [error, setError] = useState<string | null>(null)
  const [kind, setKind] = useState<NotesKind>('all')
  const [bookId, setBookId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [collapsed, setCollapsed] = useState<readonly string[]>([])

  const load = useCallback(async () => {
    try {
      setNotes(await window.api.notes.listAll())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '笔记没读出来')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => applyFilter(notes, { kind, bookId }), [notes, kind, bookId])
  const groups = useMemo(() => groupByBook(filtered), [filtered])
  const books = useMemo(() => bookOptions(notes), [notes])
  const counts = useMemo(() => countsByKind(notes, bookId), [notes, bookId])
  const selected = useMemo(
    () => filtered.find((note) => note.id === resolveSelection(filtered, selectedId)) ?? null,
    [filtered, selectedId]
  )

  const changeKind = useCallback((next: NotesKind) => setKind(next), [])
  const changeBook = useCallback((next: string | null) => setBookId(next), [])

  const saveNote = useCallback(
    async (id: number, note: string | null) => {
      const updated = await window.api.notes.update(id, { note })
      if (updated) setNotes((list) => list.map((item) => (item.id === id ? updated : item)))
    },
    []
  )

  const removeNote = useCallback(async (id: number) => {
    await window.api.notes.remove(id)
    setNotes((list) => list.filter((item) => item.id !== id))
  }, [])

  const openNote = useCallback(
    (note: HighlightWithBook) => {
      onOpenAt({ bookId: note.bookId, chapterId: note.chapterId, cfi: note.startCfi })
    },
    [onOpenAt]
  )

  const toggleGroup = useCallback((key: string) => {
    setCollapsed((list) => (list.includes(key) ? list.filter((item) => item !== key) : [...list, key]))
  }, [])

  return (
    <div className="notes-page">
      <NotesFilters
        counts={counts}
        books={books}
        kind={kind}
        bookId={bookId}
        onKind={changeKind}
        onBook={changeBook}
      />

      <main className="notes-main">
        <div className="notes-bar">
          <span className="notes-bar__title">{bookId ? bookTitleOf(books, bookId) : '全部笔记'}</span>
          <span className="notes-bar__count">
            {filtered.length} 条 · 跨 {groups.length} 本书
          </span>
        </div>

        {error && <p className="notes-bar__error">{error}</p>}

        <div className="notes-scroll">
          {filtered.length === 0 && (
            <div className="notes-empty">
              这里还没有笔记。在阅读器里选中一段文字，浮条上点一个颜色就能划出第一条。
            </div>
          )}

          {groups.map((group) => {
            const folded = collapsed.includes(group.bookId)
            return (
              <section key={group.bookId} className="notes-group">
                <div className="notes-group__head">
                  <span className="notes-group__name">{group.bookTitle}</span>
                  <span className="notes-group__n">{group.count} 条</span>
                  <span className="notes-group__spacer" />
                  <button
                    type="button"
                    className="act"
                    onClick={() => toggleGroup(group.bookId)}
                    aria-expanded={!folded}
                  >
                    {folded ? '展开' : '折起'}
                  </button>
                </div>

                {!folded &&
                  group.notes.map((note) => (
                    <NoteCard
                      key={note.id}
                      note={note}
                      selected={selected?.id === note.id}
                      onSelect={() => setSelectedId(note.id)}
                      onOpen={() => openNote(note)}
                      onSaveNote={(text) => void saveNote(note.id, text)}
                      onRemove={() => void removeNote(note.id)}
                    />
                  ))}
              </section>
            )
          })}
        </div>
      </main>

      <NoteContextPanel note={selected} onOpen={() => selected && openNote(selected)} />
    </div>
  )
}

function bookTitleOf(books: { bookId: string; bookTitle: string }[], bookId: string): string {
  return books.find((book) => book.bookId === bookId)?.bookTitle ?? '全部笔记'
}
```

`src/features/notes/group.ts` 与 `shared/types.ts` 都还没有 `HighlightColor` 的位置：`NoteCard` 的 `highlightColor` 这个可选 prop 本计划用不上（阅读器与笔记页是互斥的两个视图，不可能同时改色），所以 `NotesPage` 不传它，`HighlightColor` 的 import 也可以从 `NotesPage` 里去掉。写完跑 `npx tsc --noEmit`，报未使用就删。

- [ ] **Step 8: 加样式**

追加到 `src/styles/base.css` 末尾：

```css
/* ---- 笔记页三栏 ---- */
.notes-page {
  height: 100%;
  display: flex;
  overflow: hidden;
}

.notes-side {
  flex: 0 0 248px;
  display: flex;
  flex-direction: column;
  gap: var(--s1);
  padding: var(--s3) var(--s2);
  background: var(--panel);
  border-right: 1px solid var(--line);
  overflow-y: auto;
}

.notes-side__section {
  padding: var(--s3) var(--s2) var(--s1);
  color: var(--ink-muted);
  font-size: 11px;
  letter-spacing: 0.06em;
}

.notes-side__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.notes-side__item {
  width: 100%;
  min-height: 30px;
  display: flex;
  align-items: center;
  gap: var(--s2);
  padding: 0 var(--s2);
  border-radius: var(--r-sm);
  color: var(--ink-muted);
  font-size: 13px;
  text-align: left;
}

.notes-side__item:hover {
  background: var(--hover);
  color: var(--ink);
}

.notes-side__item.is-on {
  background: var(--active);
  color: var(--ink);
}

.notes-side__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.notes-side__count {
  color: var(--ink-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.notes-side__spacer {
  flex: 1;
}

.notes-side__foot {
  margin-top: auto;
  padding: var(--s3) var(--s2) 0;
  border-top: 1px solid var(--line);
  color: var(--ink-muted);
  font-size: 11px;
  line-height: 1.7;
}

.notes-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--shell);
}

.notes-bar {
  flex: 0 0 40px;
  display: flex;
  align-items: center;
  gap: var(--s3);
  padding: 0 var(--s4);
  border-bottom: 1px solid var(--line);
  font-size: 13px;
}

.notes-bar__title {
  font-weight: 600;
}

.notes-bar__count {
  color: var(--ink-muted);
  font-size: 12px;
}

.notes-bar__error {
  margin: 0;
  padding: 6px var(--s4);
  background: var(--panel);
  border-bottom: 1px solid var(--line);
  color: var(--accent-mark);
  font-size: 12px;
}

.notes-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 var(--s4) var(--s6);
}

.notes-empty {
  padding: var(--s6) var(--s4);
  color: var(--ink-muted);
  font-size: 13px;
}

/* 分组头吸顶：滚的是 .notes-scroll，吸顶就相对它 */
.notes-group__head {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: var(--s2);
  margin: 0 calc(var(--s4) * -1);
  padding: var(--s2) var(--s4);
  background: var(--shell);
  border-bottom: 1px solid var(--line);
}

.notes-group__name {
  font-size: 13px;
  font-weight: 600;
}

.notes-group__n {
  color: var(--ink-muted);
  font-size: 12px;
}

.notes-group__spacer {
  flex: 1;
}

/* ---- 笔记卡 ---- */
.note {
  position: relative;
  margin: var(--s3) 0;
  padding: var(--s3) var(--s3) var(--s2) var(--s4);
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  cursor: pointer;
  transition: border-color var(--ease), box-shadow var(--ease);
}

/* 左侧色条对应书内高亮颜色（spec §4.5） */
.note::before {
  content: '';
  position: absolute;
  left: 0;
  top: var(--s3);
  bottom: var(--s3);
  width: 3px;
  border-radius: 0 2px 2px 0;
  background: var(--hl-yellow);
}

.note[data-color='yellow']::before { background: var(--hl-yellow); }
.note[data-color='green']::before { background: var(--hl-green); }
.note[data-color='blue']::before { background: var(--hl-blue); }
.note[data-color='pink']::before { background: var(--hl-pink); }

.note:hover {
  border-color: color-mix(in srgb, var(--ink) 18%, transparent);
}

.note--sel {
  border-color: var(--ink-muted);
  box-shadow: var(--shadow-sheet);
}

.note__quote {
  margin: 0 0 var(--s2);
  padding: 0 0 0 var(--s2);
  border-left: 1px solid var(--line);
  color: var(--ink);
  font-family: var(--serif);
  font-size: 14px;
  line-height: 1.75;
}

.note__quote p {
  margin: 0;
}

.note__memo {
  margin-bottom: var(--s2);
  padding: var(--s2);
  background: var(--panel);
  border-radius: var(--r-sm);
  color: var(--ink-muted);
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
}

.note__label {
  margin-right: var(--s2);
  color: var(--ink-muted);
  font-size: 11px;
  letter-spacing: 0.06em;
}

.note__editor {
  display: flex;
  flex-direction: column;
  gap: var(--s2);
  margin-bottom: var(--s2);
}

.note__textarea {
  min-height: 64px;
  padding: var(--s2);
  resize: vertical;
  background: var(--paper-raised);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  color: var(--ink);
  font: inherit;
  font-size: 13px;
  line-height: 1.7;
}

.note__editor-foot,
.note__foot {
  display: flex;
  align-items: center;
  gap: var(--s2);
  color: var(--ink-muted);
  font-size: 12px;
}

.note__dot {
  opacity: 0.6;
}

.note__spacer {
  flex: 1;
}

.act {
  height: 26px;
  padding: 0 8px;
  border-radius: var(--r-sm);
  color: var(--ink-muted);
  font-size: 12px;
  transition: background var(--ease), color var(--ease);
}

.act:hover {
  background: var(--hover);
  color: var(--ink);
}

.act--accent {
  color: var(--accent-mark);
}

.act--accent:hover {
  background: color-mix(in srgb, var(--accent-mark) 12%, transparent);
  color: var(--accent-mark);
}

/* ---- 右栏 ---- */
.notes-aside {
  flex: 0 0 360px;
  display: flex;
  flex-direction: column;
  background: var(--panel);
  border-left: 1px solid var(--line);
}

.notes-aside__empty,
.notes-aside__hint {
  margin: 0;
  padding: var(--s3) var(--s4);
  color: var(--ink-muted);
  font-size: 12px;
  line-height: 1.7;
}

.notes-aside__head {
  padding: var(--s3) var(--s4);
  border-bottom: 1px solid var(--line);
}

.notes-aside__kicker {
  color: var(--ink-muted);
  font-size: 11px;
  letter-spacing: 0.06em;
}

.notes-aside__book {
  margin-top: 2px;
  font-size: 14px;
  font-weight: 600;
}

.notes-aside__loc {
  margin-top: 2px;
  color: var(--ink-muted);
  font-size: 12px;
}

.notes-aside__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--s3) var(--s4);
}

.notes-aside__note {
  margin-top: var(--s4);
  padding-top: var(--s3);
  border-top: 1px solid var(--line);
  color: var(--ink-muted);
  font-size: 11px;
  line-height: 1.7;
}

.notes-aside__foot {
  display: flex;
  gap: var(--s2);
  padding: var(--s3) var(--s4);
  border-top: 1px solid var(--line);
}

.notes-aside__foot .btn {
  flex: 1;
  justify-content: center;
}

.ctx p {
  margin: 0 0 var(--s3);
  color: var(--ink-muted);
  font-family: var(--serif);
  font-size: 13px;
  line-height: 1.8;
}

/* 命中那一段：只有它是正文的颜色，前后文故意压低 */
.ctx .ctx__cur {
  margin: 0 0 var(--s3);
  padding-left: var(--s2);
  border-left: 2px solid var(--accent-mark);
  color: var(--ink);
  font-family: var(--serif);
  font-size: 14px;
  line-height: 1.8;
}
```

`.notes-side` 里的 `gap: var(--s1)` 依赖 `--s1: 4px`（计划 01 的 tokens 里有），别写成 `--s-1`。

- [ ] **Step 9: 写 e2e**

`e2e/notes.spec.ts`：

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { nestedTocFiles, novelFiles, writeEpub } from '../fixtures/make-epub'
import { launchAppWithUserData } from './helpers'

test('跨书汇总、类型筛选、右栏上下文、回到原文', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-notes-'))
  const novelPath = join(userDataDir, 'novel.epub')
  const techPath = join(userDataDir, 'tech.epub')
  await writeEpub(novelPath, novelFiles())
  await writeEpub(techPath, nestedTocFiles())

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()

  const novelId = await win.evaluate(
    async (file) => (await (window as any).api.library.importPath(file)).bookId as string,
    novelPath
  )
  const techId = await win.evaluate(
    async (file) => (await (window as any).api.library.importPath(file)).bookId as string,
    techPath
  )

  // 第一本：《河边的月亮》第一章，走真实划词路径建一条带批注的高亮
  await win.locator('.book-list__open').first().click()
  await win.locator('iframe.reader__view').waitFor()
  const picked = await win.evaluate(() => {
    const frame = document.querySelector('iframe.reader__view') as HTMLIFrameElement
    const doc = frame.contentDocument!
    const node = doc.querySelector('p')!.firstChild as Text
    const end = Math.min(9, node.length)
    const range = doc.createRange()
    range.setStart(node, 0)
    range.setEnd(node, end)
    const selection = doc.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    return node.nodeValue!.slice(0, end)
  })
  await win.locator('.sel-dot--yellow').click()
  await win.locator('.annot__note').fill('开篇就把手机瘾写出来了')
  await win.locator('button:has-text("保存批注")').click()
  await win.locator('button:has-text("返回书架")').click()

  // 第二本：《深入理解定位》，直接用 API 建一条纯高亮（原文取自夹具）
  const techChapterId = await win.evaluate(async (id) => {
    const chapters = await (window as any).api.library.chapters(id)
    return chapters.find((c: { title: string }) => c.title === '第 1 节 笛卡尔').id as number
  }, techId)
  await win.evaluate(
    async ({ bookId, chapterId }) => {
      await (window as any).api.notes.create({
        bookId,
        chapterId,
        startCfi: 'epubcfi(/6/4!/4/2/1:0)',
        endCfi: 'epubcfi(/6/4!/4/2/1:6)',
        text: '笛卡尔坐标系用两根轴描述平面上的点。',
        color: 'blue'
      })
    },
    { bookId: techId, chapterId: techChapterId }
  )

  await win.locator('.nav-item:has-text("笔记")').click()

  // 分组与计数
  await expect(win.locator('.notes-group__head')).toHaveCount(2)
  await expect(win.locator('.notes-bar__count')).toHaveText('2 条 · 跨 2 本书')
  await expect(win.locator('.note')).toHaveCount(2)

  // 类型筛选
  await win.locator('.notes-side__item:has-text("仅有批注")').click()
  await expect(win.locator('.note')).toHaveCount(1)
  await expect(win.locator('.note__memo')).toContainText('开篇就把手机瘾写出来了')

  // 右栏上下文：命中那一段的原文要出现
  await expect(win.locator('.ctx__cur')).toHaveText(picked)

  // 回到原文：应该打开《河边的月亮》并停在第一章
  await win.locator('button:has-text("回到原文位置")').click()
  await expect(win.locator('.reader__chapter')).toHaveText('第一章 河边')

  // 回笔记页确认删掉后计数跟着变
  await win.locator('button:has-text("返回书架")').click()
  await win.locator('.nav-item:has-text("笔记")').click()
  await win.locator('.notes-side__item:has-text("全部笔记")').click()
  await win.locator('.note').first().locator('button:has-text("删除")').click()
  await win.locator('.note').first().locator('button:has-text("确认删除")').click()
  await expect(win.locator('.notes-bar__count')).toHaveText('1 条 · 跨 1 本书')

  expect(await win.evaluate((id) => (window as any).api.notes.listAll(), novelId)).toHaveLength(0)

  await app.close()
})
```

夹具里的两本书书名不同（《河边的月亮》与《深入理解定位》），所以分组一定是两组；`.notes-bar__count` 里的「跨 N 本书」数是分组数，不是书库里书的数量。

- [ ] **Step 10: 跑 e2e**

Run: `npm run e2e -- e2e/notes.spec.ts`

Expected: PASS，1 passed。

排查指引：

- `.notes-group__head` 只有 1 个 → 第二条（API 建的）没入库。确认 `chapterId` 是从 `library.chapters` 里按标题找出来的，不是硬编码。
- `.ctx__cur` 不匹配 → `highlightContext` 里 chunk 没命中。用 `.ctx` 是否存在先区分「没定位到」与「没渲染」，再看 `.notes-aside__hint` 的文案。
- 点「回到原文位置」后停在别章 → `openNote` 传的 `chapterId` 是 `note.chapterId`，而 `ReaderPage` 用它去 `readable`（`href !== ''` 的章节）里 `findIndex`。若某些书里该章确实没有正文，就会落到 0，这是设计内的降级。

- [ ] **Step 11: 跑全量测试**

Run: `npm test && npm run e2e`

Expected: 全 PASS。

- [ ] **Step 12: Commit**

```bash
git add src/features/notes src/pages/NotesPage.tsx src/styles/base.css tests/notes-group.test.ts e2e/notes.spec.ts
git commit -m "feat: 笔记页三栏（跨书汇总、类型与书籍筛选、右栏原文上下文、回到原文）"
```

---

### Task 7: 导出 Markdown

**Files:**
- Create: `electron/main/notes/export.ts`, `src/features/notes/ExportPopover.tsx`, `tests/notes-export.test.ts`, `e2e/export.spec.ts`
- Modify: `shared/ipc.ts`, `electron/main/ipc/notes.ts`, `electron/preload/index.ts`, `src/pages/NotesPage.tsx`, `src/styles/base.css`

- [ ] **Step 1: 写 Markdown 生成的失败测试**

`tests/notes-export.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { buildMarkdown, type ExportEntry } from '../electron/main/notes/export'

const AT = new Date('2026-09-29T21:40:00+08:00')

const ENTRIES: ExportEntry[] = [
  {
    bookTitle: '深度工作',
    chapterTitle: '第二章 注意力的形状',
    percent: 0.38,
    text: '不是有什么必须处理的事情，只是那个动作本身已经长进了肌肉里。',
    note: '和《习惯的力量》的回路是一回事。',
    context: {
      located: true,
      chapterTitle: '第二章 注意力的形状',
      before: '那种安静，他后来很少遇到了。',
      matched: '不是有什么必须处理的事情，只是那个动作本身已经长进了肌肉里。',
      after: '要把它拔出来，得费些力气。'
    }
  },
  {
    bookTitle: '思考，快与慢',
    chapterTitle: '第五章 你的直觉可能只是错觉',
    percent: 0.82,
    text: '我们对自己的无知视而不见。',
    note: null,
    context: null
  }
]

describe('buildMarkdown', () => {
  it('带书名分节、引文用引用块、批注单独一段', () => {
    const md = buildMarkdown(ENTRIES, { includeNotes: true, includeLocation: true, includeContext: false }, AT)
    expect(md).toContain('# 读书笔记')
    expect(md).toContain('## 深度工作')
    expect(md).toContain('## 思考，快与慢')
    expect(md).toContain('### 第二章 注意力的形状 · 全书 38%')
    expect(md).toContain('> 不是有什么必须处理的事情，只是那个动作本身已经长进了肌肉里。')
    expect(md).toContain('**我的批注**：和《习惯的力量》的回路是一回事。')
    // 没写批注的那条不该凭空长出一行批注
    expect(md.match(/\*\*我的批注\*\*/g)).toHaveLength(1)
  })

  it('关掉批注与位置后，只有书名与引文', () => {
    const md = buildMarkdown(ENTRIES, { includeNotes: false, includeLocation: false, includeContext: false }, AT)
    expect(md).not.toContain('我的批注')
    expect(md).not.toContain('全书 38%')
    expect(md).toContain('> 我们对自己的无知视而不见。')
  })

  it('附上下文时把命中那一段加粗，前后文各一段', () => {
    const md = buildMarkdown(ENTRIES, { includeNotes: false, includeLocation: false, includeContext: true }, AT)
    expect(md).toContain('> 那种安静，他后来很少遇到了。')
    expect(md).toContain('> **不是有什么必须处理的事情，只是那个动作本身已经长进了肌肉里。**')
    expect(md).toContain('> 要把它拔出来，得费些力气。')
  })

  it('没定位到上下文的条目不生成空引用块，也不留「undefined」', () => {
    const md = buildMarkdown(ENTRIES, { includeNotes: false, includeLocation: false, includeContext: true }, AT)
    expect(md).not.toContain('undefined')
    expect(md).not.toContain('> \n')
  })

  it('表头写明条数与书名数', () => {
    const md = buildMarkdown(ENTRIES, { includeNotes: true, includeLocation: true, includeContext: false }, AT)
    expect(md).toContain('共 2 条 · 跨 2 本书')
  })

  it('空列表只出表头，不抛错', () => {
    const md = buildMarkdown([], { includeNotes: true, includeLocation: true, includeContext: false }, AT)
    expect(md).toContain('共 0 条 · 跨 0 本书')
    expect(md).not.toContain('## ')
  })
})
```

- [ ] **Step 2: 写 Markdown 生成**

`electron/main/notes/export.ts`：

```ts
import type { Database } from 'better-sqlite3'
import type {
  HighlightContext,
  NotesExportOptions,
  NotesExportPreview
} from '@shared/types'
import { highlightContext, listAllHighlights } from './repo'

export type ExportEntry = {
  bookTitle: string
  chapterTitle: string | null
  percent: number
  text: string
  note: string | null
  /** 只有 includeContext 为 true 时才需要填，其余情况传 null */
  context: HighlightContext | null
}

/**
 * 由高亮列表生成一份 Markdown。
 *
 * 纯函数，不碰数据库也不碰文件：本机导出是用户要拿去别处用的东西，
 * 它必须能被逐条断言，而不是靠「导出完看一眼」。
 */
export function buildMarkdown(
  entries: readonly ExportEntry[],
  options: NotesExportOptions,
  now: Date
): string {
  const books = new Set(entries.map((entry) => entry.bookTitle))
  const lines: string[] = [
    '# 读书笔记',
    '',
    `导出时间：${stamp(now)} · 共 ${entries.length} 条 · 跨 ${books.size} 本书`,
    ''
  ]

  let currentBook: string | null = null
  for (const entry of entries) {
    if (entry.bookTitle !== currentBook) {
      currentBook = entry.bookTitle
      lines.push(`## ${entry.bookTitle}`, '')
    }

    if (options.includeLocation) {
      const where = entry.chapterTitle ?? '未知章节'
      lines.push(`### ${where} · 全书 ${Math.round(entry.percent * 100)}%`, '')
    }

    lines.push(`> ${entry.text}`, '')

    if (options.includeNotes && entry.note) {
      lines.push(`**我的批注**：${entry.note}`, '')
    }

    if (options.includeContext) {
      const block = contextBlock(entry.context)
      if (block.length > 0) lines.push(...block, '')
    }
  }

  return `${lines.join('\n').trimEnd()}\n`
}

/**
 * 上下文块。
 *
 * 命中那一段加粗：导出去到别处（Obsidian、Notion、微信）时，
 * 读者要能一眼分出「被划的那句」和它周围的原话。
 *
 * 没能定位到（`located` 为 false）就返回空数组，让调用方整块跳过——
 * 生成一行空的 `> ` 比什么都不生成更糟。
 */
function contextBlock(context: HighlightContext | null): string[] {
  if (!context || !context.located) return []
  const lines: string[] = []
  if (context.before) lines.push(`> ${context.before}`)
  lines.push(`> **${context.matched}**`)
  if (context.after) lines.push(`> ${context.after}`)
  return lines
}

/** 表头用：2026-09-29 21:40 */
function stamp(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  return `${date} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

/** 默认文件名用：2026-09-29-2140。冒号在 Windows 上是非法字符，所以时刻不加分隔符 */
export function fileStamp(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  return `${date}-${pad(now.getHours())}${pad(now.getMinutes())}`
}

/**
 * 取要导出的条目。
 *
 * `ids` 为 null 表示「全部」。给了数组就按**数据库顺序**过滤，而不是按 ids 的先后——
 * `buildMarkdown` 靠「相邻同名书」分节，顺序一乱会把同一本书拆成好几个 `## `。
 */
export function collectEntries(
  db: Database.Database,
  ids: readonly number[] | null,
  options: NotesExportOptions
): ExportEntry[] {
  const all = listAllHighlights(db)
  const picked = ids === null ? all : all.filter((item) => ids.includes(item.id))
  return picked.map((item) => ({
    bookTitle: item.bookTitle,
    chapterTitle: item.chapterTitle,
    percent: item.percent,
    text: item.text,
    note: item.note,
    context: options.includeContext ? highlightContext(db, item.id) : null
  }))
}

/** 预览与真正导出走同一条路：浮层里看见的就是落盘的那一份 */
export function previewExport(
  db: Database.Database,
  ids: readonly number[] | null,
  options: NotesExportOptions,
  now: number
): NotesExportPreview {
  const entries = collectEntries(db, ids, options)
  const unlocated = entries.filter((entry) => entry.context !== null && !entry.context.located).length
  return {
    markdown: buildMarkdown(entries, options, new Date(now)),
    total: entries.length,
    unlocated
  }
}
```

`export.ts` 只 import `repo.ts`，`repo.ts` 里 `better-sqlite3` 是 `import type`，运行时不会加载原生模块——所以这个文件能被 vitest 直接跑。

- [ ] **Step 3: 跑它，确认通过**

Run: `npx vitest run tests/notes-export.test.ts`

Expected: PASS，6 passed。

若 `>` 前后多出空格导致 `not.toContain('> \n')` 失败，检查 `contextBlock`：`> ` 后面直接接内容，不要写 `> ` 再拼一个已带空格的字符串。

- [ ] **Step 4: 加导出通道、返回类型与 preload**

`shared/ipc.ts` 的 `CH` 追加：

```ts
  notesPreviewExport: 'notes:previewExport',
  notesExportMarkdown: 'notes:exportMarkdown'
```

`API_SHAPE` 的 `notes` 改成完整形态：

```ts
  notes: [
    'listChapter',
    'listAll',
    'create',
    'update',
    'remove',
    'context',
    'previewExport',
    'exportMarkdown'
  ]
```

`shared/types.ts` 追加：

```ts
/** 导出落盘的结果。用户点了「取消」也是正常路径，所以用 saved 而不是抛错 */
export type NotesExportResult = {
  saved: boolean
  path: string | null
}
```

`electron/main/ipc/notes.ts` 顶部补 import，并在 `registerNotesIpc` 末尾追加两个 handler：

```ts
import { writeFile } from 'node:fs/promises'
import { dialog, ipcMain } from 'electron'
import type { NotesExportOptions, NotesExportResult } from '@shared/types'
import { fileStamp, previewExport } from '../notes/export'
```

```ts
  ipcMain.handle(
    CH.notesPreviewExport,
    (_event, ids: number[] | null, options: NotesExportOptions) =>
      previewExport(getDatabase(), ids, options, Date.now())
  )

  ipcMain.handle(
    CH.notesExportMarkdown,
    async (_event, ids: number[] | null, options: NotesExportOptions): Promise<NotesExportResult> => {
      const now = new Date()
      const preview = previewExport(getDatabase(), ids, options, now.getTime())

      // 保存对话框归主进程：渲染进程碰不到 fs，也不该知道用户选了哪个目录
      const picked = await dialog.showSaveDialog({
        title: '导出 Markdown',
        defaultPath: `读书笔记-${fileStamp(now)}.md`,
        filters: [{ name: 'Markdown', extensions: ['md'] }]
      })
      if (picked.canceled || !picked.filePath) return { saved: false, path: null }

      try {
        await writeFile(picked.filePath, preview.markdown, 'utf8')
      } catch (error) {
        throw new Error(toAppError(error, '文件没有写成功').message)
      }
      return { saved: true, path: picked.filePath }
    }
  )
```

`electron/preload/index.ts` 的 `notes` 里追加两项（`@shared/types` 的导入补上 `NotesExportOptions`、`NotesExportPreview`、`NotesExportResult`）：

```ts
    previewExport: (
      ids: number[] | null,
      options: NotesExportOptions
    ): Promise<NotesExportPreview> => ipcRenderer.invoke(CH.notesPreviewExport, ids, options),
    exportMarkdown: (
      ids: number[] | null,
      options: NotesExportOptions
    ): Promise<NotesExportResult> => ipcRenderer.invoke(CH.notesExportMarkdown, ids, options)
```

- [ ] **Step 5: 跑边界测试，确认契约没破**

Run: `npx tsc --noEmit && npm run e2e -- e2e/boundary.spec.ts`

Expected: PASS，1 passed。

`boundary.spec.ts` 是整表比对：`API_SHAPE.notes` 与 preload 上真实挂的方法必须一字不差。这一步就是它的用途。

- [ ] **Step 6: 写导出浮层**

`src/features/notes/ExportPopover.tsx`：

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { NotesExportOptions, NotesExportPreview } from '@shared/types'

const EMPTY: NotesExportPreview = { markdown: '', total: 0, unlocated: 0 }

/**
 * 导出浮层。
 *
 * 浮在标题栏里（spec §4.5），但状态属于笔记页——所以用 portal 把按钮塞进
 * `TitleBar` 留下的 `#titlebar-tools` 槽位，而不是把筛选结果一路提到 `App`。
 */
export function ExportPopover({
  allIds,
  filteredIds
}: {
  allIds: readonly number[]
  filteredIds: readonly number[]
}) {
  const [host, setHost] = useState<HTMLElement | null>(null)
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<'all' | 'filtered'>('all')
  const [options, setOptions] = useState<NotesExportOptions>({
    includeNotes: true,
    includeLocation: true,
    includeContext: false
  })
  const [preview, setPreview] = useState<NotesExportPreview>(EMPTY)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // 标题栏先于页面渲染，所以挂载后再取槽位；取不到就先不渲染
  useEffect(() => {
    setHost(document.getElementById('titlebar-tools'))
  }, [])

  const ids = useMemo(
    () => (scope === 'all' ? allIds : filteredIds),
    [scope, allIds, filteredIds]
  )

  // 预览永远跟着当前选项重算一次。数据在本地 sqlite，条数几十到几千，
  // 重算是毫秒级——比加一层缓存再处理失效便宜得多。
  useEffect(() => {
    if (!open) return
    let alive = true
    window.api.notes
      .previewExport([...ids], options)
      .then((result) => {
        if (!alive) return
        setPreview(result)
        setError(null)
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : '预览没生成出来')
      })
    return () => {
      alive = false
    }
  }, [open, ids, options])

  // 浮层压在正文之上，点别处或按 Esc 都要收起来
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (!target?.closest('.pop-wrap')) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = useCallback((key: keyof NotesExportOptions) => {
    setOptions((current) => ({ ...current, [key]: !current[key] }))
  }, [])

  const save = useCallback(async () => {
    setBusy(true)
    try {
      const result = await window.api.notes.exportMarkdown([...ids], options)
      // 用户点了取消不是错误：不清空上一次的「已导出」提示，也不报错
      if (result.saved) {
        setSaved(result.path)
        setError(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '导出没有成功')
    } finally {
      setBusy(false)
    }
  }, [ids, options])

  if (!host) return null

  return createPortal(
    <div className="pop-wrap">
      <button
        type="button"
        className="tb-btn tb-btn--accent"
        onClick={() => {
          setOpen((value) => !value)
          setSaved(null)
        }}
      >
        导出 Markdown
      </button>

      {open && (
        <div className="pop" role="dialog" aria-label="导出 Markdown">
          <div className="pop__title">导出 Markdown</div>

          <div className="pop__row">
            <span className="lb">范围</span>
            <div className="seg">
              <button
                type="button"
                className={`seg__b${scope === 'all' ? ' is-on' : ''}`}
                onClick={() => setScope('all')}
              >
                全部 {allIds.length} 条
              </button>
              <button
                type="button"
                className={`seg__b${scope === 'filtered' ? ' is-on' : ''}`}
                onClick={() => setScope('filtered')}
              >
                当前筛选 {filteredIds.length} 条
              </button>
            </div>
          </div>

          <label className="check">
            <input
              type="checkbox"
              checked={options.includeNotes}
              onChange={() => toggle('includeNotes')}
            />
            包含我的批注
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={options.includeLocation}
              onChange={() => toggle('includeLocation')}
            />
            包含章节与位置
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={options.includeContext}
              onChange={() => toggle('includeContext')}
            />
            附上原文上下文
            <span className="hint2">前后各一段</span>
          </label>

          {options.includeContext && preview.unlocated > 0 && (
            <p className="pop__warn">
              有 {preview.unlocated} 条没能在这本书的正文里重新定位到，
              导出时只会带上标注当时的原文。
            </p>
          )}

          {error && <p className="pop__warn">{error}</p>}

          <div className="pop__preview">
            {preview.total === 0 ? '还没有可导出的笔记。' : preview.markdown}
          </div>

          <div className="pop__foot">
            <span className="pop__done">{saved ? `已导出到 ${saved}` : ''}</span>
            <button
              type="button"
              className="btn btn--accent"
              disabled={busy || preview.total === 0}
              onClick={() => void save()}
            >
              {busy ? '导出中…' : '导出'}
            </button>
          </div>
        </div>
      )}
    </div>,
    host
  )
}
```

- [ ] **Step 7: 接进标题栏与笔记页**

`src/shell/TitleBar.tsx` 末尾加一个槽位（`ExportPopover` 用 portal 挂进来）：

```tsx
export function TitleBar({ title }: { title: string }) {
  const isMac = navigator.userAgent.includes('Mac')
  return (
    <header className="titlebar" style={{ paddingLeft: isMac ? 78 : 12 }}>
      <span className="titlebar__title">{title}</span>
      <span className="titlebar__spacer" />
      {/* 页面自己往这里渲染标题栏动作，见 ExportPopover */}
      <div className="titlebar__tools" id="titlebar-tools" />
    </header>
  )
}
```

`src/pages/NotesPage.tsx`：

```tsx
import { ExportPopover } from '../features/notes/ExportPopover'
```

在 `filtered` 那一组 `useMemo` 下面加：

```tsx
  const allIds = useMemo(() => notes.map((note) => note.id), [notes])
  const filteredIds = useMemo(() => filtered.map((note) => note.id), [filtered])
```

`.notes-bar` 那一段改成（导出按钮由 portal 渲染，这里只留槽位占位，保持 bar 的层次不变）：

```tsx
        <div className="notes-bar">
          <span className="notes-bar__title">{bookId ? bookTitleOf(books, bookId) : '全部笔记'}</span>
          <span className="notes-bar__count">
            {filtered.length} 条 · 跨 {groups.length} 本书
          </span>
        </div>
```

在组件 return 的**最外层 div 之前**插入（与 `<NotesFilters>` 平级）：

```tsx
      <ExportPopover allIds={allIds} filteredIds={filteredIds} />
```

- [ ] **Step 8: 加样式**

追加到 `src/styles/base.css` 末尾：

```css
/* ---- 标题栏工具区与导出浮层 ---- */
.titlebar__spacer {
  flex: 1;
}

.titlebar__tools {
  display: flex;
  align-items: center;
  gap: 2px;
  padding-right: var(--s3);
}

.tb-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border-radius: var(--r-sm);
  font-size: 13px;
  color: var(--ink-muted);
  transition: background var(--ease), color var(--ease);
}

.tb-btn:hover {
  background: var(--hover);
  color: var(--ink);
}

/* 标题栏上唯一的强调动作 */
.tb-btn--accent {
  color: var(--accent-mark);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-mark) 42%, transparent);
}

.tb-btn--accent:hover {
  background: color-mix(in srgb, var(--accent-mark) 10%, transparent);
  color: var(--accent-mark);
}

.pop-wrap {
  position: relative;
}

.pop {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 50;
  width: 380px;
  padding: var(--s3) var(--s4) 14px;
  background: var(--paper-raised);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-pop);
  cursor: default;
}

.pop__title {
  font-size: 13px;
  font-weight: 500;
  margin-bottom: var(--s2);
}

.pop__row {
  display: flex;
  align-items: center;
  gap: var(--s3);
  min-height: 30px;
}

.pop__row > .lb {
  flex: 0 0 32px;
  font-size: 12px;
  color: var(--ink-muted);
}

.pop__row .seg {
  flex: 1;
}

.check {
  display: flex;
  align-items: center;
  gap: var(--s2);
  min-height: 28px;
  font-size: 13px;
  cursor: pointer;
}

.check input {
  width: 13px;
  height: 13px;
  accent-color: var(--ink);
}

.check .hint2 {
  font-size: 11.5px;
  color: var(--ink-muted);
}

.pop__warn {
  margin: var(--s1) 0 0;
  color: var(--accent-mark);
  font-size: 12px;
  line-height: 1.6;
}

.pop__preview {
  margin: 10px 0 var(--s3);
  padding: 10px 12px;
  max-height: 152px;
  overflow-y: auto;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  font-family: var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 11.5px;
  line-height: 1.7;
  color: var(--ink-muted);
  white-space: pre-wrap;
  word-break: break-word;
}

.pop__foot {
  display: flex;
  align-items: center;
  gap: var(--s2);
}

.pop__done {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11.5px;
  color: var(--ink-muted);
}
```

`.btn` / `.btn--accent` / `.seg` / `.seg__b` / `.seg__b.is-on` / `--paper-raised` / `--shadow-pop` / `--mono` 在计划 01、04 里已经定义过，这里不重复写。若 `--mono` 没有定义，`font-family: var(--mono, ...)` 的兜底会接住，不用回头改 tokens。

- [ ] **Step 9: 写 e2e**

`e2e/export.spec.ts`：

```ts
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { novelFiles, writeEpub } from '../fixtures/make-epub'
import { launchAppWithUserData } from './helpers'

test('导出 Markdown：预览可见、落盘内容与预览一致、取消不报错', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-export-'))
  const epubPath = join(userDataDir, 'novel.epub')
  const outPath = join(userDataDir, 'notes.md')
  await writeEpub(epubPath, novelFiles())

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()

  // 「保存到哪」的系统对话框在测试里点不了，换成固定路径
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath, bookmark: '' })
  }, outPath)

  const bookId = await win.evaluate(
    async (file) => (await (window as any).api.library.importPath(file)).bookId as string,
    epubPath
  )
  const chapterId = await win.evaluate(async (id) => {
    const chapters = await (window as any).api.library.chapters(id)
    return chapters.find((c: { href: string }) => c.href !== '').id as number
  }, bookId)

  // 导出只吃库里存的 text，与这段话在原文里是否真能对上无关
  await win.evaluate(
    async ({ bookId, chapterId }) => {
      await (window as any).api.notes.create({
        bookId,
        chapterId,
        startCfi: 'epubcfi(/6/4!/4/2/1:0)',
        endCfi: 'epubcfi(/6/4!/4/2/1:6)',
        text: '月亮升起来的时候，河面像一条银带。',
        note: '开篇的定调',
        color: 'yellow'
      })
    },
    { bookId, chapterId }
  )

  await win.locator('.nav-item:has-text("笔记")').click()
  await win.locator('.tb-btn--accent').click()

  // 预览可见，而且是真内容
  await expect(win.locator('.pop__preview')).toContainText('# 读书笔记')
  await expect(win.locator('.pop__preview')).toContainText('共 1 条')
  await expect(win.locator('.pop__preview')).toContainText('**我的批注**：开篇的定调')

  // 选项会立刻反映到预览里
  await win.locator('.check:has-text("包含我的批注") input').uncheck()
  await expect(win.locator('.pop__preview')).not.toContainText('我的批注')
  await win.locator('.check:has-text("包含我的批注") input').check()
  await expect(win.locator('.pop__preview')).toContainText('我的批注')

  // 范围切到「当前筛选」：没有筛选时条数不变，但按钮得在
  await expect(win.locator('.seg__b:has-text("全部 1 条")')).toBeVisible()

  await win.locator('.pop__foot .btn--accent').click()
  await expect(win.locator('.pop__done')).toContainText('已导出到')

  // 落盘的那一份必须与浮层里看见的一致
  const written = readFileSync(outPath, 'utf8')
  expect(written).toContain('# 读书笔记')
  expect(written).toContain('> 月亮升起来的时候，河面像一条银带。')
  expect(written).toContain('**我的批注**：开篇的定调')
  expect(written.endsWith('\n')).toBe(true)

  // 用户点取消：不算失败，也不该再写文件
  await app.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => ({ canceled: true, filePath: '', bookmark: '' })
  })
  const before = readFileSync(outPath, 'utf8')
  await win.locator('.pop__foot .btn--accent').click()
  await expect(win.locator('.pop__done')).toContainText('已导出到')
  expect(readFileSync(outPath, 'utf8')).toBe(before)

  await app.close()
})
```

`app.evaluate` 的第一个参数是 Electron 主进程的 `{ app, dialog, ... }` 命名空间——`dialog.showSaveDialog` 是普通属性，直接换掉即可，不需要 mock 框架。

- [ ] **Step 10: 跑 e2e**

Run: `npm run e2e -- e2e/export.spec.ts`

Expected: PASS，1 passed。

排查指引：

- 点导出按钮没反应 → `#titlebar-tools` 没渲染。确认 `TitleBar` 已改成带 `titlebar__tools` 的版本，且 `ExportPopover` 的 `host` 状态不是 `null`。
- `.pop__preview` 里是「还没有可导出的笔记。」 → `ids` 传成了空数组。默认 `scope` 是 `'all'`，应传 `allIds`。
- 落盘文件不存在 → `dialog.showSaveDialog` 没被打桩。`app.evaluate` 里的 `dialog` 必须从参数解构出来，不能 `import { dialog } from 'electron'`。
- 顺序：`app.evaluate` 打桩必须在点导出之前执行，且 `launchAppWithUserData` 返回后才能 `evaluate`。

- [ ] **Step 11: 跑全量测试**

Run: `npm test && npm run e2e`

Expected: 全 PASS（vitest 与三条主线 e2e）。

- [ ] **Step 12: Commit**

```bash
git add electron/main/notes/export.ts electron/main/ipc/notes.ts shared/ipc.ts shared/types.ts \
  electron/preload/index.ts src/features/notes/ExportPopover.tsx src/shell/TitleBar.tsx \
  src/pages/NotesPage.tsx src/styles/base.css tests/notes-export.test.ts e2e/export.spec.ts
git commit -m "feat: 导出 Markdown（浮层预览、范围与三选项、保存对话框、取消不报错）"
```

---

## Self-Review

### spec 覆盖表

| spec 出处 | 要求 | 落在哪 |
|---|---|---|
| §4.5 | 划词高亮，四种颜色 | Task 1（配色契约）、Task 4（浮条 + 注入样式） |
| §4.5 | 批注只加不改原文，不插 `<mark>` | Task 4 Step 2（CSS Custom Highlight API） |
| §4.5 | 点高亮可改色 / 写批注 / 删除 | Task 4 Step 4（`HighlightPopover`） |
| §4.5 | 跨书汇总、按书分组、分组头吸顶 | Task 6 Step 2（`groupByBook`）、Step 8（`position: sticky`） |
| §4.5 | 每条笔记左侧色条对应书内高亮色 | Task 6 Step 5（`NoteCard` 的 `.note__bar`） |
| §4.5 | 右栏给出所选笔记的原文上下文 | Task 2 Step 3（`sliceContext`）、Task 6 Step 6（`NoteContextPanel`） |
| §4.5 | 导出 Markdown 走标题栏浮层、预览可见 | Task 7 Step 6（portal 进 `#titlebar-tools`）、Step 7（`TitleBar` 加槽位） |
| §2.2 | `highlights` 表结构 | 沿用计划 02 的 DDL，Task 2 只加仓储与类型 |
| §3.4 | 位置用 CFI 存，跨渲染可复原 | Task 1（`spanFromSelection` / `rangeFromSpan`） |
| §6.2 | CFI 计算、Markdown 导出要有纯函数单测 | Task 1、Task 2、Task 6、Task 7 各自的 `tests/*.test.ts` |
| §6.2 | 「划词高亮写笔记」是三条主线之一 | Task 4 Step 7、Task 6 Step 9 |
| §6.2 | 重启后笔记还在 | Task 6 Step 9 结尾用 `listAll` 落库断言；持久化本身在计划 01 已验证 |

有意不做（已在开头声明，此处不重复理由）：笔记搜索框、排序控件、每本书拆成独立文件、分组头封面缩略图。

### 占位符扫描

- 全文无 `TBD`、`TODO`、`类似 Task N`、`加上适当错误处理`。
- Task 7 Step 2 的 `export.ts` 是完整文件内容（含两个私有函数），不是片段。
- 每个 Task 的最后一个 Step 都是 commit，命令里的路径都真实存在。

### 命名与类型一致性

| 名字 | 定义处 | 使用处 | 一致 |
|---|---|---|---|
| `HighlightColor` / `HIGHLIGHT_COLORS` | `shared/highlights.ts`（Task 1） | `shared/types.ts`、`theme.ts`、`highlights.ts`(reader) | ✓ |
| `highlightRegistryName(color)` | Task 1 | reader `highlights.ts`、`theme.ts` 的 `::highlight()` 规则名 | ✓ |
| `CfiSpan` / `localParts` / `pointCfi` / `spanFromSelection` / `rangeFromSpan` / `containsPoint` / `anchorOf` | `src/features/reader/cfi.ts`（Task 1） | `paginator.ts`、`SelectionToolbar`、reader `highlights.ts`、`ReaderPage` | ✓ |
| `paintHighlights` / `clearHighlights` / `highlightAt` | `src/features/reader/highlights.ts`（Task 4） | `ReaderPage` | ✓ |
| `Highlight` / `HighlightWithBook` / `HighlightContext` | `shared/types.ts`（Task 2） | repo、IPC、preload、`NoteCard`、`NoteContextPanel` | ✓ |
| `ReadingTarget` | `shared/types.ts`（Task 2，Task 5 使用） | `App.tsx`、`ReaderPage`、`NotesPage.onOpenAt` | ✓ |
| `NotesExportOptions` / `NotesExportPreview` | `shared/types.ts`（Task 2 已加） | `export.ts`、`ExportPopover`、preload | ✓ |
| `NotesExportResult` | `shared/types.ts`（Task 7 Step 4） | IPC 返回、preload、`ExportPopover` | ✓ |
| `CH.notes*` 8 条 | `shared/ipc.ts`（Task 3 加 6 条、Task 7 加 2 条） | `ipc/notes.ts`、preload | ✓ 与 `API_SHAPE.notes` 逐项对齐 |
| `sliceContext` / `locate` / `CONTEXT_RADIUS` | `electron/main/notes/context.ts`（Task 2） | `repo.highlightContext` | ✓ |
| `collectEntries` / `previewExport` / `buildMarkdown` / `fileStamp` | `electron/main/notes/export.ts`（Task 7） | `ipc/notes.ts`、`tests/notes-export.test.ts` | ✓ |
| `applyFilter` / `groupByBook` / `countsByKind` / `bookOptions` / `resolveSelection` / `NotesKind` | `src/features/notes/group.ts`（Task 6） | `NotesPage`、`tests/notes-group.test.ts` | ✓ |

一致性上唯一需要执行者留意的地方：`notes.ts`(reader) 与 `notes/repo.ts`(main) 都叫「notes」，但一个在 `src/features/reader/`、一个在 `electron/main/`，且 import 路径完全不同（`./highlights` vs `../notes/repo`），不会混淆。

---

## Execution Handoff

计划已完成并保存到 `docs/superpowers/plans/2026-09-29-04-annotations-and-notes.md`。两种执行方式：

**1. Subagent-Driven（推荐）**——每个 Task 派一个全新的 subagent，Task 之间回到这里审阅，可快速迭代。本计划的 Task 粒度就是按这个切的：每个 Task 自带 `Files:` 清单、完整代码、可执行的验证命令与一个 commit。

**2. Inline Execution**——在当前会话里按 Task 顺序执行，中间设检查点批量审阅。

**本计划建议 Subagent-Driven**，理由是 Task 4 与 Task 6 的体量（单 Task 含 5–6 个新文件与 e2e）已经超出一个上下文窗口能稳稳装下的量，逐 Task 交付能保证每个 subagent 拿到干净上下文。

**执行前请先确认：** 计划 01、02、03 已全部落地并通过各自的 e2e——本计划的 Task 1 会改 `paginator.ts`、Task 4 会改 `theme.ts` 与 `ReaderPage.tsx`，这些都建立在 03 的成品之上。
