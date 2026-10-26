# 把 AI 回答记到划线 Implementation Plan

> **For agentic workers:** implement this plan task-by-task, in order, checking off each step as it lands. Steps use checkbox (`- [ ]`) syntax for tracking. Dispatch a fresh subagent per task where the tasks are independent (see dispatching-parallel-agents), otherwise execute inline with a review checkpoint after each task.

**Goal:** 让用户把划词产生的 AI 回答显式挂到划线上，与手写批注分表存储，并在笔记页、高亮浮层与导出中可见。

**Architecture:** 新建 `highlight_ai_notes`；`notes.pinAi` 在单事务里「找或建划线 + 插入 AI 笔记」。列表接口给每条 `Highlight` 附带 `aiNotes[]`。渲染侧在助手回合上保留会话级 `pinMeta`（原文 + CFI + source），不改造 `ai_messages`。纯逻辑（选哪条划线、筛选、导出拼接）用 vitest；事务与 IPC 用 Playwright e2e。

**Tech Stack:** Electron 主进程 + better-sqlite3 迁移、现有 notes IPC/preload 白名单、React 笔记页与 AI 面板、vitest、Playwright。

**Spec:** [docs/superpowers/specs/2026-10-26-pin-ai-answers-to-highlights-design.md](../specs/2026-10-26-pin-ai-answers-to-highlights-design.md)

---

## File map

| 文件 | 职责 |
|---|---|
| `shared/types.ts` | `HighlightAiNote*`、`PinAi*`、`Highlight.aiNotes`、导出选项 |
| `shared/ipc.ts` | 通道名 + `API_SHAPE.notes` |
| `electron/main/store/migrations.ts` | v7 建表 |
| `electron/main/notes/pin.ts` | 纯函数：同文划线里选最早一条 |
| `electron/main/notes/repo.ts` | AI 笔记 CRUD、`pinAiToHighlight`、列表附带 `aiNotes` |
| `electron/main/notes/export.ts` | `includeAiNotes` 与三格式输出 |
| `electron/main/ipc/notes.ts` | 注册 pin / listAiNotes / removeAiNote |
| `electron/preload/index.ts` | 白名单方法 |
| `src/features/notes/group.ts` | 筛选 `withAi` |
| `src/features/notes/NoteCard.tsx` / `NotesFilters.tsx` / `ExportPopover.tsx` / `NotesPage.tsx` | 展示与删除、筛选、导出开关 |
| `src/features/reader/HighlightPopover.tsx` / `ReaderPage.tsx` | 浮层列表；seed 带 CFI；pin 后刷新高亮 |
| `src/features/ai/AiMessage.tsx` / `AiPanel.tsx` | 「记到划线」按钮与 `pinMeta` |
| `tests/notes-pin.test.ts` / `tests/notes-export.test.ts` / `tests/notes-group.test.ts` | 单测 |
| `e2e/pin-ai.spec.ts` | 端到端 |

---

### Task 1: 类型、IPC 名与迁移

**Files:**
- Modify: `shared/types.ts`
- Modify: `shared/ipc.ts`
- Modify: `electron/main/store/migrations.ts`

- [x] **Step 1: 扩展 `shared/types.ts`**

在 `Highlight` 定义附近追加，并把 `Highlight` / `HighlightWithBook` 接上 `aiNotes`：

```ts
export type HighlightAiNoteSource = 'explain' | 'translate' | 'ask'

export type HighlightAiNote = {
  id: number
  highlightId: number
  content: string
  source: HighlightAiNoteSource
  createdAt: number
}

export type PinAiToHighlightInput = {
  bookId: string
  chapterId: number
  text: string
  content: string
  source: HighlightAiNoteSource
  /** 本章无同文划线时必填；缺则主进程拒建 */
  startCfi?: string
  endCfi?: string
  color?: HighlightColor
}

export type PinAiToHighlightResult = {
  highlight: Highlight
  aiNote: HighlightAiNote
  reusedEarliestDuplicate: boolean
}
```

把现有 `Highlight` 改成末尾多一行：

```ts
export type Highlight = {
  id: number
  bookId: string
  chapterId: number | null
  startCfi: string
  endCfi: string
  text: string
  note: string | null
  color: HighlightColor
  createdAt: number
  updatedAt: number
  /** 挂在这条划线上的 AI 笔记；无则为 [] */
  aiNotes: HighlightAiNote[]
}
```

`NotesExportOptions` 增加：

```ts
export type NotesExportOptions = {
  includeNotes: boolean
  includeLocation: boolean
  includeContext: boolean
  includeAiNotes: boolean
}
```

- [x] **Step 2: 扩展 `shared/ipc.ts`**

在 `CH` 里 `notesExportFile` 附近追加：

```ts
  notesPinAi: 'notes:pinAi',
  notesListAiNotes: 'notes:listAiNotes',
  notesRemoveAiNote: 'notes:removeAiNote',
```

`API_SHAPE.notes` 数组末尾追加 `'pinAi' | 'listAiNotes' | 'removeAiNote'` 三个字符串（保持与其它项同样的字面量风格）。

- [x] **Step 3: 迁移 v7**

在 `migrations` 数组末尾追加（当前最高为 6）：

```ts
  {
    version: 7,
    up: (db) => {
      db.exec(`
        CREATE TABLE highlight_ai_notes (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          highlight_id INTEGER NOT NULL REFERENCES highlights(id) ON DELETE CASCADE,
          content      TEXT NOT NULL,
          source       TEXT NOT NULL,
          created_at   INTEGER NOT NULL
        );
        CREATE INDEX idx_highlight_ai_notes_highlight
          ON highlight_ai_notes(highlight_id, created_at);
      `)
    }
  }
```

- [x] **Step 4: Commit**

```bash
git add shared/types.ts shared/ipc.ts electron/main/store/migrations.ts
git commit -m "$(cat <<'EOF'
feat: AI 记到划线的类型、IPC 名与库表迁移

为 highlight_ai_notes 与 pinAi 白名单铺好契约，Highlight 统一带上 aiNotes。
EOF
)"
```

---

### Task 2: 纯函数「选最早同文划线」+ 单测

**Files:**
- Create: `electron/main/notes/pin.ts`
- Create: `tests/notes-pin.test.ts`

- [ ] **Step 1: 写失败单测**

```ts
// tests/notes-pin.test.ts
import { describe, expect, it } from 'vitest'
import { chooseHighlightForPin } from '../electron/main/notes/pin'

describe('chooseHighlightForPin', () => {
  it('没有同文划线 → 需要新建', () => {
    expect(chooseHighlightForPin([])).toEqual({ kind: 'create' })
  })

  it('一条 → 复用且非重复提示', () => {
    expect(chooseHighlightForPin([{ id: 9 }])).toEqual({
      kind: 'reuse',
      id: 9,
      reusedEarliestDuplicate: false
    })
  })

  it('多条 → 取 id 最小，并标记重复', () => {
    expect(chooseHighlightForPin([{ id: 5 }, { id: 2 }, { id: 8 }])).toEqual({
      kind: 'reuse',
      id: 2,
      reusedEarliestDuplicate: true
    })
  })
})
```

- [ ] **Step 2: 跑测确认失败**

Run: `npm test -- tests/notes-pin.test.ts`  
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```ts
// electron/main/notes/pin.ts
/** 本章同文划线里选「最早一条」（id 最小）。多条时 reusedEarliestDuplicate 为 true。 */
export function chooseHighlightForPin(
  sameText: readonly { id: number }[]
):
  | { kind: 'create' }
  | { kind: 'reuse'; id: number; reusedEarliestDuplicate: boolean } {
  if (sameText.length === 0) return { kind: 'create' }
  let earliest = sameText[0]!
  for (const row of sameText) {
    if (row.id < earliest.id) earliest = row
  }
  return {
    kind: 'reuse',
    id: earliest.id,
    reusedEarliestDuplicate: sameText.length > 1
  }
}
```

- [ ] **Step 4: 跑测确认通过**

Run: `npm test -- tests/notes-pin.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/main/notes/pin.ts tests/notes-pin.test.ts
git commit -m "$(cat <<'EOF'
feat: 同文划线取最早一条的纯函数

pinAi 事务在找划线时复用此规则，避免多处各写一遍最小 id。
EOF
)"
```

---

### Task 3: 仓储 — AI 笔记与 pin 事务

**Files:**
- Modify: `electron/main/notes/repo.ts`

说明：vitest 不能加载 Electron ABI 的 better-sqlite3，本任务的行为由 Task 10 e2e 验收；实现时保持与现有 `createHighlight` 错误口径一致。

- [ ] **Step 1: 在 `repo.ts` 增加 AI 笔记读写与附着**

在文件顶部 import 中追加类型与 `chooseHighlightForPin`、`DEFAULT_HIGHLIGHT_COLOR`（从 `@shared/highlights`）、`PinAiToHighlightInput` / `PinAiToHighlightResult` / `HighlightAiNote`。

```ts
const AI_NOTE_COLUMNS = `id, highlight_id AS highlightId, content, source, created_at AS createdAt`

export function listAiNotesForHighlight(
  db: Database.Database,
  highlightId: number
): HighlightAiNote[] {
  return db
    .prepare(
      `SELECT ${AI_NOTE_COLUMNS} FROM highlight_ai_notes
       WHERE highlight_id = ? ORDER BY created_at, id`
    )
    .all(highlightId) as HighlightAiNote[]
}

export function listAiNotesForHighlights(
  db: Database.Database,
  highlightIds: readonly number[]
): HighlightAiNote[] {
  if (highlightIds.length === 0) return []
  const placeholders = highlightIds.map(() => '?').join(',')
  return db
    .prepare(
      `SELECT ${AI_NOTE_COLUMNS} FROM highlight_ai_notes
       WHERE highlight_id IN (${placeholders})
       ORDER BY highlight_id, created_at, id`
    )
    .all(...highlightIds) as HighlightAiNote[]
}

function attachAiNotes<T extends { id: number }>(
  db: Database.Database,
  rows: T[]
): (T & { aiNotes: HighlightAiNote[] })[] {
  const notes = listAiNotesForHighlights(
    db,
    rows.map((row) => row.id)
  )
  const byId = new Map<number, HighlightAiNote[]>()
  for (const note of notes) {
    const list = byId.get(note.highlightId) ?? []
    list.push(note)
    byId.set(note.highlightId, list)
  }
  return rows.map((row) => ({ ...row, aiNotes: byId.get(row.id) ?? [] }))
}
```

- [ ] **Step 2: 改 `getHighlight` / `listChapterHighlights` / `listAllHighlights` / `createHighlight` 返回值一律带 `aiNotes`**

`getHighlight`：查到行后 `attachAiNotes(db, [row])[0]`。  
`listChapterHighlights`：`return attachAiNotes(db, rows)`。  
`listAllHighlights`：在现有 `rows.map(...)` 得到的数组上再 `attachAiNotes`（注意 map 出的对象已无 `aiNotes`，附着即可）。  
`createHighlight`：返回前附着（新建时必为 `[]`）。

- [ ] **Step 3: 实现 insert / delete / pin**

```ts
export function insertAiNote(
  db: Database.Database,
  input: { highlightId: number; content: string; source: HighlightAiNote['source'] },
  now: number
): HighlightAiNote {
  const content = input.content.trim()
  if (content === '') throw appError('DB_ERROR', '没有可记下的回答内容')
  const info = db
    .prepare(
      `INSERT INTO highlight_ai_notes (highlight_id, content, source, created_at)
       VALUES (?, ?, ?, ?)`
    )
    .run(input.highlightId, content, input.source, now)
  const row = db
    .prepare(`SELECT ${AI_NOTE_COLUMNS} FROM highlight_ai_notes WHERE id = ?`)
    .get(Number(info.lastInsertRowid)) as HighlightAiNote | undefined
  if (!row) throw appError('DB_ERROR', 'AI 笔记写入后读不回来')
  return row
}

export function deleteAiNote(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM highlight_ai_notes WHERE id = ?').run(id)
}

/**
 * 找或建划线 + 插入一条 AI 笔记。整段包在事务里。
 * 缺 CFI 且无同文划线 → 可读错误，不建无定位脏数据。
 */
export function pinAiToHighlight(
  db: Database.Database,
  input: PinAiToHighlightInput,
  now: number
): PinAiToHighlightResult {
  const text = normalizeSpan(input.text).slice(0, MAX_HIGHLIGHT_CHARS)
  if (text === '') throw appError('DB_ERROR', '选中的内容为空，没有可标注的文字')

  const run = db.transaction((): PinAiToHighlightResult => {
    const same = db
      .prepare(
        `SELECT id FROM highlights
         WHERE book_id = ? AND chapter_id = ? AND text = ?
         ORDER BY id`
      )
      .all(input.bookId, input.chapterId, text) as { id: number }[]

    const choice = chooseHighlightForPin(same)
    let highlightId: number
    let reusedEarliestDuplicate = false

    if (choice.kind === 'reuse') {
      highlightId = choice.id
      reusedEarliestDuplicate = choice.reusedEarliestDuplicate
    } else {
      if (!input.startCfi || !input.endCfi) {
        throw appError('DB_ERROR', '没法定位到原文，请先划线后再记')
      }
      const created = createHighlight(
        db,
        {
          bookId: input.bookId,
          chapterId: input.chapterId,
          startCfi: input.startCfi,
          endCfi: input.endCfi,
          text,
          note: null,
          color: input.color ?? DEFAULT_HIGHLIGHT_COLOR
        },
        now
      )
      highlightId = created.id
    }

    const aiNote = insertAiNote(
      db,
      { highlightId, content: input.content, source: input.source },
      now
    )
    const highlight = getHighlight(db, highlightId)
    if (!highlight) throw appError('DB_ERROR', '划线读不回来')
    return { highlight, aiNote, reusedEarliestDuplicate }
  })

  return run()
}
```

注意：`createHighlight` 若内部已 `attachAiNotes`，事务内嵌套调用没问题；不要在 `pinAiToHighlight` 外再开一层事务。

- [ ] **Step 4: Commit**

```bash
git add electron/main/notes/repo.ts electron/main/notes/pin.ts
git commit -m "$(cat <<'EOF'
feat: pinAi 事务与划线列表附带 AI 笔记

找或建同文划线后写入 highlight_ai_notes，删划线靠外键级联清掉子行。
EOF
)"
```

---

### Task 4: 导出包含 AI 笔记

**Files:**
- Modify: `electron/main/notes/export.ts`
- Modify: `tests/notes-export.test.ts`

- [ ] **Step 1: 扩展 `ExportEntry` 与选项默认用法**

```ts
export type ExportEntry = {
  bookTitle: string
  chapterTitle: string | null
  percent: number
  text: string
  note: string | null
  context: HighlightContext | null
  aiNotes: { source: HighlightAiNote['source']; content: string }[]
}
```

`collectEntries` 映射里加：

```ts
aiNotes: item.aiNotes.map((n) => ({ source: n.source, content: n.content }))
```

来源标签（模块内私有）：

```ts
const AI_SOURCE_LABEL: Record<HighlightAiNote['source'], string> = {
  explain: '解释',
  translate: '翻译',
  ask: '问答'
}
```

- [ ] **Step 2: 改 `buildMarkdown` — 在「我的批注」之后**

```ts
    if (options.includeAiNotes && entry.aiNotes.length > 0) {
      for (const ai of entry.aiNotes) {
        lines.push(`**AI 笔记（${AI_SOURCE_LABEL[ai.source]}）**：${ai.content}`, '')
      }
    }
```

对 `buildHtmlCards` / `buildAnkiCsv` 做同样语义：  
- HTML：批注后增加带标签的段落；  
- Anki：若 `includeAiNotes`，增加一列 `AI`，单元格内用换行拼接 `【解释】…`；旧测试未开此列时保持列数不变——即 **仅当 `includeAiNotes === true` 时加列**。

- [ ] **Step 3: 更新单测夹具与断言**

所有现有 `ENTRIES` 条目补 `aiNotes: []`。所有 `NotesExportOptions` 字面量补 `includeAiNotes: false`（保持旧断言语义）。新增：

```ts
  it('打开 includeAiNotes 时在批注后输出 AI 段', () => {
    const withAi: ExportEntry[] = [
      {
        ...ENTRIES[0]!,
        aiNotes: [{ source: 'explain', content: '这句话是在说习惯性动作。' }]
      }
    ]
    const md = buildMarkdown(
      withAi,
      { includeNotes: true, includeLocation: true, includeContext: false, includeAiNotes: true },
      AT
    )
    expect(md).toContain('**AI 笔记（解释）**：这句话是在说习惯性动作。')
  })

  it('关掉 includeAiNotes 时不输出 AI 段', () => {
    const withAi: ExportEntry[] = [
      { ...ENTRIES[0]!, aiNotes: [{ source: 'ask', content: '不该出现' }] }
    ]
    const md = buildMarkdown(
      withAi,
      { includeNotes: true, includeLocation: true, includeContext: false, includeAiNotes: false },
      AT
    )
    expect(md).not.toContain('AI 笔记')
  })
```

- [ ] **Step 4: 跑测**

Run: `npm test -- tests/notes-export.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/main/notes/export.ts tests/notes-export.test.ts
git commit -m "$(cat <<'EOF'
feat: 笔记导出可包含挂在划线上的 AI 笔记

默认由调用方传 includeAiNotes；Markdown/HTML/Anki 与批注分段并列输出。
EOF
)"
```

---

### Task 5: IPC 与 preload

**Files:**
- Modify: `electron/main/ipc/notes.ts`
- Modify: `electron/preload/index.ts`

- [ ] **Step 1: 注册三个 handler**

```ts
import {
  // ...existing
  deleteAiNote,
  listAiNotesForHighlight,
  pinAiToHighlight
} from '../notes/repo'
import type { PinAiToHighlightInput } from '@shared/types'

// 在 registerNotesIpc 内：
  ipcMain.handle(CH.notesPinAi, (_event, input: PinAiToHighlightInput) => {
    try {
      return pinAiToHighlight(getDatabase(), input, Date.now())
    } catch (error) {
      throw new Error(toAppError(error, '没能记到划线').message)
    }
  })

  ipcMain.handle(CH.notesListAiNotes, (_event, highlightId: number) =>
    listAiNotesForHighlight(getDatabase(), highlightId)
  )

  ipcMain.handle(CH.notesRemoveAiNote, (_event, id: number) => {
    deleteAiNote(getDatabase(), id)
  })
```

- [ ] **Step 2: preload `notes` 对象追加**

```ts
    pinAi: (input: PinAiToHighlightInput): Promise<PinAiToHighlightResult> =>
      ipcRenderer.invoke(CH.notesPinAi, input),
    listAiNotes: (highlightId: number): Promise<HighlightAiNote[]> =>
      ipcRenderer.invoke(CH.notesListAiNotes, highlightId),
    removeAiNote: (id: number): Promise<void> =>
      ipcRenderer.invoke(CH.notesRemoveAiNote, id),
```

补上对应 type import。`ExportPopover` 等处构造 `NotesExportOptions` 时一律带上 `includeAiNotes: true`（默认开，与规格一致）。

- [ ] **Step 3: Commit**

```bash
git add electron/main/ipc/notes.ts electron/preload/index.ts
git commit -m "$(cat <<'EOF'
feat: 暴露 notes.pinAi / listAiNotes / removeAiNote

渲染进程只能走具名白名单；pin 失败抛中文 Error message。
EOF
)"
```

---

### Task 6: 笔记页筛选与卡片

**Files:**
- Modify: `src/features/notes/group.ts`
- Modify: `tests/notes-group.test.ts`
- Modify: `src/features/notes/NotesFilters.tsx`
- Modify: `src/features/notes/NoteCard.tsx`
- Modify: `src/pages/NotesPage.tsx`

- [ ] **Step 1: 扩展 `NotesKind` 与过滤**

```ts
export type NotesKind = 'all' | 'marked' | 'annotated' | 'withAi'

export const KIND_LABELS: Record<NotesKind, string> = {
  all: '全部笔记',
  marked: '仅高亮',
  annotated: '仅有批注',
  withAi: '有 AI 笔记'
}

export type NoteCounts = {
  all: number
  marked: number
  annotated: number
  withAi: number
}
```

`applyFilter` 增加：

```ts
    if (filter.kind === 'withAi' && note.aiNotes.length === 0) return false
```

`countsByKind` 增加 `withAi: scoped.filter((n) => n.aiNotes.length > 0).length`。  
「仅有批注」仍只看 `note !== null`，不看 `aiNotes`。

- [ ] **Step 2: 更新 `notes-group.test.ts` 夹具**

`note(...)` 工厂补 `aiNotes: []`；新增带 `aiNotes: [{ id: 1, highlightId: id, content: 'x', source: 'explain', createdAt: 1 }]` 的用例，断言 `withAi` 与 `annotated` 互不误伤。

Run: `npm test -- tests/notes-group.test.ts`  
Expected: PASS

- [ ] **Step 3: `NoteCard` 展示并可删 AI 笔记**

Props 增加 `onRemoveAiNote: (aiNoteId: number) => void`。在手写批注展示区下方：

```tsx
      {note.aiNotes.length > 0 && (
        <ul className="note__ai-list">
          {note.aiNotes.map((ai) => (
            <li key={ai.id} className="note__ai">
              <span className="note__ai-src">
                {ai.source === 'explain' ? '解释' : ai.source === 'translate' ? '翻译' : '问答'}
              </span>
              <p className="note__ai-body">{ai.content}</p>
              <button
                type="button"
                className="act"
                onClick={(event) => {
                  event.stopPropagation()
                  onRemoveAiNote(ai.id)
                }}
              >
                删除
              </button>
            </li>
          ))}
        </ul>
      )}
```

`NotesPage`：

```ts
  const removeAiNote = useCallback(async (highlightId: number, aiNoteId: number) => {
    await window.api.notes.removeAiNote(aiNoteId)
    setNotes((list) =>
      list.map((item) =>
        item.id === highlightId
          ? { ...item, aiNotes: item.aiNotes.filter((n) => n.id !== aiNoteId) }
          : item
      )
    )
  }, [])
```

`NotesFilters` 的 `KINDS` 数组纳入 `'withAi'`（已从 `KIND_LABELS` 驱动文案）。

- [ ] **Step 4: 最小样式**

在 `src/styles/base.css` 已有 `.note__*` 附近增加 `.note__ai-list` / `.note__ai` / `.note__ai-src` / `.note__ai-body`：来源用小号墨色标签，正文与批注同等可读，勿新引入卡片阴影或紫系装饰。

- [ ] **Step 5: Commit**

```bash
git add src/features/notes/group.ts src/features/notes/NotesFilters.tsx src/features/notes/NoteCard.tsx src/pages/NotesPage.tsx src/styles/base.css tests/notes-group.test.ts
git commit -m "$(cat <<'EOF'
feat: 笔记页展示并筛选挂在划线上的 AI 笔记

「有 AI 笔记」与「仅有批注」分开；删除 AI 笔记不动划线与手写批注。
EOF
)"
```

---

### Task 7: 导出浮层开关

**Files:**
- Modify: `src/features/notes/ExportPopover.tsx`

- [ ] **Step 1: 默认选项与复选框**

```ts
  const [options, setOptions] = useState<NotesExportOptions>({
    includeNotes: true,
    includeLocation: true,
    includeContext: false,
    includeAiNotes: true
  })
```

在「附上原文上下文」后增加：

```tsx
          <label className="check">
            <input
              type="checkbox"
              checked={options.includeAiNotes}
              onChange={() => toggle('includeAiNotes')}
            />
            包含 AI 笔记
          </label>
```

`toggle` 已是 `keyof NotesExportOptions`，无需改签名。

- [ ] **Step 2: Commit**

```bash
git add src/features/notes/ExportPopover.tsx
git commit -m "$(cat <<'EOF'
feat: 导出浮层增加「包含 AI 笔记」开关

默认打开；预览与落盘共用同一份 options。
EOF
)"
```

---

### Task 8: 高亮浮层列出 AI 笔记

**Files:**
- Modify: `src/features/reader/HighlightPopover.tsx`
- Modify: `src/features/reader/ReaderPage.tsx`（传入删除回调并刷新 state）

- [ ] **Step 1: 浮层增加列表**

Props 增加 `onRemoveAiNote: (id: number) => void`。在 textarea 与 foot 之间渲染与 NoteCard 同结构的列表（可复用同一 class）。`POPOVER_MAX_HEIGHT` 若列表易被裁切，改为 `320` 并让 `.annot` 内部 `overflow-y: auto`。

- [ ] **Step 2: ReaderPage 删除后更新 `highlights` 与 `active`**

```ts
  const removeAiNote = useCallback(async (aiNoteId: number) => {
    await window.api.notes.removeAiNote(aiNoteId)
    const strip = (h: Highlight): Highlight => ({
      ...h,
      aiNotes: h.aiNotes.filter((n) => n.id !== aiNoteId)
    })
    setHighlights((list) => list.map(strip))
    setActive((current) =>
      current ? { ...current, highlight: strip(current.highlight) } : current
    )
  }, [])
```

传给 `HighlightPopover`。

- [ ] **Step 3: Commit**

```bash
git add src/features/reader/HighlightPopover.tsx src/features/reader/ReaderPage.tsx src/styles/base.css
git commit -m "$(cat <<'EOF'
feat: 阅读器高亮浮层可查看并删除 AI 笔记

与笔记页同一数据源字段，删除只去掉子行。
EOF
)"
```

---

### Task 9: AI 面板「记到划线」

**Files:**
- Modify: `src/features/ai/AiPanel.tsx`
- Modify: `src/features/ai/AiMessage.tsx`
- Modify: `src/features/reader/ReaderPage.tsx`（seed 带 CFI；`onPinned`）

- [ ] **Step 1: 扩展 seed 与 Turn**

`AiSeed`：

```ts
export type AiSeed =
  | { kind: 'prefill'; task: 'ask'; text: string; startCfi: string; endCfi: string }
  | {
      kind: 'send'
      task: 'explain' | 'translate'
      text: string
      startCfi: string
      endCfi: string
    }
```

`Turn` 增加可选：

```ts
  pinMeta?: {
    text: string
    startCfi: string
    endCfi: string
    source: 'explain' | 'translate' | 'ask'
  }
  pinned?: boolean
  pinNote?: string | null
  pinError?: string | null
```

- [ ] **Step 2: ReaderPage `askFromSelection` 带上 CFI**

```ts
      setAiSeed(
        task === 'ask'
          ? {
              kind: 'prefill',
              task: 'ask',
              text: selection.text,
              startCfi: selection.startCfi,
              endCfi: selection.endCfi
            }
          : {
              kind: 'send',
              task,
              text: selection.text,
              startCfi: selection.startCfi,
              endCfi: selection.endCfi
            }
      )
```

- [ ] **Step 3: AiPanel 在 `send` 时把 pinMeta 写到助手回合**

维护 `pendingPinRef`：seed 为 prefill/send 时写入 `{ text, startCfi, endCfi, source }`；`send(...)` 创建助手 turn 时读出并挂上 `pinMeta`，用完不清掉整块直到该次 send 用过（prefill 在用户真正 submit 时用 `excerpt` + pendingPinRef）。

自由提问（无 excerpt、无 pendingPin）：助手 turn **不设** `pinMeta` → 无按钮。

- [ ] **Step 4: `AiMessage` 渲染按钮**

Props：`onPin?: (turn: Turn) => void`。当 `turn.role === 'assistant' && turn.state === 'done' && turn.pinMeta`：

```tsx
      {turn.pinMeta && turn.state === 'done' && onPin && (
        <div className="ai-msg__pin">
          <button type="button" className="btn" onClick={() => onPin(turn)}>
            {turn.pinned ? '已记下' : '记到划线'}
          </button>
          {turn.pinNote && <p className="ai-msg__pin-note">{turn.pinNote}</p>}
          {turn.pinError && (
            <p className="ai-msg__status ai-msg__status--error">{turn.pinError}</p>
          )}
        </div>
      )}
```

- [ ] **Step 5: AiPanel `pinTurn`**

```ts
  const pinTurn = async (turn: Turn): Promise<void> => {
    if (!turn.pinMeta || chapterId === null) return
    try {
      const result = await window.api.notes.pinAi({
        bookId,
        chapterId,
        text: turn.pinMeta.text,
        content: turn.text,
        source: turn.pinMeta.source,
        startCfi: turn.pinMeta.startCfi,
        endCfi: turn.pinMeta.endCfi
      })
      setTurns((list) =>
        list.map((item) =>
          item.id === turn.id
            ? {
                ...item,
                pinned: true,
                pinError: null,
                pinNote: result.reusedEarliestDuplicate
                  ? '已挂到本章最早的一条相同划线'
                  : null
              }
            : item
        )
      )
      onPinned?.(result.highlight)
    } catch (e) {
      setTurns((list) =>
        list.map((item) =>
          item.id === turn.id
            ? {
                ...item,
                pinError: e instanceof Error ? e.message : '没能记到划线'
              }
            : item
        )
      )
    }
  }
```

`AiPanel` props 增加 `onPinned?: (highlight: Highlight) => void`。

- [ ] **Step 6: ReaderPage 合并新高亮**

```ts
  const onPinned = useCallback((highlight: Highlight) => {
    setHighlights((list) =>
      list.some((item) => item.id === highlight.id)
        ? list.map((item) => (item.id === highlight.id ? highlight : item))
        : [...list, highlight]
    )
  }, [])
```

传给 `AiPanel`。历史回填的 turn 无 `pinMeta`，不显示按钮（符合规格）。

- [ ] **Step 7: Commit**

```bash
git add src/features/ai/AiPanel.tsx src/features/ai/AiMessage.tsx src/features/reader/ReaderPage.tsx
git commit -m "$(cat <<'EOF'
feat: AI 回答可显式记到划线

划词种子带上 CFI；仅完成态且带 pinMeta 的助手回答显示按钮，不自动写入。
EOF
)"
```

---

### Task 10: 端到端

**Files:**
- Create: `e2e/pin-ai.spec.ts`

参考 `e2e/notes.spec.ts` 的临时 userData 与开窗方式。

- [ ] **Step 1: 编写用例（经 IPC，不依赖真实模型）**

```ts
test('pinAi 找或建划线，清空对话后笔记仍在，删划线级联', async () => {
  // 1. 导入夹具书 / 或复用已有 make-epub 流程打开 bookId、chapterId
  // 2. 直接 notes.pinAi({ ..., content: '解释正文', source: 'explain', startCfi, endCfi })
  // 3. notes.listAll → 该条 aiNotes[0].content === '解释正文'
  // 4. 再 pin 一次同文 → aiNotes.length === 2
  // 5. ai.clear(bookId, scopeKey) 之后 listAll 的 aiNotes 仍在
  // 6. notes.remove(highlightId) 后 listAiNotes(highlightId) 为空（或 listAll 无此 id）
})

test('缺 CFI 且无同文划线时 pinAi 失败且不留脏划线', async () => {
  // pinAi 不传 startCfi/endCfi，text 用本章从未划过的句子
  // 期望抛出含「没法定位到原文」
  // listAll 中无该 text
})
```

可选 UI 断言：若 e2e 已有进入阅读器 + mock AI 的路径则点按钮；否则 IPC 覆盖规格 §9 即可（与仓库「AI 真调用不进 CI」一致）。

- [ ] **Step 2: 跑 e2e**

Run: `npm run e2e -- e2e/pin-ai.spec.ts`  
Expected: PASS

- [ ] **Step 3: 跑边界冒烟（API_SHAPE）**

Run: `npm run e2e -- e2e/boundary.spec.ts`  
Expected: PASS（preload 形状含新方法）

- [ ] **Step 4: Commit**

```bash
git add e2e/pin-ai.spec.ts
git commit -m "$(cat <<'EOF'
test: pinAi 找或建、级联删除与缺 CFI 拒建

用 IPC 覆盖记到划线主路径，不依赖真实模型调用。
EOF
)"
```

- [ ] **Step 5: 更新规格状态行**

将 `docs/superpowers/specs/2026-10-26-pin-ai-answers-to-highlights-design.md` 头部状态改为：`已确认，实现计划见 plans/2026-10-26-pin-ai-answers-to-highlights.md`。

```bash
git add docs/superpowers/specs/2026-10-26-pin-ai-answers-to-highlights-design.md
git commit -m "$(cat <<'EOF'
docs: 关联 AI 记到划线的实现计划
EOF
)"
```

---

## Spec coverage checklist

| 规格条目 | 任务 |
|---|---|
| 显式「记到划线」、不自动 | Task 9 |
| 分表、可多条 | Task 1–3 |
| 同文取最早 / 否则新建 | Task 2–3 |
| 缺 CFI 拒建 | Task 3、10 |
| 列表带 aiNotes | Task 3 |
| IPC 白名单 | Task 1、5 |
| 导出开关 | Task 4、7 |
| 笔记页筛选 / 卡片 | Task 6 |
| 高亮浮层 | Task 8 |
| 清对话不影响已 pin | Task 10 |
| 删划线级联 | Task 1 FK + Task 10 |
| 结构化任务不进划线 | 未做入口（YAGNI） |
| 左栏本章划线列表 | 非目标，无任务 |

## Placeholder / 类型自检

- 无 TBD /「类似 Task N」省略实现。
- `PinAiToHighlightInput` / `Highlight.aiNotes` / `includeAiNotes` / `pinMeta` 前后任务同名。
- `chooseHighlightForPin` 与仓储查询 `ORDER BY id` 一致（取最小 id）。
