<div align="center">

# 书架

**一个纯本地的桌面端 epub 阅读器 —— 把本地书当作要沉淀的知识，而不是消遣**

[![Electron](https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![SQLite](https://img.shields.io/badge/SQLite-better--sqlite3-003B57?logo=sqlite&logoColor=white)](https://github.com/WiseLibs/better-sqlite3)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-2B2723)](#下载与安装)
[![License](https://img.shields.io/badge/license-ISC-2B2723)](#许可)

[界面预览](#界面预览) · [下载与安装](#下载与安装) · [从源码运行](#从源码运行) · [AI 配置](#ai-配置byok) · [技术栈](#技术栈与架构) · [设计文档](#设计文档)

</div>

---

**无账号、无云同步、无遥测。** 书库、笔记与阅读进度全部只存在这台电脑上，首次启动不联网、不需要登录。AI 能力走 BYOK（自带密钥），不配置也能完整读书。

> **开发状态**：项目按 6 份实现计划推进，已完成应用骨架与本地数据层（计划 01）、epub 导入管线（计划 02）、阅读器渲染（计划 03）、划词标注与笔记（计划 04）。AI 能力层与打包正在实现中，安装包会随版本发布到 [Releases](https://github.com/FengHaiSheng/book-reader/releases)。下方的界面预览来自设计稿。

---

## 界面预览

打开的是一本**装帧好的书**，不是一个阅读器软件：应用外壳是书桌，阅读面是纸，面板是抽屉。层次来自表面与投影，不来自特效。

| 书架 | 阅读器 |
|---|---|
| ![书架](docs/images/bookshelf.png) | ![阅读器](docs/images/reader.png) |
| 网格 / 列表双视图，封面按真实装帧渲染（投影 + 书脊），末尾即拖放终点，支持一次拖入多本。 | 单章 iframe + CSS 多栏横向翻页，划词浮条就地高亮、写批注、问 AI。窗口够宽时自动切对开双页。 |

| 笔记 |
|---|
| ![笔记](docs/images/notes.png) |
| 跨书汇总，按书分组、分组头吸顶；左侧色条对应书内高亮颜色；右栏给出所选笔记的原文上下文，不跳回书里也能判断这条笔记是否要留；一键导出 Markdown。 |

---

## 功能

### 阅读

- **只支持 epub**：导入时把书复制进书库，原文件之后移动或删除都不影响阅读
- **sha256 去重**：同一本书不会被导入第二遍
- **分页与定位**：CSS 多栏横向翻页，进度与高亮以 CFI 为准，改字号重排后位置依然准
- **排版全可调**：字体（宋 / 黑）、字号 15–24、**每行字数 24–48**、行距 1.5–2.2、亮 / 暗主题
- **每行字数是独立控件**，不是字号的副产物 —— 「字太小看不清」和「一行太长读着累」是两个不同的诉求。窗口不够宽时会在界面上明说按上限显示，不静默降级
- **自适应**：≥1900px 自动切对开双页；<840px 侧栏收成图标栏
- **暗色主题是一等公民**，夜间阅读不是可选项

### 标注与笔记

- 划词浮条：高亮（4 色）、写批注、复制、查词、问 AI
- 高亮用 CSS Custom Highlight API 实现，不往正文里插 `<mark>`，避免改动书内结构导致定位漂移
- 笔记页跨书汇总，支持按书 / 类型筛选，可导出 Markdown 与单本笔记
- 笔记与高亮都落在本机 SQLite 里，杀进程重开零丢失

### AI 能力（BYOK）

- **划词问答 / 解释 / 翻译**：流式回答，附带可回跳的引用标记
- **本章小结、全书要点、关键词与概念、思维导图**：固定提示词模板 + 固定输出结构，结果落库复用，不重复花钱
- **中文检索零成本可用**：FTS5 bigram 关键词召回，不依赖 embedding、不引第三方分词库；也支持显式为某本书建立向量索引
- 支持 **DeepSeek / 通义千问 / 智谱 GLM / Kimi** 四家 OpenAI 兼容接口
- **单通道串行**：同一时刻只有一个 AI 请求在跑，手快连点也不会并发烧钱；切章、关面板、关窗口即中断
- 每条回答下方显示本次 token 用量 —— BYOK 产品里这是信任的基础
- 错误分四类给四种动作：网络问题（重试）/ 配置问题（去设置）/ 模型问题（换模型）/ 内容问题（被拒答、被截断）

### 三条贯穿全局的硬规则

1. **AI 永不后台自动调用。** BYOK 下 token 是真金白银，任何「打开书就自动跑全书分析」都是产品事故。所有 AI 调用必须由你显式触发或确认。
2. **能力降级要明说。** 国内厂商接口能力不齐（embedding、结构化输出），遇到不支持会在界面上明确说明降级成什么，不静默失败。
3. **渲染进程零能力。** 文件系统、解析、数据库、AI 调用、密钥全部留在主进程，preload 只暴露具名白名单方法。

### 明确不做

账号与云同步、多端、向量数据库、自动更新、朗读 / TTS、epub 之外的格式（mobi / pdf / txt）、AI 自动分析整本书。纯本地是产品定位，不是还没做。

---

## 下载与安装

安装包发布在 **[GitHub Releases](https://github.com/FengHaiSheng/book-reader/releases)**，到页面下载与你系统对应的文件即可（`x.y.z` 为版本号）：

| 你的系统 | 下载文件 |
|---|---|
| macOS（Apple 芯片 / M 系列） | `书架-x.y.z-arm64.dmg` |
| macOS（Intel） | `书架-x.y.z-x64.dmg` |
| Windows 10 / 11（64 位） | `书架 Setup x.y.z.exe` |

### 系统要求

- **macOS** 12 及以上，Apple 芯片或 Intel
- **Windows** 10 / 11，64 位

### macOS 安装

1. 双击下载到的 `.dmg`
2. 把 **书架** 拖进「应用程序」文件夹
3. 在启动台或「应用程序」里打开

### Windows 安装

1. 双击下载到的 `.exe`
2. 安装向导里可以**修改安装目录**（默认不装到系统盘也可以），也可以勾选创建桌面快捷方式
3. 安装完成后从开始菜单或桌面打开

### 首次打开被系统拦住了怎么办

这是**未签名应用的必然结果，不是装错了**：

- **macOS**：双击会提示「无法打开，因为 Apple 无法检查其是否包含恶意软件」。在「应用程序」里 **右键（或按住 Control 点击）书架 → 打开 → 再点一次「打开」** 即可放行，之后正常双击启动。
- **Windows**：会出现 SmartScreen 蓝色提示。点 **「更多信息」→「仍要运行」**。

放行这一步只需要做一次。如果希望双击即可打开（需要 Apple Developer Program 账号，99 USD/年），可参考 [打包](#打包) 一节开启签名与公证。

### 首次启动

不联网、不需要注册登录。导入一本 epub 就能开始读；AI 功能是可选增强，随时在「设置 → 模型」里配置。

---

## 从源码运行

用于开发或自行构建安装包。

**前置**：Node.js 22.12 及以上（仓库用 [volta](https://volta.sh/) 锁定了 `22.12.0`）、Git。

```bash
git clone https://github.com/FengHaiSheng/book-reader.git
cd book-reader
npm install
npm run dev
```

`npm install` 会自动执行 `postinstall`，把原生模块 `better-sqlite3` 按 Electron 的 ABI 重编译。**这一步不能省**——缺了它，应用启动时会报 `NODE_MODULE_VERSION` 不匹配。若你跳过了 postinstall，手动补一次：

```bash
npx electron-builder install-app-deps
```

构建并以生产模式预览：

```bash
npm run build
npm start
```

---

## 开发

| 命令 | 作用 |
|---|---|
| `npm run dev` | 开发模式启动（主进程 + preload 热重载，渲染进程 HMR） |
| `npm run build` | 构建 main / preload / renderer 到 `out/` |
| `npm start` | 用构建产物启动应用 |
| `npm test` | 跑纯函数单测（vitest，不依赖原生模块） |
| `npm run e2e` | 构建后跑 Electron 端到端测试（Playwright） |
| `npm run dist:dir` | 只产出解包后的 `.app`，不签名不打 dmg，用于验证「包起来能不能跑」 |
| `npm run dist:mac` | 打 macOS dmg（arm64 + x64） |
| `npm run dist:win` | 打 Windows nsis 安装包（**需在 Windows 机器上执行**） |

**测试分工**：不碰原生模块的纯逻辑（元数据抽取、XHTML→纯文本、chunk 划分与 bigram 切词、错误归一化、密钥脱敏等）用 vitest 跑；必须碰真实数据库与真实 IPC 的部分放进 Electron 里用 Playwright 跑——为 Electron 编译的二进制无法在 Node 进程里加载，与其两套构建来回 rebuild，不如让它在真实运行环境里验证。AI 真实调用不进 CI（要钱、不稳定），改用录制式夹具 + 一份真机手测清单。

### 打包

打包用 [electron-builder](https://www.electron.build/)，配置在 `electron-builder.yml`。两个必须解包到 asar 之外的东西：`better-sqlite3` 的原生 `.node`（`dlopen` 不认 asar 虚拟路径），以及 epub 抽取 worker（要被 `worker_threads` 加载）。

未签名的 macOS dmg 首次打开会被 Gatekeeper 拦住（自己用右键「打开」放行）。要给别人双击即可打开，需要 Apple Developer Program 账号，拿到 Developer ID 后设置 `CSC_LINK` / `CSC_KEY_PASSWORD` 环境变量，并把配置里的 `notarize` 改成 `true`。Windows 侧同理，未签名时会触发 SmartScreen 警告。

---

## AI 配置（BYOK）

打开 **设置 → 模型**：

1. 选择服务商（DeepSeek / 通义千问 / 智谱 GLM / Kimi）
2. 填入该服务商的 API Key，点「保存」

Key 会用系统钥匙串（macOS Keychain / Windows DPAPI）加密后只存本机，**明文永远不会离开主进程**，设置页只回显脱敏形态：

```
sk-••••••••3f7a
```

输入框里的明文在失焦后立即清除。「导出全部数据」也**不包含密钥**——换机器要重填，这是安全的默认。

模型分组下方常驻一张**能力表**，把 chat / 流式 / 向量检索 / 结构化输出逐项标出「支持 / 不支持（将降级为 X）」，让你在配置阶段就知道会降到什么程度，而不是提问时才发现：

| 缺失能力 | 降级做法 | 界面上会怎么说 |
|---|---|---|
| 无 embedding | 退化为关键词检索 + 当前章节窗口 | 当前模型不提供向量检索，已改用关键词检索，跨章节召回会变弱 |
| 无 JSON mode | 提示词要求 JSON + 解析容错，仍失败则按文本展示 | 本次未能生成结构化大纲，已按纯文本呈现 |
| 上下文窗口小 | 按 token 预算截断，优先当前段落所在窗口 + 召回片段 | 本次只送入了本书 N 段，回答范围受限 |

> **关于费用**：embedding 同样不会后台自动计算。默认不建向量索引；需要全书级检索时，应用既不偷偷降级也不偷偷花钱，而是在回答里明说并给出「建立向量索引」按钮，点击前会告知将发起多少次请求、预计消耗多少。

---

## 技术栈与架构

Electron + React + TypeScript，仅支持 epub，不用 LangChain（这一层逻辑很薄，框架的抽象成本大于收益）。

| 进程 | 职责 | 明确不做 |
|---|---|---|
| 渲染进程（React） | 只负责 UI 与交互状态 | 不碰 fs、不碰 sqlite、不持有密钥、不发 AI 请求 |
| preload | 用 `contextBridge` 暴露**具名白名单方法** | 不提供通用 `invoke(channel, args)` 透传 |
| 主进程（Node） | 文件读写、epub 解析、SQLite、AI Provider 调用、密钥管理 | 不承载业务 UI 逻辑 |

安全基线：`contextIsolation: true` + `nodeIntegration: false` + `sandbox: true`；自定义 `epub://` 协议注册时校验路径前缀，拒绝 `..` 穿越；**禁止执行书内脚本**（CSP `script-src 'none'`）——epub 是外来文件，执行它等于允许任意代码在渲染进程里跑；书内外链一律交给系统浏览器。

### 项目结构

```
electron/
  main/
    index.ts        # 应用生命周期、单实例锁
    window.ts       # BrowserWindow 创建与安全配置
    ipc/            # IPC 路由，每个域一个模块，方法名即白名单
    library/        # 书库：导入、删除、去重、封面缓存
    epub/           # zip 读取、OPF 解析、纯文本抽取、chunk 划分、中文 bigram
    store/          # better-sqlite3 封装、迁移、查询
    ai/             # Provider 抽象、检索、任务提示词、并发与中断
    secrets/        # safeStorage 密钥读写
  preload/
src/
  features/
    library/        # 书架
    reader/         # 阅读器（iframe 宿主、划词、高亮、排版面板）
    notes/          # 笔记汇总与导出
    ai/             # AI 面板、引用渲染、任务进度
    settings/       # 模型 / 阅读偏好 / 数据
  shell/            # 标题栏、侧栏
  pages/            # 书架 / 笔记 / 设置
  styles/           # Design Tokens 与基础样式
shared/             # 类型、IPC 契约、错误模型
design/mockups/     # 三份视觉样板（书架 / 阅读器 / 笔记）
docs/superpowers/   # 设计文档与实现计划
```

### 数据放在哪

| 平台 | 位置 |
|---|---|
| macOS | `~/Library/Application Support/书架/` |
| Windows | `%APPDATA%\书架\` |

```
db.sqlite          # 书库、目录、章节、chunk、进度、高亮、笔记、AI 结果
secrets.json       # 加密后的密钥密文（与数据库分开，导出时天然不含）
library/<bookId>/  # book.epub + cover.jpg
backups/           # 迁移前的数据库备份，保留最近 3 份
logs/              # 按天切分，保留 7 天
```

**隐私红线**：日志只记 bookId、字数、token 数、耗时——绝不记 API Key，绝不记书籍正文。无遥测、无崩溃上报。

---

## 设计文档

| 文档 | 内容 |
|---|---|
| [设计文档](docs/superpowers/specs/2026-09-29-book-reader-design.md) | 定位、进程模型、数据模型、渲染管线、AI 能力层、质量保障 |
| [设计语境](.uicraft.md) | Design Tokens、三层表面、自适应断点表、排版规范 |
| [实现计划](docs/superpowers/plans/) | 6 份可独立交付的计划：应用骨架 → 导入管线 → 阅读器 → 标注笔记 → AI 能力 → 书架完善与打包 |

视觉样板（可直接在浏览器打开）：[书架](design/mockups/bookshelf.html) · [阅读器](design/mockups/reader.html) · [笔记](design/mockups/notes.html)

---

## 许可

[ISC](https://opensource.org/licenses/ISC)
