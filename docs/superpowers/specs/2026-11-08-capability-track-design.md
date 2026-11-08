# 学习脉络（Capability Track）· 设计文档

- 日期：2026-11-08
- 状态：草案（分段确认完成，待用户审阅本文件）
- 范围：目标驱动的能力树 + 书库挂载 + 主动「问缺」；单活跃 Track
- 配套：
  - [阅微总设计](./2026-09-29-book-reader-design.md)（AI 硬规则、单通道、降级）
  - [功能清单](./2026-11-03-feature-inventory.md)（当前已落地能力）

---

## 0. 摘要

在「单书 AI」之上增加平行主线 **学习脉络**：用户给出目标（如「当好 CEO」），系统显式生成能力骨架并把本地书挂到节点；用户可主动问「我缺什么」。缺口以书库覆盖与阅读进度为主，笔记 / 钉住的 AI 回答加权；空节点给「建议补哪类书」的类目文案，不做外链导购。

V1 主价值是 **问缺**；**成树**是底座。不做测验、多 Track UI、按节点跨书长对话。

---

## 1. 目标与非目标

### 1.1 目标

1. 系统持有持久化的能力脉络（不是散落书单），深度 ≤3。
2. 脉络来源为混合：目标生成骨架，书库填叶与加权；允许空节点。
3. 用户显式触发「生成 / 重生脉络」与「我缺什么」；结果可缓存复用。
4. 缺口信号本地可算、可解释：覆盖（A）+ 进度（B）为主，沉淀（C）加权。
5. 主导航增加「脉络」页，与书架 / 笔记 / 设置平级。

### 1.2 非目标（V1）

- 多 Track 切换 UI（表可预留 `archived`，界面只暴露一个 active）
- 测验 / 自评问卷
- 外链荐书、导购、联网搜书
- 按节点跨书自由长对话（下一刀）
- 笔记页按脉络节点筛选（下一刀）
- 后台自动成树、自动问缺、打开应用即分析
- 划词浮条或阅读器 AI 面板内嵌「问缺」
- 书架卡片强制展示挂载信息（可选后续，V1 默认不做）

### 1.3 沿用硬规则

1. AI 永不后台自动调用。
2. 能力降级要明说。
3. 渲染进程零能力；密钥与模型调用在主进程。
4. 单通道串行；中断即 Abort；BYOK 展示用量。

---

## 2. 概念模型

| 对象 | 含义 |
|---|---|
| Track | 一个学习目标（如 CEO）。V1 仅 1 个 `active` |
| Node | 能力节点，树形；**Track 本身不是节点**。depth 1=能力域，2=子系统，3=可选要点；`depth` 取值 1–3 |
| NodeBook | 书与节点的多对多挂载（`ai` 建议或 `user` 手改） |
| GapReport | `track.gap` 的结构化结果，落库复用 |

删书：只删除该书写入的挂载行，不级联删除 Track / Node。

**「未归类」**：不是数据库节点，而是成树后的 UI 列表——书库中尚未挂到任何节点的书，供用户拖入节点。

---

## 3. 成树与问缺

### 3.1 任务一览

| 任务 id | 触发 | 费用 | 说明 |
|---|---|---|---|
| `track.build` | 创建脉络 / 重生骨架 | 有（确认框） | 两阶段：骨架 → 挂载建议 |
| `track.gap` | 「我缺什么」或一句追问 | 有；可缓存 | 本地信号 + 模型成文 |
| （本地） | 改名、改挂载、看树、看旧报告 | 无 | 不调模型 |
| `track.computeSignals` | UI 角标 / 问缺前 | 无 | 纯聚合 |

### 3.2 `track.build` 输入输出

**输入（主进程组装，不塞全书正文）：**

- `goal_text`
- 书库摘要：`id / title / author / tags / status / progress%`；可选每书目录标题前若干条（控 token）
- 若重生：上一版节点树（尽量保留用户改过的节点 id）

**阶段 1 · 骨架 JSON：** 节点 `id / title / summary / parent_id / depth / sort_order`，深度校验失败则拒收并明说。

**阶段 2 · 挂载建议：** `nodeId → bookId[]`。低置信或不匹配进「未归类」；用户可一键接受或逐条改。

空节点合法，作为覆盖缺口来源。

**重生策略：** 用新骨架替换该 Track 下全部 `track_nodes`；挂载按「新节点 id 对齐」尽量保留——仅当新树仍含相同 `node_id` 时保留原 `track_node_books`（含 `source=user`）；对不上的挂载丢弃。确认框须写明此行为。

### 3.3 `track.gap` 信号与输出

**每节点本地信号：**

- A 覆盖：挂书数；0 = 覆盖缺口
- B 进度：挂书进度均值、未开始占比
- C 沉淀：相关高亮数、批注数、钉住 AI 笔记数（简单加权；具体权重实现计划里定一组默认值并单测锁住）

**模型输出（固定结构，优先 JSON）：**

- `overall`：总判一两句
- `gaps[]`：`nodeId` / 类型（`coverage` \| `progress` \| `sediment`）/ 说明 / `suggestBookKinds[]`（类目文案）
- `nextSteps[]`：本地下一步（去读某本、给某节点补书、先攻某子系统）

**缓存键：** `scope_key = signalsFingerprint`（由全树各节点 A/B/C 信号规范化序列化后哈希）。信号变则键变，下次「我缺什么」自然不命中旧缓存；UI 另提示「信号已变，可重新问缺」，**不自动重跑**。用户追问时 `scope_key = signalsFingerprint + '\n' + normalizedQuestion`。命中唯一键则 `cached: true` 并标明未重新计费。若用户强制「无视缓存再问」，使用新 `scope_key` 后缀（如时间戳）写入新行，不覆盖旧报告（界面默认仍展示最新一条）。

### 3.4 降级

| 情况 | 行为 |
|---|---|
| 无 JSON mode | 剥代码块容错；失败则纯文本 + 明说 |
| 书太多超预算 | 只送 Top-N 本摘要，结果顶栏明说 N |
| 网络 / 配置 / 模型 / 内容 | 与现有 AI 四类错误动作一致 |
| 无 API Key | 空态引导去设置，不发起请求 |

---

## 4. UI 信息架构

### 4.1 导航

主导航由「书架 / 笔记 / 设置」增为 **书架 / 脉络 / 笔记 / 设置**。

阅读中侧栏图标轨同样可进脉络；进入后离开阅读器（与进笔记一致）。不在阅读器内再开第二套问缺面板。

### 4.2 脉络页

**空态：** 定位文案 + 目标输入 +「生成脉络」（确认费用与两阶段）+ 无密钥时的设置入口。

**有 Track：**

- 左：能力树；角标反映信号强弱；空节点可区分；点节点看挂书；可手改挂载；点书名打开阅读器
- 右：主按钮「我缺什么」；最近 `GapReport`；可选一句追问；信号已变提示
- 顶栏：目标标题、重生骨架、次要编辑入口

### 4.3 与其它页

- 书架：不嵌树；V1 不做挂载角标
- 笔记：不按节点筛选（非目标）
- 设置：不新增脉络专区；密钥与能力表沿用

---

## 5. 存储与 IPC

### 5.1 表

```text
tracks
  id TEXT PK
  goal_text TEXT NOT NULL
  title TEXT NOT NULL
  status TEXT NOT NULL          -- active | archived
  prompt_version TEXT NOT NULL
  created_at INTEGER NOT NULL
  updated_at INTEGER NOT NULL

track_nodes
  id TEXT PK
  track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE
  parent_id TEXT NULL
  title TEXT NOT NULL
  summary TEXT NOT NULL DEFAULT ''
  sort_order INTEGER NOT NULL DEFAULT 0
  depth INTEGER NOT NULL
  created_at INTEGER NOT NULL
  updated_at INTEGER NOT NULL

track_node_books
  track_id TEXT NOT NULL
  node_id TEXT NOT NULL
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE
  source TEXT NOT NULL          -- ai | user
  created_at INTEGER NOT NULL
  PRIMARY KEY (node_id, book_id)

track_ai_results
  id INTEGER PRIMARY KEY AUTOINCREMENT
  track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE
  task TEXT NOT NULL            -- build | gap
  scope_key TEXT NOT NULL
  prompt_version TEXT NOT NULL
  provider TEXT NOT NULL
  model TEXT NOT NULL
  payload TEXT NOT NULL
  input_tokens INTEGER NOT NULL DEFAULT 0
  output_tokens INTEGER NOT NULL DEFAULT 0
  created_at INTEGER NOT NULL
  UNIQUE (track_id, task, scope_key, prompt_version, model)
```

不复用 `ai_results`（现有表强制 `book_id`）。信号不落冗余表，问缺时现算。

### 5.2 IPC（V1 最小白名单）

本地（无模型）：

- `track.getActive` → 当前 active Track 或 null
- `track.listNodes` → 节点树 + 每节点挂书摘要
- `track.setBookLinks` → 设置某节点的 bookId 列表（标记 `source=user`）
- `track.renameNode` → 改标题 / summary
- `track.computeSignals` → 每节点 A/B/C 与全树 fingerprint
- `track.getLatestGap` → 最新 GapReport 或 null（只读库，不调模型）

花钱（单通道 + Abort）：

- `track.build({ goalText, rebuild? })` → 流式阶段进度；成功后写库
- `track.gap({ question?, forceRefresh? })` → 流式或一次性 JSON；`cached` 标志

实现计划扩写 `shared/ipc.ts` → `API_SHAPE` 时不得超出上表；若需增删方法，先改本 spec。

---

## 6. 测试

| 层 | 覆盖 |
|---|---|
| 单元 | 信号聚合；树 JSON 校验（深度、环、非法 bookId 剔除）；C 加权默认值 |
| 集成 | migration；删书只摘挂载；build/gap 唯一键复用 |
| e2e（窄） | 无 key 空态；有 Track 时 mock provider 走通「我缺什么」 |

不测模型文采；固定 fixture + mock chat。

---

## 7. 分期

| 刀 | 内容 |
|---|---|
| **本 spec（V1）** | 单 Track 成树 + 挂载手改 + 问缺 + 脉络页 |
| 下一刀 | 节点域跨书问答 |
| 再下一刀 | 多 Track UI、笔记按节点筛选 |

---

## 8. 决策记录

| 决策 | 选择 | 原因 |
|---|---|---|
| 谁建树 | AI：目标骨架 + 书库挂载（混合） | 纯书库无法表达「整块能力空白」 |
| V1 主价值 | 问缺；成树为底座 | 用户要系统有脉络，并主动问欠缺 |
| 缺口证据 | A+B 主，C 加权；不做测验 | 本地已有数据够用，少打扰 |
| 架构 | 独立 Track 实体，非标签树 / 非单份大纲 | 可复算、可演进到域问答 |
| AI 结果表 | `track_ai_results` 分立 | 避免扭曲现有 `book_id` 唯一键 |
| 导航 | 新增「脉络」一级 | 平行主线，不附属单书面板 |
