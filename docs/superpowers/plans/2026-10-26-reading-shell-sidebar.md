# 阅读壳层侧栏 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 阅读时壳层侧栏常驻并默认收成图标轨；去掉「返回书架」；目录/书签并入展开侧栏；所有离开阅读路径统一 Modal 确认。

**Architecture:** 废除 `App` 整页替换阅读器；始终渲染 `Sidebar` + 主区。`ReaderPage` 经 Context 把目录/书签交给侧栏。`requestExit` 统一确认后再 flush。版心不再在阅读器内扣 `TOC_WIDTH`；`aiPanelRange` 改为扣壳层侧栏实际宽度。

**Tech Stack:** React、现有 `Modal`、vitest、Playwright e2e。

**Spec:** [docs/superpowers/specs/2026-10-26-reading-shell-sidebar-design.md](../specs/2026-10-26-reading-shell-sidebar-design.md)

## Global Constraints

- 确认 UI 用 `Modal`，不用 `window.confirm`
- 进入阅读自动收起侧栏；退出强制展开；阅读中临时展开不持久化
- 打开离开确认期间忽略新的 `requestExit`
- 中文文案按 spec §2.2
- 同步更新所有依赖「返回书架」/ 阅读内 `.toc` 可见的 e2e

---

## File map

| 文件 | 职责 |
|---|---|
| `src/shell/sidebarWidth.ts` | `SIDEBAR_WIDTH=248`、`SIDEBAR_COLLAPSED_WIDTH=56` |
| `src/shell/ReadingChromeContext.tsx` | 目录/书签 Context + Provider |
| `src/shell/ExitReadingModal.tsx` | 离开确认 Modal |
| `src/shell/Sidebar.tsx` | collapsed / 阅读态 / 目录插槽 / 展开控件 |
| `src/App.tsx` | 常驻侧栏、`requestExit`、状态 |
| `src/features/reader/ReaderPage.tsx` / `ComicReader.tsx` | 去返回与独立 Toc；提供 Context；受控 exit |
| `src/features/reader/TocPanel.tsx` | 可嵌入侧栏 |
| `src/features/reader/layout.ts` | `aiPanelRange` 扣壳层侧栏宽 |
| `src/features/reader/chrome.ts` | 阅读顶栏左垫（侧栏已占左缘时减小） |
| `src/styles/base.css` | 折叠侧栏、阅读态样式 |
| `tests/reader-layout.test.ts` | 更新 AI 面板宽度假设 |
| `e2e/*.spec.ts` | 退出与目录交互路径 |

---

### Task 1: 宽度常量与 `aiPanelRange`

**Files:**
- Create: `src/shell/sidebarWidth.ts`
- Modify: `src/features/reader/layout.ts`
- Modify: `tests/reader-layout.test.ts`

- [ ] **Step 1: 新增宽度常量**

```ts
/** 壳层侧栏展开宽，与 `.sidebar` 的 flex-basis 一致 */
export const SIDEBAR_WIDTH = 248
/** 阅读时收起的图标轨宽，对齐 .uicraft.md */
export const SIDEBAR_COLLAPSED_WIDTH = 56
export const SIDEBAR_BORDER = 1
```

- [ ] **Step 2: `aiPanelRange` 改为接收 `shellSidebarWidth`**

```ts
export function aiPanelRange(input: {
  windowWidth: number
  prefs: ReadingPrefs
  /** 壳层侧栏当前占用（含与否由调用方决定；阅读收起传 56，展开/非阅读传 248） */
  shellSidebarWidth: number
}): { min: number; max: number } {
  const [min, cap] = PREFS_LIMITS.aiPanelWidth
  const room =
    input.windowWidth -
    input.shellSidebarWidth -
    SIDEBAR_BORDER -
    readingAreaWidth(input.prefs, input.windowWidth)
  return { min, max: Math.max(min, Math.min(cap, room)) }
}
```

保留 `TOC_WIDTH` 导出一段时间作别名或删掉并改注释；**选定：删除阅读器内 `TOC_WIDTH`/`TOC_BORDER`，调用方改用 shell 常量。**

- [ ] **Step 3: 更新 `tests/reader-layout.test.ts`**

`computeAiPanelWidth` / `aiPanelRange` 调用传入 `shellSidebarWidth: 248`（或测收起 56）。期望值按新公式重算：

- 2560 - 248 - 1 - readingArea → 仍应能到 720
- 1400 用例同步改注释与期望

- [ ] **Step 4: 跑测并提交**

```bash
npx vitest run tests/reader-layout.test.ts
git add src/shell/sidebarWidth.ts src/features/reader/layout.ts tests/reader-layout.test.ts
git commit -m "refactor: AI 面板宽度按壳层侧栏扣减"
```

---

### Task 2: ReadingChrome Context + ExitReadingModal

**Files:**
- Create: `src/shell/ReadingChromeContext.tsx`
- Create: `src/shell/ExitReadingModal.tsx`

- [ ] **Step 1: Context**

```tsx
import { createContext, useContext, type ReactNode } from 'react'
import type { Bookmark, ReaderChapter } from '@shared/types'

export type ReadingChromeValue = {
  chapters: ReaderChapter[]
  currentChapterId: number | null
  onSelectChapter: (chapterId: number) => void
  marks: readonly Bookmark[]
  currentMark: Bookmark | null
  onAddMark: () => void
  onRemoveMark: (id: number) => void
  onSelectMark: (bookmark: Bookmark) => void
  /** 漫画等无目录时为 false */
  showToc: boolean
}

const ReadingChromeContext = createContext<ReadingChromeValue | null>(null)

export function ReadingChromeProvider({
  value,
  children
}: {
  value: ReadingChromeValue
  children: ReactNode
}) {
  return (
    <ReadingChromeContext.Provider value={value}>{children}</ReadingChromeContext.Provider>
  )
}

export function useReadingChrome(): ReadingChromeValue | null {
  return useContext(ReadingChromeContext)
}
```

- [ ] **Step 2: ExitReadingModal**

```tsx
import { Modal } from './Modal'
import type { PageId } from './Sidebar'

const PAGE_LABEL: Record<PageId, string> = {
  library: '书架',
  notes: '笔记',
  settings: '设置'
}

export function ExitReadingModal({
  to,
  onCancel,
  onConfirm
}: {
  to: PageId | null
  onCancel: () => void
  onConfirm: () => void
}) {
  const body =
    to === null
      ? '进度会自动保存。确定离开阅读吗？'
      : `进度会自动保存。确定离开并前往「${PAGE_LABEL[to]}」吗？`
  return (
    <Modal title="离开阅读？" onClose={onCancel}>
      <p className="modal__text">{body}</p>
      <div className="modal__acts">
        <button type="button" className="btn" autoFocus onClick={onCancel}>
          取消
        </button>
        <button type="button" className="btn btn--accent" onClick={onConfirm}>
          离开
        </button>
      </div>
    </Modal>
  )
}
```

若尚无 `.modal__text` / `.modal__acts`，复用现有 Modal 内按钮排布样式（对照 TagManager）。

- [ ] **Step 3: Commit**

```bash
git add src/shell/ReadingChromeContext.tsx src/shell/ExitReadingModal.tsx
git commit -m "feat: 阅读目录 Context 与离开确认 Modal"
```

---

### Task 3: Sidebar 折叠与阅读态

**Files:**
- Modify: `src/shell/Sidebar.tsx`
- Modify: `src/styles/base.css`

- [ ] **Step 1: 扩展 Sidebar props**

新增：`collapsed: boolean`、`reading: boolean`、`onToggleCollapsed?: () => void`、`onSelect` 在阅读时由 App 包成 `requestExit`。

阅读·收起：只渲染三项 `nav-item`（`aria-label` = 文案，可见为简短图标字或首字）+ 展开按钮。  
阅读·展开：三项 + 收起按钮 + `useReadingChrome()` 有 `showToc` 时渲染 `TocPanel`。  
非阅读：行为与现网一致；忽略 `collapsed`（始终展开宽）。

- [ ] **Step 2: CSS**

```css
.sidebar--collapsed {
  flex: 0 0 56px;
  padding: var(--s3) var(--s1);
  align-items: stretch;
}
.sidebar--collapsed .nav-item {
  justify-content: center;
  padding: 0;
}
.sidebar--reading {
  /* macOS 顶留白：与 BAR_PAD_LEFT 等效，避免点到红绿灯 */
}
```

图标可用文案首字（书/笔/设）或内联 SVG；保持朴素，不引入新图标库。

- [ ] **Step 3: Commit**

```bash
git add src/shell/Sidebar.tsx src/styles/base.css
git commit -m "feat: 侧栏支持阅读折叠与目录嵌入"
```

---

### Task 4: App 常驻侧栏 + requestExit

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: 状态**

```ts
const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
const [exitDialog, setExitDialog] = useState<{ to: PageId | null } | null>(null)
const flushExitRef = useRef<(() => void) | null>(null)
```

- [ ] **Step 2: 结构**

始终渲染：

```tsx
<div className="app">
  {!reading && <TitleBar title={TITLES[page]} />}
  <div className="body">
    <Sidebar
      current={page}
      reading={reading !== null}
      collapsed={reading !== null && sidebarCollapsed}
      onToggleCollapsed={() => setSidebarCollapsed((v) => !v)}
      onSelect={(id) => (reading ? requestExit(id) : setPage(id))}
      ...
    />
    <main className="content">
      {reading ? (
        <ReaderPage
          ...
          registerFlushExit={(fn) => { flushExitRef.current = fn }}
          onRequestExit={() => requestExit(null)}
        />
      ) : (
        /* 原 pages */
      )}
    </main>
  </div>
  {exitDialog && (
    <ExitReadingModal
      to={exitDialog.to}
      onCancel={() => setExitDialog(null)}
      onConfirm={() => {
        flushExitRef.current?.()
        setReading(null)
        if (exitDialog.to !== null) setPage(exitDialog.to)
        setSidebarCollapsed(false)
        setExitDialog(null)
      }}
    />
  )}
</div>
```

`requestExit(to)`：若 `exitDialog` 已开则 return；否则 `setExitDialog({ to })`。

进入阅读：`useEffect` 当 `reading` 从 null→有值时 `setSidebarCollapsed(true)`。

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat: App 常驻侧栏与统一离开确认"
```

---

### Task 5: ReaderPage / ComicReader / TocPanel

**Files:**
- Modify: `src/features/reader/ReaderPage.tsx`
- Modify: `src/features/reader/ComicReader.tsx`
- Modify: `src/features/reader/TocPanel.tsx`
- Modify: `src/features/reader/chrome.ts`（可选减小 BAR_PAD_LEFT）

- [ ] **Step 1: 去掉「返回书架」与独立 Toc 挂载**

文字书 / 漫画 / 缺书态顶栏均删除返回按钮。`TocPanel` 不再渲染在 `.reader__body` 内。

- [ ] **Step 2: Provider**

`ReaderPage` 用 `ReadingChromeProvider` 包裹（或在 App 层由 Reader 回调——**选定：ReaderPage 根节点 Provider**，Sidebar 为兄弟时 Context 不可达！）

**重要修正：** Sidebar 与 ReaderPage 是兄弟，Provider 必须在 `App` 共同祖先。因此：

- `App` 持有 `readingChrome` state（或 `ReadingChromeProvider` 包住 `.body`）
- `ReaderPage` 通过 `onChromeChange(value | null)` 上报；卸载时清 null
- 或 App 用 Provider 包 `.body`，ReaderPage 内用 setter context 注册

**选定实现：**

```tsx
// App
<ReadingChromeProvider value={chrome}>
  <div className="body">...</div>
</ReadingChromeProvider>
```

ReaderPage：`useEffect` / 渲染期调用 `setReadingChrome(value)`（由第二 Context `ReadingChromeSetter` 提供），卸载清 null。

- [ ] **Step 3: Esc → `onRequestExit`；`registerFlushExit(exit)`**

- [ ] **Step 4: `computeAiPanelWidth` 传入当前壳层侧栏宽**（props `shellSidebarWidth`）

- [ ] **Step 5: Commit**

```bash
git add src/features/reader src/App.tsx src/shell
git commit -m "feat: 阅读器去返回按钮，目录经 Context 交给侧栏"
```

---

### Task 6: e2e 与手动路径对齐

**Files:**
- Modify: `e2e/reader.spec.ts`, `e2e/notes.spec.ts`, `e2e/reading-time.spec.ts`, `e2e/comic-import.spec.ts`, `e2e/bookmarks.spec.ts`, `e2e/reader-search.spec.ts`
- Optional helper in `e2e/helpers.ts`: `exitReading(win)`, `expandReaderSidebar(win)`

- [ ] **Step 1: helper**

```ts
export async function exitReading(win: Page): Promise<void> {
  await win.getByRole('button', { name: '书架', exact: true }).click()
  await win.getByRole('button', { name: '离开' }).click()
}

export async function ensureSidebarExpanded(win: Page): Promise<void> {
  const expand = win.getByRole('button', { name: '展开侧栏' })
  if (await expand.isVisible()) await expand.click()
}
```

- [ ] **Step 2: 替换所有「返回书架」点击为 `exitReading`**

- [ ] **Step 3: 书签/查找用例在操作 `.toc__*` 前 `ensureSidebarExpanded`**

- [ ] **Step 4: 跑相关 e2e + 单测**

```bash
npx vitest run tests/reader-layout.test.ts
npx playwright test e2e/bookmarks.spec.ts e2e/reader.spec.ts e2e/reading-time.spec.ts
```

- [ ] **Step 5: Commit**

```bash
git add e2e
git commit -m "test: 阅读退出与侧栏目录的 e2e 对齐"
```

---

## Spec coverage checklist

| Spec 项 | Task |
|---|---|
| 去返回书架 | 5 |
| 常驻侧栏、进收起出展开 | 3, 4 |
| 目录并入展开侧栏 | 2, 3, 5 |
| 全路径确认 Modal | 2, 4, 5 |
| 版心/AI 宽不再扣阅读内 Toc | 1, 5 |
| 漫画无目录 | 5 |
| e2e | 6 |
