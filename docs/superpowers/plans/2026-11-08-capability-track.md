# 学习脉络（Capability Track）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地单活跃 Track：目标成树 + 书库挂载手改 + 主动「问缺」+ 主导航「脉络」页。

**Architecture:** 新域 `track`（表 / repo / 纯信号与树校验 / 两个显式 AI 任务）挂到主进程；花钱走现有 `AiQueue` 单通道；渲染进程只通过 `window.api.track.*` 白名单。不复用 `ai_results`（强制 `book_id`）。

**Tech Stack:** Electron 主进程、better-sqlite3、React 19、vitest、Playwright；OpenAI 兼容 chat（现有 `OpenAICompatProvider`）。

**Spec:** [docs/superpowers/specs/2026-11-08-capability-track-design.md](../specs/2026-11-08-capability-track-design.md)

## Global Constraints

- AI 永不后台自动调用；成树 / 问缺均需用户显式触发 + 确认框（build）
- 能力降级明说（无 JSON mode、Top-N 截断、无 key）
- 渲染进程零能力；密钥与模型调用只在主进程
- 单通道串行（复用 `electron/main/ai/queue.ts` 的 `AiQueue`）
- V1：仅 1 个 `active` Track；树 depth 1–3；无测验 / 外链导购 / 节点跨书长对话
- 中文 UI 文案；commit 消息遵循仓库中文 Conventional Commits
- 缺口权重默认锁定：`highlight*1 + note*2 + aiNote*3`（note = 有批注文案的高亮）

## File map

| 文件 | 职责 |
|---|---|
| `shared/track.ts` | Track 常量、信号权重、树/缺口类型、纯函数校验与 fingerprint 原文 |
| `shared/types.ts` | 导出 Track 相关视图类型（供 preload / 渲染） |
| `shared/ipc.ts` | `CH.track*`、`API_SHAPE.track` |
| `electron/main/store/migrations.ts` | v8：四张 track 表 |
| `electron/main/track/signals.ts` | 从行数据算每节点 A/B/C 与 fingerprint |
| `electron/main/track/repo.ts` | tracks / nodes / links / track_ai_results CRUD |
| `electron/main/track/validate.ts` | 模型骨架 JSON → 规范化节点；挂载 bookId 过滤 |
| `electron/main/track/prompts.ts` | build / gap 提示词（带 `TRACK_PROMPT_VERSION`） |
| `electron/main/track/tasks.ts` | `runTrackBuild` / `runTrackGap`（askJson 模式对齐 ai/tasks） |
| `electron/main/track/library-summary.ts` | 书库摘要 Top-N 挑选 |
| `electron/main/ipc/track.ts` | IPC handlers |
| `electron/main/ipc/index.ts` | `registerTrackIpc()` |
| `electron/preload/index.ts` | `api.track` |
| `src/features/track/*` | 脉络页 UI |
| `src/shell/Sidebar.tsx` / `src/App.tsx` | 导航「脉络」 |
| `tests/track-*.test.ts` | 纯函数与 migration |
| `e2e/track.spec.ts` | 无 key 空态 + mock 问缺（若 e2e 无 mock AI，则只测空态与导航） |

---

### Task 1: 共享类型、信号纯函数、树校验

**Files:**
- Create: `shared/track.ts`
- Create: `tests/track-signals.test.ts`
- Create: `tests/track-validate.test.ts`
- Modify: `shared/types.ts`（re-export 或并列导出 Track 视图类型）

**Interfaces:**
- Produces:
  - `TRACK_PROMPT_VERSION = 'v1'`
  - `SEDIMENT_WEIGHTS = { highlight: 1, note: 2, aiNote: 3 }`
  - `TrackNodeInput`, `TrackGapPayload`, `NodeSignals`, `TrackSignalsSnapshot`
  - `normalizeTrackTree(raw: unknown): { nodes: TrackNodeInput[] } | { error: string }`
  - `sedimentScore(h, note, aiNote): number`
  - `signalsFingerprintSource(nodes: Array<{ id: string } & NodeSignals>): string`

- [ ] **Step 1: 写失败单测 `tests/track-signals.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { sedimentScore, signalsFingerprintSource, SEDIMENT_WEIGHTS } from '../shared/track'

describe('track signals', () => {
  it('沉淀加权', () => {
    expect(sedimentScore(2, 1, 1)).toBe(
      2 * SEDIMENT_WEIGHTS.highlight + 1 * SEDIMENT_WEIGHTS.note + 1 * SEDIMENT_WEIGHTS.aiNote
    )
  })

  it('fingerprint 原文稳定排序', () => {
    const a = signalsFingerprintSource([
      { id: 'b', bookCount: 0, progressAvg: 0, unreadRatio: 1, sediment: 0 },
      { id: 'a', bookCount: 1, progressAvg: 0.5, unreadRatio: 0, sediment: 3 }
    ])
    const b = signalsFingerprintSource([
      { id: 'a', bookCount: 1, progressAvg: 0.5, unreadRatio: 0, sediment: 3 },
      { id: 'b', bookCount: 0, progressAvg: 0, unreadRatio: 1, sediment: 0 }
    ])
    expect(a).toBe(b)
    expect(a.startsWith('v1\n')).toBe(true)
  })
})
```

- [ ] **Step 2: 跑测确认失败**

Run: `pnpm test -- tests/track-signals.test.ts`  
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `shared/track.ts`（最小通过）**

必须包含：

```ts
export const TRACK_PROMPT_VERSION = 'v1'
export const SEDIMENT_WEIGHTS = { highlight: 1, note: 2, aiNote: 3 } as const
export const TRACK_MAX_DEPTH = 3
export const TRACK_LIBRARY_TOP_N = 80

export type NodeSignals = {
  bookCount: number
  progressAvg: number
  unreadRatio: number
  sediment: number
}

export type TrackNodeInput = {
  id: string
  parentId: string | null
  title: string
  summary: string
  depth: number
  sortOrder: number
}

export type TrackGapType = 'coverage' | 'progress' | 'sediment'

export type TrackGapPayload = {
  overall: string
  gaps: Array<{
    nodeId: string
    type: TrackGapType
    summary: string
    suggestBookKinds: string[]
  }>
  nextSteps: string[]
  /** 模型失败降级时保留原文 */
  rawText?: string
  note?: string | null
}

export function sedimentScore(highlight: number, note: number, aiNote: number): number {
  return (
    highlight * SEDIMENT_WEIGHTS.highlight +
    note * SEDIMENT_WEIGHTS.note +
    aiNote * SEDIMENT_WEIGHTS.aiNote
  )
}

/** 规范化序列；主进程再 sha256。前缀版本便于改算法时废旧缓存 */
export function signalsFingerprintSource(
  nodes: Array<{ id: string } & NodeSignals>
): string {
  const lines = [...nodes]
    .sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
    .map(
      (n) =>
        `${n.id}|${n.bookCount}|${n.progressAvg.toFixed(4)}|${n.unreadRatio.toFixed(4)}|${n.sediment}`
    )
  return `v1\n${lines.join('\n')}`
}

export function normalizeTrackTree(raw: unknown): { nodes: TrackNodeInput[] } | { error: string } {
  // 校验：数组、id 非空唯一、parent 存在或 null、无环、depth 1..3 且与父子一致、title 非空
  // 失败返回中文 error
}
```

- [ ] **Step 4: 写 `tests/track-validate.test.ts`**（合法树 / 超深 / 环 / 缺父 / 重复 id）

- [ ] **Step 5: 跑通**

Run: `pnpm test -- tests/track-signals.test.ts tests/track-validate.test.ts`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add shared/track.ts shared/types.ts tests/track-signals.test.ts tests/track-validate.test.ts
git commit -m "$(cat <<'EOF'
feat: 学习脉络信号与树校验纯函数

EOF
)"
```

---

### Task 2: Migration v8 + track repo

**Files:**
- Modify: `electron/main/store/migrations.ts`（追加 version 8）
- Modify: `tests/migrate.test.ts`（断言 v8 DDL 片段）
- Create: `electron/main/track/repo.ts`
- Create: `tests/track-repo.test.ts`（若 vitest 难加载 better-sqlite3，则用内存 db 的现有测试夹具模式；否则测 SQL 拼装 + 用 fake；优先看 `tests/` 里其它 repo 测法——没有则本任务只测 migration + 把 repo 交给 Task 3 集成）

**DDL（必须与 spec §5.1 一致）：**

```sql
CREATE TABLE tracks (
  id TEXT PRIMARY KEY,
  goal_text TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE track_nodes (
  id TEXT PRIMARY KEY,
  track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  parent_id TEXT,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  depth INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_track_nodes_track ON track_nodes(track_id, sort_order);
CREATE TABLE track_node_books (
  track_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (node_id, book_id)
);
CREATE INDEX idx_track_node_books_book ON track_node_books(book_id);
CREATE TABLE track_ai_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  task TEXT NOT NULL,
  scope_key TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  payload TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE (track_id, task, scope_key, prompt_version, model)
);
```

**Interfaces（`repo.ts`）：**

```ts
getActiveTrack(db): TrackRow | null
replaceActiveTrack(db, { id, goalText, title, nodes, links, promptVersion }): void
  // 事务：若已有 active → status=archived；插入新 active；写入 nodes/links
rebuildActiveTree(db, trackId, nodes, links, keepUserLinksByNodeId: boolean): void
  // 按 spec：换节点；同 node_id 保留旧挂载（含 user）
setNodeBooks(db, trackId, nodeId, bookIds: string[]): void  // source='user'
renameNode(db, nodeId, title, summary): void
listNodesWithBooks(db, trackId): TrackNodeView[]
saveTrackAiResult / getTrackAiResult(db, key)
latestGapResult(db, trackId): StoredGap | null
```

约束：同一时刻仅一行 `status='active'`（`replaceActiveTrack` / 归档保证；可加部分唯一不便用 SQLite 时用应用层保证）。

- [ ] **Step 1: 扩展 migrate 单测断言含 `track_nodes` / `track_ai_results`**
- [ ] **Step 2: 跑测失败 → 加 v8 migration → PASS**
- [ ] **Step 3: 实现 repo 核心方法**
- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: 学习脉络表结构与仓库层

EOF
)"
```

---

### Task 3: 本地信号聚合 `computeSignals`

**Files:**
- Create: `electron/main/track/signals.ts`
- Create: `tests/track-aggregate-signals.test.ts`
- Uses: `shared/track.ts`、`repo.listNodesWithBooks`、现有 `reading_progress` / `highlights` / `highlight_ai_notes`

**Produces:**

```ts
export type TrackSignalRow = {
  nodeId: string
  bookCount: number
  progressAvg: number      // 无书时 0
  unreadRatio: number      // 无书时 1
  sediment: number
  strength: 'empty' | 'weak' | 'ok'  // UI 角标：empty=0书; weak=有书但进度低或沉淀低; ok=其他
}

computeTrackSignals(db, trackId): {
  nodes: TrackSignalRow[]
  fingerprintSource: string
  fingerprint: string  // sha256 hex of fingerprintSource
}
```

聚合 SQL 口径：

- 进度：`reading_progress.percent`（0–1 或 0–100？**先读现有列口径并在本文件注释写死**；与阅读器保存一致）
- 未开始：无 progress 行或 percent≈0 视为 unread
- 高亮：`highlights` 按 `book_id`；`note` 计数 = `highlights` 中 `note` 非空非空串；`aiNote` = `highlight_ai_notes` 行数

- [ ] **Step 1: 单测用夹具对象（不必真 SQLite）测 strength 与 fingerprint**
- [ ] **Step 2: 实现 + 对真实查询写集成测（若项目已有 db 测试助手则用；否则 signals 纯函数接收「已查好的 book 指标 map」再聚合，SQL 放 repo）**
- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: 学习脉络节点缺口信号聚合

EOF
)"
```

---

### Task 4: build / gap 任务（主进程 AI）

**Files:**
- Create: `electron/main/track/library-summary.ts`
- Create: `electron/main/track/prompts.ts`
- Create: `electron/main/track/validate-mount.ts`（或并入 `validate.ts`）：过滤非法 bookId、生成未归类列表
- Create: `electron/main/track/tasks.ts`
- Create: `tests/track-library-summary.test.ts`

**Consumes:** `ai/tasks.ts` 的 `askJson` 模式——**不要复制一整份 provider**；优先抽取或并行实现同款「声明 jsonMode → 失败降级 → parseLooseJson」小助手到 `track/tasks.ts` 私有函数（允许短期重复，避免大重构 `tasks.ts`）。

**Produces:**

```ts
runTrackBuild(db, {
  goalText: string
  rebuild: boolean
  providerId, model, signal
  onProgress: (p: { phase: 1 | 2; label: string }) => void
}): Promise<{ trackId: string; uncategorizedBookIds: string[]; usage; note }>

runTrackGap(db, {
  question?: string
  forceRefresh?: boolean
  providerId, model, signal
}): Promise<{ payload: TrackGapPayload; cached: boolean; usage; fingerprint: string }>
```

**build 流程：**

1. 组书库摘要：全库 list → 按「在读 > 有标签 > 最近打开」排序，截断 `TRACK_LIBRARY_TOP_N`；若截断，`note` 含「本次只参考了 N 本」
2. phase1 askJson 骨架 → `normalizeTrackTree`；失败则抛可读中文错或返回 raw（与现有结构化任务一致：**payload null + raw 展示**，build 若无树则应失败并明说，因无法落库）
3. phase2 askJson 挂载 → 只保留真实 bookId；写库（rebuild 按 spec 保留同 id 挂载）
4. `task='build'` 写入 `track_ai_results`（`scope_key` 可用 `goalText` 规范化 + 书库 id 集合哈希）

**gap 流程：**

1. `computeTrackSignals` → fingerprint
2. `scope_key = fingerprint` 或 `fingerprint + '\n' + normalizedQuestion`；`forceRefresh` 时追加 `\n' + Date.now()`
3. 命中缓存 → `cached: true`
4. 否则 askJson → 校验 `TrackGapPayload`（未知 nodeId 的 gap 丢弃或标明）；落库

- [ ] **Step 1: Top-N 单测**
- [ ] **Step 2: prompts + tasks 实现（可先用假 chat 注入测校验路径；真实 chat 接 provider）**
- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: 学习脉络成树与问缺 AI 任务

EOF
)"
```

---

### Task 5: IPC + preload 白名单

**Files:**
- Modify: `shared/ipc.ts` — 增加 CH 与 API_SHAPE
- Create: `electron/main/ipc/track.ts`
- Modify: `electron/main/ipc/index.ts`
- Modify: `electron/preload/index.ts`
- 若有 preload/API 冒烟测：更新断言

**CH 新增（只增不改）：**

```ts
trackGetActive: 'track:getActive',
trackListNodes: 'track:listNodes',
trackSetBookLinks: 'track:setBookLinks',
trackRenameNode: 'track:renameNode',
trackComputeSignals: 'track:computeSignals',
trackGetLatestGap: 'track:getLatestGap',
trackBuild: 'track:build',
trackGap: 'track:gap',
trackCancel: 'track:cancel',
trackOnProgress: 'track:onProgress',  // 主→渲染，若复用 ai:progress 则可不增；优先复用 CH.aiProgress 并约定 task 前缀 track:
```

**API_SHAPE.track：**

```ts
track: [
  'getActive',
  'listNodes',
  'setBookLinks',
  'renameNode',
  'computeSignals',
  'getLatestGap',
  'build',
  'gap',
  'cancel',
  'onProgress' // 若复用 ai.onProgress 则删此项，UI 直接订 ai.onProgress
]
```

**Handler 要点：**

- `build` / `gap`：`queue.run('track:build'|`track:gap`, …)` + `AbortController` map；与 AI 其它任务互斥
- 无 key：`statusOf` 同类检查，抛「请先在设置里配置模型密钥」
- `setBookLinks` / `renameNode`：无模型

- [ ] **Step 1: 改 CH + API_SHAPE + preload**
- [ ] **Step 2: registerTrackIpc + 取消路径**
- [ ] **Step 3: 跑现有 IPC/白名单相关测试**
- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: 暴露学习脉络 IPC 白名单

EOF
)"
```

---

### Task 6: 侧栏导航 + 脉络页 UI

**Files:**
- Modify: `src/shell/Sidebar.tsx` — `PageId` 增加 `'track'`；NAV 在书架与笔记之间插入「脉络」；`NavIcon` 增加简单树/脉络线框图标；阅读态 `SIDEBAR_EXPANDED_MIN_WIDTH` 若按三字按钮校准，改为能容纳四项（读 `sidebarWidth.ts` 注释并更新常量/单测）
- Modify: `src/shell/sidebarWidth.ts` + 其测试（若有）
- Modify: `src/App.tsx` — `page === 'track' && <TrackPage onOpenBook={...} />`
- Create: `src/features/track/TrackPage.tsx`
- Create: `src/features/track/TrackTree.tsx`
- Create: `src/features/track/GapPanel.tsx`
- Create: `src/features/track/track.css`（或沿用现有 desk 变量，避免新设计体系）

**UI 行为（对照 spec §4）：**

1. 空态：目标 textarea +「生成脉络」→ confirm「将调用模型，分两阶段生成骨架并建议挂书」→ `api.track.build`
2. 有 Track：左树（信号角标 empty/weak/ok）+ 节点挂书列表（增删）+ 未归类区；右「我缺什么」+ 最近报告 + 可选追问；顶栏重生
3. 信号 fingerprint 与 `getLatestGap` 的 fingerprint 不同 → 提示可重新问缺
4. 无 key：按钮可点但给出去设置的说明（或禁用 + 说明）
5. 点书名：`onOpenBook(bookId)` 走 App 现有 `openBook`
6. 中文错误四类展示对齐现有 AI 面板可读文案（可简）

- [ ] **Step 1: Sidebar PageId + 宽度常量**
- [ ] **Step 2: TrackPage 空态**
- [ ] **Step 3: 树 + 挂载编辑 + GapPanel**
- [ ] **Step 4: App 接线**
- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: 主导航增加脉络页与问缺界面

EOF
)"
```

---

### Task 7: e2e 与功能清单回写

**Files:**
- Create: `e2e/track.spec.ts`
- Modify: `docs/superpowers/specs/2026-11-03-feature-inventory.md`（增加「学习脉络 V1」条目，标明已落地范围）
- 可选：README 功能列表加一句（若本轮要用户可见说明）

**e2e 最小：**

1. 启动应用 → 侧栏可见「脉络」→ 进入空态文案含「生成脉络」或目标输入
2. （若 e2e 能注入 mock key / mock provider：跑问缺；否则跳过花钱路径，仅导航与空态）

- [ ] **Step 1: e2e 导航/空态**
- [ ] **Step 2: 更新 feature-inventory**
- [ ] **Step 3: `pnpm test` 全绿；`pnpm e2e` 相关 greps 通过**
- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
test: 学习脉络导航空态 e2e 并更新功能清单

EOF
)"
```

---

## Spec coverage checklist

| Spec 项 | Task |
|---|---|
| 单 active Track + 混合成树 | 2, 4 |
| 深度 ≤3、空节点、未归类 UI | 1, 4, 6 |
| 手改挂载 / 重生保留同 id | 2, 4, 6 |
| 问缺 A+B 主 C 加权、类目建议 | 1, 3, 4, 6 |
| 信号指纹缓存 / forceRefresh | 3, 4 |
| 主导航脉络页 | 6 |
| 硬规则 / 降级 / 单通道 | 4, 5 |
| 不做测验/外链/跨书对话/多 Track UI | 全任务勿加 |
| 测试 | 1–3, 7 |

## Self-review notes

- 无 TBD；权重与 Top-N 已钉死在 Global Constraints / `shared/track.ts`
- IPC 方法名与 spec §5.2 对齐；进度事件优先复用 `ai:progress` 以免双通道
- `reading_progress.percent` 口径在 Task 3 必须对照现有写入代码写进注释，禁止假设 0–100 却按 0–1 算
