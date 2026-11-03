# 全库正文搜索结果浮层 Implementation Plan

> **For agentic workers:** implement this plan task-by-task, in order, checking off each step as it lands. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搜正文结果改为 App 级顶部浮层，进阅读后仍可浏览/点选；统一 10 条分页；输入与「搜正文」合成一组。

**Architecture:** 正文搜索状态上提到 `App`；`LibraryBodySearchOverlay` 常挂壳层；`LibraryPage` 只负责触发搜索与书名筛选；点命中 `setReading` 并收起浮层。

**Tech Stack:** React、现有 `library.searchAll`、vitest、Playwright。

**Spec:** [docs/superpowers/specs/2026-11-03-library-body-search-overlay-design.md](../specs/2026-11-03-library-body-search-overlay-design.md)

## Global Constraints

- 关闭结果保留输入框文字；书架 Esc 仍清空输入 + 结果
- 进阅读自动收起浮层；Esc 展开时先收起
- 每页 10 条；FTS LIMIT 仍 60
- 中文文案

## File map

| 文件 | 职责 |
|---|---|
| `src/features/library/hits.ts` | `PAGE_SIZE`、`sliceHitsPage`、`hitPageCount` |
| `tests/library-hits.test.ts` | 分页单测 |
| `src/features/library/LibraryBodySearchOverlay.tsx` | 浮层 UI（展开/收起/关闭/分页） |
| `src/features/library/useBodySearch.ts` | 正文搜索状态与 run/clear/close |
| `src/App.tsx` | 挂载浮层；阅读 Esc 先收起；onOpenAt 收起 |
| `src/pages/LibraryPage.tsx` | 去掉本地 body 状态，接 hook/props |
| `src/features/library/LibraryTitlebarTools.tsx` + CSS | 输入+搜正文合成组 |
| `e2e/library-search.spec.ts` | 进阅读后浮层仍在、可再点 |

---

### Task 1: 分页纯函数

**Files:** `src/features/library/hits.ts`, `tests/library-hits.test.ts`

- [x] 导出 `PAGE_SIZE = 10`、`sliceHitsPage(hits, page)`、`hitPageCount(total)`
- [x] vitest 覆盖边界（空、恰好一页、跨页）

### Task 2: `useBodySearch` + 浮层组件

**Files:** Create hook + `LibraryBodySearchOverlay.tsx`；改写/替换原 `LibrarySearchResults` 用法

- [x] hook：`query` 仍可由页面管；body 侧 `run(keyword)` / `close()`（保留 query）/ `clearAll()` / `collapse()` / `toggle` / `setPage`
- [x] 浮层：`open` 时列表+分页；`!open` 时细条；关闭按钮；busy/error
- [x] 去掉 PER_BOOK=5

### Task 3: App 接线

**Files:** `App.tsx`, `LibraryPage.tsx`, `ReaderPage` Esc 路径

- [x] App 持有 hook；渲染 overlay（有 body 会话时）
- [x] `onOpenAt`：`setReading` + `collapse()`
- [x] 阅读 `onRequestExit` 包装：浮层展开则 `collapse()`，否则原逻辑
- [x] LibraryPage 用 App 传入的 search API，不再本地存 hits

### Task 4: 标题栏视觉合成

**Files:** `LibraryTitlebarTools.tsx`, `base.css`

- [x] `.search-group` 包住 input + 搜正文按钮，共用边框

### Task 5: e2e

**Files:** `e2e/library-search.spec.ts`

- [x] 点命中后 `.libsearch` 细条仍可见；展开再点；关闭保留输入
