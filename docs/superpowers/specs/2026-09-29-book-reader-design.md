# 桌面端读书软件 · 设计文档

- 日期：2026-09-29
- 状态：待评审
- 配套资料：
  - [.uicraft.md](../../../.uicraft.md) —— 设计语境、Design Tokens、自适应策略表
  - [reader.html](../../../design/mockups/reader.html) —— 阅读器视觉样板（已实现并验证交互）
  - [bookshelf.html](../../../design/mockups/bookshelf.html) —— 书架样板
  - [notes.html](../../../design/mockups/notes.html) —— 笔记样板

---

## 0. 摘要

一个**纯本地、无账号、仅支持 epub** 的桌面端读书软件，带 BYOK（自带密钥）AI 能力。目标用户是中文读者，把本地 epub 当作要沉淀的知识而非消遣。

三条贯穿全文的约束：

1. **AI 永不后台自动调用。** BYOK 下 token 是真金白银，任何自动分析都是产品事故。所有 AI 调用必须由用户显式触发或确认。
2. **能力降级要明说。** 国内厂商接口能力不齐（embedding、结构化输出），遇到不支持必须在 UI 上明确说明，不静默失败。
3. **渲染进程零能力。** 文件系统、解析、数据库、AI 调用、密钥全部留在主进程。

---

## 1. 定位、边界与架构

### 1.1 技术栈

Electron + React + TypeScript。仅支持 epub。纯本地、无账号、无云同步。BYOK 接入国内大模型（DeepSeek / 通义 / 智谱 / Kimi）。不用 LangChain——这一层逻辑很薄，框架带来的抽象成本大于收益。

### 1.2 进程模型与能力边界

| 进程 | 职责 | 明确不做 |
|---|---|---|
| 渲染进程（React） | 只负责 UI 与交互状态 | 不碰 fs、不碰 sqlite、不持有密钥、不发 AI 请求 |
| preload | 用 `contextBridge` 暴露**具名白名单方法** | 不提供通用 `invoke(channel, args)` 透传 |
| 主进程（Node） | 文件读写、epub 解析、SQLite、AI Provider 调用、TTS、密钥管理 | 不承载业务 UI 逻辑 |

两条硬性安全配置：`contextIsolation: true` + `nodeIntegration: false` + `sandbox: true`。AI 请求一律在主进程发起，顺带绕开 CORS。

### 1.3 目录结构

```
electron/
  main/
    index.ts        # 应用生命周期、窗口创建
    ipc/            # IPC 路由，每个域一个模块，方法名即白名单
    library/        # 书库：导入、删除、去重、封面缓存
    epub/           # zip 读取、OPF 解析、纯文本抽取、自定义协议
    store/          # better-sqlite3 封装、迁移、查询
    ai/             # Provider 抽象、RAG 检索、任务提示词、并发与中断
    tts/            # 预留，第一期不实现
    secrets/        # safeStorage 密钥读写
  preload/
src/
  features/
    library/        # 书架
    reader/         # 阅读器（iframe 宿主、划词、高亮、排版面板）
    notes/          # 笔记汇总与导出
    ai/             # AI 面板、引用渲染、任务进度
  shared/           # 类型、Design Tokens、错误码
```

---

## 2. 数据模型与本地存储

### 2.1 应用目录

```
userData/
  db.sqlite
  secrets.json          # safeStorage 加密后的密文
  library/<bookId>/book.epub
  library/<bookId>/cover.jpg
  logs/                 # 按天切分，保留 7 天
```

导入时把 epub **复制**进 `library/`，用户原始文件后续被移动或删除都不影响书库。

### 2.2 表结构

**books** —— `id`(TEXT uuid) / title / author / publisher / language / isbn / cover_path / file_path / `file_hash`(sha256，用于去重) / file_size / added_at / last_opened_at / total_chars / chapter_count / status(unread|reading|finished)

**chapters** —— `id`(INTEGER) / book_id / **parent_id**(支持嵌套目录) / order_index(在 spine 中的顺序) / title / href(zip entry) / depth / **char_start, char_end**（该书纯文本中的字符区间，非正文节点为 NULL）

> 目录树与阅读顺序是两回事，所以 parent_id 与 order_index 分开存。

**chunks** —— `id` / book_id / chapter_id / order_index / text / token_count / **embedding**(BLOB，可空) / heading_path(「书名 > 章 > 节」)

**reading_progress** —— `book_id`(PK) / cfi / chapter_id / percent / updated_at

**highlights** —— `id` / book_id / chapter_id / start_cfi / end_cfi / text(选中原文) / note(批注) / color / created_at / updated_at

**ai_results** —— `id` / book_id / task / scope_key / `prompt_version` / provider / model / payload(JSON) / input_tokens / output_tokens / created_at
**UNIQUE(book_id, task, scope_key, prompt_version, model)** —— 换模型或改提示词即自动失效重算，用户不需要理解缓存。

**ai_messages** —— `id` / book_id / chapter_id(NULL 表示全书级) / scope_key / role / content / tokens / created_at

**tags** / **book_tags** —— tags(id, name, color) / book_tags(book_id, tag_id)，多对多。书架侧栏按标签筛选、列表视图显示标签都依赖它。

**settings** —— key-value，存阅读偏好（字号、每行字数、行距、主题、字体）、当前 Provider 与模型。

**chunks_fts** —— FTS5 虚表，见 §5.2 的中文 bigram 方案。

### 2.3 关键决策

- **不引入向量数据库。** 中文 chunk embedding 存 BLOB，检索时内存暴力余弦。几千个 chunk 是毫秒级，引一套向量库是纯粹的过度设计。
- **embedding 默认为空。** 是否计算由用户显式决定，见 §5.3。
- **密钥不入库。** `secrets.json` 与数据库分开，导出数据时天然不含密钥。

---

## 3. epub 解析与渲染管线

### 3.1 渲染路径与 AI 路径分离

这是本节最重要的一条：**渲染走原始 XHTML，AI 走抽取的纯文本。**

- 渲染路径保留书内原有排版与样式，只做可控覆盖，不做重排重制。
- AI 路径需要的是连续、干净的文本流，与渲染无关。两条路径各有自己的产物（zip 内的 entry vs `chapters` 表的纯文本），互不干扰。

### 3.2 导入管线

1. 计算 sha256，与库内比对去重（命中则跳到已存在的书，不导入第二份）
2. 校验是合法 zip 且含 OPF，解析元数据（标题、作者、出版社、语言、封面）
3. 复制到 `library/<bookId>/book.epub`，抽取封面到 `cover.jpg`
4. 在主进程 worker 中按 spine 顺序抽取每章纯文本，写 `chapters`（含嵌套目录与 char_start/char_end）
5. 划分 chunk（以自然段为单位聚合到 400–600 token，段间重叠 1 段），写 `chunks`
6. 建立 FTS bigram 索引
7. 全程包在事务里——**任一步失败必须回滚，不留半本书的脏数据**，并删除已复制的目录

### 3.3 不预解压，注册自定义协议

保留原始 zip 不展开，注册 `epub://<bookId>/<entry>`，用 `protocol.handle` + yauzl 按需解压单个 entry。

必须做的校验：路径解析后校验前缀必须落在 `library/<bookId>/` 内，拒绝 `..` 穿越。只有封面例外——导入时抽一次并缓存，避免每次渲染书架都解压。

### 3.4 渲染

- **单章单 iframe**：一章一个文档，翻章即换文档，避免整本书进 DOM。
- **分页用 CSS 多栏**：`column-count` + 固定视口高度实现横向翻页，不做 JS 逐字测量。
- **主题覆盖**：向 iframe 注入 `<style id="reader-theme">`，用 CSS 变量覆盖字号、行距、颜色、字体。书的样式优先，主题只覆盖"阅读相关"的部分。
- **定位用 CFI**：进度与高亮都以 CFI 为准，不依赖字符偏移。
- **高亮用 CSS Custom Highlight API**：不向 DOM 插 `<mark>`，避免改动书内结构导致 CFI 漂移。
- **iframe 与 React 用 postMessage 通信**：iframe 内不引入任何 Node 能力，也不执行书内脚本（§6.4）。
- **渲染库倾向 foliate-js**，其 CFI 与分页实现成熟。需在实现阶段先做一次技术验证（见 §8）。

### 3.5 AI 引用回跳

拿到 chunk 后，取其前 30 个字符，在当前章节的 DOM 文本里匹配定位 Range → 滚动并短暂高亮；跨章节则先切章再匹配。匹配失败退化为「跳到对应章」，并明说定位失败，不假装成功。

---

## 4. UI/UX 信息架构

视觉规范以 [.uicraft.md](../../../.uicraft.md) 为准（方向「纸感静谧」、三层表面、Design Tokens、自适应策略表）。本节只固定结构。

### 4.1 页面结构

- 一级页面只有三个：**书架（首页）/ 笔记 / 设置**
- 阅读器是**沉浸式全屏**，不是第四个 tab
- 进入书后，右侧面板三个 tab：**目录 / 笔记 / 本书分析**

### 4.2 桌面端结构语言

不是网页。两个平台共用一套设计语言，只做平台级适配：

- **标题栏 44px 自绘**：macOS 让出左上角红绿灯位置；Windows 在右上角自绘最小化 / 最大化 / 关闭
- **左侧边栏 248px**：一级导航 + 上下文列表（进入书后变为本书目录）
- **三层表面**：外壳（书桌）→ 面板（侧栏、AI 面板）→ 内容面（纸）。深度来自层次，不来自特效
- **不扁平**，但禁止玻璃拟态、渐变文字、发光、装饰性纹理
- 滚动发生在**面板内**，不是整页滚动
- 原生优先：原生菜单栏、原生文件对话框、原生右键菜单、系统滚动条
- 交互用 hover / 右键菜单 / 键盘快捷键 / 拖拽，禁用移动端手势隐喻

### 4.3 自适应

优先级：**面板先退让，正文优先**；正文列有宽度上限（中文一行 30–38 字是舒适区）；超出上限的宽度不留给纸面空白，交给**对开双页**。完整断点表见 .uicraft.md。

已知取舍：AI 面板打开必然挤窄正文列。这是 BYOK 产品里必要的代价，不做"面板压住正文"的浮层方案。

### 4.4 排版可调

「每行字数 24–48（默认 34）」是**独立控件**，不是字号的副产物——"字太小看不清"和"一行太长读着累"是两个不同诉求。版心宽 = 每行字数 × 字号。

窗口宽度不足时每行字数只能按上限显示，**必须在界面上明说**（如"窗口宽度只够 37 字／行，已按上限显示"），不能静默降级。

### 4.5 书架与笔记

- **书架**：网格 / 列表可切换，网格用 `auto-fill` 自适应列数；封面按真实装帧渲染（投影 + 书脊），产品中由导入时抽出的封面图渲染；网格末尾是拖放终点，支持一次拖入多本；空状态明说"只保存在本机"。
- **笔记**：跨书汇总，按书分组、分组头吸顶；每条笔记左侧色条对应书内高亮颜色；右栏给出**所选笔记的原文上下文**，让用户不跳回书里也能判断这条笔记是否要留；导出 Markdown 走标题栏浮层，预览可见。

### 4.6 设置页

三组，都是桌面端面板形态（不是网页式长表单）：

1. **模型**：选 Provider（DeepSeek / 通义 / 智谱 / Kimi）→ 填 key → 「测试连接」。key 只回显 `sk-••••••••3f7a`，输入框里的明文在失焦后立即清除。下方常驻一张**能力表**，把 chat / stream / 向量检索 / 结构化输出逐项标出「支持 / 不支持（将降级为 X）」——这是硬规则 2 的落点，让用户在配置阶段就知道会降级，而不是提问时才发现。
2. **阅读偏好**：字体、字号、每行字数、行距、主题。与阅读器内的 Aa 面板共用同一份设置。
3. **数据**：书库位置与占用、导出全部数据（不含密钥）、数据库备份列表（最近 3 份）、清理缓存。

> 这是唯一还没有视觉稿的一级页面，见 §8。

---

## 5. AI 能力层

### 5.1 一个协议 + 四份能力声明

DeepSeek、通义、智谱、Kimi 均提供 OpenAI 兼容的 `/chat/completions`，因此**不写四套 Provider**，只写一个 `OpenAICompatProvider`，差异收敛到能力声明与参数映射：

```ts
provider = {
  id, name, baseURL, keyRef,
  caps: { stream, embed, jsonMode, vision, maxContext, params },
  chat(req)    → AsyncIterable<Delta>,
  embed(texts) → number[][]
}
```

- 能力表**内置一份、随版本更新**，运行时不做探测——任何探测都是花用户的钱。只有当实际调用返回「不支持」时，才把该项标记为 unavailable 并持久化。
- 参数映射表吃掉 `max_tokens` 之类的命名差异与取值区间差异。
- 填 key 时只发一次极限小的验活请求（1 token），失败直接暴露原始错误，不吞。

### 5.2 降级路径

| 缺失能力 | 降级做法 | UI 上必须说 |
|---|---|---|
| 无 embedding | 检索退化为关键词检索 + 当前章节窗口 | 面板顶部常驻：当前模型不提供向量检索，已改用关键词检索，跨章节召回会变弱 |
| 无 JSON mode | 提示词要求 JSON + 解析容错（剥 ``` 包裹、取首尾花括号），仍失败则按文本展示 | 本次未能生成结构化大纲，已按纯文本呈现 |
| 上下文窗口小 | 按 token 预算截断，优先"当前段落所在窗口"+ 召回片段 | 本次只送入了本书 N 段，回答范围受限 |

**中文检索的坑**：FTS5 的 `unicode61` 对中文按连续 CJK 串切分，几乎等于整句成词，检索基本失效。所以单独建一列 **bigram 索引**——入库时把中文按二字切分写入 FTS 表，查询时同样切分。纯本地、零成本、中文召回可用，不引第三方分词库。

### 5.3 花钱的事一律显式

**embedding 也不许后台自动算。**

- **方案 A（默认）**：不建向量索引。检索 = bigram 关键词召回 Top-K + 当前章节以光标为中心的窗口 + 目录标题。覆盖"就这段话问"和"这一章讲什么"两个主流场景，零等待零成本。
- **方案 B（显式动作）**：用户点「为本书建立检索索引」→ 确认框写明"将发起 N 次请求、预计消耗 X"→ 进度可见、可取消、可断点续（`chunks.embedding IS NULL` 即未算）。
- **方案 C（推荐落地方式）**：默认走 A；当提问被判定为全书级而当前没有索引时，既不偷偷降级也不偷偷花钱，而是在回答里明说并给出按钮——「这个问题需要跨全书检索，当前只用了关键词检索，结果可能不全 ［建立向量索引］」。

### 5.4 任务清单与输出结构

每个任务 = 固定提示词模板 + 固定输出结构 + 一个 `prompt_version`。

| 任务 | 输入 | 输出 | 触发 |
|---|---|---|---|
| 划词问答 | 选中文本 + 所在段上下文 + 问题 | 流式 markdown + 引用标记 | 划词浮条「问 AI」 |
| 解释 / 翻译 | 选中文本 | 流式纯文本 | 划词浮条 |
| 本章小结 | 整章纯文本（超预算则分段） | JSON：overview / keyPoints[] / terms[] | 面板显式点击 |
| 全书要点 | 各章小结 map → 汇总 reduce | JSON：主题脉络 / 核心论点[] / 结论 | 显式点击 + 逐章进度 |
| 关键词与概念 | 全书要点或指定章节 | JSON：term / 一句话释义 / 出现位置 | 派生自上一任务 |
| 思维导图 | 全书要点 JSON | 树形 JSON，前端直接渲染 | 同上，**不调模型** |

- **map-reduce 是唯一多请求的任务**，必须显示「第 3/12 章」、可随时中断，且每章结果落库——中断后再点继续不重算已完成的。
- 思维导图从要点 JSON 派生，省一次调用。
- 所有结果写入 `ai_results`，命中唯一键即复用，不重复花钱。

### 5.5 引用回跳

提示词要求模型用 `[1]` 标注依据，数字映射到本次送入的 chunk 列表，回跳逻辑见 §3.5。

### 5.6 并发、中断与失败

- 请求全在主进程发起，SSE 分片经 IPC 流给渲染进程。
- **单通道串行**：同一时刻只允许 1 个 AI 请求在跑。手快连点、同时开两个面板都不会并发烧钱，后续请求排队并在 UI 显示「排队中」。
- **中断即停流**：切章、关面板、关窗口都触发 AbortController，不做后台续跑。
- **重试**：仅网络错误 / 5xx / 429 重试一次，800ms 退避。401、余额不足、400 参数错误不重试，直接转成中文可读错误并指向设置页。
- 每条回答下方显示本次 token 用量（流式结束后补齐）。BYOK 产品里这是信任的基础。
- 错误分四类给四种动作：网络问题（重试）/ 配置问题（去设置）/ 模型问题（换模型）/ 内容问题（被拒答、被截断）。

### 5.7 密钥

`safeStorage.encryptString` → `secrets.json`（走 macOS Keychain / Windows DPAPI）。渲染进程永远拿不到明文，设置页只回显 `sk-••••••••3f7a`，验活和请求全在主进程完成。不做多 key 轮换、不做代理池。

---

## 6. 质量保障

### 6.1 测试策略

| 层 | 工具 | 覆盖 |
|---|---|---|
| 纯函数单测 | vitest（不引入任何原生依赖） | 元数据抽取、XHTML→纯文本、chunk 划分与 bigram 切词、CFI 计算、Markdown 导出、AI 乱格式 JSON 解析容错、错误分类映射、迁移调度逻辑、密钥脱敏 |
| 集成测试 | Playwright for Electron + 临时 userData 目录 | 走真实 IPC 与真实 sqlite：迁移落库、导入管线端到端（落库正确、去重生效、失败时事务回滚不留半本书）、密钥重启后仍在 |
| 渲染组件 | @testing-library/react | 划词浮条、Aa 排版面板、笔记筛选 |
| 端到端 | Playwright for Electron | 只保三条主线：导入并打开一本书 / 划词高亮写笔记 / 重启后进度与笔记还在 |

**为什么集成测试不用 vitest**：better-sqlite3 是原生模块，Node 与 Electron 的 ABI（NODE_MODULE_VERSION）不同，为 Electron 编译的二进制无法在 Node 进程中加载，反之亦然。与其在两套构建之间来回 rebuild，不如把「必须碰真实数据库」的测试放进 Electron 里跑——那本来也是它真实运行的环境。vitest 只负责不依赖原生模块的纯逻辑。

**AI 真实调用不进 CI**（要钱、不稳定）。改用录制式夹具：把一次真实响应存成 json，测解析与渲染路径；另留一份真机手测清单。

测试夹具准备三本 epub：正常中文小说、多级嵌套目录的技术书、**畸形书**（缺 OPF、封面损坏、XHTML 不规范）。解析器对脏数据不崩是硬要求。

### 6.2 统一错误模型

跨 IPC 的错误是可序列化的纯数据，渲染进程只负责显示、不负责分类：

```ts
type AppError = {
  code: 'EPUB_PARSE_FAILED' | 'FILE_MISSING' | 'DB_ERROR'
      | 'AI_AUTH' | 'AI_QUOTA' | 'AI_RATE_LIMIT' | 'AI_TIMEOUT' | 'AI_UNSUPPORTED'
      | 'SECRET_UNAVAILABLE' | 'OFFLINE',
  message: string,                 // 已本地化的中文，可直接展示
  detail?: string,                 // 原始错误，只进「查看详情」和日志
  action?: 'retry' | 'openSettings' | 'pickAnotherFile' | 'none'
}
```

- 主进程 `uncaughtException` 记录后给可恢复提示，不静默退出。
- 日志在 `userData/logs/`，按天切、留 7 天。
- **隐私红线：日志只记 bookId、字数、token 数、耗时——绝不记 API key，绝不记书籍正文。**

### 6.3 数据安全与可迁移

- 「导出全部数据」打成一个 zip，**不含 secrets.json**——换机器要重填 key，这是安全的默认。
- 迁移：`user_version` pragma + 顺序迁移脚本，每个迁移包在事务里；迁移前自动备份 db，留最近 3 份。
- 删书：删目录 + 级联删表，二次确认并明说「笔记与高亮会一起删除，不可恢复」。

### 6.4 安全清单

- `contextIsolation: true` / `nodeIntegration: false` / `sandbox: true`
- preload 只暴露具名白名单方法，不做通用 `invoke(channel, args)` 透传
- 自定义 epub 协议：路径解析后校验前缀，拒绝 `..` 穿越，只允许读本书目录
- **禁止执行书内脚本**（CSP `script-src 'none'`）：epub 是外来文件，执行它等于允许任意代码在渲染进程里跑
- 书内外链一律交给系统浏览器，不在应用内打开
- 无遥测、无崩溃上报到服务器

### 6.5 打包

electron-builder → macOS dmg（arm64 + x64，签名 + 公证，否则用户打不开）+ Windows nsis。首次启动不联网、不需要登录。

### 6.6 性能与规模假设

目标书库 ≤ 500 本、单本 ≤ 100MB、单本 ≤ 3000 章。导入解析跑在主进程 worker 里不阻塞 UI；打开书只解压当前章，冷启动 < 300ms；目录一次性从 DB 读，先不做虚拟滚动。chunk embedding 全量驻留内存约 20MB 量级，可接受，不做量化。

### 6.7 验收标准

1. **断网**下可完成导入、阅读、划词、写笔记、看历史笔记；只有 AI 功能提示离线
2. 杀进程重开，阅读位置（CFI）与全部笔记零丢失
3. 导入畸形 epub 不崩溃，报可读错误，且不留下半个书的脏数据
4. 未配置 key 时点「问 AI」，明确引导到设置页，不出现英文报错
5. AI 请求中断后无残留进行中请求（日志可核对）

---

## 7. 非目标

明确不做，避免范围蔓延：

- **账号、云同步、多端**——纯本地是产品定位，不是还没做
- **向量数据库**——chunk embedding 存 BLOB + 内存暴力余弦足够
- **自动更新**——第一期不做（无后端、签发链路成本高）。改为「关于」页显示版本 + 手动检查更新（只读一次 Release 的 latest.json）
- **朗读 / TTS**——`electron/main/tts` 目录预留，第一期不实现
- **epub 之外的格式**（mobi / pdf / txt）——解析管线的复杂度会翻倍
- **AI 自动分析整本书**——违反硬规则 1
- **多 key 轮换、代理池、用量统计报表**——单人本地应用，过度设计

---

## 8. 开放问题

进入实现前需要解决的：

1. **foliate-js 的技术验证**：CFI 计算、CSS 多栏分页、与 React 的 postMessage 边界，是否真的能覆盖 §3.4 的全部要求。若不行，退路是自己基于 zip + iframe 实现分页（成本更高，但可控）。
2. **bm25 排序参数**：FTS5 的排序在中文 bigram 下需要实测调参，否则召回质量可能不如预期。
3. **每行字数与分页的相互作用**：CSS 多栏分页下改字号会重排，需要验证 CFI 定位在重排后仍然准确。
4. **设置页视觉稿**：三个一级页面里唯一还没出稿的（§4.6）。模型能力表怎么排布最易读，需要单独画一版。
