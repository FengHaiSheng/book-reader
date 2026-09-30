# 应用骨架与本地数据层 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付一个能启动的 Electron 应用：安全的三进程边界、真实的 SQLite 存储与迁移、可持久化的密钥管理，以及对齐设计稿的应用外壳与设置页。

**Architecture:** 渲染进程零能力，preload 用 `contextBridge` 暴露具名白名单方法，主进程独占文件系统与数据库。数据层用 better-sqlite3 + `user_version` 顺序迁移，迁移调度逻辑做成不依赖原生模块的纯函数以便单测；所有必须碰真实数据库的验证走 Playwright for Electron。

**Tech Stack:** Electron / electron-vite / React / TypeScript / better-sqlite3 / vitest / Playwright

**Spec:** [2026-09-29-book-reader-design.md](../specs/2026-09-29-book-reader-design.md)

---

## Prerequisites

**执行前必须先配置 git 身份**，否则本计划里所有 commit 步骤都会失败：

```bash
git config user.name "你的名字"
git config user.email "你的邮箱"
```

本计划不代你决定提交身份，也不会修改你的全局配置——上面这条命令的 scope 由你自己选择（带 `--global` 或不带）。

---

## 计划拆分说明

整个应用含 6 个可独立交付的子系统，因此拆成 6 份计划，本文件是第 1 份：

| 计划 | 内容 | 交付物 |
|---|---|---|
| **01（本文）** | 应用骨架、SQLite、迁移、密钥、设置页 | 能启动、能存设置和密钥的应用 |
| 02 | epub 导入管线 | 能导入 epub 并落库（books/chapters/chunks + FTS bigram） |
| 03 | 阅读器渲染 | 能读书：自定义协议、iframe、分页、CFI、进度 |
| 04 | 标注与笔记 | 能划词、写笔记、跨书汇总、导出 Markdown |
| 05 | AI 能力层 | 能问 AI：Provider、降级、检索、任务、引用回跳 |
| 06 | 书架完善与打包 | 能装给别人用：网格/列表、标签、导出数据、签名打包 |

依赖关系：02 依赖 01；03 依赖 02；04 依赖 03；05 依赖 02 与 04；06 依赖全部。

---

## File Structure

本计划创建的文件与各自职责：

```
package.json                     # 依赖与脚本
electron.vite.config.ts          # main / preload / renderer 三段构建配置
tsconfig.json                    # 单一 TS 配置 + @shared 路径别名
vitest.config.ts                 # 仅跑纯函数测试
playwright.config.ts             # Electron 端到端测试配置
.gitignore
shared/
  ipc.ts                         # IPC 通道名常量与请求/响应类型（三方共用契约）
  errors.ts                      # AppError 结构与错误归一化
  types.ts                       # 设置项、Provider 等实体类型
electron/main/
  index.ts                       # 应用生命周期、单实例锁
  window.ts                      # BrowserWindow 创建与安全配置
  ipc/index.ts                   # 统一注册所有 IPC handler
  ipc/settings.ts                # 设置相关 handler
  ipc/secrets.ts                 # 密钥相关 handler
  store/db.ts                    # 打开数据库、设置 pragma、迁移前备份
  store/migrate.ts               # 迁移调度（纯逻辑，可单测）
  store/migrations.ts            # 迁移清单（第 1 版建 settings 表）
  store/settings.ts              # settings 表读写
  secrets/mask.ts                # 密钥脱敏（纯函数，可单测）
  secrets/index.ts               # safeStorage 加解密与 secrets.json 读写
electron/preload/
  index.ts                       # contextBridge 白名单
src/
  index.html
  main.tsx                       # React 挂载
  App.tsx                        # 三栏外壳与页面切换
  shell/TitleBar.tsx             # 自绘标题栏
  shell/Sidebar.tsx              # 一级导航
  pages/LibraryPage.tsx          # 书架占位（计划 06 实现）
  pages/NotesPage.tsx            # 笔记占位（计划 04 实现）
  pages/SettingsPage.tsx         # 设置页三组
  styles/tokens.css              # Design Tokens，来自 .uicraft.md
  styles/base.css                # 全局重置、滚动条、按钮
tests/
  migrate.test.ts                # 迁移调度纯逻辑
  mask.test.ts                   # 密钥脱敏
  errors.test.ts                 # 错误归一化
e2e/
  helpers.ts                     # 启动 Electron、临时 userData
  boundary.spec.ts               # 渲染进程无 Node 能力 + 白名单
  settings.spec.ts               # 设置持久化（重启后仍在）
  secrets.spec.ts                # 密钥持久化与脱敏
```

---

### Task 1: 项目脚手架与构建跑通

**Files:**
- Create: `package.json`, `electron.vite.config.ts`, `tsconfig.json`, `.gitignore`
- Create: `src/index.html`, `src/main.tsx`, `src/App.tsx`
- Create: `electron/main/index.ts`, `electron/main/window.ts`, `electron/preload/index.ts`

- [ ] **Step 1: 初始化 npm 并安装依赖**

```bash
npm init -y
npm i react react-dom better-sqlite3
npm i -D electron electron-vite vite @vitejs/plugin-react typescript vitest \
  @playwright/test electron-builder \
  @types/node @types/react @types/react-dom @types/better-sqlite3
```

- [ ] **Step 2: 写 package.json 的 scripts 与入口**

把 `package.json` 改成（保留 npm 生成的 `dependencies` / `devDependencies` 字段）：

```json
{
  "name": "book-read",
  "version": "0.1.0",
  "private": true,
  "main": "out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "start": "electron-vite preview",
    "test": "vitest run",
    "e2e": "npm run build && playwright test",
    "postinstall": "electron-builder install-app-deps"
  }
}
```

`postinstall` 那行是关键：它把 better-sqlite3 重编译成 Electron 的 ABI。缺了它，应用启动时会报 `NODE_MODULE_VERSION` 不匹配。

**不要加 `"type": "module"`**。两条硬原因：① `sandbox: true` 的 preload **不支持 ESM**，加了这个字段后 electron-vite 会把 preload 打成 `.mjs`，加载直接失败；② 主进程代码里要用 `__dirname` 定位 preload 与后续的 worker 入口（见计划 02），而 ESM 里没有 `__dirname`。源码照常写 ESM 语法，由构建器产出 CJS，两者不冲突。渲染进程是 Vite 管的，不受影响。

- [ ] **Step 3: 写 electron.vite.config.ts**

```ts
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const shared = resolve(__dirname, 'shared')

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': shared } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': shared } }
  },
  renderer: {
    root: 'src',
    resolve: { alias: { '@shared': shared } },
    plugins: [react()],
    build: {
      rollupOptions: { input: resolve(__dirname, 'src/index.html') }
    }
  }
})
```

`externalizeDepsPlugin()` 让主进程的 `dependencies` 不打进 bundle——better-sqlite3 这类原生模块必须保持外部引用。

- [ ] **Step 4: 写 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "noEmit": true,
    "types": ["node"],
    "baseUrl": ".",
    "paths": { "@shared/*": ["shared/*"] }
  },
  "include": ["src", "electron", "shared", "tests", "e2e"]
}
```

- [ ] **Step 5: 写 .gitignore**

```
node_modules/
out/
dist/
test-results/
playwright-report/
.vite/
.DS_Store
```

- [ ] **Step 6: 写主进程入口**

`electron/main/index.ts`：

```ts
import { app, BrowserWindow } from 'electron'
import { createMainWindow } from './window'

// 单实例锁：第二次启动时聚焦已有窗口，而不是开出第二个库
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    createMainWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
```

- [ ] **Step 7: 写窗口创建**

`electron/main/window.ts`：

```ts
import { join } from 'node:path'
import { BrowserWindow, shell } from 'electron'

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 840,
    minHeight: 600,
    show: false,
    backgroundColor: '#E8E3DA',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.once('ready-to-show', () => win.show())

  // 书内外链一律交给系统浏览器，不在应用内打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}
```

`titleBarStyle: 'hiddenInset'` 意味着 macOS 上用的是**原生红绿灯**。设计稿里手绘的那三个圆点只是示意，真实实现不要画——那样会得到两组红绿灯。

- [ ] **Step 8: 写 preload 骨架**

`electron/preload/index.ts`：

```ts
import { contextBridge } from 'electron'

// 白名单方法在后续 Task 逐个补齐。
// 这里刻意不提供通用的 invoke(channel, args) 透传——那等于把 IPC 变成万能钥匙。
contextBridge.exposeInMainWorld('api', {})
```

- [ ] **Step 9: 写渲染进程最小页面**

`src/index.html`：

```html
<!DOCTYPE html>
<html lang="zh-CN" data-theme="light">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self'"
    />
    <title>书架</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

`src/main.tsx`：

```tsx
import { createRoot } from 'react-dom/client'
import App from './App'

const el = document.getElementById('root')
if (!el) throw new Error('#root not found')
createRoot(el).render(<App />)
```

`src/App.tsx`：

```tsx
export default function App() {
  return <div style={{ padding: 24 }}>脚手架就绪</div>
}
```

- [ ] **Step 10: 启动验证**

Run: `npm run dev`
Expected: 出现一个 1440×900 的窗口，内容显示「脚手架就绪」，DevTools 控制台无报错。macOS 上标题栏左侧能看到原生红绿灯。

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json electron.vite.config.ts tsconfig.json .gitignore src electron
git commit -m "chore: 搭建 Electron + React + TS 脚手架并跑通构建"
```

---

### Task 2: 三进程边界与 Playwright 冒烟

把安全边界做成**被测试保护的契约**，而不是一句口头约定。

**Files:**
- Create: `shared/ipc.ts`
- Create: `playwright.config.ts`, `e2e/helpers.ts`, `e2e/boundary.spec.ts`
- Modify: `electron/preload/index.ts`

- [ ] **Step 1: 写 IPC 契约**

`shared/ipc.ts`：

```ts
/** IPC 通道名。只增不改，改名等于破坏契约。 */
export const CH = {
  settingsGetAll: 'settings:getAll',
  settingsSet: 'settings:set',
  secretsStatus: 'secrets:status',
  secretsSet: 'secrets:set',
  secretsClear: 'secrets:clear'
} as const

export type Channel = (typeof CH)[keyof typeof CH]

/** preload 暴露给渲染进程的白名单方法名，冒烟测试会断言它完全一致 */
export const API_SHAPE = {
  settings: ['getAll', 'set'],
  secrets: ['status', 'set', 'clear']
} as const
```

- [ ] **Step 2: 写失败的白名单测试**

`e2e/boundary.spec.ts`：

```ts
import { test, expect } from '@playwright/test'
import { API_SHAPE } from '../shared/ipc'
import { launchApp } from './helpers'

test('渲染进程没有 Node 能力，且 api 只暴露白名单方法', async () => {
  const app = await launchApp()
  const win = await app.firstWindow()

  expect(await win.evaluate(() => typeof (window as any).require)).toBe('undefined')

  const actual = await win.evaluate(() =>
    Object.fromEntries(
      Object.entries((window as any).api ?? {}).map(([k, v]) => [k, Object.keys(v as object).sort()])
    )
  )

  const expected = Object.fromEntries(
    Object.entries(API_SHAPE).map(([k, v]) => [k, [...v].sort()])
  )
  expect(actual).toEqual(expected)

  await app.close()
})
```

- [ ] **Step 3: 跑它，确认失败**

Run: `npm run e2e -- e2e/boundary.spec.ts`
Expected: FAIL —— preload 目前暴露的是空对象 `{}`，`actual` 与 `expected` 不一致。（此时若报找不到 `playwright.config.ts`，说明 Step 4 还没做，先做 Step 4 再回来。）

- [ ] **Step 4: 写 Playwright 配置与启动助手**

`playwright.config.ts`：

```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']]
})
```

`e2e/helpers.ts`：

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication } from 'playwright'

/**
 * 每次启动都用一个全新的临时 userData 目录，保证测试之间互不污染，
 * 也保证不会碰到开发者本机的真实书库。
 */
export async function launchApp(): Promise<ElectronApplication> {
  const userData = mkdtempSync(join(tmpdir(), 'book-read-e2e-'))
  return electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    env: { ...process.env, NODE_ENV: 'test' }
  })
}
```

- [ ] **Step 5: 补全 preload 白名单（先给占位实现）**

`electron/preload/index.ts`：

```ts
import { contextBridge, ipcRenderer } from 'electron'
import { CH } from '@shared/ipc'

const api = {
  settings: {
    getAll: (): Promise<Record<string, string>> => ipcRenderer.invoke(CH.settingsGetAll),
    set: (key: string, value: string): Promise<void> =>
      ipcRenderer.invoke(CH.settingsSet, key, value)
  },
  secrets: {
    status: (): Promise<{ available: boolean; providers: Record<string, string> }> =>
      ipcRenderer.invoke(CH.secretsStatus),
    set: (provider: string, key: string): Promise<void> =>
      ipcRenderer.invoke(CH.secretsSet, provider, key),
    clear: (provider: string): Promise<void> => ipcRenderer.invoke(CH.secretsClear, provider)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
```

主进程此时还没注册这些 handler，`invoke` 会 reject——这不影响本 Task 的冒烟测试，它只检查**形状**。handler 在 Task 5 / 6 补。

- [ ] **Step 6: 跑测试，确认通过**

Run: `npm run e2e -- e2e/boundary.spec.ts`
Expected: PASS，1 passed。

- [ ] **Step 7: Commit**

```bash
git add shared/ipc.ts playwright.config.ts e2e electron/preload/index.ts
git commit -m "test: 用 e2e 锁定进程边界与 preload 白名单形状"
```

---

### Task 3: Design Tokens 与三栏外壳

**Files:**
- Create: `src/styles/tokens.css`, `src/styles/base.css`
- Create: `src/shell/TitleBar.tsx`, `src/shell/Sidebar.tsx`
- Create: `src/pages/LibraryPage.tsx`, `src/pages/NotesPage.tsx`, `src/pages/SettingsPage.tsx`
- Modify: `src/App.tsx`, `src/main.tsx`

- [ ] **Step 1: 写 Design Tokens**

`src/styles/tokens.css` —— 数值全部来自 [.uicraft.md](../../../.uicraft.md)，两边必须一致：

```css
:root {
  --shell: #e8e3da;
  --panel: #f3efe7;
  --paper: #fcfaf6;
  --paper-raised: #ffffff;
  --hover: rgba(43, 39, 35, 0.05);
  --active: rgba(43, 39, 35, 0.09);
  --line: #dbd4c8;
  --ink: #2b2723;
  --ink-muted: #6b635b;
  --accent-link: #2c4a7c;
  --accent-mark: #b4462f;
  --hl-yellow: #f2e3a8;
  --hl-green: #c9dfc4;
  --hl-blue: #c6d6e8;
  --hl-pink: #edcfd4;

  --shadow-sheet: 0 1px 2px rgba(43, 39, 35, 0.05), 0 10px 30px rgba(43, 39, 35, 0.09);
  --shadow-pop: 0 6px 22px rgba(43, 39, 35, 0.16);

  --serif: 'Source Han Serif SC', 'Noto Serif SC', 'Songti SC', SimSun, serif;
  --sans: 'PingFang SC', 'Microsoft YaHei', system-ui, -apple-system, 'Segoe UI', sans-serif;

  --s1: 4px;
  --s2: 8px;
  --s3: 12px;
  --s4: 16px;
  --s5: 24px;
  --s6: 32px;
  --s7: 48px;

  --r-sm: 4px;
  --r-md: 8px;
  --r-lg: 12px;
  --ease: 160ms ease-out;
}

html[data-theme='dark'] {
  --shell: #100f0e;
  --panel: #1a1816;
  --paper: #211e1b;
  --paper-raised: #2a2620;
  --hover: rgba(230, 224, 216, 0.07);
  --active: rgba(230, 224, 216, 0.12);
  --line: #332e28;
  --ink: #e6e0d8;
  --ink-muted: #9a9188;
  --accent-link: #8fb0e0;
  --accent-mark: #d9836a;
  --hl-yellow: #4a4023;
  --hl-green: #2f3e2c;
  --hl-blue: #2a3644;
  --hl-pink: #452f33;
  --shadow-sheet: 0 1px 2px rgba(0, 0, 0, 0.5), 0 10px 30px rgba(0, 0, 0, 0.45);
  --shadow-pop: 0 6px 22px rgba(0, 0, 0, 0.6);
}

@media (prefers-reduced-motion: reduce) {
  * {
    transition: none !important;
    animation: none !important;
  }
}
```

- [ ] **Step 2: 写基础样式**

`src/styles/base.css`：

```css
@import './tokens.css';

* {
  box-sizing: border-box;
}

html,
body,
#root {
  height: 100%;
}

body {
  margin: 0;
  background: var(--shell);
  color: var(--ink);
  font-family: var(--sans);
  font-size: 14px;
  overflow: hidden;
  -webkit-font-smoothing: antialiased;
}

button {
  font: inherit;
  color: inherit;
  background: none;
  border: 0;
  cursor: pointer;
}

::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}
::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--ink) 18%, transparent);
  border: 3px solid transparent;
  background-clip: content-box;
  border-radius: 6px;
}
::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--ink) 32%, transparent);
  background-clip: content-box;
}
```

- [ ] **Step 3: 写标题栏**

`src/shell/TitleBar.tsx`：

```tsx
export function TitleBar({ title }: { title: string }) {
  const isMac = navigator.userAgent.includes('Mac')
  return (
    <header className="titlebar" style={{ paddingLeft: isMac ? 78 : 12 }}>
      <span className="titlebar__title">{title}</span>
    </header>
  )
}
```

`paddingLeft: 78` 是给 macOS 原生红绿灯让位。Windows 上红绿灯不存在，从 12px 开始排，窗口控件由系统画在右上角。

- [ ] **Step 4: 写侧栏**

`src/shell/Sidebar.tsx`：

```tsx
export type PageId = 'library' | 'notes' | 'settings'

const NAV: { id: PageId; label: string }[] = [
  { id: 'library', label: '书架' },
  { id: 'notes', label: '笔记' },
  { id: 'settings', label: '设置' }
]

export function Sidebar({
  current,
  onSelect
}: {
  current: PageId
  onSelect: (id: PageId) => void
}) {
  return (
    <nav className="sidebar">
      {NAV.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`nav-item${current === item.id ? ' nav-item--active' : ''}`}
          aria-current={current === item.id ? 'page' : undefined}
          onClick={() => onSelect(item.id)}
        >
          {item.label}
        </button>
      ))}
    </nav>
  )
}
```

- [ ] **Step 5: 写三个页面（后两个先占位）**

`src/pages/LibraryPage.tsx`：

```tsx
export function LibraryPage() {
  return <div className="page-placeholder">书架将在计划 06 实现</div>
}
```

`src/pages/NotesPage.tsx`：

```tsx
export function NotesPage() {
  return <div className="page-placeholder">笔记将在计划 04 实现</div>
}
```

`src/pages/SettingsPage.tsx`：

```tsx
export function SettingsPage() {
  return <div className="page-placeholder">设置页将在本计划 Task 7 实现</div>
}
```

- [ ] **Step 6: 组装外壳**

`src/App.tsx`：

```tsx
import { useState } from 'react'
import { TitleBar } from './shell/TitleBar'
import { Sidebar, type PageId } from './shell/Sidebar'
import { LibraryPage } from './pages/LibraryPage'
import { NotesPage } from './pages/NotesPage'
import { SettingsPage } from './pages/SettingsPage'
import './styles/base.css'

const TITLES: Record<PageId, string> = {
  library: '书架',
  notes: '笔记',
  settings: '设置'
}

export default function App() {
  const [page, setPage] = useState<PageId>('library')

  return (
    <div className="app">
      <TitleBar title={TITLES[page]} />
      <div className="body">
        <Sidebar current={page} onSelect={setPage} />
        <main className="content">
          {page === 'library' && <LibraryPage />}
          {page === 'notes' && <NotesPage />}
          {page === 'settings' && <SettingsPage />}
        </main>
      </div>
    </div>
  )
}
```

外壳布局样式追加到 `src/styles/base.css` 末尾：

```css
.app {
  height: 100vh;
  display: flex;
  flex-direction: column;
}

.titlebar {
  flex: 0 0 44px;
  display: flex;
  align-items: center;
  background: var(--shell);
  border-bottom: 1px solid var(--line);
  user-select: none;
  -webkit-app-region: drag;
}

.titlebar__title {
  font-size: 13px;
  font-weight: 500;
}

.sidebar {
  flex: 0 0 248px;
  background: var(--panel);
  border-right: 1px solid var(--line);
  padding: var(--s3) var(--s2);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-item {
  height: 32px;
  padding: 0 var(--s3);
  border-radius: var(--r-sm);
  font-size: 13px;
  color: var(--ink-muted);
  text-align: left;
  transition: background var(--ease), color var(--ease);
}

.nav-item:hover {
  background: var(--hover);
  color: var(--ink);
}

.nav-item--active {
  background: var(--active);
  color: var(--ink);
  font-weight: 500;
}

.body {
  flex: 1;
  display: flex;
  min-height: 0;
}

.content {
  flex: 1;
  min-width: 0;
  overflow: auto;
  background: var(--shell);
}

.page-placeholder {
  padding: var(--s6);
  color: var(--ink-muted);
  font-size: 13px;
}
```

`-webkit-app-region: drag` 让标题栏可以拖动窗口。注意：栏内的按钮必须再加 `-webkit-app-region: no-drag`，否则点不动——后续加按钮的 Task 要留意这一条。

- [ ] **Step 7: 目视验证**

Run: `npm run dev`
Expected: 44px 标题栏 + 248px 浅色侧栏 + 主区；点三个导航项能切换页面，当前项有高亮底色；macOS 上红绿灯只有一组（原生那组），标题栏文字从红绿灯右侧开始。

- [ ] **Step 8: Commit**

```bash
git add src
git commit -m "feat: 实现三栏应用外壳与 Design Tokens"
```

---

### Task 4: 迁移调度（纯逻辑，可单测）

先把迁移的**调度逻辑**和具体的迁移**内容**分开。调度逻辑不碰原生模块，因此能在 vitest 里测。

**Files:**
- Create: `shared/types.ts`, `shared/errors.ts`
- Create: `electron/main/store/migrate.ts`, `electron/main/store/migrations.ts`
- Create: `vitest.config.ts`, `tests/migrate.test.ts`, `tests/errors.test.ts`

- [ ] **Step 1: 写共享类型**

`shared/types.ts`：

```ts
export type ProviderId = 'deepseek' | 'qwen' | 'zhipu' | 'kimi'

export const PROVIDERS: { id: ProviderId; name: string; baseURL: string }[] = [
  { id: 'deepseek', name: 'DeepSeek', baseURL: 'https://api.deepseek.com/v1' },
  {
    id: 'qwen',
    name: '通义千问',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1'
  },
  { id: 'zhipu', name: '智谱 GLM', baseURL: 'https://open.bigmodel.cn/api/paas/v4' },
  { id: 'kimi', name: 'Kimi', baseURL: 'https://api.moonshot.cn/v1' }
]

/** 阅读偏好。每行字数是独立控件，不是字号的副产物。 */
export type ReadingPrefs = {
  font: 'serif' | 'sans'
  fontSize: number
  charsPerLine: number
  lineHeight: number
  theme: 'light' | 'dark'
}

export const DEFAULT_PREFS: ReadingPrefs = {
  font: 'serif',
  fontSize: 19,
  charsPerLine: 34,
  lineHeight: 1.85,
  theme: 'light'
}
```

- [ ] **Step 2: 写错误契约**

`shared/errors.ts`：

```ts
export type AppErrorCode =
  | 'EPUB_PARSE_FAILED'
  | 'FILE_MISSING'
  | 'DB_ERROR'
  | 'AI_AUTH'
  | 'AI_QUOTA'
  | 'AI_RATE_LIMIT'
  | 'AI_TIMEOUT'
  | 'AI_UNSUPPORTED'
  | 'SECRET_UNAVAILABLE'
  | 'OFFLINE'
  | 'UNKNOWN'

export type AppErrorAction = 'retry' | 'openSettings' | 'pickAnotherFile' | 'none'

export type AppError = {
  code: AppErrorCode
  /** 已本地化的中文，可直接展示 */
  message: string
  /** 原始错误，只进「查看详情」和日志 */
  detail?: string
  action?: AppErrorAction
}

export function appError(
  code: AppErrorCode,
  message: string,
  init?: { detail?: string; action?: AppErrorAction }
): AppError {
  return { code, message, detail: init?.detail, action: init?.action ?? 'none' }
}

/**
 * 把任意抛出物归一化成 AppError。
 * 注意：detail 里绝不能带 API key 与书籍正文。
 */
export function toAppError(e: unknown, fallbackMessage = '发生了未知错误'): AppError {
  if (isAppError(e)) return e
  const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
  return { code: 'UNKNOWN', message: fallbackMessage, detail, action: 'none' }
}

function isAppError(e: unknown): e is AppError {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    'message' in e &&
    typeof (e as AppError).message === 'string'
  )
}
```

- [ ] **Step 3: 写错误归一化的失败测试**

`tests/errors.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { appError, toAppError } from '../shared/errors'

describe('toAppError', () => {
  it('已经是 AppError 时原样返回', () => {
    const original = appError('AI_AUTH', '密钥无效', { action: 'openSettings' })
    expect(toAppError(original)).toBe(original)
  })

  it('把原生 Error 转成带 detail 的 UNKNOWN', () => {
    const result = toAppError(new TypeError('boom'), '读取失败')
    expect(result.code).toBe('UNKNOWN')
    expect(result.message).toBe('读取失败')
    expect(result.detail).toBe('TypeError: boom')
    expect(result.action).toBe('none')
  })

  it('把非 Error 抛出物也转成字符串 detail', () => {
    expect(toAppError('oops').detail).toBe('oops')
  })
})
```

- [ ] **Step 4: 写 vitest 配置并跑测试**

`vitest.config.ts`：

```ts
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve(__dirname, 'shared') } },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node'
  }
})
```

Run: `npx vitest run tests/errors.test.ts`
Expected: PASS，3 passed。

- [ ] **Step 5: 写迁移调度的失败测试**

`tests/migrate.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { migrate, type Migration, type MigrationDb } from '../electron/main/store/migrate'

/** 记录调用的假数据库，替代真实 better-sqlite3（原生模块在 vitest 里加载不了） */
function fakeDb(initialVersion = 0) {
  const applied: string[] = []
  let version = initialVersion
  const db: MigrationDb = {
    pragma(source, options) {
      const set = /^user_version\s*=\s*(\d+)$/.exec(source)
      if (set) {
        version = Number(set[1])
        applied.push(`pragma:${version}`)
        return undefined
      }
      return options?.simple ? version : [{ user_version: version }]
    },
    exec(sql) {
      applied.push(`exec:${sql}`)
      return undefined
    },
    // 真实 better-sqlite3 的 transaction 返回一个可直接调用的函数，假实现保持同样形状
    transaction: ((fn: () => void) => fn) as MigrationDb['transaction']
  }
  return { db, applied, version: () => version }
}

describe('migrate', () => {
  it('从 0 升到最新版本并按序执行', () => {
    const { db, applied, version } = fakeDb(0)
    expect(
      migrate(db, [
        { version: 1, up: (d) => d.exec('settings') },
        { version: 2, up: (d) => d.exec('books') }
      ])
    ).toBe(2)
    expect(version()).toBe(2)
    expect(applied).toEqual(['exec:settings', 'pragma:1', 'exec:books', 'pragma:2'])
  })

  it('已是最新版时不重复执行', () => {
    const { db, applied } = fakeDb(2)
    expect(
      migrate(db, [
        { version: 1, up: (d) => d.exec('settings') },
        { version: 2, up: (d) => d.exec('books') }
      ])
    ).toBe(2)
    expect(applied).toEqual([])
  })

  it('从中间版本升级时只执行更高的迁移', () => {
    const { db, applied } = fakeDb(1)
    migrate(db, [
      { version: 1, up: (d) => d.exec('one') },
      { version: 2, up: (d) => d.exec('two') },
      { version: 3, up: (d) => d.exec('three') }
    ])
    expect(applied).toEqual(['exec:two', 'pragma:2', 'exec:three', 'pragma:3'])
  })

  it('清单乱序传入也能按 version 升序执行', () => {
    const { db, applied } = fakeDb(0)
    migrate(db, [
      { version: 2, up: (d) => d.exec('two') },
      { version: 1, up: (d) => d.exec('one') }
    ])
    expect(applied).toEqual(['exec:one', 'pragma:1', 'exec:two', 'pragma:2'])
  })
})
```

- [ ] **Step 6: 跑测试，确认失败**

Run: `npx vitest run tests/migrate.test.ts`
Expected: FAIL —— 报错指向 `electron/main/store/migrate.ts` 无法解析（该文件下一Step才创建），或 `migrate is not a function`。

- [ ] **Step 7: 写迁移调度实现**

`electron/main/store/migrate.ts`：

```ts
/** 迁移只需要数据库的最小子集，这样调度逻辑本身不依赖原生模块，能在 vitest 里测 */
export type MigrationDb = {
  pragma: (source: string, options?: { simple: boolean }) => unknown
  exec: (sql: string) => unknown
  transaction: <T extends (...args: never[]) => unknown>(fn: T) => T
}

export type Migration = {
  version: number
  up: (db: MigrationDb) => void
}

/** 按 version 升序执行未应用过的迁移。每个迁移连同 user_version 的更新一起包在事务里。 */
export function migrate(db: MigrationDb, migrations: Migration[]): number {
  const current = Number(db.pragma('user_version', { simple: true }))
  const pending = migrations
    .filter((m) => m.version > current)
    .sort((a, b) => a.version - b.version)

  for (const m of pending) {
    const run = db.transaction(() => {
      m.up(db)
      db.pragma(`user_version = ${m.version}`)
    })
    run()
  }

  return Number(db.pragma('user_version', { simple: true }))
}
```

- [ ] **Step 8: 跑测试，确认全部通过**

Run: `npx vitest run`
Expected: PASS，全部用例通过（errors 3 个 + migrate 4 个）。

- [ ] **Step 9: 写迁移清单**

`electron/main/store/migrations.ts`：

```ts
import type { Migration } from './migrate'

export const migrations: Migration[] = [
  {
    version: 1,
    up: (db) => {
      db.exec(`
        CREATE TABLE settings (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `)
    }
  }
]
```

后续计划（02 及以后）在**末尾追加**新版本，绝不修改已发布的迁移。

- [ ] **Step 10: Commit**

```bash
git add shared/types.ts shared/errors.ts electron/main/store vitest.config.ts tests
git commit -m "feat: 迁移调度与统一错误模型（含单测）"
```

---

### Task 5: SQLite 接线与设置持久化

打通「渲染进程改设置 → 落库 → 重启后还在」这条链路。

**Files:**
- Create: `electron/main/store/db.ts`, `electron/main/store/settings.ts`
- Create: `electron/main/ipc/index.ts`, `electron/main/ipc/settings.ts`
- Create: `e2e/settings.spec.ts`
- Modify: `electron/main/index.ts`

- [ ] **Step 1: 写数据库打开与迁移前备份**

`electron/main/store/db.ts`：

```ts
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { migrations } from './migrations'
import { migrate } from './migrate'

const KEEP_BACKUPS = 3

let instance: Database.Database | null = null

export function openDatabase(userDataDir: string): Database.Database {
  if (instance) return instance

  const dbPath = join(userDataDir, 'db.sqlite')
  const needsMigration = existsSync(dbPath)

  if (needsMigration) backupBeforeMigrate(dbPath, userDataDir)

  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db, migrations)

  instance = db
  return db
}

export function getDatabase(): Database.Database {
  if (!instance) throw new Error('数据库尚未打开')
  return instance
}

export function closeDatabase(): void {
  instance?.close()
  instance = null
}

/** 迁移前留一份备份，保留最近 3 份。用户的数据不该被一次迁移赌掉。 */
function backupBeforeMigrate(dbPath: string, userDataDir: string): void {
  const dir = join(userDataDir, 'backups')
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  copyFileSync(dbPath, join(dir, `db-${stamp}.sqlite`))

  const backups = readdirSync(dir)
    .filter((f) => f.startsWith('db-') && f.endsWith('.sqlite'))
    .map((f) => ({ file: join(dir, f), mtime: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)

  for (const old of backups.slice(KEEP_BACKUPS)) rmSync(old.file, { force: true })
}
```

- [ ] **Step 2: 写设置仓储**

`electron/main/store/settings.ts`：

```ts
import type Database from 'better-sqlite3'
import { DEFAULT_PREFS, type ReadingPrefs } from '@shared/types'

export function getAll(db: Database.Database): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM settings').all() as {
    key: string
    value: string
  }[]
  return Object.fromEntries(rows.map((r) => [r.key, r.value]))
}

export function set(db: Database.Database, key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value)
}

/** 读到脏数据或缺失字段时回落到默认值，不让一个坏值把阅读器界面搞崩 */
export function readPrefs(db: Database.Database): ReadingPrefs {
  const raw = getAll(db).prefs
  if (!raw) return { ...DEFAULT_PREFS }

  let parsed: Partial<ReadingPrefs>
  try {
    parsed = JSON.parse(raw) as Partial<ReadingPrefs>
  } catch {
    return { ...DEFAULT_PREFS }
  }

  return {
    font: parsed.font === 'sans' ? 'sans' : DEFAULT_PREFS.font,
    fontSize: clampNumber(parsed.fontSize, 15, 24, DEFAULT_PREFS.fontSize),
    charsPerLine: clampNumber(parsed.charsPerLine, 24, 48, DEFAULT_PREFS.charsPerLine),
    lineHeight: clampNumber(parsed.lineHeight, 1.5, 2.2, DEFAULT_PREFS.lineHeight),
    theme: parsed.theme === 'dark' ? 'dark' : DEFAULT_PREFS.theme
  }
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}
```

- [ ] **Step 3: 写设置 IPC handler**

`electron/main/ipc/settings.ts`：

```ts
import { ipcMain } from 'electron'
import { CH } from '@shared/ipc'
import { getDatabase } from '../store/db'
import { getAll, set } from '../store/settings'

export function registerSettingsIpc(): void {
  ipcMain.handle(CH.settingsGetAll, () => getAll(getDatabase()))
  ipcMain.handle(CH.settingsSet, (_event, key: string, value: string) => {
    set(getDatabase(), key, value)
  })
}
```

- [ ] **Step 4: 写 IPC 统一注册入口**

`electron/main/ipc/index.ts`：

```ts
import { registerSecretsIpc } from './secrets'
import { registerSettingsIpc } from './settings'

/** 所有 IPC handler 的唯一注册点。新增域时在这里加一行。 */
export function registerIpc(): void {
  registerSettingsIpc()
  registerSecretsIpc()
}
```

Task 6 才会创建 `./secrets`。为了让本 Task 能独立跑通，先建一个占位文件 `electron/main/ipc/secrets.ts`：

```ts
export function registerSecretsIpc(): void {
  // Task 6 实现
}
```

- [ ] **Step 5: 在主进程启动时打开数据库**

修改 `electron/main/index.ts`，在 `app.whenReady()` 里加数据库初始化与 IPC 注册：

```ts
import { app, BrowserWindow } from 'electron'
import { registerIpc } from './ipc'
import { closeDatabase, openDatabase } from './store/db'
import { createMainWindow } from './window'

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    openDatabase(app.getPath('userData'))
    registerIpc()
    createMainWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  app.on('will-quit', () => {
    closeDatabase()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
```

- [ ] **Step 6: 写设置持久化的失败测试**

「重启后还在」必须在**同一个 userData 目录**上启动两次，所以先把 `e2e/helpers.ts` 改成支持指定目录：

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication } from 'playwright'

/**
 * 每次启动都用一个全新的临时 userData 目录，保证测试之间互不污染，
 * 也保证不会碰到开发者本机的真实书库。
 */
export async function launchApp(): Promise<ElectronApplication> {
  return launchAppWithUserData(mkdtempSync(join(tmpdir(), 'book-read-e2e-')))
}

/** 指定目录启动，用于验证「重启后仍然存在」这类需要跨进程持久化的行为 */
export async function launchAppWithUserData(userDataDir: string): Promise<ElectronApplication> {
  return electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    env: { ...process.env, NODE_ENV: 'test' }
  })
}
```

然后写 `e2e/settings.spec.ts`：

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchAppWithUserData } from './helpers'

test('设置写入后重启进程仍然存在', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-settings-'))

  const first = await launchAppWithUserData(userDataDir)
  const firstWin = await first.firstWindow()
  await firstWin.evaluate(() => (window as any).api.settings.set('prefs', '{"charsPerLine":42}'))
  await first.close()

  const second = await launchAppWithUserData(userDataDir)
  const secondWin = await second.firstWindow()
  const value = await secondWin.evaluate(async () => {
    const all = await (window as any).api.settings.getAll()
    return all.prefs
  })
  expect(value).toBe('{"charsPerLine":42}')
  await second.close()
})
```

- [ ] **Step 7: 跑测试，确认失败**

Run: `npm run e2e -- e2e/settings.spec.ts`
Expected: FAIL —— 第一次 `settings.set` 就会 reject（此时 Step 8 尚未执行时先跑一次，能看到失败）。

- [ ] **Step 8: 把设置接进渲染进程**

`src/pages/SettingsPage.tsx` 先只放一个最小可用的读写区块，完整的三个分组在 Task 7 补齐：

```tsx
import { useEffect, useState } from 'react'

export function SettingsPage() {
  const [chars, setChars] = useState<number | null>(null)

  useEffect(() => {
    void window.api.settings.getAll().then((all) => {
      const raw = all.prefs
      setChars(raw ? (JSON.parse(raw).charsPerLine ?? 34) : 34)
    })
  }, [])

  async function commit(next: number) {
    setChars(next)
    await window.api.settings.set('prefs', JSON.stringify({ charsPerLine: next }))
  }

  if (chars === null) return <div className="page-placeholder">加载中…</div>

  return (
    <div className="page-placeholder">
      <label>
        每行字数
        <input
          type="range"
          min={24}
          max={48}
          value={chars}
          onChange={(e) => void commit(Number(e.target.value))}
        />
        {chars}
      </label>
    </div>
  )
}
```

需要让 TS 认识 `window.api`。新建 `src/global.d.ts`：

```ts
import type { Api } from '../electron/preload'

declare global {
  interface Window {
    api: Api
  }
}

export {}
```

把 `src/global.d.ts` 加进 `tsconfig.json` 的 `include`（`"src"` 已覆盖）。

- [ ] **Step 9: 跑测试，确认通过**

Run: `npm run e2e -- e2e/settings.spec.ts`
Expected: PASS，1 passed。

- [ ] **Step 10: Commit**

```bash
git add electron/main src e2e shared
git commit -m "feat: SQLite 接线与设置持久化，含重启后仍在的 e2e"
```

---

### Task 6: 密钥管理（safeStorage）

**Files:**
- Create: `electron/main/secrets/mask.ts`, `electron/main/secrets/index.ts`
- Create: `tests/mask.test.ts`
- Create: `e2e/secrets.spec.ts`
- Modify: `electron/main/ipc/secrets.ts`, `shared/ipc.ts`

- [ ] **Step 1: 写脱敏纯函数**

`electron/main/secrets/mask.ts`：

```ts
/**
 * 把明文密钥变成可安全展示的形式：sk-••••••••3f7a
 * 太短的 key 全部打码，避免末尾几位就泄露大半。
 */
export function maskKey(plain: string): string {
  const trimmed = plain.trim()
  if (trimmed.length <= 12) return '•'.repeat(trimmed.length)
  return `${trimmed.slice(0, 3)}${'•'.repeat(8)}${trimmed.slice(-4)}`
}
```

- [ ] **Step 2: 写脱敏的失败测试**

`tests/mask.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { maskKey } from '../electron/main/secrets/mask'

describe('maskKey', () => {
  it('保留前三后四，中间打码', () => {
    expect(maskKey('sk-abcdefghijklmnop3f7a')).toBe('sk-••••••••3f7a')
  })

  it('短 key 全部打码，不泄露片段', () => {
    expect(maskKey('sk-1234567890')).toBe('••••••••••••')
  })

  it('去掉首尾空白后再处理', () => {
    expect(maskKey('  sk-abcdefghijklmnop3f7a  ')).toBe('sk-••••••••3f7a')
  })
})
```

- [ ] **Step 3: 跑测试，确认通过**

Run: `npx vitest run tests/mask.test.ts`
Expected: PASS，3 passed。注意 `maskKey` 结果里是 8 个 `•`，而 `'sk-abcdefghijklmnop3f7a'` 长度为 23、截取后三段长度 3+8+4=15 —— 不需要与原文等长，展示用途不受影响。

- [ ] **Step 4: 写密钥存储**

`electron/main/secrets/index.ts`：

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app, safeStorage } from 'electron'
import { appError } from '@shared/errors'
import { maskKey } from './mask'

type SecretsFile = {
  provider: string | null
  /** 值为 safeStorage 加密后的 base64，明文绝不落盘 */
  keys: Record<string, string>
}

function filePath(): string {
  return join(app.getPath('userData'), 'secrets.json')
}

function readFile(): SecretsFile {
  const path = filePath()
  if (!existsSync(path)) return { provider: null, keys: {} }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as SecretsFile
  } catch {
    return { provider: null, keys: {} }
  }
}

function writeFile(data: SecretsFile): void {
  const path = filePath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(data, null, 2), { mode: 0o600 })
}

function assertAvailable(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw appError('SECRET_UNAVAILABLE', '当前系统无法提供安全的密钥存储，暂不能保存 API Key')
  }
}

export function setKey(provider: string, plain: string): void {
  assertAvailable()
  const data = readFile()
  data.keys[provider] = safeStorage.encryptString(plain.trim()).toString('base64')
  data.provider = provider
  writeFile(data)
}

export function getKey(provider: string): string | null {
  const encrypted = readFile().keys[provider]
  if (!encrypted) return null
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
  } catch {
    return null
  }
}

export function clearKey(provider: string): void {
  const data = readFile()
  delete data.keys[provider]
  if (data.provider === provider) data.provider = null
  writeFile(data)
}

/** 只回显脱敏结果，明文永远不出主进程 */
export function status(): { available: boolean; providers: Record<string, string> } {
  const available = safeStorage.isEncryptionAvailable()
  const data = readFile()
  const providers: Record<string, string> = {}
  if (available) {
    for (const provider of Object.keys(data.keys)) {
      const plain = getKey(provider)
      if (plain) providers[provider] = maskKey(plain)
    }
  }
  return { available, providers }
}
```

- [ ] **Step 5: 写密钥 IPC handler**

替换 `electron/main/ipc/secrets.ts` 的占位实现：

```ts
import { ipcMain } from 'electron'
import { CH } from '@shared/ipc'
import { clearKey, setKey, status } from '../secrets'

export function registerSecretsIpc(): void {
  ipcMain.handle(CH.secretsStatus, () => status())
  ipcMain.handle(CH.secretsSet, (_event, provider: string, key: string) => {
    setKey(provider, key)
  })
  ipcMain.handle(CH.secretsClear, (_event, provider: string) => {
    clearKey(provider)
  })
}
```

- [ ] **Step 6: 写密钥持久化的失败测试**

`e2e/secrets.spec.ts`：

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchAppWithUserData } from './helpers'

test('密钥加密落盘，重启后仍可读，且只以脱敏形态暴露给渲染进程', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-secrets-'))
  const PLAIN = 'sk-testtesttesttest3f7a'

  const first = await launchAppWithUserData(userDataDir)
  const firstWin = await first.firstWindow()
  await firstWin.evaluate((key) => (window as any).api.secrets.set('deepseek', key), PLAIN)

  const statusAfterSet = await firstWin.evaluate(() => (window as any).api.secrets.status())
  expect(statusAfterSet.providers.deepseek).toBe('sk-••••••••3f7a')
  expect(JSON.stringify(statusAfterSet)).not.toContain(PLAIN)
  await first.close()

  const second = await launchAppWithUserData(userDataDir)
  const secondWin = await second.firstWindow()
  const statusAfterRestart = await secondWin.evaluate(() => (window as any).api.secrets.status())
  expect(statusAfterRestart.providers.deepseek).toBe('sk-••••••••3f7a')
  await second.close()
})

test('磁盘上的 secrets.json 不含明文', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-secrets-plain-'))
  const PLAIN = 'sk-plaintext-must-not-appear-3f7a'

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()
  await win.evaluate((key) => (window as any).api.secrets.set('kimi', key), PLAIN)
  await app.close()

  const { readFileSync } = await import('node:fs')
  const onDisk = readFileSync(join(userDataDir, 'secrets.json'), 'utf8')
  expect(onDisk).not.toContain(PLAIN)
})
```

- [ ] **Step 7: 跑测试，确认通过**

Run: `npm run e2e -- e2e/secrets.spec.ts`
Expected: PASS，2 passed。若 `statusAfterSet.providers.deepseek` 拿到的是 `undefined`，检查 preload 里 `status` 的返回类型是否与 handler 返回结构一致。

- [ ] **Step 8: Commit**

```bash
git add electron/main/secrets electron/main/ipc/secrets.ts tests/mask.test.ts e2e/secrets.spec.ts
git commit -m "feat: safeStorage 密钥管理，含落盘不含明文与重启可读的 e2e"
```

---

### Task 7: 设置页三组

**Files:**
- Create: `src/features/settings/ModelSection.tsx`, `src/features/settings/ReadingSection.tsx`, `src/features/settings/DataSection.tsx`
- Modify: `src/pages/SettingsPage.tsx`, `src/styles/base.css`

- [ ] **Step 1: 写阅读偏好分组**

`src/features/settings/ReadingSection.tsx`：

```tsx
import { useEffect, useState } from 'react'
import { DEFAULT_PREFS, type ReadingPrefs } from '@shared/types'

const FIELDS: {
  key: keyof ReadingPrefs
  label: string
  min: number
  max: number
  step: number
}[] = [
  { key: 'fontSize', label: '字号', min: 15, max: 24, step: 1 },
  { key: 'charsPerLine', label: '每行字数', min: 24, max: 48, step: 1 },
  { key: 'lineHeight', label: '行距', min: 1.5, max: 2.2, step: 0.05 }
]

export function ReadingSection() {
  const [prefs, setPrefs] = useState<ReadingPrefs | null>(null)

  useEffect(() => {
    void window.api.settings.getAll().then((all) => {
      const raw = all.prefs
      if (!raw) return setPrefs({ ...DEFAULT_PREFS })
      try {
        setPrefs({ ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<ReadingPrefs>) })
      } catch {
        setPrefs({ ...DEFAULT_PREFS })
      }
    })
  }, [])

  if (!prefs) return <p className="settings__hint">加载中…</p>

  function commit(next: ReadingPrefs) {
    setPrefs(next)
    void window.api.settings.set('prefs', JSON.stringify(next))
  }

  return (
    <section className="settings__group">
      <h2 className="settings__title">阅读偏好</h2>

      <div className="settings__row">
        <span className="settings__label">字体</span>
        <div className="seg">
          {(['serif', 'sans'] as const).map((font) => (
            <button
              key={font}
              type="button"
              className={`seg__b${prefs.font === font ? ' is-on' : ''}`}
              onClick={() => commit({ ...prefs, font })}
            >
              {font === 'serif' ? '宋体' : '黑体'}
            </button>
          ))}
        </div>
      </div>

      {FIELDS.map((field) => {
        const value = Number(prefs[field.key])
        return (
          <div className="settings__row" key={field.key}>
            <label className="settings__label" htmlFor={`pref-${field.key}`}>
              {field.label}
            </label>
            <input
              id={`pref-${field.key}`}
              type="range"
              min={field.min}
              max={field.max}
              step={field.step}
              value={value}
              onChange={(e) => commit({ ...prefs, [field.key]: Number(e.target.value) })}
            />
            <span className="settings__value">
              {field.key === 'lineHeight' ? value.toFixed(2) : value}
            </span>
          </div>
        )
      })}

      <div className="settings__row">
        <span className="settings__label">主题</span>
        <div className="seg">
          {(['light', 'dark'] as const).map((theme) => (
            <button
              key={theme}
              type="button"
              className={`seg__b${prefs.theme === theme ? ' is-on' : ''}`}
              onClick={() => {
                document.documentElement.dataset.theme = theme
                commit({ ...prefs, theme })
              }}
            >
              {theme === 'light' ? '亮色' : '暗色'}
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}
```

- [ ] **Step 2: 写模型分组**

`src/features/settings/ModelSection.tsx`：

```tsx
import { useEffect, useState } from 'react'
import { PROVIDERS, type ProviderId } from '@shared/types'

export function ModelSection() {
  const [provider, setProvider] = useState<ProviderId>('deepseek')
  const [masked, setMasked] = useState<string | null>(null)
  const [available, setAvailable] = useState(true)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void window.api.secrets.status().then((s) => {
      setAvailable(s.available)
      setMasked(s.providers[provider] ?? null)
    })
  }, [provider])

  async function save() {
    const key = draft.trim()
    if (!key) return
    setSaving(true)
    try {
      await window.api.secrets.set(provider, key)
      setDraft('')
      setMasked((await window.api.secrets.status()).providers[provider] ?? null)
    } finally {
      setSaving(false)
    }
  }

  async function clear() {
    await window.api.secrets.clear(provider)
    setMasked(null)
  }

  return (
    <section className="settings__group">
      <h2 className="settings__title">模型</h2>

      {!available && (
        <p className="settings__notice">
          当前系统无法提供安全的密钥存储，API Key 无法保存。你仍然可以阅读和记笔记。
        </p>
      )}

      <div className="settings__row">
        <label className="settings__label" htmlFor="provider">
          服务商
        </label>
        <select
          id="provider"
          value={provider}
          onChange={(e) => setProvider(e.target.value as ProviderId)}
        >
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div className="settings__row">
        <label className="settings__label" htmlFor="api-key">
          API Key
        </label>
        {masked ? (
          <>
            <code className="settings__masked">{masked}</code>
            <button type="button" className="btn" onClick={() => void clear()}>
              清除
            </button>
          </>
        ) : (
          <>
            <input
              id="api-key"
              type="password"
              value={draft}
              placeholder="sk-…"
              disabled={!available}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => setDraft('')}
            />
            <button
              type="button"
              className="btn"
              disabled={!available || saving || !draft.trim()}
              onClick={() => void save()}
            >
              保存
            </button>
          </>
        )}
      </div>

      <p className="settings__hint">
        密钥用系统钥匙串加密后只存在这台电脑上，不会上传，也不会随「导出全部数据」一起导出。
      </p>
    </section>
  )
}
```

「测试连接」按钮不在本 Task：它要真的发一次 AI 请求，属于计划 05 的 Provider 层。这里先把保存链路做对。

- [ ] **Step 3: 写数据分组**

`src/features/settings/DataSection.tsx`：

```tsx
export function DataSection() {
  return (
    <section className="settings__group">
      <h2 className="settings__title">数据</h2>
      <p className="settings__hint">
        书库、笔记与阅读进度全部保存在本机。导出数据不包含 API Key，换机器后需要重新填写。
      </p>
      <div className="settings__row">
        <span className="settings__label">书库</span>
        <span className="settings__hint">导入书籍后这里会显示位置与占用</span>
      </div>
    </section>
  )
}
```

真实的书库容量与导出功能要等书库数据存在之后，属于计划 06。

- [ ] **Step 4: 组装设置页并补样式**

`src/pages/SettingsPage.tsx`：

```tsx
import { DataSection } from '../features/settings/DataSection'
import { ModelSection } from '../features/settings/ModelSection'
import { ReadingSection } from '../features/settings/ReadingSection'

export function SettingsPage() {
  return (
    <div className="settings">
      <ModelSection />
      <ReadingSection />
      <DataSection />
    </div>
  )
}
```

把以下样式追加到 `src/styles/base.css`：

```css
.settings {
  padding: var(--s6) var(--s6) var(--s7);
  max-width: 720px;
  display: flex;
  flex-direction: column;
  gap: var(--s6);
}

.settings__group {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  padding: var(--s5);
}

.settings__title {
  margin: 0 0 var(--s4);
  font-size: 16px;
  font-weight: 600;
}

.settings__row {
  display: flex;
  align-items: center;
  gap: var(--s3);
  min-height: 36px;
  margin-bottom: var(--s2);
}

.settings__label {
  flex: 0 0 84px;
  font-size: 13px;
  color: var(--ink-muted);
}

.settings__value {
  flex: 0 0 44px;
  text-align: right;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.settings__masked {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 12px;
  color: var(--ink);
  background: var(--shell);
  padding: 4px 8px;
  border-radius: var(--r-sm);
}

.settings__hint {
  margin: var(--s3) 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--ink-muted);
}

.settings__notice {
  margin: 0 0 var(--s3);
  font-size: 12px;
  line-height: 1.6;
  color: var(--accent-mark);
}

.settings__row input[type='range'] {
  flex: 1;
  min-width: 0;
  accent-color: var(--ink);
}

.settings__row input[type='password'],
.settings__row select {
  flex: 1;
  min-width: 0;
  height: 30px;
  padding: 0 var(--s2);
  font: inherit;
  font-size: 13px;
  color: var(--ink);
  background: var(--paper-raised);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
}

.btn {
  height: 30px;
  padding: 0 var(--s3);
  border-radius: var(--r-sm);
  font-size: 13px;
  color: var(--ink);
  background: var(--paper-raised);
  border: 1px solid var(--line);
  transition: background var(--ease);
}

.btn:hover:not(:disabled) {
  background: var(--hover);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.seg {
  display: flex;
  gap: 2px;
  padding: 2px;
  background: var(--shell);
  border-radius: var(--r-sm);
}

.seg__b {
  height: 24px;
  padding: 0 var(--s3);
  border-radius: 2px;
  font-size: 12px;
  color: var(--ink-muted);
  transition: background var(--ease), color var(--ease);
}

.seg__b.is-on {
  background: var(--paper-raised);
  color: var(--ink);
  box-shadow: 0 1px 2px rgba(43, 39, 35, 0.14);
}

html[data-theme='dark'] .seg__b.is-on {
  box-shadow: none;
}
```

- [ ] **Step 5: 写设置页的 e2e 冒烟**

追加到 `e2e/settings.spec.ts`：

```ts
test('设置页能改每行字数并落库，且密钥以脱敏形态展示', async () => {
  const app = await launchApp()
  const win = await app.firstWindow()

  await win.getByRole('button', { name: '设置' }).click()
  await win.getByLabel('每行字数').fill('40')

  const stored = await win.evaluate(async () => {
    const all = await (window as any).api.settings.getAll()
    return JSON.parse(all.prefs).charsPerLine
  })
  expect(stored).toBe(40)

  await win.evaluate(() => (window as any).api.secrets.set('deepseek', 'sk-testtesttesttest3f7a'))
  await win.reload()
  await win.getByRole('button', { name: '设置' }).click()
  await expect(win.getByText('sk-••••••••3f7a')).toBeVisible()

  await app.close()
})
```

- [ ] **Step 6: 跑测试，确认通过**

Run: `npm run e2e`
Expected: PASS，全部用例通过（boundary 1 + settings 2 + secrets 2）。

- [ ] **Step 7: 目视验证暗色主题**

Run: `npm run dev` → 设置页 → 主题切到「暗色」
Expected: 外壳、面板、卡片三层底色都变暗；文字对比清晰；没有出现纯黑配纯白。切换后重启，主题保持。

- [ ] **Step 8: Commit**

```bash
git add src e2e
git commit -m "feat: 设置页三组（模型密钥、阅读偏好、数据）"
```

---

## Self-Review

**1. Spec coverage（对照 spec 检查本计划覆盖到的部分）**

| Spec 条目 | 本计划覆盖 |
|---|---|
| §1.2 进程模型与能力边界 | Task 2（白名单形状被 e2e 锁定） |
| §1.2 `contextIsolation` / `nodeIntegration` / `sandbox` | Task 1 Step 7 |
| §2.1 应用目录 | Task 5（db + backups）、Task 6（secrets.json） |
| §2.2 settings 表 | Task 4 Step 9 |
| §4.6 设置页三组 | Task 7 |
| §5.7 密钥只回显脱敏、明文不出主进程 | Task 6 |
| §6.1 纯函数单测 + Playwright 集成 | Task 4（vitest）、Task 5/6（e2e） |
| §6.2 统一错误模型 | Task 4 Step 2 |
| §6.3 迁移前备份、保留 3 份 | Task 5 Step 1 |
| §6.4 安全清单中 preload 白名单、外链交系统浏览器 | Task 1 Step 7、Task 2 |
| §6.4 禁止执行书内脚本 | 未覆盖——属于计划 03（iframe 与 CSP） |

未覆盖的 spec 条目（books/chapters/chunks/highlights/ai_results 表、导入管线、渲染、笔记、AI、打包）分别落在计划 02–06。

**2. Placeholder scan**

已检查：无 TBD / TODO / 「稍后实现」类步骤。Task 5 Step 8 与 Task 7 中的占位文案（LibraryPage / NotesPage / DataSection）是**明确标注归属计划**的真实占位实现，不是计划缺口。

**3. 类型与命名一致性**

- `CH` 五个通道在 Task 2 定义，Task 5 用 `settingsGetAll` / `settingsSet`，Task 6 用 `secretsStatus` / `secretsSet` / `secretsClear` —— 名字一致。
- `API_SHAPE` 的键（`settings: [getAll, set]`、`secrets: [status, set, clear]`）与 preload 暴露的方法名逐一对齐。
- `MigrationDb` 在 Task 4 定义，`migrations.ts` 与 `db.ts` 均按同一签名使用。
- `maskKey` 在 Task 6 定义并被 `status()` 调用，测试断言的 `sk-••••••••3f7a` 与 e2e 断言一致。
- `ReadingPrefs` / `DEFAULT_PREFS` 在 Task 4 的 `shared/types.ts` 定义，Task 5 的 `readPrefs` 与 Task 7 的 `ReadingSection` 共用。

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-09-29-01-app-shell-and-data-layer.md`. Two execution options:**

**1. Subagent-Driven（推荐）** —— 每个任务派一个全新 subagent，任务之间我来审查，迭代快、上下文干净

**2. Inline Execution** —— 在当前会话里按 executing-plans 批量执行，带检查点

选哪个？
