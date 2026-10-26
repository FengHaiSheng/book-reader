# 把 AI 回答记到划线 · 设计文档

- 日期：2026-10-26
- 状态：已确认，实现计划见 [plans/2026-10-26-pin-ai-answers-to-highlights.md](../plans/2026-10-26-pin-ai-answers-to-highlights.md)
- 范围：仅「划词产生的 AI 回答 → 挂到划线」；不含合上书看小结、不含阅读器左栏本章划线列表
- 配套：
  - [读书软件设计文档](./2026-09-29-book-reader-design.md) —— 进程模型、标注模型、AI 硬规则
  - 现有表：`highlights`（批注在 `note`）、`ai_messages`（按章会话）

---

## 0. 摘要

划词后点「解释 / 翻译 / 问 AI」，回答目前只活在 AI 面板的本章对话里：翻章或合上书就从日常回看路径里消失。本功能让用户把**某一条已完成的助手回答**显式记到一条划线上；手写批注与 AI 笔记分开存、一条划线可挂多条 AI 笔记；没有划线时先建再挂，已有相同原文划线则复用最早一条。

硬规则不变：**不自动记**；记的是回答正文副本，不依赖之后是否还留着 `ai_messages`。

---

## 1. 目标与非目标

### 1.1 目标

1. 每条**已完成**的助手回答下方提供「记到划线」。
2. 手写批注（`highlights.note`）与 AI 笔记分离；一条划线可挂多条 AI 笔记。
3. 本章已有原文完全相同的划线 → 挂到**最早**那条；否则新建默认色划线再挂。
4. 记下后出现在：阅读器高亮浮层、笔记页卡片、笔记导出（可关）。
5. 清空本章对话不影响已记下的内容；删除划线级联删除其 AI 笔记。

### 1.2 非目标

- 不自动把回答写入划线。
- 不把本章小结 / 全书要点 / 关键词 / 思维导图写入划线（另题）。
- 不做阅读器左栏「本章划线列表」（另题）。
- 不改造 `ai_messages` 的生命周期，不在对话消息上挂 `highlight_id`。
- 不做模糊匹配原文、不做跨章复用划线。
- 不在本次做「编辑已记下的 AI 笔记正文」（可删；改字需求未提出）。

---

## 2. 用户流程

1. 用户划词 → 解释 / 翻译 / 问 AI → 面板出现助手回答。
2. 回答流式结束且本轮带有**提问用的选中原文**时，该条回答下出现「记到划线」。
3. 点击后：
   - 本章存在 `text` 完全相等的划线 → 向最早一条插入一条 AI 笔记；
   - 否则用该原文新建划线（默认高亮色、无手写批注）再插入。
4. 成功：按钮文案变为「已记下」；仍可再点，再插入一条（不覆盖）。
5. 若本章有多条相同原文划线：挂到最早一条，并在该回答下用一行状态说明「已挂到本章最早的一条相同划线」。
6. 失败：该回答下显示可读中文错误，回答仍留在面板，可重试。不自动重试。

自由提问（未带选中原文）的助手回答：**不显示**「记到划线」，避免挂到对不上的句子上。

---

## 3. 数据模型

### 3.1 新表 `highlight_ai_notes`

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | INTEGER PK | |
| `highlight_id` | INTEGER NOT NULL | `REFERENCES highlights(id) ON DELETE CASCADE` |
| `content` | TEXT NOT NULL | 记下时的回答正文副本 |
| `source` | TEXT NOT NULL | `explain` \| `translate` \| `ask` |
| `created_at` | INTEGER NOT NULL | |

索引：`idx_highlight_ai_notes_highlight (highlight_id, created_at)`。

迁移：在现有 `user_version` 序列上新增一版，整步事务；迁移前仍走现有「备份最近 3 份 db」路径。

### 3.2 不变

- `highlights.note` 只表示用户手写批注。
- `ai_messages` 不增加外键、不因「记到划线」而改写或删除。

### 3.3 类型（`shared/types`）

```ts
type HighlightAiNoteSource = 'explain' | 'translate' | 'ask'

type HighlightAiNote = {
  id: number
  highlightId: number
  content: string
  source: HighlightAiNoteSource
  createdAt: number
}

/** 「记到划线」一次事务的结果 */
type PinAiToHighlightResult = {
  highlight: Highlight
  aiNote: HighlightAiNote
  /** 本章曾有多条相同原文划线时为 true */
  reusedEarliestDuplicate: boolean
}
```

`Highlight` 与 `HighlightWithBook` 均增加 `aiNotes: HighlightAiNote[]`（按 `created_at` 升序；没有则为空数组）。`listChapter` / `listAll` 一次带出，避免笔记页 N+1。

---

## 4. 主进程行为

### 4.1 找或建划线

输入：`bookId`、`chapterId`、`text`、可选 CFI（新建时需要）、`color` 默认值。

1. 在 `highlights` 中查 `book_id + chapter_id + text` 完全相等，按 `id ASC` 取第一条。
2. 命中 → 复用其 `id`。
3. 未命中 → `notes.create` 同等逻辑新建（需 `start_cfi` / `end_cfi`；见 §4.3）。
4. 插入 `highlight_ai_notes`。
5. 单事务；任一步失败整单回滚。

### 4.2 IPC（白名单新增）

| 方法 | 作用 |
|---|---|
| `notes.pinAi` | 找或建划线 + 插入 AI 笔记（§4.1） |
| `notes.listAiNotes` | 按 `highlightId` 列出（浮层按需；列表接口若已嵌入则可少用） |
| `notes.removeAiNote` | 按 AI 笔记 `id` 删除；不动划线与手写批注 |

`notes.listChapter` / `notes.listAll`：结果中带上每条划线的 `aiNotes`。  
`notes.remove`（删划线）：依赖 FK CASCADE，无需手删子表。  
preload `API_SHAPE` 与通道名同步扩展；冒烟断言仍要求形状一致。

### 4.3 新建划线时的定位

从划词进 AI 时，渲染进程须在 seed / 回合元数据里保留当时的 `startCfi`、`endCfi`、`text`（以及 `source`）。`pinAi` 在需要新建时带上 CFI；缺 CFI 且又找不到同文划线 → 返回可读错误「没法定位到原文，请先划线后再记」，不建无定位的脏划线。

### 4.4 导出

`ExportEntry` 增加 `aiNotes: { source, content }[]`。  
`NotesExportOptions` 增加 `includeAiNotes: boolean`（默认 `true`）。  
Markdown / HTML / Anki：在「我的批注」之后输出「AI 笔记」块（带来源标签）；无则整块省略。

---

## 5. 渲染进程

### 5.1 AI 面板

- 仅 `state === 'done'` 且回合带有非空选中原文 + 合法 `source` 时渲染「记到划线」。
- 点击调用 `notes.pinAi`；成功更新该回合的「已记下」态；`reusedEarliestDuplicate` 时展示说明文案。
- 阅读器若因此新建了划线：通过现有本章高亮刷新路径把新高亮画进正文（与手动画线同一套 Custom Highlight）。

### 5.2 高亮浮层

在手写批注编辑区下方增加「AI 笔记」列表：来源标签 + 正文 + 删除。删除走 `notes.removeAiNote`。

### 5.3 笔记页

- 卡片：批注下展示 AI 笔记列表（只读正文 + 可删）。
- 筛选：现有「仅高亮 / 仅有批注」语义不变（「仅有批注」仍只看 `note`）。新增「有 AI 笔记」：`aiNotes.length > 0`。
- 右侧上下文面板不改。

### 5.4 导出浮层

增加「包含 AI 笔记」开关，默认开；预览与落盘共用同一选项。

---

## 6. 错误与文案口径

| 情况 | 用户可见 |
|---|---|
| 写库失败 | 「没能记到划线：…」 |
| 缺 CFI 且无同文划线 | 「没法定位到原文，请先划线后再记」 |
| 多条同文划线 | 「已挂到本章最早的一条相同划线」 |
| 无选中原文的回答 | 不显示按钮 |

错误已是中文可读串，渲染层只展示，不二次分类（与现有 `AppError` 约定一致）。

---

## 7. 测试

### 7.1 单测（vitest）

- 找或建：未命中新建、命中复用、多条取 `id` 最小。
- 导出：开/关 `includeAiNotes`；有批注 + 多条 AI 笔记的 Markdown 形状。
- 筛选：`有 AI 笔记` 与「仅有批注」互不误伤。

### 7.2 端到端（Playwright）

1. 划词 → 解释（可用夹具/mock 回答）→ 记到划线 → 笔记页可见 AI 笔记。
2. 导出预览含 AI 段；关闭开关后不含。
3. 删除划线后对应 AI 笔记不可见。
4. 清空本章 AI 对话后，已 pin 的 AI 笔记仍在。

不强制真实模型调用进 CI。

---

## 8. 与后续两块的边界

本规格交付后仍独立、可单测的两块（另开设计，不阻塞本实现）：

1. **合上书看已生成的小结 / 要点**：只读 `ai_results`，挂在笔记页按书分组。
2. **阅读器左栏本章划线列表**：消费已有 `listChapter`（含本规格带出的 `aiNotes` 亦可，但不依赖）。

---

## 9. 验收标准

1. 未点「记到划线」时，库中不出现新的 `highlight_ai_notes` 行。
2. 记一次后，笔记页与（默认选项下）导出能看到该回答；手写 `note` 未被改写。
3. 同一回答连点两次产生两条 AI 笔记。
4. 清空 `ai_messages` 该 scope 后，已 pin 内容仍在。
5. 删划线后其子 AI 笔记不残留。
6. 断网下只要本地库可写，记到划线可用（不发起新的模型请求）。
