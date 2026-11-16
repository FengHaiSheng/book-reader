# 书架按脉络分节 + 新书本地归位 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 标签体系不动；有 active Track 时书架主区可「按脉络」树形分节；新书零费用本地预归位（高置信 `local` / 中置信待确认 / 低置信未归类）。

**Architecture:** 打分与分节均为纯函数（可单测）；主进程 `matchBooks` / `confirmMatch` 写 `track_node_books`（扩展 `source=local`）；导入成功后对零挂载新书调用匹配；书架用现有 `listNodes` + 本地 `groupBooksByTrack` 渲染分节；脉络页加「归位未归类」与待确认区。不改 `tags` 表、不改侧栏标签语义。

**Tech Stack:** Electron 主进程、better-sqlite3、React 19、vitest、Playwright。

**Spec:** [docs/superpowers/specs/2026-11-11-track-sidebar-tags-design.md](../specs/2026-11-11-track-sidebar-tags-design.md)

## Global Constraints

- AI 永不后台自动调用；本地归位不调模型、无费用确认框
- 标签 / ＋标签 / 标签管理语义零改动
- 匹配与「归位未归类」只处理**零挂载**书；已挂书跳过
- 确认待确认后一律 `source=user`
- 渲染进程零能力；IPC 白名单先改 spec/本计划再扩 `API_SHAPE`
- 中文 UI；commit 用仓库中文 Conventional Commits

## File map

| 文件 | 职责 |
|---|---|
| `shared/track.ts` | 扩展 `TrackBookSource` 常量/类型（若已有则改）；匹配阈值常量可放此或 `shared/track-match.ts` |
| `shared/track-match.ts` | 规范化、打分、三档决策纯函数 |
| `shared/ipc.ts` / `shared/types.ts` | 通道、`API_SHAPE`、匹配结果类型 |
| `electron/main/track/repo.ts` | `asSource` 认 `local`；`addBookLinks`（插入挂载） |
| `electron/main/track/match-books.ts` | 组装书信号（含目录标题）+ 调纯函数 + 写库 |
| `electron/main/ipc/track.ts` | `matchBooks` / `confirmMatch` handlers |
| `electron/preload/index.ts` | 暴露两方法 |
| `electron/main/library/importer.ts` 等调用链 | 导入成功后触发匹配（见 Task 5：集中在 import 汇总处更干净） |
| `src/features/library/track-groups.ts` | `groupBooksByTrack` 纯函数 |
| `src/features/library/shelf.ts` | `parseGroupBy` / `LibraryGroupBy` |
| `src/features/library/LibraryToolbar.tsx` | 「按列表 \| 按脉络」切换 |
| `src/features/library/TrackShelf.tsx` | 分节渲染（复用 BookGrid/BookList 卡片） |
| `src/pages/LibraryPage.tsx` | 拉 nodes、切换 groupBy、导入后提示匹配结果 |
| `src/features/track/TrackPage.tsx` | 「归位未归类」+ 待确认 UI |
| `src/features/track/types.ts` | `source` 含 `local` |
| `tests/track-match.test.ts` | 打分与三档 |
| `tests/library-track-groups.test.ts` | 分节 |
| `tests/track-ipc-shape.test.ts` | 白名单增量 |
| `e2e/track-shelf-groups.spec.ts` | 窄 e2e |
| `docs/superpowers/specs/2026-11-03-feature-inventory.md` | 功能清单补一句 |

---

### Task 1: `source=local` 类型与仓储

**Files:**
- Modify: `electron/main/track/repo.ts`（`TrackBookSource`、`asSource`）
- Modify: `src/features/track/types.ts`
- Modify: `shared/track.ts`（若适合导出统一 `TrackBookSource`）
- Test: `tests/track-repo.test.ts` 或新建 `tests/track-source-local.test.ts`

**Interfaces:**
- Produces: `TrackBookSource = 'ai' | 'user' | 'local'`；`asSource` 三者皆合法；`addBookLinks(db, trackId, links: {nodeId, bookId, source}[], now)` 仅 INSERT OR IGNORE / 跳过已存在键

- [x] **Step 1: 写失败单测（source=local 可读可写）**

```ts
import { describe, expect, it } from 'vitest'
// 按现有 track-repo 测试夹具风格：内存库 + 迁移到最新
// 断言：插入 source='local' 后 listNodesWithBooks 读回 local；非法 source 被 asSource 丢弃或写入抛错（与现网 ai/user 行为一致——写入前校验）
```

在 `tests/track-source-local.test.ts`：复用 `tests/track-repo.test.ts` 的 DB 搭建方式，插入一条 `local` 挂载并 `listNodesWithBooks` 断言 `books[0].source === 'local'`。

- [x] **Step 2: 跑测确认失败**

Run: `pnpm test -- tests/track-source-local.test.ts`  
Expected: FAIL（`asSource` 尚不认 local 或类型不含 local）

- [x] **Step 3: 最小实现**

1. `TrackBookSource` 加入 `'local'`
2. `asSource`: `value === 'ai' || value === 'user' || value === 'local'`
3. 导出 `addBookLinks`：

```ts
export function addBookLinks(
  db: Database.Database,
  trackId: string,
  links: TrackLinkInput[],
  now: number
): void {
  // 校验节点属于 track；INSERT；若 PRIMARY KEY 冲突则跳过（不降级 user→local）
}
```

`mergeLinks` 里「user 不被非 user 覆盖」规则保持；`local` 与 `ai` 同等，不能覆盖 `user`。

- [x] **Step 4: 跑测通过**

Run: `pnpm test -- tests/track-source-local.test.ts tests/track-repo.test.ts`

- [x] **Step 5: Commit**

```bash
git add electron/main/track/repo.ts src/features/track/types.ts shared/track.ts tests/track-source-local.test.ts
git commit -m "$(cat <<'EOF'
feat: 脉络挂载来源支持 local

EOF
)"
```

---

### Task 2: 本地匹配纯函数

**Files:**
- Create: `shared/track-match.ts`
- Create: `tests/track-match.test.ts`

**Interfaces:**
- Produces:

```ts
export const TRACK_MATCH = {
  highMin: 0.82,
  highGap: 0.15,
  medMin: 0.48,
  tocTitleMax: 12,
  pendingMax: 3
} as const

export type MatchBookInput = {
  bookId: string
  title: string
  author: string | null
  tocTitles: string[] // 已截断
}

export type MatchNodeInput = {
  id: string
  parentId: string | null
  title: string
  summary: string
  depth: number
}

export type MatchDecision =
  | { bookId: string; kind: 'mount'; nodeIds: string[] }
  | { bookId: string; kind: 'pending'; candidates: Array<{ nodeId: string; score: number }> }
  | { bookId: string; kind: 'skip'; reason: 'low' | 'already-linked' }

export function scoreBookAgainstNode(book: MatchBookInput, node: MatchNodeInput): number
export function decideBookMatch(
  book: MatchBookInput,
  nodes: MatchNodeInput[],
  linkedBookIds: ReadonlySet<string>
): MatchDecision
export function decideMatches(
  books: MatchBookInput[],
  nodes: MatchNodeInput[],
  linkedBookIds: ReadonlySet<string>
): MatchDecision[]
```

**打分规则（锁进单测）：**

1. `normalize(s)`：`trim` → 小写 → 去掉 `\s` 与常见标点 `[\u3000\s.,，。:：;；!！?？、·\-_/\\()（）\[\]【】「」『』""'']+`
2. 若 `normalize(node.title)` 非空且（是 `normalize(book.title)` 的子串或反之）且较短方长度 ≥ 较长方的 40% → 至少 `0.92`
3. 否则用 token：按连续汉字块 / `[a-z0-9]+` 切分；书侧 = title+author+tocTitles；节点侧 = title+summary；Jaccard ∈ [0,1]
4. 若 author 非空且 `normalize(author)` 出现在节点 title+summary 规范化串中 → `max(score, 0.55)`
5. 最终 `scoreBookAgainstNode` = 上述 max，夹在 0..1

**决策规则：**

1. 若 `linkedBookIds.has(bookId)` → `{ kind: 'skip', reason: 'already-linked' }`
2. 算所有节点分数；取 `score >= medMin` 为候选
3. 候选空 → `{ kind: 'skip', reason: 'low' }`
4. 在候选中做祖孙折叠：若 A 是 B 祖先且两者都候选，丢弃较浅者（留更深）
5. 令 `best` = 最高分，`second` = 次高（无则 0）
6. 折叠后若所有候选 `score >= highMin` → `{ kind: 'mount', nodeIds: 那些 id }`（可多挂）
7. 否则若 `best >= highMin` 且 `best - second >= highGap` → mount 唯一个 best
8. 否则 → `{ kind: 'pending', candidates: 按分降序最多 pendingMax 条 }`

- [x] **Step 1: 写 `tests/track-match.test.ts` 覆盖**

```ts
import { describe, expect, it } from 'vitest'
import { decideBookMatch, scoreBookAgainstNode, TRACK_MATCH } from '../shared/track-match'

const nodes = [
  { id: 'd1', parentId: null, title: '战略', summary: '公司战略', depth: 1 },
  { id: 'd2', parentId: 'd1', title: '竞争战略', summary: '定位与取舍', depth: 2 },
  { id: 'f1', parentId: null, title: '财务', summary: '财报', depth: 1 }
]

describe('track-match', () => {
  it('书名强含节点名 → 高置信挂最深', () => {
    const d = decideBookMatch(
      { bookId: 'b1', title: '竞争战略精解', author: null, tocTitles: [] },
      nodes,
      new Set()
    )
    expect(d).toEqual({ bookId: 'b1', kind: 'mount', nodeIds: ['d2'] })
  })

  it('已挂载 → already-linked', () => {
    const d = decideBookMatch(
      { bookId: 'b1', title: '竞争战略精解', author: null, tocTitles: [] },
      nodes,
      new Set(['b1'])
    )
    expect(d.kind).toBe('skip')
    if (d.kind === 'skip') expect(d.reason).toBe('already-linked')
  })

  it('弱相关 → pending 或 low', () => {
    const d = decideBookMatch(
      { bookId: 'b2', title: '诗歌选集', author: null, tocTitles: ['春'] },
      nodes,
      new Set()
    )
    expect(d.kind === 'pending' || (d.kind === 'skip' && d.reason === 'low')).toBe(true)
  })

  it('祖孙同时高分只留深节点', () => {
    // 构造 title 同时强匹配「战略」与「竞争战略」时 nodeIds 不含 d1
    const d = decideBookMatch(
      { bookId: 'b3', title: '竞争战略', author: null, tocTitles: [] },
      nodes,
      new Set()
    )
    expect(d.kind).toBe('mount')
    if (d.kind === 'mount') {
      expect(d.nodeIds).toContain('d2')
      expect(d.nodeIds).not.toContain('d1')
    }
  })
})
```

- [x] **Step 2: 跑测失败 → Step 3 实现 `shared/track-match.ts` → Step 4 跑通 → Step 5 Commit**

```bash
git add shared/track-match.ts tests/track-match.test.ts
git commit -m "$(cat <<'EOF'
feat: 脉络本地挂载打分与三档决策

EOF
)"
```

---

### Task 3: `matchBooks` / `confirmMatch` 主进程 + IPC

**Files:**
- Create: `electron/main/track/match-books.ts`
- Modify: `electron/main/ipc/track.ts`
- Modify: `electron/preload/index.ts`
- Modify: `shared/ipc.ts`、`shared/types.ts`（结果类型）
- Modify: `tests/track-ipc-shape.test.ts`
- Test: `tests/track-match-books.test.ts`（可用假 db + 夹具章节）

**Interfaces:**
- Produces:

```ts
// shared/types.ts 或 shared/track-match.ts 导出供 preload
export type TrackMatchResult = {
  mounted: Array<{ bookId: string; nodeIds: string[] }>
  pending: Array<{ bookId: string; candidates: Array<{ nodeId: string; score: number; title: string }> }>
  skipped: Array<{ bookId: string; reason: 'low' | 'already-linked' }>
}

// electron/main/track/match-books.ts
export function runMatchBooks(
  db: Database.Database,
  opts: { bookIds?: string[] }
): TrackMatchResult

export function runConfirmMatch(
  db: Database.Database,
  bookId: string,
  nodeIds: string[],
  now?: number
): void
```

**`runMatchBooks` 步骤：**

1. `getActiveTrack`；无则返回空三类数组  
2. `listNodesWithBooks` → nodes + `linkedBookIds`（任意节点上出现过的 bookId）  
3. 目标书：若 `bookIds` 有值则用它，否则全库 `listBooks` 里不在 linked 的 id  
4. 每本书：`listChapters` 取前 `TRACK_MATCH.tocTitleMax` 条 `title`  
5. `decideMatches` → 对 `mount` 调 `addBookLinks(..., source: 'local')`  
6. `pending` 带上 `nodeId→title` 方便 UI  
7. 返回三类结果（mount 已落库）

**`runConfirmMatch`：**

1. 无 active → 抛错  
2. 校验 nodeIds 都属于该 track  
3. 若该书已有挂载 → 抛可读错或 no-op 跳过（推荐：仍允许追加？Spec：待确认来自零挂载；确认时若已非零则 skip。实现：已挂则 throw `这本书已经挂过节点了`）  
4. `addBookLinks` 全部 `source: 'user'`

**IPC：**

```ts
CH.trackMatchBooks = 'track:matchBooks'
CH.trackConfirmMatch = 'track:confirmMatch'
API_SHAPE.track 追加 'matchBooks', 'confirmMatch'
```

preload:

```ts
matchBooks: (opts?: { bookIds?: string[] }) => ipcRenderer.invoke(CH.trackMatchBooks, opts ?? {})
confirmMatch: (bookId: string, nodeIds: string[]) =>
  ipcRenderer.invoke(CH.trackConfirmMatch, bookId, nodeIds)
```

- [x] **Step 1: 扩展 `tests/track-ipc-shape.test.ts` 的 `TRACK_METHODS` 含新方法；跑测 FAIL**
- [x] **Step 2: 改 ipc / preload / CH / API_SHAPE；跑 shape 测 PASS**
- [x] **Step 3: 写 `tests/track-match-books.test.ts`（内存库：建 track+节点+书，match 后挂载为 local；confirm 为 user）**
- [x] **Step 4: 实现 `match-books.ts` + handlers；测 PASS**
- [x] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: 暴露脉络本地归位 matchBooks 与 confirmMatch

EOF
)"
```

---

### Task 4: 导入后自动匹配

**Files:**
- Modify: 导入汇总处——优先 `electron/main/ipc/library.ts`（或现有 `importPaths` handler）在返回 outcomes 前/后调用 `runMatchBooks`；**不要**在每个 importer 文件里散落
- Modify: `src/features/library/shelf.ts` — `summarizeMatch` 文案
- Modify: `src/features/library/useImport.ts` 或 `LibraryPage` — 导入后若有 active，再调一次 `matchBooks`（若主进程已跑，渲染只需展示主进程返回；更干净：**主进程 import 返回扩展字段** 或 **渲染在 onDone 后对 imported ids 调 matchBooks**）

**推荐（少改 ImportOutcome 类型）：** 渲染进程 `useImport`/`LibraryPage` 在 `outcomes` 成功后：

```ts
const importedIds = outcomes
  .filter((o) => o.status === 'imported')
  .map((o) => o.bookId)
if (importedIds.length > 0) {
  const active = await window.api.track.getActive()
  if (active) {
    const match = await window.api.track.matchBooks({ bookIds: importedIds })
    setNotice(summarizeImport(outcomes) + '。' + summarizeMatch(match))
  }
}
```

`summarizeMatch`：

```ts
export function summarizeMatch(result: TrackMatchResult): string {
  const n = result.mounted.length
  const m = result.pending.length
  const k = result.skipped.filter((s) => s.reason === 'low').length
  return `脉络归位 ${n} 本，待确认 ${m} 本，仍未归类 ${k} 本`
}
```

pending>0 时 notice 可带「可到脉络页确认」（纯文案即可）。

- [x] **Step 1: 单测 `summarizeMatch`**
- [x] **Step 2: 接入 LibraryPage / useImport**
- [x] **Step 3: 手动或单测验证无 Track 时不调用 match（getActive null 则跳过）**
- [x] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: 导入后对零挂载新书本地预归位

EOF
)"
```

---

### Task 5: 书架分节纯函数

**Files:**
- Create: `src/features/library/track-groups.ts`
- Create: `tests/library-track-groups.test.ts`
- Modify: `src/features/library/shelf.ts` — `LibraryGroupBy`、`parseGroupBy`

**Interfaces:**

```ts
export type LibraryGroupBy = 'list' | 'track'

export function parseGroupBy(raw: string | undefined | null): LibraryGroupBy {
  return raw === 'track' ? 'track' : 'list'
}

export type TrackShelfSection = {
  nodeId: string | null // null = 未归类
  title: string
  depth: number // 未归类用 0
  bookIds: string[] // 过滤后、直挂；空节点为 []
}

export function groupBooksByTrack(
  visibleBookIds: readonly string[],
  nodes: ReadonlyArray<{
    id: string
    parentId: string | null
    title: string
    depth: number
    sortOrder: number
    bookIds: string[] // 该节点直挂
  }>
): TrackShelfSection[]
```

**规则：**

1. 节点按现有树序（与 `listNodes` 顺序一致：调用方保证；函数内按 depth/sortOrder 稳排亦可）输出每一节点一节，`bookIds` = 节点直挂 ∩ `visibleBookIds`  
2. **空节点也输出**（`bookIds: []`）  
3. 末节：`nodeId: null`, `title: '未归类'`, `bookIds` = `visibleBookIds` 里未出现在任何节点直挂中的 id；若为空则**省略**未归类节  
4. 一书多挂 → 多个节的 bookIds 可重复出现同一 id  

- [x] **Step 1–4: TDD 实现 + Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: 书架按脉络分节纯函数

EOF
)"
```

---

### Task 6: 书架 UI「按列表 | 按脉络」

**Files:**
- Modify: `src/features/library/LibraryToolbar.tsx`
- Create: `src/features/library/TrackShelf.tsx`
- Modify: `src/pages/LibraryPage.tsx`
- Modify: `src/styles/base.css`（节标题样式，沿用现有墨色/间距变量；不引入紫系卡片套娃）

**行为：**

1. `LibraryPage` mount 时 `getActive()`；有 Track 则 `listNodes()`，映射为 `groupBooksByTrack` 输入  
2. `groupBy` 从 `settings.getAll()['library.groupBy']` 经 `parseGroupBy`；`pickGroupBy` 写回 `settings.set('library.groupBy', next)`；无 Track 时强制 UI 为 list（不显示切换）  
3. Toolbar：在网格/列表 seg **左侧或右侧**加一组 seg：`按列表` / `按脉络`（仅 `hasTrack`）  
4. `groupBy==='track'` 时渲染 `TrackShelf`：每节 `h3.track-shelf__title`（可用 `padding-left: (depth-1)*12px`），其下按当前 `view` 复用 `BookGrid`/`BookList`（传入该节 books）；空节点显示 `<p className="track-shelf__empty">暂无挂书</p>`  
5. 标签筛选仍走 `library.list(tagFilter)`；状态与 query 仍 `filterBooks`；再 `groupBooksByTrack`  
6. 工具栏旁可显示 `track.title` 小字上下文（可选，有则写，无则跳过以免挤）

- [x] **Step 1: 改 Toolbar props：`groupBy` / `onGroupBy` / `showTrackGroup`**
- [x] **Step 2: 实现 TrackShelf + LibraryPage 接线**
- [x] **Step 3: 手动目视或 e2e（Task 8）**
- [x] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: 书架支持按脉络树形分节浏览

EOF
)"
```

---

### Task 7: 脉络页「归位未归类」+ 待确认

**Files:**
- Modify: `src/features/track/TrackPage.tsx`
- Modify: `src/features/track/track.css`（若需待确认列表样式）

**行为：**

1. 顶栏或未归类区旁按钮「归位未归类」→ `matchBooks({})`（默认未归类）→ `reload` + 把 `pending` 放进 state  
2. 待确认区：每条显示书名 + 候选节点 radio/checkbox（默认勾选 candidates）+「确认」→ `confirmMatch` → 从 pending 移除并 reload  
3. 「全部跳过」清空 pending state（不写库）  
4. 导入带来的 pending：若用户先在书架看到文案，进脉络页可再点「归位未归类」重跑（pending 不持久化，符合 spec）

- [x] **Step 1: UI + 调用**
- [x] **Step 2: 确认后 source 为 user（可依赖 Task 3 单测）**
- [x] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: 脉络页支持归位未归类与待确认挂载

EOF
)"
```

---

### Task 8: e2e 窄覆盖 + 功能清单

**Files:**
- Create: `e2e/track-shelf-groups.spec.ts`
- Modify: `docs/superpowers/specs/2026-11-03-feature-inventory.md`

**e2e 场景（mock / 直接写库优先）：**

1. 无 Track：书架无「按脉络」控件；＋标签仍可用（可复用现有 tags 流程极简断言）  
2. 有 Track（经 `api.track.build` 需 key——若 e2e 难 mock，则用 evaluate 调主进程测试钩子或直接 SQL fixture）：切换按脉络，见到节点节标题；空节点可见  
3. 侧栏选标签后节内书变少（或空节保留）

若 build 难自动化：用 `window.api` 无法直接插节点时，在 e2e 辅助里走现有 track repo 测试通道——查 `e2e/track*.spec.ts` 既有模式并对齐。

功能清单补：

- 书架有 Track 时可「按脉络」分节；标签不变  
- 导入 / 归位未归类：本地三档挂载  

- [x] **Step 1: e2e 绿灯**
- [x] **Step 2: 更新清单**
- [x] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
test: 书架按脉络分节 e2e 并更新功能清单

EOF
)"
```

---

## Spec coverage checklist

| Spec 要求 | Task |
|---|---|
| 标签原样 | 6（不改 Tag*）、8 |
| 按列表 \| 按脉络 | 6 |
| 树形分节、直挂、空节点、未归类末节 | 5–6 |
| 筛选叠加 | 6 |
| 本地三档匹配 | 2–3 |
| 导入触发 | 4 |
| 归位未归类 + 待确认 | 7 |
| `source=local`；确认 `user` | 1, 3 |
| 不改 tags 表 / 无 listSidebarTree | 全程不建 |
| 只碰零挂载 | 2–3 |

## Placeholder / 一致性自检

- 阈值与函数名以 Task 2 `TRACK_MATCH` / `decideBookMatch` 为准  
- IPC 名 `matchBooks` / `confirmMatch` 与 preload、shape 测一致  
- 无 `archived`、无侧栏树、无「挂到…」改标签按钮
