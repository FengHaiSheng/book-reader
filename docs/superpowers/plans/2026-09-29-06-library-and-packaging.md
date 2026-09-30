# 书架完善、数据可迁移与打包 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「自己能用」变成「能装给别人用」：书架补齐网格/列表、真实封面、标签与拖放导入；设置页「数据」组落地（占用、导出、备份列表、清理缓存）；加「关于」与手动检查更新；用 electron-builder 打出可分发的 macOS dmg 与 Windows nsis。

**Architecture:** 全部沿用前五份计划的边界——渲染进程只拿白名单方法，封面通过 `epub://` 的虚拟 entry 交给协议层从书目录直接读文件（不解压 zip、不进 IPC 传二进制），标签与导出全在主进程读写 SQLite 与 zip。新引入的运行期依赖只有 `yazl`（写 zip），它此前是 devDependency 只在测试里造 epub 夹具用。

**Tech Stack:** Electron / React / TypeScript / better-sqlite3 / yazl / electron-builder / vitest / Playwright

**Spec:** [2026-09-29-book-reader-design.md](../specs/2026-09-29-book-reader-design.md)

---

## Prerequisites

**执行前必须先配置 git 身份**，否则本计划里所有 commit 步骤都会失败：

```bash
git config user.name "你的名字"
git config user.email "你的邮箱"
```

依赖关系（见计划 01 的「计划拆分说明」）：**06 依赖 01–05 全部完成**。具体用到的东西：

| 来自 | 用到什么 |
|---|---|
| 01 | `openDatabase` / `getDatabase`、`backupBeforeMigrate`、`settings` 读写、`toAppError` / `appError`、`launchAppWithUserData`、Design Tokens、`SettingsPage` 与 `DataSection` 占位 |
| 02 | `books` / `chapters` / `chunks` / `tags` / `book_tags` 表（迁移 v2 已建好）、`listBooks` / `deleteBookRows`、`library/<bookId>/cover.<ext>`、`ImportOutcome`、`fixtures/make-epub.ts` |
| 03 | `epub://` 协议（`parseEpubUrl` / `mimeFor` / `registerEpubScheme`）、`ReaderPage`、`App.tsx` 的 `reading` 状态 |
| 04 | `shared/highlights.ts` 的配色、`notes:*` 通道、`toIpcError` 的写法 |
| 05 | `ai:*` 通道、`app.evaluate` 打桩 `globalThis.fetch` 的手法 |

**本计划不新增任何数据表**：`tags` 与 `book_tags` 在计划 02 的迁移 v2 里已经建好（`ON DELETE CASCADE` 齐备），用户库里没有任何一本书时它们就是空表。所以这里没有 v3 迁移。

---

## File Structure

新增文件与各自职责：

```
shared/
  epub.ts                          # EPUB_SCHEME / COVER_ENTRY / epubUrl / coverUrl（主进程与渲染进程共用）
  update.ts                        # 版本比较与「该不该提示更新」的纯逻辑
electron/main/
  library/tags.ts                  # tags / book_tags 的全部 SQL：列表、计数、建、改名、删、指派
  data/walk.ts                     # 目录占用与文件列举（纯 node，可单测）
  data/archive.ts                  # 导出全部数据为一个 zip（不含 secrets.json）
  data/backups.ts                  # 备份列表
  ipc/data.ts                      # data:* 全部 handler
  update.ts                        # 手动检查更新：读一次 latest.json
src/features/library/
  shelf.ts                         # 视图取值、导入结果摘要、进度文案、删书确认文案（纯函数，可单测）
  useImport.ts                     # 导入的进度/提示/忙状态（选择文件与拖放共用一条路径）
  BookCover.tsx                    # 真实装帧：封面图 + 书脊 + 投影，缺图退化成素面
  BookGrid.tsx                     # 网格视图（末尾是拖放终点）
  LibraryToolbar.tsx               # 导入按钮 + 网格/列表切换 + 标签管理入口
  TagPicker.tsx                    # 单本书的标签指派浮层
  TagManager.tsx                   # 标签的新建 / 改名 / 删除
src/features/settings/
  AboutSection.tsx                 # 版本号与手动检查更新
tests/
  library-shelf.test.ts            # parseView / summarizeImport / progressText
  data-walk.test.ts                # dirBytes / listFiles
  update.test.ts                   # parseVersion / compareVersions / pickUpdate
e2e/
  tags.spec.ts                     # 标签仓储：建、指派、筛选、改名、删（书还在）
  library.spec.ts                  # 网格/列表、封面真实渲染、视图持久化、多本导入
  tags-ui.spec.ts                  # 侧栏筛选、列表视图标签、指派浮层、标签管理
  data.spec.ts                     # 占用、导出 zip（不含密钥）、备份列表、清理缓存
  about.spec.ts                    # 版本号常显、更新源未配置时按钮禁用并说明
build/
  entitlements.mac.plist           # macOS 加固运行时需要的 entitlements
electron-builder.yml               # 打包配置（mac dmg arm64+x64 / win nsis）
```

需要修改的既有文件：

```
shared/types.ts                    # BookTag / Tag / ImportProgressEvent / DataStats / BackupInfo / ExportResult / CleanupResult
shared/ipc.ts                      # 追加 library 标签与 data / appInfo 通道，API_SHAPE 同步
shared/errors.ts                   # 追加 readableError（剥掉 Electron 给 IPC 错误加的前缀）
electron/main/library/repo.ts      # listBooks 支持按标签筛选、带上每本书的标签
electron/main/epub/epub-url.ts     # EPUB_SCHEME 改为从 @shared/epub 转出
electron/main/epub/protocol.ts     # 新增虚拟 entry __cover：从书目录读封面文件
electron/main/store/migrate.ts     # 新增 pendingCount：迁移前的备份只在「真的有事要干」时做
electron/main/store/db.ts          # 备份时机改为「文件已存在且有待执行迁移」，改用 db.backup 取一致性快照
electron/main/index.ts             # openDatabase 变 async，接上 registerDataIpc / registerAppInfoIpc
electron/main/ipc/library.ts       # 标签 handler、多本导入、导入进度带上第几本
electron/main/ipc/index.ts         # 注册 data 与 appInfo
electron/preload/index.ts          # 追加 tags* / data.* / app.* 白名单，新增 pathForFile
src/shell/Sidebar.tsx              # 书架页显示标签列表（上下文列表）
src/App.tsx                        # 标签与筛选状态提升到这里（侧栏与书架页都要用）
src/pages/LibraryPage.tsx          # 由「最小可用」换成完整书架（视图、拖放、标签筛选）
src/features/library/BookList.tsx  # 加封面缩略图与标签 chip
src/features/library/ImportButton.tsx  # 变成纯展示按钮（进度与提示上移到 useImport）
src/features/settings/DataSection.tsx  # 由占位换成真实的数据组
src/pages/SettingsPage.tsx         # 追加 AboutSection
src/styles/base.css                # 封面、网格、标签、数据组、关于组样式
package.json                       # yazl 移到 dependencies；追加 dist:mac / dist:win
tests/errors.test.ts               # 追加 readableError 的用例
tests/migrate.test.ts              # 追加 pendingCount 的用例
```

---

### Task 1: 标签：仓储、按标签筛选与 IPC

标签表在计划 02 就建好了，但至今没有任何代码碰过它。本 Task 把它接上，并且顺手解决一个已经存在的小毛病：**Electron 会给每个 reject 的 IPC 调用套一层前缀**（`Error invoking remote method 'x': Error: 真的话`），计划 02 的导入按钮直接把 `e.message` 显示给用户，界面里会出现这串英文。标签的错误信息必须干净地到达界面，所以先把这个剥前缀的纯函数建起来。

**Files:**
- Modify: `shared/errors.ts`, `shared/types.ts`, `shared/ipc.ts`
- Modify: `tests/errors.test.ts`
- Create: `electron/main/library/tags.ts`
- Modify: `electron/main/library/repo.ts`, `electron/main/ipc/library.ts`
- Modify: `electron/preload/index.ts`
- Create: `e2e/tags.spec.ts`

- [ ] **Step 1: 追加共享类型**

在 `shared/types.ts` 末尾追加（`HighlightColor` 的 `import type` 计划 04 已经加过，不要重复导入）：

```ts
/** 书上的标签，够渲染一行 chip 用 */
export type BookTag = {
  id: number
  name: string
  color: HighlightColor
}

/** 侧栏用的标签：比 BookTag 多一个计数 */
export type Tag = BookTag & { bookCount: number }
```

把 `BookSummary` 改成（只加 `tags` 一个字段，其余不动）：

```ts
export type BookSummary = {
  id: string
  title: string
  author: string | null
  coverPath: string | null
  status: BookStatus
  chapterCount: number
  totalChars: number
  addedAt: number
  lastOpenedAt: number | null
  /** 按标签名排序；没打标签就是空数组，不是 undefined */
  tags: BookTag[]
}
```

- [ ] **Step 2: 写剥前缀的纯函数**

在 `shared/errors.ts` 末尾追加：

```ts
/**
 * 把跨 IPC 抛回来的错误整理成一句话，直接能显示给用户。
 *
 * Electron 会给每个 reject 的 invoke 套一层
 * `Error invoking remote method 'library:tagCreate': Error: 真正的话`，
 * 主进程 `toAppError` 已经把 detail 与 code 归拢干净了，剩下这层前缀由这里剥掉。
 * 正则不匹配就原样返回，不做二次猜测——猜错比留个前缀更难查。
 */
export function readableError(error: unknown, fallback = '操作没有成功'): string {
  const raw = error instanceof Error ? error.message : String(error)
  const matched = /^Error invoking remote method '[^']*':\s*(?:Error:\s*)?([\s\S]*)$/.exec(raw)
  const text = (matched?.[1] ?? raw).trim()
  return text || fallback
}
```

- [ ] **Step 3: 写它的失败测试**

在 `tests/errors.test.ts` 末尾追加一个 `describe`（保留文件里已有的 import，把 `readableError` 加进 `../shared/errors` 那一行的导入里）：

```ts
describe('readableError', () => {
  it('剥掉 Electron 给 IPC 错误加的前缀', () => {
    const error = new Error(
      "Error invoking remote method 'library:tagCreate': Error: 已经有叫「待读」的标签了"
    )
    expect(readableError(error)).toBe('已经有叫「待读」的标签了')
  })

  it('更深的一层嵌套也只剥第一层，内容原样保留', () => {
    const error = new Error(
      "Error invoking remote method 'data:export': Error: 磁盘已满：/Users/me/Desktop/out.zip"
    )
    expect(readableError(error)).toBe('磁盘已满：/Users/me/Desktop/out.zip')
  })

  it('本来就没有前缀的错误原样返回', () => {
    expect(readableError(new Error('网络不可用'))).toBe('网络不可用')
  })

  it('空消息回落到兜底文案', () => {
    expect(readableError(new Error(''), '导入没有成功')).toBe('导入没有成功')
    expect(readableError(null, '导入没有成功')).toBe('导入没有成功')
  })
})
```

- [ ] **Step 4: 跑它，确认通过**

Run: `npx vitest run tests/errors.test.ts`

Expected: PASS，文件里原有 4 条加新 4 条共 8 passed。若报 `readableError is not a function`，说明 Step 2 的函数没加或没导出。

- [ ] **Step 5: 写标签仓储**

新建 `electron/main/library/tags.ts`：

```ts
import type Database from 'better-sqlite3'
import { appError } from '@shared/errors'
import { HIGHLIGHT_COLORS, normalizeColor, type HighlightColor } from '@shared/highlights'
import type { BookTag, Tag } from '@shared/types'

const MAX_NAME = 24

/**
 * 一次取回全书库的「书 → 标签」，给 listBooks 用。
 *
 * 写成一次查询而不是每本书查一次：书架默认就能有几百本，N+1 会在这里变成
 * 几百条 SQL，而标签本来就不多。
 */
export function tagsByBook(db: Database.Database): Map<string, BookTag[]> {
  const rows = db
    .prepare(
      `SELECT bt.book_id AS bookId, t.id AS id, t.name AS name, t.color AS color
       FROM book_tags bt
       JOIN tags t ON t.id = bt.tag_id
       ORDER BY t.name COLLATE NOCASE`
    )
    .all() as { bookId: string; id: number; name: string; color: string }[]

  const map = new Map<string, BookTag[]>()
  for (const row of rows) {
    const list = map.get(row.bookId) ?? []
    list.push({ id: row.id, name: row.name, color: normalizeColor(row.color) })
    map.set(row.bookId, list)
  }
  return map
}

export function listTags(db: Database.Database): Tag[] {
  const rows = db
    .prepare(
      `SELECT t.id AS id, t.name AS name, t.color AS color,
              COUNT(bt.book_id) AS bookCount
       FROM tags t
       LEFT JOIN book_tags bt ON bt.tag_id = t.id
       GROUP BY t.id
       ORDER BY t.name COLLATE NOCASE`
    )
    .all() as { id: number; name: string; color: string; bookCount: number }[]

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    color: normalizeColor(row.color),
    bookCount: row.bookCount
  }))
}

export function createTag(db: Database.Database, name: string): Tag {
  const trimmed = cleanName(name)
  if (db.prepare('SELECT id FROM tags WHERE name = ?').get(trimmed)) {
    throw appError('DB_ERROR', `已经有叫「${trimmed}」的标签了`)
  }
  const color = nextColor(db)
  const info = db.prepare('INSERT INTO tags (name, color) VALUES (?, ?)').run(trimmed, color)
  return { id: Number(info.lastInsertRowid), name: trimmed, color, bookCount: 0 }
}

export function renameTag(db: Database.Database, id: number, name: string): Tag {
  const trimmed = cleanName(name)
  if (db.prepare('SELECT id FROM tags WHERE name = ? AND id <> ?').get(trimmed, id)) {
    throw appError('DB_ERROR', `已经有叫「${trimmed}」的标签了`)
  }
  const info = db.prepare('UPDATE tags SET name = ? WHERE id = ?').run(trimmed, id)
  if (info.changes === 0) throw appError('DB_ERROR', '这个标签已经不存在了')

  const row = db
    .prepare(
      `SELECT t.id AS id, t.name AS name, t.color AS color,
              COUNT(bt.book_id) AS bookCount
       FROM tags t
       LEFT JOIN book_tags bt ON bt.tag_id = t.id
       WHERE t.id = ?
       GROUP BY t.id`
    )
    .get(id) as { id: number; name: string; color: string; bookCount: number }

  return {
    id: row.id,
    name: row.name,
    color: normalizeColor(row.color),
    bookCount: row.bookCount
  }
}

/**
 * 删标签只脱掉书上的标签，一本书都不动。
 * `book_tags` 的 ON DELETE CASCADE 需要 `foreign_keys = ON`——计划 01 的 db.ts 已经打开。
 */
export function deleteTag(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM tags WHERE id = ?').run(id)
}

export function assignTag(db: Database.Database, bookId: string, tagId: number, on: boolean): void {
  if (on) {
    db.prepare('INSERT OR IGNORE INTO book_tags (book_id, tag_id) VALUES (?, ?)').run(bookId, tagId)
    return
  }
  db.prepare('DELETE FROM book_tags WHERE book_id = ? AND tag_id = ?').run(bookId, tagId)
}

function cleanName(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) throw appError('DB_ERROR', '标签名不能为空')
  if (trimmed.length > MAX_NAME) throw appError('DB_ERROR', `标签名最多 ${MAX_NAME} 个字`)
  return trimmed
}

/** 按已有标签数轮流取色，让新标签一眼能和旧标签分开 */
function nextColor(db: Database.Database): HighlightColor {
  const row = db.prepare('SELECT COUNT(*) AS n FROM tags').get() as { n: number }
  return HIGHLIGHT_COLORS[row.n % HIGHLIGHT_COLORS.length]!
}
```

- [ ] **Step 6: 让 `listBooks` 带上标签并支持筛选**

`electron/main/library/repo.ts`：把 `listBooks` 整份替换成下面这版，并在文件顶部的 import 里补 `import { tagsByBook } from './tags'`：

```ts
/** listBooks 的中间形态：先按行取回，再把标签一次贴上去 */
type BookRow = Omit<BookSummary, 'tags'>

export function listBooks(db: Database.Database, tagId: number | null = null): BookSummary[] {
  const rows = db
    .prepare(
      `SELECT id, title, author, cover_path AS coverPath, status,
              chapter_count AS chapterCount, total_chars AS totalChars,
              added_at AS addedAt, last_opened_at AS lastOpenedAt
       FROM books
       WHERE ? IS NULL OR id IN (SELECT book_id FROM book_tags WHERE tag_id = ?)
       ORDER BY COALESCE(last_opened_at, added_at) DESC`
    )
    .all(tagId, tagId) as BookRow[]

  const tags = tagsByBook(db)
  return rows.map((row) => ({ ...row, tags: tags.get(row.id) ?? [] }))
}
```

`? IS NULL OR ...` 用的是 SQLite 对 NULL 的三值逻辑：`tagId` 传 `null` 时第一个条件恒真，等于不筛。**不要**改成两段拼接的 SQL 字符串——那样要在字符串里插值，而这个函数迟早会被别处用别的参数调。

- [ ] **Step 7: 追加 IPC 通道与白名单**

`shared/ipc.ts` 的 `CH` 里追加（紧跟 `libraryImportProgress` 之后）：

```ts
  libraryImportPaths: 'library:importPaths',
  libraryTagsList: 'library:tagsList',
  libraryTagCreate: 'library:tagCreate',
  libraryTagRename: 'library:tagRename',
  libraryTagDelete: 'library:tagDelete',
  libraryTagAssign: 'library:tagAssign'
```

`API_SHAPE.library` 改成：

```ts
  library: [
    'pickAndImport',
    'importPath',
    'importPaths',
    'pathForFile',
    'list',
    'chapters',
    'search',
    'remove',
    'tagsList',
    'tagCreate',
    'tagRename',
    'tagDelete',
    'tagAssign',
    'onImportProgress'
  ]
```

`importPaths` 与 `pathForFile` 在 Task 3 落地。**这一步先把它们写进契约**，`boundary.spec.ts` 会一直红到 Task 3——所以本 Task 的验证只看 `npx tsc --noEmit` 与 `e2e/tags.spec.ts`，`boundary.spec.ts` 留到 Task 3 一起绿。契约先行的好处是：preload 少挂一个方法、或多挂一个方法，都会在那条测试里立刻暴露。

- [ ] **Step 8: 写 library handler 的标签部分**

`electron/main/ipc/library.ts`：把 import 补成

```ts
import { appError, toAppError } from '@shared/errors'
import { assignTag, createTag, deleteTag, listTags, renameTag } from '../library/tags'
```

（`appError` 若暂时没用到就先不加，`npx tsc --noEmit` 会告诉你。）在 `registerLibraryIpc` 里把 `libraryList` 那一行换成：

```ts
  ipcMain.handle(CH.libraryList, (_event, tagId?: number | null) =>
    listBooks(getDatabase(), tagId ?? null)
  )

  ipcMain.handle(CH.libraryTagsList, () => listTags(getDatabase()))

  ipcMain.handle(CH.libraryTagCreate, (_event, name: string) => {
    try {
      return createTag(getDatabase(), name)
    } catch (error) {
      return fail(error, '标签没有建成')
    }
  })

  ipcMain.handle(CH.libraryTagRename, (_event, id: number, name: string) => {
    try {
      return renameTag(getDatabase(), id, name)
    } catch (error) {
      return fail(error, '标签没有改成')
    }
  })

  ipcMain.handle(CH.libraryTagDelete, (_event, id: number) => {
    try {
      deleteTag(getDatabase(), id)
    } catch (error) {
      return fail(error, '标签没有删掉')
    }
  })

  ipcMain.handle(CH.libraryTagAssign, (_event, bookId: string, tagId: number, on: boolean) => {
    try {
      assignTag(getDatabase(), bookId, tagId, on)
    } catch (error) {
      return fail(error, '标签没有指派成功')
    }
  })
```

在文件末尾加这个私有小工具：

```ts
/**
 * 跨 IPC 只把 message 交给渲染进程。
 *
 * `ipc/notes.ts` 与 `ipc/ai.ts` 各自有一份等价实现（名叫 toIpcError / toReadable）。
 * 三份合一是独立的重构，不在本计划范围；这里只保证新增的标签 handler
 * 用的是同一个 `toAppError`，不会多出第四种错误形状。
 */
function fail(error: unknown, fallback: string): never {
  throw new Error(toAppError(error, fallback).message)
}
```

- [ ] **Step 9: 补 preload 白名单**

`electron/preload/index.ts` 的 `api.library` 里追加（`@shared/types` 的导入补上 `Tag`）：

```ts
    tagsList: (): Promise<Tag[]> => ipcRenderer.invoke(CH.libraryTagsList),
    tagCreate: (name: string): Promise<Tag> => ipcRenderer.invoke(CH.libraryTagCreate, name),
    tagRename: (id: number, name: string): Promise<Tag> =>
      ipcRenderer.invoke(CH.libraryTagRename, id, name),
    tagDelete: (id: number): Promise<void> => ipcRenderer.invoke(CH.libraryTagDelete, id),
    tagAssign: (bookId: string, tagId: number, on: boolean): Promise<void> =>
      ipcRenderer.invoke(CH.libraryTagAssign, bookId, tagId, on),
```

同时把 `library.list` 改成带可选筛选：

```ts
    list: (tagId?: number | null): Promise<BookSummary[]> =>
      ipcRenderer.invoke(CH.libraryList, tagId ?? null),
```

- [ ] **Step 10: 写标签的端到端测试**

新建 `e2e/tags.spec.ts`：

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { novelFiles, writeEpub } from '../fixtures/make-epub'
import { launchAppWithUserData } from './helpers'

test('标签：创建、指派、按标签筛选、改名、删除后书还在', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-tags-'))
  const epubPath = join(userDataDir, 'novel.epub')
  await writeEpub(epubPath, novelFiles())

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()

  const imported = await win.evaluate((p) => (window as any).api.library.importPath(p), epubPath)
  const bookId = imported.bookId as string

  expect(await win.evaluate(() => (window as any).api.library.tagsList())).toEqual([])

  const tag = await win.evaluate(() => (window as any).api.library.tagCreate('待读'))
  expect(tag.name).toBe('待读')
  expect(tag.bookCount).toBe(0)
  expect(['yellow', 'green', 'blue', 'pink']).toContain(tag.color)

  await win.evaluate(
    (args: { bookId: string; tagId: number }) =>
      (window as any).api.library.tagAssign(args.bookId, args.tagId, true),
    { bookId, tagId: tag.id }
  )

  const tagged = await win.evaluate(() => (window as any).api.library.list())
  expect(tagged[0].tags).toEqual([{ id: tag.id, name: '待读', color: tag.color }])

  const counted = await win.evaluate(() => (window as any).api.library.tagsList())
  expect(counted[0].bookCount).toBe(1)

  expect(await win.evaluate((id: number) => (window as any).api.library.list(id), tag.id)).toHaveLength(1)
  expect(await win.evaluate(() => (window as any).api.library.list(9999))).toHaveLength(0)

  const renamed = await win.evaluate(
    (args: { id: number; name: string }) =>
      (window as any).api.library.tagRename(args.id, args.name),
    { id: tag.id, name: '在读' }
  )
  expect(renamed.name).toBe('在读')
  expect(renamed.bookCount).toBe(1)

  await win.evaluate((id: number) => (window as any).api.library.tagDelete(id), tag.id)
  expect(await win.evaluate(() => (window as any).api.library.tagsList())).toEqual([])

  // 删标签绝不能连带删书
  const after = await win.evaluate(() => (window as any).api.library.list())
  expect(after).toHaveLength(1)
  expect(after[0].tags).toEqual([])

  await app.close()
})

test('标签的错误信息是中文，且不带 Electron 的 IPC 前缀', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-tags-dup-'))
  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()

  await win.evaluate(() => (window as any).api.library.tagCreate('待读'))
  const message = await win.evaluate(() =>
    (window as any).api.library
      .tagCreate('待读')
      .then(() => '')
      .catch((e: Error) => e.message)
  )

  expect(message).toContain('已经有叫「待读」的标签了')
  expect(await win.evaluate(() => (window as any).api.library.tagsList())).toHaveLength(1)

  await app.close()
})
```

第二条刻意只断言 `toContain` 而不是相等：Electron 加的那层前缀是**协议层行为**，剥掉它的是渲染进程的 `readableError`（Step 2 已单测）。主进程这侧能保证的是「message 里确实带着那句中文」。

- [ ] **Step 11: 跑测试，确认通过**

Run: `npx tsc --noEmit && npx vitest run && npm run e2e -- e2e/tags.spec.ts`

Expected: `tsc` 无输出；vitest 全绿；tags.spec 2 passed。

若报 `no such table: tags`，说明计划 02 的迁移 v2 没跑起来——先去查 `e2e/import.spec.ts` 是否通过，别在这个 Task 里改迁移。

- [ ] **Step 12: Commit**

```bash
git add shared electron/main tests/errors.test.ts e2e/tags.spec.ts
git commit -m "feat: 标签仓储与按标签筛选（books 带标签、计数、建改删指派、剥掉 IPC 错误前缀）"
```

---

### Task 2: 封面真实渲染

书架至今不显示封面（计划 02 明确留给了这里）。封面的位置很尴尬：它在导入时被抽到 `library/<bookId>/cover.<ext>`，**不在 zip 里**，所以既不能走 zip 里的 entry，也不该把图片二进制塞进 IPC。

做法是给 `epub://` 加一个虚拟 entry：`epub://<bookId>/__cover` 由协议层直接从书目录读文件。这样渲染进程只写一个 `<img src>`，`loading="lazy"` 天然生效（Chromium 对 `epub://` 这种 standard scheme 一样支持懒加载），几百本书也只加载视口里的那几张。

**Files:**
- Create: `shared/epub.ts`
- Modify: `electron/main/epub/epub-url.ts`, `electron/main/epub/protocol.ts`
- Modify: `e2e/protocol.spec.ts`
- Create: `src/features/library/BookCover.tsx`
- Modify: `src/styles/base.css`

- [ ] **Step 1: 写共用的 URL 约定**

新建 `shared/epub.ts`：

```ts
/**
 * epub:// 的公共约定。主进程（协议实现）与渲染进程（拼 URL）都要用，
 * 所以放 shared——两边各写一遍字符串，迟早在某一侧改错。
 */

export const EPUB_SCHEME = 'epub'

/**
 * 封面的虚拟 entry。
 *
 * 封面在导入时被抽到 `library/<bookId>/cover.<ext>`，不在 zip 里，
 * 所以给它一个固定的虚拟路径，由协议层直接读文件。
 *
 * 代价：真实 zip 里若存在叫 `__cover` 的条目会被它遮住。这个风险由
 * 「同一本书的封面只有一份」兜住——就算撞上，返回的也正是这本书自己的封面。
 */
export const COVER_ENTRY = '__cover'

/** entry 里可能带空格或中文，逐段编码，别让 URL 解析器把 `/` 之外的东西吃掉 */
export function epubUrl(bookId: string, entry: string): string {
  return `${EPUB_SCHEME}://${bookId}/${entry.split('/').map(encodeURIComponent).join('/')}`
}

export function coverUrl(bookId: string): string {
  return epubUrl(bookId, COVER_ENTRY)
}
```

- [ ] **Step 2: 让 `epub-url.ts` 的 `EPUB_SCHEME` 只有一处定义**

`electron/main/epub/epub-url.ts`：把文件顶部那段常量声明

```ts
export const EPUB_SCHEME = 'epub'
```

替换成

```ts
import { EPUB_SCHEME } from '@shared/epub'

export { EPUB_SCHEME }
```

这样 `tests/epub-url.test.ts` 里 `import { EPUB_SCHEME } from '../electron/main/epub/epub-url'` 依然成立，而值的定义回到了 shared 一处。

- [ ] **Step 3: 写失败的协议测试**

`e2e/protocol.spec.ts`：在文件末尾追加一个用例（复用它里面已有的 `get` 助手与导入夹具的写法；若助手的返回形状与本段不一致，以文件里已有的为准，本段只多断言 `contentType`）：

```ts
test('封面走虚拟 entry：从书目录直接读文件，不解压 zip', async () => {
  const byId = await win.evaluate((id: string) => window.fetch(`epub://${id}/__cover`).then(async (r) => ({
    status: r.status,
    contentType: r.headers.get('content-type') ?? '',
    bytes: (await r.arrayBuffer()).byteLength
  })), bookId)

  expect(byId.status).toBe(200)
  expect(byId.contentType).toContain('image/')
  expect(byId.bytes).toBeGreaterThan(0)

  const missing = await win.evaluate((id: string) =>
    window.fetch(`epub://${id}/__cover`).then((r) => r.status), '11111111-2222-3333-4444-555555555555')
  expect(missing).toBe(404)
})
```

`novelFiles()` 造的夹具里封面是 `Buffer.from('fake-jpeg-bytes')`，不是合法 JPEG，但这不影响协议层：这里验的是「读到文件、给出正确的 Content-Type、响应非空」。**图片能不能解码**由 Task 3 的书架 e2e 用 `naturalWidth > 0` 验（那时用的是同一份夹具，同样解不出来）——所以 Task 3 会改用带真实封面的夹具，见那一节的说明。

- [ ] **Step 4: 跑它，确认失败**

Run: `npm run e2e -- e2e/protocol.spec.ts`

Expected: FAIL —— `__cover` 落到 `mimeFor` 上返回 null，被当成不支持的类型，状态码是 **403** 而不是 200。（`missing` 那条同样是 403，因为它连 bookId 都不存在，同样卡在 `mimeFor`。）

- [ ] **Step 5: 实现虚拟 entry**

`electron/main/epub/protocol.ts`：把 import 补成

```ts
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { protocol } from 'electron'
import { CHAPTER_CSP } from '@shared/csp'
import { COVER_ENTRY } from '@shared/epub'
import { bookDir } from '../library/paths'
import { readEntries } from './zip'
import { EPUB_SCHEME, mimeFor, parseEpubUrl } from './epub-url'
```

把 `handleEpubProtocol` 里的 `protocol.handle(EPUB_SCHEME, async (request) => { ... })` 开头改成：

```ts
  protocol.handle(EPUB_SCHEME, async (request) => {
    const target = parseEpubUrl(request.url)
    if (!target) return new Response(null, { status: 400 })

    // 封面不进 zip：导入时已经抽成文件了，直接读（spec §3.3 的「只有封面例外」）
    if (target.entry === COVER_ENTRY) return serveCover(target.bookId)

    const mime = mimeFor(target.entry)
```

并在文件末尾（`handleEpubProtocol` 之外）加上：

```ts
const COVER_FILE = /^cover\.[a-z0-9]+$/i

/**
 * 从 `library/<bookId>/` 里找封面文件。
 *
 * 只认 `cover.<ext>` 这个形状，不接受任何来自 URL 的文件名——路径完全由
 * `bookId` 与这个正则决定，URL 里的东西一个字都进不了路径拼接。
 */
function serveCover(bookId: string): Response {
  const dir = bookDir(bookId)

  let name: string
  try {
    name = readdirSync(dir).find((file) => COVER_FILE.test(file)) ?? ''
  } catch {
    // 书不存在、目录被删：对渲染进程都是 404
    return new Response(null, { status: 404 })
  }
  if (!name) return new Response(null, { status: 404 })

  const mime = mimeFor(name)
  if (!mime) return new Response(null, { status: 404 })

  try {
    return new Response(readFileSync(join(dir, name)), {
      headers: { 'Content-Type': mime, 'Access-Control-Allow-Origin': '*' }
    })
  } catch {
    return new Response(null, { status: 404 })
  }
}
```

注意 `serveCover` 是**同步**返回 `Response`（`readdirSync` + `readFileSync`），封面都是几十到几百 KB 的文件、只在书架渲染时读，不值得为它引入异步；要改异步反而会让 `protocol.handle` 的返回类型多一层包装。

- [ ] **Step 6: 跑测试，确认通过**

Run: `npx vitest run tests/epub-url.test.ts && npm run e2e -- e2e/protocol.spec.ts`

Expected: 13 passed；protocol.spec 全部 passed（含新加的封面用例）。

- [ ] **Step 7: 写封面组件**

新建 `src/features/library/BookCover.tsx`：

```tsx
import { useState } from 'react'
import { coverUrl } from '@shared/epub'
import type { BookSummary } from '@shared/types'

/**
 * 真实装帧：封面图 + 书脊 + 投影（spec §4.5）。
 *
 * 封面缺失、或者文件坏了（`coverPath` 有值但图读不出来）都退化成一本书名的
 * 素面——不画一个假的封面图，那只会让人以为书库里有张图坏了。
 * `loading="lazy"` 是关键：书库上限按 500 本算，不懒加载会把几百张封面一起拉起来。
 */
export function BookCover({ book, width }: { book: BookSummary; width: number }) {
  const [broken, setBroken] = useState(false)
  const height = Math.round(width * 1.45)

  return (
    <span className="book-cover" style={{ width, height }} aria-hidden="true">
      {book.coverPath !== null && !broken ? (
        <img
          className="book-cover__img"
          src={coverUrl(book.id)}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
        />
      ) : (
        <span className="book-cover__blank">
          <span className="book-cover__blank-title">{book.title}</span>
        </span>
      )}
      <span className="book-cover__spine" />
    </span>
  )
}
```

`aria-hidden="true"` 是有意的：封面里的书名与列表里的书名重复，读屏会被念两遍。书名是真实的文字节点，不是图。

- [ ] **Step 8: 加封面样式**

追加到 `src/styles/base.css` 末尾：

```css
/* 书的装帧：一块纸面 + 左侧书脊 + 一点投影。深度来自层次，不来自特效 */
.book-cover {
  position: relative;
  display: block;
  flex: 0 0 auto;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 3px 5px 5px 3px;
  box-shadow: 0 1px 2px rgba(43, 39, 35, 0.08), 0 6px 14px rgba(43, 39, 35, 0.12);
  overflow: hidden;
}

.book-cover__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.book-cover__spine {
  position: absolute;
  inset: 0 auto 0 0;
  width: 5px;
  background: linear-gradient(
    to right,
    rgba(43, 39, 35, 0.18),
    rgba(43, 39, 35, 0.04) 60%,
    transparent
  );
  pointer-events: none;
}

.book-cover__blank {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: var(--s3);
  background: var(--paper-raised);
}

.book-cover__blank-title {
  font-family: var(--serif);
  font-size: 12px;
  line-height: 1.5;
  color: var(--ink-muted);
  text-align: center;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
}
```

`BookCover` 此时还没有被任何页面用到，`npx tsc --noEmit` 不会报未使用（它是导出）。它在 Task 3 接入书架。

- [ ] **Step 9: 跑一遍全量**

Run: `npx tsc --noEmit && npx vitest run && npm run e2e -- e2e/protocol.spec.ts e2e/reader.spec.ts`

Expected: 全部通过。reader.spec 是回归：`epub-url.ts` 动了 import，如果 `EPUB_SCHEME` 转出写错，章节文档会整体读不出来。

- [ ] **Step 10: Commit**

```bash
git add shared/epub.ts electron/main/epub src/features/library/BookCover.tsx src/styles/base.css e2e/protocol.spec.ts
git commit -m "feat: 封面走 epub:// 虚拟 entry 从书目录直读，配真实装帧组件（懒加载、缺图退素面）"
```

---

### Task 3: 书架：网格/列表切换与拖放导入

计划 02 留下的 `LibraryPage` + `BookList` + `ImportButton` 是三块要扩的结构：视图要可切换并记住选择、网格末尾要是拖放终点、导入要支持一次多本且进度要说清「第几本」。

本 Task 顺手把三个纯逻辑抽到 `shelf.ts`：视图取值、导入结果摘要、进度文案。它们都是**界面上真正会出错的判断**（`'list'` 之外的脏值、全重复、单本不带前缀），值得单测。

**Files:**
- Modify: `shared/types.ts`, `shared/ipc.ts`
- Modify: `tests/`, `electron/main/ipc/library.ts`, `electron/preload/index.ts`
- Create: `src/features/library/shelf.ts`, `src/features/library/useImport.ts`, `src/features/library/BookGrid.tsx`, `src/features/library/LibraryToolbar.tsx`
- Modify: `src/features/library/ImportButton.tsx`, `src/features/library/BookList.tsx`, `src/pages/LibraryPage.tsx`, `src/styles/base.css`
- Create: `tests/library-shelf.test.ts`, `e2e/library.spec.ts`

- [ ] **Step 1: 追加共享类型**

`shared/types.ts` 末尾追加：

```ts
/** 主进程推给渲染进程的导入进度：多本一起导入时要能说出「第几本」 */
export type ImportProgressEvent = ImportProgress & {
  fileIndex: number
  fileCount: number
  fileName: string
}
```

- [ ] **Step 2: 写纯函数**

新建 `src/features/library/shelf.ts`：

```ts
import type { ImportOutcome, ImportProgressEvent } from '@shared/types'

export type LibraryView = 'grid' | 'list'

/** 设置里存的是字符串，读到什么都不许让书架渲染不出来 */
export function parseView(raw: string | undefined | null): LibraryView {
  return raw === 'list' ? 'list' : 'grid'
}

/** 导入结束后的那一句话：导入了几本、哪几本是重复的 */
export function summarizeImport(outcomes: readonly ImportOutcome[]): string {
  const imported = outcomes.filter((item) => item.status === 'imported')
  const duplicates = outcomes.filter((item) => item.status === 'duplicate')
  const parts: string[] = []

  if (imported.length > 0) parts.push(`导入 ${imported.length} 本`)
  if (duplicates.length > 0) {
    const titles = duplicates.map((item) => `《${item.title}》`).join('')
    parts.push(`${duplicates.length} 本已在书库里${titles}`)
  }
  return parts.join('，')
}

const PHASE_LABEL: Record<ImportProgressEvent['phase'], string> = {
  hash: '校验文件',
  extract: '解析正文',
  store: '写入书库'
}

/** 进度文案要能看出「进行到第几本、这一步做到哪儿」，否则多本导入像卡住了 */
export function progressText(progress: ImportProgressEvent): string {
  const book = progress.fileCount > 1 ? `第 ${progress.fileIndex + 1}/${progress.fileCount} 本 · ` : ''
  const step = progress.total > 1 ? ` ${progress.done}/${progress.total}` : '…'
  return `${book}${PHASE_LABEL[progress.phase]}${step}`
}

/**
 * 删书的二次确认文案只有这一份。spec §6.3 要求明说笔记与高亮一起删，
 * 网格视图与列表视图的删除按钮共用它，别让两处文案各自演化。
 */
export function confirmRemove(book: { title: string }): boolean {
  return window.confirm(`删除《${book.title}》？笔记、高亮与阅读进度会一起删除，不可恢复。`)
}
```

- [ ] **Step 3: 写它的测试**

新建 `tests/library-shelf.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { parseView, progressText, summarizeImport } from '../src/features/library/shelf'

describe('parseView', () => {
  it('只认 list，其余一律回网格', () => {
    expect(parseView('list')).toBe('list')
    expect(parseView('grid')).toBe('grid')
    expect(parseView(undefined)).toBe('grid')
    expect(parseView('')).toBe('grid')
    expect(parseView('LIST')).toBe('grid')
  })
})

describe('summarizeImport', () => {
  it('全是新书', () => {
    expect(
      summarizeImport([
        { status: 'imported', bookId: 'a', title: '河边的月亮' },
        { status: 'imported', bookId: 'b', title: '夏夜' }
      ])
    ).toBe('导入 2 本')
  })

  it('全是重复时不谎报导入成功', () => {
    expect(
      summarizeImport([{ status: 'duplicate', bookId: 'a', title: '河边的月亮' }])
    ).toBe('1 本已在书库里《河边的月亮》')
  })

  it('混合时两段都写出来', () => {
    expect(
      summarizeImport([
        { status: 'imported', bookId: 'a', title: '河边的月亮' },
        { status: 'duplicate', bookId: 'b', title: '夏夜' }
      ])
    ).toBe('导入 1 本，1 本已在书库里《夏夜》')
  })

  it('取消选择时返回空串，界面上什么都不显示', () => {
    expect(summarizeImport([])).toBe('')
  })
})

describe('progressText', () => {
  it('单本不带「第几本」，步数只有一步时用省略号', () => {
    expect(
      progressText({ phase: 'hash', done: 1, total: 1, fileIndex: 0, fileCount: 1, fileName: 'a.epub' })
    ).toBe('校验文件…')
  })

  it('多本带序号，多步带分数', () => {
    expect(
      progressText({ phase: 'extract', done: 4, total: 120, fileIndex: 1, fileCount: 3, fileName: 'b.epub' })
    ).toBe('第 2/3 本 · 解析正文 4/120')
  })
})
```

- [ ] **Step 4: 跑它，确认通过**

Run: `npx vitest run tests/library-shelf.test.ts`

Expected: PASS，9 passed。

- [ ] **Step 5: 多本导入的 IPC 与进度**

`shared/ipc.ts` 的 `CH` 里 `libraryImportPaths` 已在 Task 1 加过，这里不用重复。`API_SHAPE.library` 也不用动。

`electron/main/ipc/library.ts`：

把 `pickAndImport` 那段循环改成带序号：

```ts
  ipcMain.handle(CH.libraryPickAndImport, async (event) => {
    const picked = await dialog.showOpenDialog({
      title: '选择 epub 文件',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'EPUB', extensions: ['epub'] }]
    })
    if (picked.canceled || picked.filePaths.length === 0) return null

    const sender = event.sender as Electron.WebContents
    const outcomes: ImportOutcome[] = []
    for (const [index, filePath] of picked.filePaths.entries()) {
      outcomes.push(await runImport(filePath, sender, { index, count: picked.filePaths.length }))
    }
    return outcomes
  })

  ipcMain.handle(CH.libraryImportPaths, async (event, paths: string[]) => {
    if (paths.length === 0) return []
    const sender = event.sender as Electron.WebContents
    const outcomes: ImportOutcome[] = []
    for (const [index, filePath] of paths.entries()) {
      outcomes.push(await runImport(filePath, sender, { index, count: paths.length }))
    }
    return outcomes
  })
```

把 `runImport` 整份替换成：

```ts
type ImportSlot = { index: number; count: number }

async function runImport(
  filePath: string,
  sender: Electron.WebContents,
  slot: ImportSlot
): Promise<ImportOutcome> {
  if (!filePath.toLowerCase().endsWith('.epub')) {
    throw appError('EPUB_PARSE_FAILED', `${basename(filePath)} 不是 epub 文件`)
  }
  const fileName = basename(filePath)
  try {
    return await importEpub(getDatabase(), filePath, (progress: ImportProgress) => {
      if (sender.isDestroyed()) return
      const event: ImportProgressEvent = {
        ...progress,
        fileIndex: slot.index,
        fileCount: slot.count,
        fileName
      }
      sender.send(CH.libraryImportProgress, event)
    })
  } catch (error) {
    throw toAppError(error, `《${fileName}》导入失败`)
  }
}
```

`@shared/types` 的导入补上 `ImportProgressEvent`（`ImportProgress` 继续保留，`importEpub` 的回调签名用的还是它）。

- [ ] **Step 6: preload 的两个新口子**

`electron/preload/index.ts`：

顶部 import 改成

```ts
import { contextBridge, ipcRenderer, webUtils } from 'electron'
```

`api.library` 里追加：

```ts
    importPaths: (paths: string[]): Promise<ImportOutcome[]> =>
      ipcRenderer.invoke(CH.libraryImportPaths, paths),
    /**
     * 拖进来的 File 对象里没有路径，只有 Electron 的 webUtils 能拿。
     * 它必须跑在 preload，所以这里开一个小口子——只做这一件事，
     * 不把 webUtils 整个暴露出去。
     */
    pathForFile: (file: File): string => webUtils.getPathForFile(file),
```

`onImportProgress` 的监听类型从 `ImportProgress` 换成 `ImportProgressEvent`。

- [ ] **Step 7: 抽出导入流程**

新建 `src/features/library/useImport.ts`：

```ts
import { useCallback, useState } from 'react'
import type { ImportOutcome, ImportProgressEvent } from '@shared/types'
import { readableError } from '@shared/errors'
import { summarizeImport } from './shelf'

/**
 * 选择文件与拖放共用的一条导入路径。
 *
 * 两条入口的差别只有「怎么拿到路径」，进度、提示、忙状态必须完全一样——
 * 分别写一遍的结果通常是拖放那条忘了退订进度事件。
 */
export function useImport(onDone: () => Promise<void> | void) {
  const [progress, setProgress] = useState<ImportProgressEvent | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const run = useCallback(
    async (task: () => Promise<ImportOutcome[] | null>): Promise<void> => {
      setBusy(true)
      setNotice(null)
      const unsubscribe = window.api.library.onImportProgress(setProgress)
      try {
        const outcomes = await task()
        await onDone()
        setNotice(summarizeImport(outcomes ?? []))
      } catch (error) {
        setNotice(readableError(error, '导入没有成功'))
      } finally {
        unsubscribe()
        setProgress(null)
        setBusy(false)
      }
    },
    [onDone]
  )

  return { progress, busy, notice, setNotice, run }
}
```

- [ ] **Step 8: `ImportButton` 变纯展示**

`src/features/library/ImportButton.tsx` 整份替换成：

```tsx
export function ImportButton({ busy, onPick }: { busy: boolean; onPick: () => void }) {
  return (
    <button type="button" className="btn btn--primary" disabled={busy} onClick={onPick}>
      {busy ? '导入中…' : '导入 EPUB'}
    </button>
  )
}
```

进度与错误提示都搬到 `LibraryPage`——那里同时管着拖放，两处的状态必须是一份。

- [ ] **Step 9: 写网格视图**

新建 `src/features/library/BookGrid.tsx`：

```tsx
import type { BookSummary } from '@shared/types'
import { BookCover } from './BookCover'
import { confirmRemove } from './shelf'

/**
 * 网格用 auto-fill 自适应列数（spec §4.5），列宽由 CSS 定，这里只负责结构。
 * 末尾永远留一个拖放终点：它让「拖到书架上」这件事有个明确的目标，
 * 空白区域的虚线框比整页任意位置都能放更好理解。
 */
export function BookGrid({
  books,
  onOpen,
  onRemove
}: {
  books: BookSummary[]
  onOpen: (id: string) => void
  onRemove: (id: string) => void
}) {
  return (
    <ul className="book-grid">
      {books.map((book) => (
        <li key={book.id} className="book-grid__cell">
          <button type="button" className="book-card" onClick={() => onOpen(book.id)}>
            <BookCover book={book} width={132} />
            <span className="book-card__title">{book.title}</span>
            <span className="book-card__meta">{book.author ?? '未知作者'}</span>
          </button>
          <button
            type="button"
            className="book-card__remove"
            onClick={() => {
              if (confirmRemove(book)) onRemove(book.id)
            }}
          >
            删除
          </button>
        </li>
      ))}
      <li className="book-grid__cell book-grid__drop">拖 epub 到这里</li>
    </ul>
  )
}
```

空状态不在这里：`LibraryPage` 要按空/非空切换整块内容（空的时候不该出现拖放终点），交给它判断。

- [ ] **Step 10: 写工具栏**

新建 `src/features/library/LibraryToolbar.tsx`：

```tsx
import { ImportButton } from './ImportButton'
import type { LibraryView } from './shelf'

export function LibraryToolbar({
  view,
  onView,
  busy,
  onPick,
  onManageTags
}: {
  view: LibraryView
  onView: (view: LibraryView) => void
  busy: boolean
  onPick: () => void
  onManageTags: () => void
}) {
  return (
    <div className="library__tools">
      <ImportButton busy={busy} onPick={onPick} />
      <button type="button" className="btn" onClick={onManageTags}>
        标签
      </button>
      <div className="seg" role="group" aria-label="视图">
        {(['grid', 'list'] as const).map((item) => (
          <button
            key={item}
            type="button"
            className={`seg__b${view === item ? ' is-on' : ''}`}
            aria-pressed={view === item}
            onClick={() => onView(item)}
          >
            {item === 'grid' ? '网格' : '列表'}
          </button>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 11: 列表视图接上封面**

`src/features/library/BookList.tsx` 整份替换成（标签 chip 在 Task 4 加，这里先把封面与确认文案接上）：

```tsx
import type { BookSummary } from '@shared/types'
import { BookCover } from './BookCover'
import { confirmRemove } from './shelf'

export function BookList({
  books,
  onOpen,
  onRemove
}: {
  books: BookSummary[]
  onOpen: (id: string) => void
  onRemove: (id: string) => void
}) {
  return (
    <ul className="book-list">
      {books.map((book) => (
        <li key={book.id} className="book-list__item">
          <BookCover book={book} width={40} />
          <button type="button" className="book-list__open" onClick={() => onOpen(book.id)}>
            <span className="book-list__title">{book.title}</span>
            <span className="book-list__meta">
              {book.author ?? '未知作者'} · {book.chapterCount} 章 ·{' '}
              {Math.round(book.totalChars / 1000)}k 字
            </span>
          </button>
          <button type="button" className="btn" onClick={() => onOpen(book.id)}>
            打开
          </button>
          <button
            type="button"
            className="book-list__remove"
            onClick={() => {
              if (confirmRemove(book)) onRemove(book.id)
            }}
          >
            删除
          </button>
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 12: 重写书架页**

`src/pages/LibraryPage.tsx` 整份替换成：

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import type { BookSummary } from '@shared/types'
import { BookGrid } from '../features/library/BookGrid'
import { BookList } from '../features/library/BookList'
import { LibraryToolbar } from '../features/library/LibraryToolbar'
import { progressText, parseView, type LibraryView } from '../features/library/shelf'
import { useImport } from '../features/library/useImport'

export function LibraryPage({ onOpen }: { onOpen: (id: string) => void }) {
  const [books, setBooks] = useState<BookSummary[] | null>(null)
  const [view, setView] = useState<LibraryView>('grid')
  const [dropping, setDropping] = useState(false)
  const dragDepth = useRef(0)

  const refresh = useCallback(async () => {
    setBooks(await window.api.library.list())
  }, [])

  const { progress, busy, notice, setNotice, run } = useImport(refresh)

  useEffect(() => {
    void refresh()
    void window.api.settings.getAll().then((all) => setView(parseView(all['library.view'])))
  }, [refresh])

  /*
   * 必须挡住窗口级的 dragover / drop 默认行为：不挡的话，文件掉进窗口时
   * Chromium 会直接导航到 file://，整个应用界面被替换成那张文件列表。
   */
  useEffect(() => {
    const block = (event: DragEvent): void => event.preventDefault()
    window.addEventListener('dragover', block)
    window.addEventListener('drop', block)
    return () => {
      window.removeEventListener('dragover', block)
      window.removeEventListener('drop', block)
    }
  }, [])

  function pickView(next: LibraryView): void {
    setView(next)
    void window.api.settings.set('library.view', next)
  }

  function onPick(): void {
    void run(() => window.api.library.pickAndImport())
  }

  async function onDrop(event: React.DragEvent<HTMLDivElement>): Promise<void> {
    event.preventDefault()
    dragDepth.current = 0
    setDropping(false)

    const paths = Array.from(event.dataTransfer.files)
      .map((file) => window.api.library.pathForFile(file))
      .filter((path) => path.toLowerCase().endsWith('.epub'))

    if (paths.length === 0) {
      setNotice('拖进来的文件里没有 .epub')
      return
    }
    await run(() => window.api.library.importPaths(paths))
  }

  if (!books) return <div className="page-placeholder">加载中…</div>

  return (
    <div
      className={`library${dropping ? ' library--dropping' : ''}`}
      onDragEnter={(event) => {
        event.preventDefault()
        dragDepth.current += 1
        setDropping(true)
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => {
        // dragleave 会在子元素之间来回冒泡，靠计数判断是不是真的离开了这一页
        dragDepth.current -= 1
        if (dragDepth.current <= 0) setDropping(false)
      }}
      onDrop={(event) => void onDrop(event)}
    >
      <div className="library__head">
        <h1 className="library__title">书架</h1>
        <LibraryToolbar
          view={view}
          onView={pickView}
          busy={busy}
          onPick={onPick}
          onManageTags={() => setNotice('标签管理在下一个 Task 接上')}
        />
      </div>

      <div className="library__status" role="status">
        {progress && <span className="import__progress">{progressText(progress)}</span>}
        {notice && <span className="import__notice">{notice}</span>}
      </div>

      {books.length === 0 ? (
        <p className="library__empty">
          书架还是空的。把 epub 拖进来，或者点「导入 EPUB」——导入的书只保存在这台电脑上，不会上传。
        </p>
      ) : view === 'grid' ? (
        <BookGrid
          books={books}
          onOpen={onOpen}
          onRemove={(id) => void window.api.library.remove(id).then(refresh)}
        />
      ) : (
        <BookList
          books={books}
          onOpen={onOpen}
          onRemove={(id) => void window.api.library.remove(id).then(refresh)}
        />
      )}

      {dropping && <div className="library__dropmask">松手即导入</div>}
    </div>
  )
}
```

`onManageTags` 现在只弹一句提示：标签管理面板是 Task 4 的东西，这一步不留一个点不动的按钮——`useImport` 的 `notice` 已经有一个显示位置，先用它。

- [ ] **Step 13: 补书架样式**

追加到 `src/styles/base.css` 末尾（`.library__head` / `.library__title` / `.library__empty` / `.import__progress` 计划 02 已有，这里只加新的）：

```css
.library--dropping {
  outline: 2px dashed var(--accent-link);
  outline-offset: -8px;
}

.library__tools {
  display: flex;
  align-items: center;
  gap: var(--s2);
}

.library__status {
  display: flex;
  align-items: center;
  gap: var(--s3);
  min-height: 20px;
  margin: calc(var(--s4) * -1) 0 var(--s4);
}

.import__notice {
  font-size: 12px;
  color: var(--ink-muted);
}

.library__dropmask {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--shell) 72%, transparent);
  color: var(--ink-muted);
  font-size: 14px;
  pointer-events: none;
}

.library {
  max-width: none;
}

.book-grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
  gap: var(--s5) var(--s4);
}

.book-grid__cell {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--s3);
}

.book-grid__drop {
  min-height: 220px;
  border: 1px dashed var(--line);
  border-radius: var(--r-md);
  align-items: center;
  justify-content: center;
  color: var(--ink-muted);
  font-size: 12px;
}

.book-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--s2);
  padding: 0;
  background: none;
  border: 0;
  color: inherit;
  cursor: pointer;
  max-width: 100%;
}

.book-card .book-cover {
  transition: transform var(--ease), box-shadow var(--ease);
}

.book-card:hover .book-cover {
  transform: translateY(-2px);
  box-shadow: 0 2px 4px rgba(43, 39, 35, 0.1), 0 12px 24px rgba(43, 39, 35, 0.18);
}

.book-card__title {
  font-size: 13px;
  line-height: 1.4;
  text-align: center;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.book-card:hover .book-card__title {
  color: var(--accent-link);
}

.book-card__meta {
  font-size: 12px;
  color: var(--ink-muted);
}

.book-card__remove {
  font-size: 12px;
  color: var(--ink-muted);
  opacity: 0;
  transition: opacity var(--ease), color var(--ease);
}

.book-grid__cell:hover .book-card__remove {
  opacity: 1;
}

.book-card__remove:hover {
  color: var(--accent-mark);
}

.book-list__item .book-cover {
  border-radius: 2px 3px 3px 2px;
}
```

`.library { max-width: none }` 覆盖计划 02 里的 `max-width: 900px`：网格要按窗口宽度铺开，900px 上限会把列数锁死在四五列。

- [ ] **Step 14: 给夹具加一本带真封面的书**

Task 2 Step 3 留下的问题是：`novelFiles()` 的封面是 `Buffer.from('fake-jpeg-bytes')`，`naturalWidth` 永远是 0，没法验「图真的解码出来了」。给 `fixtures/make-epub.ts` 追加一本封面是**合法 PNG** 的书：

```ts
/**
 * 一张 8×12 的纯色 PNG。刻意手写字节而不是引入图片资源：
 * 它是合法 PNG，浏览器能解出 naturalWidth，用来验「封面真的渲染出来了」。
 */
const PNG_8x12 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAMCAIAAAD8x7XPAAAAF0lEQVR4nGP8z4AATK' +
    'TCUQ5DORwAAM8lB/0Iq8hLAAAAAElFTkSuQmCC',
  'base64'
)

/** 封面能解码的书：网格视图要靠它验真实装帧 */
export function coverBookFiles(): EpubFiles {
  const files = novelFiles()
  files['OEBPS/cover.jpg'] = PNG_8x12
  return files
}
```

`novelFiles()` 里 OPF 声明的 media-type 是 `image/jpeg`，而这里给的是 PNG 字节——浏览器凭 Content-Type 解码，`mimeFor` 按**扩展名**给出的也是 `image/jpeg`。所以不要改扩展名，直接复用 `.jpg`：

Chromium 对 `image/jpeg` 的响应做的是**嗅探解码**，PNG 字节会以 PNG 解出来，`naturalWidth` 是 8。若在某个 Electron 版本上嗅探失效导致 `naturalWidth` 为 0，把上面那行改成让 `novelFiles()` 的 OPF 声明 `image/png` 并把覆盖的文件名写成 `OEBPS/cover.png`。

**里面那串 base64 必须逐字照抄。** 如果不放心，先写这个文件、跑一条断言 `PNG_8x12.subarray(1, 4).toString('ascii') === 'PNG'` 的小检查，确认它真的是 PNG 头。

- [ ] **Step 15: 写书架的端到端测试**

新建 `e2e/library.spec.ts`：

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { coverBookFiles, novelFiles, writeEpub } from '../fixtures/make-epub'
import { launchAppWithUserData } from './helpers'

test('网格/列表切换、封面真实渲染、视图选择重启后还在', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-shelf-'))
  const first = join(userDataDir, 'novel.epub')
  const second = join(userDataDir, 'cover.epub')
  await writeEpub(first, novelFiles())
  await writeEpub(second, coverBookFiles())

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()

  await win.evaluate(
    (paths: string[]) => (window as any).api.library.importPaths(paths),
    [first, second]
  )
  await win.reload()

  // 2 本书 + 末尾那个拖放终点
  await expect(win.locator('.book-grid__cell')).toHaveCount(3)
  const covers = win.locator('.book-cover__img')
  await expect(covers).toHaveCount(2)
  expect(await covers.first().getAttribute('src')).toMatch(/^epub:\/\/[0-9a-f-]{36}\/__cover$/)

  // 图真的解码出来了，而不是坏图
  await expect
    .poll(() => covers.first().evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0)

  await win.getByRole('button', { name: '列表' }).click()
  await expect(win.locator('.book-list__item')).toHaveCount(2)
  await expect(win.locator('.book-grid__cell')).toHaveCount(0)

  await win.getByRole('button', { name: '网格' }).click()
  await expect(win.locator('.book-grid__cell')).toHaveCount(3)

  await win.getByRole('button', { name: '列表' }).click()
  await expect(win.locator('.book-list__item')).toHaveCount(2)

  // 换进程重开：视图选择存在 settings 里，必须还在
  await app.close()
  const again = await launchAppWithUserData(userDataDir)
  const win2 = await again.firstWindow()
  await expect(win2.locator('.book-list__item')).toHaveCount(2)
  await again.close()
})

test('一次多本导入：重复的被跳过，状态行说清楚', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-shelf-multi-'))
  const novel = join(userDataDir, 'novel.epub')
  const other = join(userDataDir, 'other.epub')
  await writeEpub(novel, novelFiles())
  await writeEpub(other, coverBookFiles())

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()

  const outcomes = await win.evaluate(
    (paths: string[]) => (window as any).api.library.importPaths(paths),
    [novel, other, novel, join(userDataDir, 'missing.epub')].filter(
      (p) => !p.endsWith('missing.epub')
    )
  )
  expect(outcomes.map((item: { status: string }) => item.status)).toEqual([
    'imported',
    'imported',
    'duplicate'
  ])

  await win.reload()
  await expect(win.locator('.book-grid__cell')).toHaveCount(3)

  await app.close()
})
```

第二条刻意不把不存在的文件放进列表：`importPaths` 遇到读不到的文件会整批 reject，那样后半段的断言全跑不到。缺文件的行为由计划 02 的错误路径覆盖。

- [ ] **Step 16: 跑测试，确认通过**

Run: `npx tsc --noEmit && npx vitest run && npm run e2e -- e2e/boundary.spec.ts e2e/library.spec.ts e2e/import.spec.ts`

Expected: `tsc` 无输出；vitest 全绿；boundary.spec 1 passed（这是 `API_SHAPE.library` 从 Task 1 攒到现在的总账，`importPaths` / `pathForFile` 必须都在）；library.spec 2 passed；import.spec 仍 passed（它是回归：`listBooks` 加了 `tags` 字段后 `books[0].coverPath` 那些断言不该受影响）。

若 `naturalWidth` 是 0：先看封面那条 `epub://` 请求的状态码（`win.evaluate` 里 `fetch(...).then(r => r.status)`），403 说明 `serveCover` 没拦住、404 说明文件没找到，两个都是 Task 2 的实现问题，不是本 Task 的 UI 问题。

- [ ] **Step 17: Commit**

```bash
git add shared electron/main/ipc electron/preload src fixtures e2e tests/library-shelf.test.ts
git commit -m "feat: 书架网格/列表切换、真实封面渲染、拖放与多本导入（视图选择落设置）"
```

---

### Task 4: 标签 UI：侧栏筛选、列表标签与标签管理

仓储层在 Task 1 就绪，这里把它变成能用的界面。三个落点：

- **侧栏**（spec §4.2 的「上下文列表」）：书架页显示标签列表与计数，点一下就筛。
- **列表视图**：每行显示标签 chip（spec §4.5 明确只要求列表视图显示）。
- **标签管理**：新建、改名、删除。放在工具栏的「标签」按钮后面，不做右键菜单——右键菜单要单独走主进程 `Menu`，为三个动作多开一条 IPC 通道不划算。

标签与筛选状态放在 `App.tsx`：侧栏与书架页是兄弟节点，`LibraryPage` 自己拿不到侧栏。这是唯一合理的提升位置。

**Files:**
- Create: `src/features/library/TagPicker.tsx`, `src/features/library/TagManager.tsx`
- Modify: `src/shell/Sidebar.tsx`, `src/App.tsx`, `src/pages/LibraryPage.tsx`
- Modify: `src/features/library/BookList.tsx`, `src/features/library/LibraryToolbar.tsx`, `src/styles/base.css`
- Create: `e2e/tags-ui.spec.ts`

- [ ] **Step 1: 侧栏加标签列表**

`src/shell/Sidebar.tsx`：把 import 补上 `import type { Tag } from '@shared/types'`，并把组件整体换成：

```tsx
export function Sidebar({
  current,
  onSelect,
  tags,
  tagFilter,
  onPickTag
}: {
  current: PageId
  onSelect: (id: PageId) => void
  /** null 表示当前页面没有上下文列表；空数组是「还没建过标签」 */
  tags?: Tag[] | null
  tagFilter?: number | null
  onPickTag?: (tagId: number | null) => void
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

      {tags ? (
        <div className="sidebar__section">
          <p className="sidebar__heading">标签</p>
          <button
            type="button"
            className={`tag-item${tagFilter === null ? ' tag-item--active' : ''}`}
            onClick={() => onPickTag?.(null)}
          >
            <span className="tag-item__name">全部</span>
          </button>

          {tags.map((tag) => (
            <button
              key={tag.id}
              type="button"
              className={`tag-item${tagFilter === tag.id ? ' tag-item--active' : ''}`}
              onClick={() => onPickTag?.(tag.id)}
            >
              <span className={`tag-dot tag-dot--${tag.color}`} />
              <span className="tag-item__name">{tag.name}</span>
              <span className="tag-item__count">{tag.bookCount}</span>
            </button>
          ))}

          {tags.length === 0 && <p className="sidebar__hint">还没有标签</p>}
        </div>
      ) : null}
    </nav>
  )
}
```

- [ ] **Step 2: 指派浮层**

新建 `src/features/library/TagPicker.tsx`：

```tsx
import { useState } from 'react'
import { readableError } from '@shared/errors'
import type { BookSummary, Tag } from '@shared/types'

/**
 * 单本书的标签指派。用浮层而不是右键菜单：指派本身要能一眼看到「已经打了哪些」，
 * 复选框比菜单里的勾更直白。
 *
 * `mine` 由 props 现算，父组件在每次改动后重新拉列表，所以这里不维护本地副本——
 * 本地副本与真相源两份，迟早会出现「关掉标签后 chip 还在」。
 */
export function TagPicker({
  book,
  tags,
  onChanged,
  onClose
}: {
  book: BookSummary
  tags: Tag[]
  onChanged: () => Promise<void>
  onClose: () => void
}) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const mine = new Set(book.tags.map((tag) => tag.id))

  async function toggle(tag: Tag): Promise<void> {
    setBusy(true)
    try {
      await window.api.library.tagAssign(book.id, tag.id, !mine.has(tag.id))
      await onChanged()
    } catch (e) {
      setError(readableError(e, '标签没有指派成功'))
    } finally {
      setBusy(false)
    }
  }

  async function create(): Promise<void> {
    const name = draft.trim()
    if (!name) return
    setBusy(true)
    try {
      const tag = await window.api.library.tagCreate(name)
      setDraft('')
      setError(null)
      await window.api.library.tagAssign(book.id, tag.id, true)
      await onChanged()
    } catch (e) {
      setError(readableError(e, '标签没有建成'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="tag-picker">
      <p className="tag-picker__title">《{book.title}》的标签</p>

      {tags.length === 0 && <p className="tag-picker__hint">还没有标签，先在下面建一个</p>}

      {tags.map((tag) => (
        <label key={tag.id} className="tag-picker__row">
          <input
            type="checkbox"
            checked={mine.has(tag.id)}
            disabled={busy}
            onChange={() => void toggle(tag)}
          />
          <span className={`tag-dot tag-dot--${tag.color}`} />
          <span className="tag-picker__name">{tag.name}</span>
        </label>
      ))}

      <div className="tag-picker__new">
        <input
          value={draft}
          placeholder="新标签名"
          maxLength={24}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void create()
          }}
        />
        <button type="button" className="btn" disabled={busy || !draft.trim()} onClick={() => void create()}>
          新建并打上
        </button>
      </div>

      {error && <p className="tag-picker__error">{error}</p>}

      <button type="button" className="btn" onClick={onClose}>
        收起
      </button>
    </div>
  )
}
```

- [ ] **Step 3: 标签管理面板**

新建 `src/features/library/TagManager.tsx`：

```tsx
import { useState } from 'react'
import { readableError } from '@shared/errors'
import type { Tag } from '@shared/types'

/**
 * 新建 / 改名 / 删除。
 *
 * 改名是「失焦或回车才提交」：每敲一个字母就发一次 IPC，会让中间态
 * （比如删到只剩一个字）也进库，用户看到的是标签名在闪。
 */
export function TagManager({ tags, onChanged }: { tags: Tag[]; onChanged: () => Promise<void> }) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function guard(action: () => Promise<unknown>, fallback: string): Promise<void> {
    setBusy(true)
    try {
      await action()
      setError(null)
      await onChanged()
    } catch (e) {
      setError(readableError(e, fallback))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="tag-manager">
      <p className="tag-manager__title">标签</p>

      {tags.length === 0 && <p className="tag-manager__hint">还没有标签</p>}

      {tags.map((tag) => (
        <div key={tag.id} className="tag-manager__row">
          <span className={`tag-dot tag-dot--${tag.color}`} />
          <input
            className="tag-manager__name"
            defaultValue={tag.name}
            maxLength={24}
            disabled={busy}
            onBlur={(event) => {
              const next = event.target.value.trim()
              if (!next || next === tag.name) {
                event.target.value = tag.name
                return
              }
              void guard(() => window.api.library.tagRename(tag.id, next), '标签没有改成')
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              if (event.key === 'Escape') {
                event.currentTarget.value = tag.name
                event.currentTarget.blur()
              }
            }}
          />
          <span className="tag-manager__count">{tag.bookCount} 本</span>
          <button
            type="button"
            className="tag-manager__remove"
            disabled={busy}
            onClick={() => {
              // 「书不会一起删」必须说出来，否则没人敢点
              if (window.confirm(`删除标签「${tag.name}」？书不会删，只是不再带这个标签。`)) {
                void guard(() => window.api.library.tagDelete(tag.id), '标签没有删掉')
              }
            }}
          >
            删除
          </button>
        </div>
      ))}

      <div className="tag-manager__new">
        <input
          value={draft}
          placeholder="新标签名"
          maxLength={24}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && draft.trim()) {
              void guard(() => window.api.library.tagCreate(draft.trim()), '标签没有建成').then(() =>
                setDraft('')
              )
            }
          }}
        />
        <button
          type="button"
          className="btn"
          disabled={busy || !draft.trim()}
          onClick={() =>
            void guard(() => window.api.library.tagCreate(draft.trim()), '标签没有建成').then(() =>
              setDraft('')
            )
          }
        >
          新建
        </button>
      </div>

      {error && <p className="tag-manager__error">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 4: 列表视图显示标签**

`src/features/library/BookList.tsx`：把 import 补上 `TagPicker` 与 `Tag`，组件签名与列表项改成：

```tsx
export function BookList({
  books,
  tags,
  onOpen,
  onRemove,
  onTagsChanged
}: {
  books: BookSummary[]
  tags: Tag[]
  onOpen: (id: string) => void
  onRemove: (id: string) => void
  onTagsChanged: () => Promise<void>
}) {
  const [picking, setPicking] = useState<string | null>(null)
```

每个 `<li>` 里，在「打开」按钮之前插入标签区：

```tsx
          <span className="book-list__tags">
            {book.tags.map((tag) => (
              <span key={tag.id} className={`tag-chip tag-chip--${tag.color}`}>
                {tag.name}
              </span>
            ))}
          </span>
          <button
            type="button"
            className="book-list__tag-add"
            aria-expanded={picking === book.id}
            onClick={() => setPicking(picking === book.id ? null : book.id)}
          >
            ＋标签
          </button>
```

并在 `<li>` 的末尾（`</li>` 之前）插入浮层：

```tsx
          {picking === book.id && (
            <>
              <span className="tag-picker__scrim" onClick={() => setPicking(null)} />
              <TagPicker
                book={book}
                tags={tags}
                onChanged={onTagsChanged}
                onClose={() => setPicking(null)}
              />
            </>
          )}
```

文件顶部补 `import { useState } from 'react'`。`book-list__item` 需要 `position: relative`（Step 7 的样式里给了）。

- [ ] **Step 5: 工具栏的标签入口**

`src/features/library/LibraryToolbar.tsx` 把 `onManageTags` 换成受控的开合：

```tsx
export function LibraryToolbar({
  view,
  onView,
  busy,
  onPick,
  managing,
  onToggleTags
}: {
  view: LibraryView
  onView: (view: LibraryView) => void
  busy: boolean
  onPick: () => void
  managing: boolean
  onToggleTags: () => void
}) {
```

并把那个按钮改成：

```tsx
      <button type="button" className="btn" aria-expanded={managing} onClick={onToggleTags}>
        标签
      </button>
```

- [ ] **Step 6: 书架页接上标签**

`src/pages/LibraryPage.tsx`：签名改成

```tsx
export function LibraryPage({
  onOpen,
  tags,
  tagFilter,
  onTagsChanged
}: {
  onOpen: (id: string) => void
  tags: Tag[]
  tagFilter: number | null
  onTagsChanged: () => Promise<void>
}) {
```

`refresh` 带上筛选，并加一个 `syncAll`：

```tsx
  const refresh = useCallback(async () => {
    setBooks(await window.api.library.list(tagFilter))
  }, [tagFilter])

  /** 标签变了要同时刷新两处：侧栏的计数（在 App 里）与列表里的 chip（在这里） */
  const syncAll = useCallback(async () => {
    await onTagsChanged()
    await refresh()
  }, [onTagsChanged, refresh])

  useEffect(() => {
    void refresh()
  }, [refresh])
```

（原来的 `settings.getAll` 那半段保留在同一个 effect 里，只是 `void refresh()` 已经被上面这个 effect 接走，别写两遍。）

`useImport(refresh)` 不变。加一个管理面板的开合：

```tsx
  const [managing, setManaging] = useState(false)
```

`LibraryToolbar` 的调用改成：

```tsx
        <LibraryToolbar
          view={view}
          onView={pickView}
          busy={busy}
          onPick={onPick}
          managing={managing}
          onToggleTags={() => setManaging(!managing)}
        />
```

在 `.library__status` 之后插入面板：

```tsx
      {managing && <TagManager tags={tags} onChanged={syncAll} />}
```

`BookList` 的调用改成：

```tsx
        <BookList
          books={books}
          tags={tags}
          onOpen={onOpen}
          onRemove={(id) => void window.api.library.remove(id).then(refresh)}
          onTagsChanged={syncAll}
        />
```

筛选为空时给一句明确的话，别让人以为书丢了：

```tsx
      {books.length === 0 ? (
        <p className="library__empty">
          {tagFilter === null
            ? '书架还是空的。把 epub 拖进来，或者点「导入 EPUB」——导入的书只保存在这台电脑上，不会上传。'
            : '这个标签下还没有书。'}
        </p>
      ) : view === 'grid' ? (
```

`Tag` 类型从 `@shared/types` 导入。

- [ ] **Step 7: 补标签样式**

追加到 `src/styles/base.css` 末尾：

```css
.sidebar__section {
  margin-top: var(--s5);
  padding-top: var(--s4);
  border-top: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sidebar__heading {
  margin: 0 0 var(--s2);
  padding: 0 var(--s3);
  font-size: 11px;
  letter-spacing: 0.08em;
  color: var(--ink-muted);
}

.sidebar__hint {
  margin: 0;
  padding: 0 var(--s3);
  font-size: 12px;
  color: var(--ink-muted);
}

.tag-item {
  display: flex;
  align-items: center;
  gap: var(--s2);
  width: 100%;
  padding: 6px var(--s3);
  border-radius: var(--r-sm);
  font-size: 13px;
  text-align: left;
  transition: background var(--ease);
}

.tag-item:hover {
  background: var(--hover);
}

.tag-item--active {
  background: var(--active);
}

.tag-item__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tag-item__count {
  font-size: 11px;
  color: var(--ink-muted);
  font-variant-numeric: tabular-nums;
}

.tag-dot {
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.tag-dot--yellow {
  background: var(--hl-yellow);
}
.tag-dot--green {
  background: var(--hl-green);
}
.tag-dot--blue {
  background: var(--hl-blue);
}
.tag-dot--pink {
  background: var(--hl-pink);
}

.tag-chip {
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 11px;
  color: var(--ink);
}

.tag-chip--yellow {
  background: var(--hl-yellow);
}
.tag-chip--green {
  background: var(--hl-green);
}
.tag-chip--blue {
  background: var(--hl-blue);
}
.tag-chip--pink {
  background: var(--hl-pink);
}

.book-list__item {
  position: relative;
}

.book-list__tags {
  display: flex;
  align-items: center;
  gap: var(--s1);
  flex-wrap: wrap;
  max-width: 220px;
}

.book-list__tag-add {
  font-size: 12px;
  color: var(--ink-muted);
  opacity: 0;
  transition: opacity var(--ease), color var(--ease);
}

.book-list__item:hover .book-list__tag-add,
.book-list__tag-add[aria-expanded='true'] {
  opacity: 1;
}

.book-list__tag-add:hover {
  color: var(--accent-link);
}

.tag-picker__scrim {
  position: fixed;
  inset: 0;
  z-index: 4;
}

.tag-picker {
  position: absolute;
  right: var(--s5);
  top: calc(100% - var(--s2));
  z-index: 5;
  width: 260px;
  padding: var(--s4);
  display: flex;
  flex-direction: column;
  gap: var(--s2);
  background: var(--paper-raised);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-pop);
}

.tag-picker__title {
  margin: 0;
  font-size: 12px;
  color: var(--ink-muted);
}

.tag-picker__hint,
.tag-manager__hint {
  margin: 0;
  font-size: 12px;
  color: var(--ink-muted);
}

.tag-picker__row {
  display: flex;
  align-items: center;
  gap: var(--s2);
  font-size: 13px;
  cursor: pointer;
}

.tag-picker__name {
  flex: 1;
  min-width: 0;
}

.tag-picker__new,
.tag-manager__new {
  display: flex;
  align-items: center;
  gap: var(--s2);
}

.tag-picker__new input,
.tag-manager__new input {
  flex: 1;
  min-width: 0;
}

.tag-picker__error,
.tag-manager__error {
  margin: 0;
  font-size: 12px;
  color: var(--accent-mark);
}

.tag-manager {
  margin-bottom: var(--s5);
  padding: var(--s4) var(--s5);
  display: flex;
  flex-direction: column;
  gap: var(--s2);
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
}

.tag-manager__title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}

.tag-manager__row {
  display: flex;
  align-items: center;
  gap: var(--s2);
}

.tag-manager__name {
  flex: 1;
  min-width: 0;
}

.tag-manager__count {
  font-size: 12px;
  color: var(--ink-muted);
  font-variant-numeric: tabular-nums;
}

.tag-manager__remove {
  font-size: 12px;
  color: var(--ink-muted);
}

.tag-manager__remove:hover:not(:disabled) {
  color: var(--accent-mark);
}
```

`input` 与 `select` 的基础样式计划 01 的 `base.css` 里已有（`.settings` 那些规则用的是元素选择器），若发现输入框是浏览器默认外观，把 `select, input[type='text'], input[type='password'], input:not([type])` 的那组规则补进这里——**先跑 Step 8，界面看起来不对再补**。

- [ ] **Step 8: 书架页接上侧栏与状态**

`src/App.tsx` 整份替换成：

```tsx
import { useCallback, useEffect, useState } from 'react'
import type { Tag } from '@shared/types'
import { TitleBar } from './shell/TitleBar'
import { Sidebar, type PageId } from './shell/Sidebar'
import { LibraryPage } from './pages/LibraryPage'
import { NotesPage } from './pages/NotesPage'
import { SettingsPage } from './pages/SettingsPage'
import { ReaderPage } from './features/reader/ReaderPage'
import './styles/base.css'

const TITLES: Record<PageId, string> = {
  library: '书架',
  notes: '笔记',
  settings: '设置'
}

export default function App() {
  const [page, setPage] = useState<PageId>('library')
  const [reading, setReading] = useState<string | null>(null)
  const [tags, setTags] = useState<Tag[]>([])
  const [tagFilter, setTagFilter] = useState<number | null>(null)

  const refreshTags = useCallback(async () => {
    setTags(await window.api.library.tagsList())
  }, [])

  useEffect(() => {
    if (page === 'library' && !reading) void refreshTags()
  }, [page, reading, refreshTags])

  // 正在筛的那个标签被删掉时把筛选退回「全部」，否则列表会一直是空的
  useEffect(() => {
    if (tagFilter !== null && !tags.some((tag) => tag.id === tagFilter)) setTagFilter(null)
  }, [tags, tagFilter])

  // 阅读器是沉浸式全屏（spec §4.1），它自带标题栏与返回入口，不叠在外壳里
  if (reading) return <ReaderPage bookId={reading} onExit={() => setReading(null)} />

  return (
    <div className="app">
      <TitleBar title={TITLES[page]} />
      <div className="body">
        <Sidebar
          current={page}
          onSelect={setPage}
          tags={page === 'library' ? tags : null}
          tagFilter={tagFilter}
          onPickTag={setTagFilter}
        />
        <main className="content">
          {page === 'library' && (
            <LibraryPage
              onOpen={setReading}
              tags={tags}
              tagFilter={tagFilter}
              onTagsChanged={refreshTags}
            />
          )}
          {page === 'notes' && <NotesPage />}
          {page === 'settings' && <SettingsPage />}
        </main>
      </div>
    </div>
  )
}
```

计划 04 把 `reading` 从 `string` 换成了 `ReadingTarget`（笔记页「回到原文」要用）。**照抄计划 04 里那份 `App.tsx` 的 `reading` 相关写法**，本段只补 `tags` / `tagFilter` / `refreshTags` 三处，别把 `ReadingTarget` 改回字符串。若 `NotesPage` 需要 `onOpenAt`，照旧传。

- [ ] **Step 9: 写标签界面的端到端测试**

新建 `e2e/tags-ui.spec.ts`：

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { coverBookFiles, novelFiles, writeEpub } from '../fixtures/make-epub'
import { launchAppWithUserData } from './helpers'

test('标签：侧栏筛选、列表显示、指派浮层、管理面板改名与删除', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-tags-ui-'))
  const novel = join(userDataDir, 'novel.epub')
  const other = join(userDataDir, 'other.epub')
  await writeEpub(novel, novelFiles())
  await writeEpub(other, coverBookFiles())

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()

  const outcomes = await win.evaluate(
    (paths: string[]) => (window as any).api.library.importPaths(paths),
    [novel, other]
  )
  const firstBook = outcomes[0].bookId as string
  await win.reload()

  await expect(win.locator('.sidebar__hint')).toHaveText('还没有标签')

  // 通过管理面板建一个标签
  await win.getByRole('button', { name: '标签' }).click()
  await win.locator('.tag-manager__new input').fill('待读')
  await win.getByRole('button', { name: '新建' }).click()
  await expect(win.locator('.tag-manager__row')).toHaveCount(1)
  await expect(win.locator('.tag-item')).toHaveCount(2) // 「全部」+ 「待读」

  // 指派给第一本书
  await win.getByRole('button', { name: '列表' }).click()
  await expect(win.locator('.book-list__item')).toHaveCount(2)
  await win.locator('.book-list__item').first().getByRole('button', { name: '＋标签' }).click()
  await win.locator('.tag-picker__row input[type=checkbox]').first().check()
  await expect(win.locator('.book-list__item').first().locator('.tag-chip')).toHaveText('待读')

  await expect(win.locator('.tag-item', { hasText: '待读' }).locator('.tag-item__count')).toHaveText('1')

  // 取消指派
  await win.locator('.book-list__item').first().getByRole('button', { name: '＋标签' }).click()
  await win.locator('.tag-picker__row input[type=checkbox]').first().uncheck()
  await expect(win.locator('.book-list__item').first().locator('.tag-chip')).toHaveCount(0)

  // 重新打上，再验侧栏筛选
  await win.locator('.book-list__item').first().getByRole('button', { name: '＋标签' }).click()
  await win.locator('.tag-picker__row input[type=checkbox]').first().check()
  await win.getByRole('button', { name: '收起' }).click()

  await win.locator('.tag-item', { hasText: '待读' }).click()
  await expect(win.locator('.book-list__item')).toHaveCount(1)

  // 在筛选态下删掉标签：筛选要退回「全部」，书一本都不能少
  await win.locator('.tag-manager__row').waitFor({ state: 'detached' }).catch(() => undefined)
  win.on('dialog', (dialog) => void dialog.accept())
  await win.getByRole('button', { name: '标签' }).click()
  await win.locator('.tag-manager__row').getByRole('button', { name: '删除' }).click()

  await expect(win.locator('.tag-item')).toHaveCount(1) // 只剩「全部」
  await expect(win.locator('.book-list__item')).toHaveCount(2)
  expect(await win.evaluate(() => (window as any).api.library.list())).toHaveLength(2)

  await app.close()
})
```

`win.on('dialog', ...)` 必须在点击之前注册（Playwright 默认会自动 dismiss，不接就会把 `confirm` 判成取消）。`waitFor({ state: 'detached' })` 那行是等浮层收起来，`catch` 是为了在它已经收起时不报错——这行也可以直接删掉，删掉后若出现 flake 再加回来。

- [ ] **Step 10: 跑测试，确认通过**

Run: `npx tsc --noEmit && npx vitest run && npm run e2e -- e2e/boundary.spec.ts e2e/tags.spec.ts e2e/tags-ui.spec.ts e2e/notes.spec.ts`

Expected: 全绿，tags-ui 1 passed，notes.spec 仍 passed（回归：`App.tsx` 是它和阅读器共用的文件）。

- [ ] **Step 11: Commit**

```bash
git add src shared e2e/tags-ui.spec.ts
git commit -m "feat: 标签界面（侧栏筛选与计数、列表 chip、指派浮层、新建改名删除）"
```

---

### Task 5: 备份只在真要迁移时做，以及设置页「数据」组的第一半

先修一个已经存在的毛病，再说界面。

计划 01 的 `backupBeforeMigrate` 是**每次启动只要 `db.sqlite` 存在就备份一份**。当时看不出来，等设置页要列「最近 3 份」时就露馅了：那三份全是最近三次启动的快照，跟迁移毫无关系，用户看到的是三个几乎一样的文件、都在今天。spec §6.3 要的是「**迁移前**自动备份」。

改成：打开数据库 → 看有没有待执行的迁移 → 有才备份。同时把复制换成 better-sqlite3 的 `db.backup()`：`journal_mode = WAL` 下直接 `copyFile` 可能漏掉 WAL 里的内容，`backup()` 拿到的是一致性快照。

**Files:**
- Modify: `electron/main/store/migrate.ts`, `tests/migrate.test.ts`
- Modify: `electron/main/store/db.ts`, `electron/main/index.ts`
- Create: `electron/main/data/walk.ts`, `tests/data-walk.test.ts`
- Create: `electron/main/data/backups.ts`, `electron/main/ipc/data.ts`
- Modify: `shared/types.ts`, `shared/ipc.ts`, `electron/main/ipc/index.ts`, `electron/preload/index.ts`
- Create: `e2e/data.spec.ts`

- [ ] **Step 1: 给迁移调度加一个「还差几个」**

`electron/main/store/migrate.ts` 末尾追加（`migrate` 的实现里那段筛选逻辑抽出来共用）：

```ts
/** 还差几个迁移没跑。db.ts 靠它决定「要不要在迁移前备份」——没活干就别备份 */
export function pendingCount(db: MigrationDb, migrations: Migration[]): number {
  const current = Number(db.pragma('user_version', { simple: true }))
  return migrations.filter((migration) => migration.version > current).length
}
```

把 `migrate` 里那行筛选换成 `pendingCount` 的等价写法（保持行为不变，只是不再重复一遍 `filter`）：

```ts
export function migrate(db: MigrationDb, migrations: Migration[]): number {
  const current = Number(db.pragma('user_version', { simple: true }))
  const pending = migrations
    .filter((migration) => migration.version > current)
    .sort((a, b) => a.version - b.version)
  // ...原有循环不动
```
```

上面这一段的骨架如果你更愿意保持原样，就**只加 `pendingCount`，不动 `migrate`**——两者只差一次 `filter`，不值得为它改一行已经通过的代码。选哪种都要保证 `pendingCount(db, migrations)` 与 `migrate` 用的是同一个判断。

- [ ] **Step 2: 写它的测试**

`tests/migrate.test.ts`（文件里已经有了一个假的 `MigrationDb`，`fakeDb(version)` 之类；用同一个假实现，把 `pendingCount` 加进 `../electron/main/store/migrate` 的导入里）追加：

```ts
describe('pendingCount', () => {
  it('全新库：所有迁移都待跑', () => {
    expect(pendingCount(fakeDb(0), LIST)).toBe(3)
  })

  it('已经是最新：一个都不待跑', () => {
    expect(pendingCount(fakeDb(3), LIST)).toBe(0)
  })

  it('版本号有跳号时按「大于当前」计算', () => {
    expect(pendingCount(fakeDb(1), LIST)).toBe(2)
    expect(pendingCount(fakeDb(5), LIST)).toBe(0)
  })
})
```

其中 `LIST` 是三条 `version` 为 1/2/3 的假迁移，照着文件里已有的写法造；`fakeDb` 若名字不同，用文件里那个。

- [ ] **Step 3: 跑它，确认通过**

Run: `npx vitest run tests/migrate.test.ts`

Expected: PASS。

- [ ] **Step 4: 改备份时机**

`electron/main/store/db.ts`：

把 import 补成

```ts
import { mkdirSync, readdirSync, rmSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { migrations } from './migrations'
import { migrate, pendingCount } from './migrate'
```

`openDatabase` 整份替换成：

```ts
let instance: Database.Database | null = null

export async function openDatabase(userDataDir: string): Promise<Database.Database> {
  if (instance) return instance

  const dbPath = join(userDataDir, 'db.sqlite')
  const existed = existsSync(dbPath)

  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  /*
   * 只在「库已经有了、而且确实有待执行的迁移」时备份。
   * 计划 01 原版是「文件存在就备份」，每一次启动都会压一份新快照，
   * 结果是最近的 3 份备份全是今天早上开机留下的，跟迁移没关系。
   */
  if (existed && pendingCount(db, migrations) > 0) {
    await backupBeforeMigrate(db, userDataDir)
  }

  migrate(db, migrations)

  instance = db
  return db
}
```

`backupBeforeMigrate` 整份替换成：

```ts
const KEEP_BACKUPS = 3

/**
 * 迁移前留一份备份，保留最近 3 份（spec §6.3）。
 *
 * 用 `db.backup()` 而不是 `copyFileSync`：WAL 模式下 db.sqlite 之外还有一份
 * `-wal`，直接复制文件可能拿到一个少了最近写入的库。backup() 由 sqlite 在
 * 连接上做一致性快照。
 */
async function backupBeforeMigrate(db: Database.Database, userDataDir: string): Promise<void> {
  const dir = join(userDataDir, 'backups')
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  await db.backup(join(dir, `db-${stamp}.sqlite`))

  const backups = readdirSync(dir)
    .filter((file) => file.startsWith('db-') && file.endsWith('.sqlite'))
    .map((file) => ({ file: join(dir, file), mtime: statSync(join(dir, file)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)

  for (const old of backups.slice(KEEP_BACKUPS)) rmSync(old.file, { force: true })
}
```

`instance` 的声明保持在文件里只有一处（原本在 `openDatabase` 上方，别搬重了）。

- [ ] **Step 5: 主进程改成 await**

`electron/main/index.ts` 里 `app.whenReady().then(() => {` 那段改成：

```ts
  app.whenReady().then(async () => {
    await openDatabase(app.getPath('userData'))
    registerIpc()
    createMainWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })
```

- [ ] **Step 6: 目录占用与文件列举**

新建 `electron/main/data/walk.ts`：

```ts
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export type FileEntry = { name: string; path: string; bytes: number; mtime: number }

/**
 * 递归累加目录占用。目录不存在按 0 算——「还没导入过书」不是错误。
 * 单个文件读不到（权限、刚被删）也按 0 算：占用统计不该让设置页报错。
 */
export function dirBytes(dir: string): number {
  let entries: ReturnType<typeof readdirSync>
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return 0
  }

  let total = 0
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      total += dirBytes(path)
      continue
    }
    try {
      total += statSync(path).size
    } catch {
      // 读不到就按 0 算
    }
  }
  return total
}

/** 列出目录下的文件（不递归），按名字排序，供导出与备份列表用 */
export function listFiles(dir: string): FileEntry[] {
  let entries: ReturnType<typeof readdirSync>
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }

  const files: FileEntry[] = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const path = join(dir, entry.name)
    try {
      const stat = statSync(path)
      files.push({ name: entry.name, path, bytes: stat.size, mtime: stat.mtimeMs })
    } catch {
      // 读不到就跳过
    }
  }
  return files.sort((a, b) => a.name.localeCompare(b.name))
}

/** 只列子目录名。书库的每一层都是「一本书一个目录」 */
export function listDirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
}
```

- [ ] **Step 7: 写它的测试**

新建 `tests/data-walk.test.ts`：

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { dirBytes, listDirs, listFiles } from '../electron/main/data/walk'

function makeTree(): string {
  const root = mkdtempSync(join(tmpdir(), 'book-read-walk-'))
  mkdirSync(join(root, 'library', 'book-a'), { recursive: true })
  mkdirSync(join(root, 'library', 'book-b'), { recursive: true })
  writeFileSync(join(root, 'library', 'book-a', 'book.epub'), 'x'.repeat(100))
  writeFileSync(join(root, 'library', 'book-b', 'cover.jpg'), 'y'.repeat(30))
  writeFileSync(join(root, 'db.sqlite'), 'z'.repeat(10))
  return root
}

describe('dirBytes', () => {
  it('递归累加', () => {
    const root = makeTree()
    expect(dirBytes(join(root, 'library'))).toBe(130)
    expect(dirBytes(root)).toBe(140)
  })

  it('目录不存在按 0 算，不抛错', () => {
    expect(dirBytes('/definitely/not/here')).toBe(0)
  })
})

describe('listFiles', () => {
  it('只列文件、不递归、按名字排序', () => {
    const root = makeTree()
    expect(listFiles(join(root, 'library', 'book-a')).map((f) => f.name)).toEqual(['book.epub'])
    expect(listFiles(join(root, 'library')).map((f) => f.name)).toEqual([])
  })
})

describe('listDirs', () => {
  it('只列子目录', () => {
    const root = makeTree()
    expect(listDirs(join(root, 'library'))).toEqual(['book-a', 'book-b'])
    expect(listDirs(join(root, 'nope'))).toEqual([])
  })
})
```

- [ ] **Step 8: 跑它，确认通过**

Run: `npx vitest run tests/data-walk.test.ts tests/migrate.test.ts`

Expected: 全绿。

- [ ] **Step 9: 追加共享类型与通道**

`shared/types.ts` 末尾追加：

```ts
export type DataStats = {
  userDataDir: string
  dbBytes: number
  libraryBytes: number
  backupBytes: number
  logBytes: number
  bookCount: number
}

export type BackupInfo = {
  name: string
  bytes: number
  createdAt: number
}

export type ExportResult = {
  canceled: boolean
  filePath: string | null
  entries: number
  bytes: number
}

export type CleanupResult = {
  freedBytes: number
  removedLogs: number
}
```

`shared/ipc.ts` 的 `CH` 里追加：

```ts
  dataStats: 'data:stats',
  dataBackups: 'data:backups',
  dataOpenFolder: 'data:openFolder'
```

`API_SHAPE` 追加：

```ts
  data: ['stats', 'backups', 'openFolder', 'exportAll', 'cleanup']
```

（`exportAll` 与 `cleanup` 在 Task 6 落地，所以本 Task 的验证同样只看 `tsc` 与 data.spec 里的前两条——`boundary.spec.ts` 会红到 Task 6。理由与 Task 1 Step 7 相同。）

- [ ] **Step 10: 备份列表**

新建 `electron/main/data/backups.ts`：

```ts
import { join } from 'node:path'
import type { BackupInfo } from '@shared/types'
import { listFiles } from './walk'

/** 备份目录里的 db-*.sqlite，最新的在最前 */
export function listBackups(userDataDir: string): BackupInfo[] {
  return listFiles(join(userDataDir, 'backups'))
    .filter((file) => file.name.startsWith('db-') && file.name.endsWith('.sqlite'))
    .map((file) => ({ name: file.name, bytes: file.bytes, createdAt: file.mtime }))
    .sort((a, b) => b.createdAt - a.createdAt)
}
```

- [ ] **Step 11: 写 data handler**

新建 `electron/main/ipc/data.ts`：

```ts
import { join } from 'node:path'
import { app, ipcMain, shell } from 'electron'
import { CH } from '@shared/ipc'
import { toAppError } from '@shared/errors'
import type { DataStats } from '@shared/types'
import { listBackups } from '../data/backups'
import { dirBytes } from '../data/walk'
import { getDatabase } from '../store/db'

export function registerDataIpc(): void {
  ipcMain.handle(CH.dataStats, () => stats())

  ipcMain.handle(CH.dataBackups, () => listBackups(app.getPath('userData')))

  ipcMain.handle(CH.dataOpenFolder, (_event, kind: 'library' | 'backup' | 'userData', name?: string) => {
    const userData = app.getPath('userData')
    if (kind === 'userData') return shell.openPath(userData)
    if (kind === 'library') return shell.openPath(join(userData, 'library'))
    // name 从渲染进程来，所以按「只允许纯文件名」校验，别让它拼出目录穿越
    if (!name || name !== name.split(/[\\/]/).pop()) return
    shell.showItemInFolder(join(userData, 'backups', name))
  })
}

function stats(): DataStats {
  const userData = app.getPath('userData')
  const db = getDatabase()
  const bookCount = (db.prepare('SELECT COUNT(*) AS n FROM books').get() as { n: number }).n

  return {
    userDataDir: userData,
    dbBytes: dirBytes(join(userData, 'backups')) + fileBytes(join(userData, 'db.sqlite')),
    libraryBytes: dirBytes(join(userData, 'library')),
    backupBytes: dirBytes(join(userData, 'backups')),
    logBytes: dirBytes(join(userData, 'logs')),
    bookCount
  }
}
```

上面 `dbBytes` 那行写错了——`dbBytes` 只该是数据库本身，把 backups 加进去会让界面上「数据库」那一项莫名其妙变大。改成：

```ts
function stats(): DataStats {
  const userData = app.getPath('userData')
  const bookCount = (getDatabase().prepare('SELECT COUNT(*) AS n FROM books').get() as { n: number }).n

  return {
    userDataDir: userData,
    dbBytes: singleFileBytes(join(userData, 'db.sqlite')),
    libraryBytes: dirBytes(join(userData, 'library')),
    backupBytes: dirBytes(join(userData, 'backups')),
    logBytes: dirBytes(join(userData, 'logs')),
    bookCount
  }
}

/** 单个文件的大小；文件不存在按 0 算 */
function singleFileBytes(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}
```

import 里补 `import { statSync } from 'node:fs'`，并把上面那段错的版本整段删掉（别两个 `stats` 都留着）。

- [ ] **Step 12: 注册 handler 与白名单**

`electron/main/ipc/index.ts`：

```ts
import { registerDataIpc } from './data'
import { registerLibraryIpc } from './library'
import { registerNotesIpc } from './notes'
import { registerReaderIpc } from './reader'
import { registerSecretsIpc } from './secrets'
import { registerSettingsIpc } from './settings'

/** 所有 IPC handler 的唯一注册点。新增域时在这里加一行。 */
export function registerIpc(): void {
  registerSettingsIpc()
  registerSecretsIpc()
  registerLibraryIpc()
  registerReaderIpc()
  registerNotesIpc()
  registerDataIpc()
}
```

（AI 那几行照当前文件里的原样保留，别漏。）

`electron/preload/index.ts` 的 `api` 追加（`@shared/types` 导入补上 `BackupInfo`、`DataStats`）：

```ts
  data: {
    stats: (): Promise<DataStats> => ipcRenderer.invoke(CH.dataStats),
    backups: (): Promise<BackupInfo[]> => ipcRenderer.invoke(CH.dataBackups),
    openFolder: (kind: 'library' | 'backup' | 'userData', name?: string): Promise<void> =>
      ipcRenderer.invoke(CH.dataOpenFolder, kind, name)
  },
```

- [ ] **Step 13: 写数据组的端到端测试**

新建 `e2e/data.spec.ts`（本 Task 只写前两条，导出的用例在 Task 6 追加）：

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { novelFiles, writeEpub } from '../fixtures/make-epub'
import { launchAppWithUserData } from './helpers'

test('数据统计：书库占用随导入增长，备份列表反映磁盘上的备份', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-data-'))
  const epubPath = join(userDataDir, 'novel.epub')
  await writeEpub(epubPath, novelFiles())

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()

  const before = await win.evaluate(() => (window as any).api.data.stats())
  expect(before.bookCount).toBe(0)
  expect(before.libraryBytes).toBe(0)
  expect(before.dbBytes).toBeGreaterThan(0)

  await win.evaluate((p: string) => (window as any).api.library.importPath(p), epubPath)

  const after = await win.evaluate(() => (window as any).api.data.stats())
  expect(after.bookCount).toBe(1)
  expect(after.libraryBytes).toBeGreaterThan(0)

  // 没有待执行迁移时不该产生备份：启动两次也还是 0 份
  expect(await win.evaluate(() => (window as any).api.data.backups())).toEqual([])
  await app.close()

  const second = await launchAppWithUserData(userDataDir)
  const win2 = await second.firstWindow()
  expect(await win2.evaluate(() => (window as any).api.data.backups())).toEqual([])
  await second.close()
})

test('备份列表：按时间倒序，界面能显示', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-data-backup-'))
  mkdirSync(join(userDataDir, 'backups'), { recursive: true })
  writeFileSync(join(userDataDir, 'backups', 'db-2026-01-01T00-00-00-000Z.sqlite'), 'old')
  writeFileSync(join(userDataDir, 'backups', 'db-2026-02-01T00-00-00-000Z.sqlite'), 'newer-content')

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()

  const backups = await win.evaluate(() => (window as any).api.data.backups())
  expect(backups).toHaveLength(2)
  expect(backups[0].name).toContain('2026-02-01')
  expect(backups[0].bytes).toBeGreaterThan(backups[1].bytes)

  await app.close()
})
```

第一条后面的「启动两次也没有备份」是这次修正的核心断言：它证明备份不再跟着启动次数走。

- [ ] **Step 14: 跑测试，确认通过**

Run: `npx tsc --noEmit && npx vitest run && npm run e2e -- e2e/settings.spec.ts e2e/import.spec.ts e2e/data.spec.ts`

Expected: 全绿，data.spec 2 passed。settings.spec 与 import.spec 是回归：`openDatabase` 变成 async、备份时机变了，这两条会最先暴露问题。

- [ ] **Step 15: Commit**

```bash
git add shared electron/main electron/preload tests e2e/data.spec.ts
git commit -m "feat: 数据统计与备份列表（备份改为仅在有待执行迁移时做，改用一致性快照）"
```

---

### Task 6: 导出全部数据、清理缓存与设置页「数据」组

导出的关键是**导什么、绝不导什么**：`db.sqlite` 的一致性快照 + `library/**`（每本书的 epub 与封面），**不含 `secrets.json`**（spec §6.3）。备份目录与日志也不进包——它们是这台机器的运行痕迹，不是用户的数据。

「清理缓存」的边界要说清楚：它**不动**用户数据，也**不动**已经花钱算出来的向量（那是钱，spec §5.3 的硬规则）。它做两件事：删日志、`VACUUM` 回收删书之后留在 sqlite 文件里的空洞。

**Files:**
- Modify: `package.json`（yazl 移到 dependencies）
- Create: `electron/main/data/archive.ts`
- Modify: `electron/main/ipc/data.ts`, `shared/ipc.ts`, `electron/preload/index.ts`
- Modify: `src/features/settings/DataSection.tsx`, `src/pages/SettingsPage.tsx`, `src/styles/base.css`
- Modify: `e2e/data.spec.ts`

- [ ] **Step 1: 把 yazl 变成运行期依赖**

```bash
npm i yazl
```

Run: `node -e "const p=require('./package.json'); console.log(p.dependencies.yazl, p.devDependencies.yazl)"`

Expected: 打印出 `^2.x.x undefined`（版本号可能不同）。`dependencies` 里必须有它、`devDependencies` 里必须没有——electron-builder 只把 `dependencies` 打进安装包，留在 devDependencies 里的结果是**开发机上导出正常、装给别人的版本一点导出就报找不到模块**。

`@types/yazl` 继续留在 devDependencies。

- [ ] **Step 2: 写导出**

新建 `electron/main/data/archive.ts`：

```ts
import { createWriteStream, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import yazl from 'yazl'
import { listDirs, listFiles } from './walk'

const README = [
  '这是「书架」导出的一份完整数据。',
  '',
  'db.sqlite                书库、章节、笔记与高亮、AI 结果、阅读进度、设置',
  'library/<bookId>/        每本书的 epub 与封面',
  '',
  '不含 API Key。换一台机器后需要在设置页重新填写密钥。',
  ''
].join('\n')

/**
 * 导出为一个 zip：数据库一致性快照 + library/**（spec §6.3）。
 *
 * 三样东西刻意不进包：
 * - `secrets.json`：换机器要重填 key，这是安全的默认；
 * - `backups/`：那是本机的迁移快照，不是用户的数据；
 * - `logs/`：运行痕迹，且 spec §6.2 的隐私红线要求它只留在本机。
 *
 * 数据库用 `db.backup()` 落到临时文件再打包：WAL 模式下直接读 db.sqlite
 * 可能拿到少了最近写入的版本，而导出必须是一份能开得起来的库。
 */
export async function exportAll(
  db: Database.Database,
  userDataDir: string,
  target: string
): Promise<{ entries: number; bytes: number }> {
  const staging = mkdtempSync(join(tmpdir(), 'book-read-export-'))
  try {
    const snapshot = join(staging, 'db.sqlite')
    await db.backup(snapshot)

    const zip = new yazl.ZipFile()
    const output = createWriteStream(target)
    const finished = new Promise<void>((resolve, reject) => {
      output.on('close', resolve)
      output.on('error', reject)
    })
    zip.outputStream.pipe(output)

    let entries = 0
    zip.addFile(snapshot, 'db.sqlite')
    entries += 1

    const library = join(userDataDir, 'library')
    for (const bookDir of listDirs(library)) {
      for (const file of listFiles(join(library, bookDir))) {
        zip.addFile(file.path, `library/${bookDir}/${file.name}`)
        entries += 1
      }
    }

    zip.addBuffer(Buffer.from(README, 'utf8'), 'README.txt')
    entries += 1

    zip.end()
    await finished

    return { entries, bytes: statSync(target).size }
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

/** zip 内部一律用正斜杠；Windows 上 join 会给反斜杠，所以路径是拼出来的 */
export function zipEntryName(bookDir: string, file: string): string {
  return `library/${bookDir}/${file}`
}

/** 只在这里用一次：确认 library 目录不存在时导出仍然成功（不抛错） */
export function libraryDirs(userDataDir: string): string[] {
  return listDirs(join(userDataDir, 'library'))
}

/** 留一个入口给 e2e 之外的调用方判断有没有可导出的书 */
export function bookDirs(userDataDir: string): number {
  try {
    return readdirSync(join(userDataDir, 'library'), { withFileTypes: true }).filter((e) =>
      e.isDirectory()
    ).length
  } catch {
    return 0
  }
}
```

上面 `zipEntryName` / `libraryDirs` / `bookDirs` 三个导出都是多余的——`exportAll` 已经自己拼了路径，另外两个没人会调。**把它们删掉**，只保留 `README` 与 `exportAll`：

```ts
export async function exportAll(
  db: Database.Database,
  userDataDir: string,
  target: string
): Promise<{ entries: number; bytes: number }> {
  const staging = mkdtempSync(join(tmpdir(), 'book-read-export-'))
  try {
    const snapshot = join(staging, 'db.sqlite')
    await db.backup(snapshot)

    const zip = new yazl.ZipFile()
    const output = createWriteStream(target)
    const finished = new Promise<void>((resolve, reject) => {
      output.on('close', resolve)
      output.on('error', reject)
    })
    zip.outputStream.pipe(output)

    let entries = 0
    zip.addFile(snapshot, 'db.sqlite')
    entries += 1

    const library = join(userDataDir, 'library')
    for (const bookDir of listDirs(library)) {
      for (const file of listFiles(join(library, bookDir))) {
        zip.addFile(file.path, `library/${bookDir}/${file.name}`)
        entries += 1
      }
    }

    zip.addBuffer(Buffer.from(README, 'utf8'), 'README.txt')
    entries += 1

    zip.end()
    await finished

    return { entries, bytes: statSync(target).size }
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}
```

- [ ] **Step 3: 清理缓存**

在 `electron/main/data/archive.ts` 末尾追加（它和导出一样，都是「操作 userData 目录」的事）：

```ts
/**
 * 清理缓存：删日志 + VACUUM 回收删书后留下的空洞。
 *
 * **不动 `chunks.embedding`**：那是用户花钱算出来的向量，spec §5.3 的硬规则是
 * 「花钱的事一律显式」，绝不能混在一个叫「清理缓存」的按钮里被人顺手删掉。
 */
export function cleanup(db: Database.Database, userDataDir: string): {
  freedBytes: number
  removedLogs: number
} {
  const logDir = join(userDataDir, 'logs')
  const before = dirBytes(logDir) + singleFileBytes(join(userDataDir, 'db.sqlite'))
  const removedLogs = listFiles(logDir).length

  rmSync(logDir, { recursive: true, force: true })
  // VACUUM 不能在事务里跑，也不能在打开的 prepared statement 上跑
  db.pragma('wal_checkpoint(TRUNCATE)')
  db.exec('VACUUM')

  const after = singleFileBytes(join(userDataDir, 'db.sqlite'))
  return { freedBytes: Math.max(0, before - after), removedLogs }
}
```

import 补 `import { dirBytes, listDirs, listFiles } from './walk'`，并补一个私有函数：

```ts
function singleFileBytes(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}
```

`ipc/data.ts` 里 Task 5 写过的同名 `singleFileBytes` 与这里重复。**只保留一份**：把 `ipc/data.ts` 里那个删掉，从 `../data/archive` 导入 `singleFileBytes`（把它 export 出去）。哪个文件留都能用，但不要两份都在。

- [ ] **Step 4: 接上 handler**

`shared/ipc.ts` 的 `CH` 里追加：

```ts
  dataExportAll: 'data:exportAll',
  dataCleanup: 'data:cleanup'
```

`electron/main/ipc/data.ts` 里追加两个 handler：

```ts
  ipcMain.handle(CH.dataExportAll, async () => {
    const picked = await dialog.showSaveDialog({
      title: '导出全部数据',
      defaultPath: `书架数据-${new Date().toISOString().slice(0, 10)}.zip`,
      filters: [{ name: 'ZIP', extensions: ['zip'] }]
    })
    if (picked.canceled || !picked.filePath) {
      return { canceled: true, filePath: null, entries: 0, bytes: 0 }
    }

    try {
      const result = await exportAll(getDatabase(), app.getPath('userData'), picked.filePath)
      return { canceled: false, filePath: picked.filePath, ...result }
    } catch (error) {
      throw new Error(toAppError(error, '导出没有成功').message)
    }
  })

  ipcMain.handle(CH.dataCleanup, () => {
    try {
      return cleanup(getDatabase(), app.getPath('userData'))
    } catch (error) {
      throw new Error(toAppError(error, '清理没有成功').message)
    }
  })
```

`dialog` 加进 `electron` 的 import。

`electron/preload/index.ts` 的 `api.data` 追加（类型导入补 `CleanupResult`、`ExportResult`）：

```ts
    exportAll: (): Promise<ExportResult> => ipcRenderer.invoke(CH.dataExportAll),
    cleanup: (): Promise<CleanupResult> => ipcRenderer.invoke(CH.dataCleanup)
```

- [ ] **Step 5: 补导出与清理的 e2e**

`e2e/data.spec.ts` 追加（顶部 import 补 `readZipNames` 用的 yauzl 与 `statSync`）：

```ts
import { open as openZip } from 'yauzl'

/** 用 yauzl 列 zip 里的 entry 名：导出物是给用户拿走的，必须真的能解开 */
function readZipNames(file: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    openZip(file, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error ?? new Error('打不开 zip'))
      const names: string[] = []
      zip.on('entry', (entry) => {
        names.push(entry.fileName)
        zip.readEntry()
      })
      zip.on('end', () => resolve(names))
      zip.on('error', reject)
      zip.readEntry()
    })
  })
}

test('导出全部数据：含 db 与书库，不含密钥与日志', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-export-'))
  const epubPath = join(userDataDir, 'novel.epub')
  await writeEpub(epubPath, novelFiles())
  mkdirSync(join(userDataDir, 'logs'), { recursive: true })
  writeFileSync(join(userDataDir, 'logs', 'app-2026-01-01.log'), 'noise')

  const target = join(userDataDir, 'out.zip')

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()

  await win.evaluate((p: string) => (window as any).api.library.importPath(p), epubPath)
  await win.evaluate(() => (window as any).api.secrets.set('deepseek', 'sk-test-1234567890'))

  await app.evaluate(({ dialog }, file: string) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file, bookmark: '' })
  }, target)

  const result = await win.evaluate(() => (window as any).api.data.exportAll())
  expect(result.canceled).toBe(false)
  expect(result.bytes).toBeGreaterThan(0)

  const names = await readZipNames(target)
  expect(names).toContain('db.sqlite')
  expect(names).toContain('README.txt')
  expect(names.some((name) => name.startsWith('library/') && name.endsWith('book.epub'))).toBe(true)
  expect(names.some((name) => name.includes('secrets.json'))).toBe(false)
  expect(names.some((name) => name.includes('logs/'))).toBe(false)

  await app.close()
})

test('清理缓存：删日志、回收空洞，向量不动', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-cleanup-'))
  mkdirSync(join(userDataDir, 'logs'), { recursive: true })
  writeFileSync(join(userDataDir, 'logs', 'app-2026-01-01.log'), 'x'.repeat(4096))

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()

  const result = await win.evaluate(() => (window as any).api.data.cleanup())
  expect(result.removedLogs).toBe(1)
  expect(existsSync(join(userDataDir, 'logs'))).toBe(false)

  // 库还能用
  expect(await win.evaluate(() => (window as any).api.library.list())).toEqual([])

  await app.close()
})
```

`freedBytes` 不断言具体值：VACUUM 在一张空库上释放的字节数取决于页大小，断言 `> 0` 会在某些机器上偶发为 0。真正要验的是「日志被删了、库还能用」。

- [ ] **Step 6: 写数据组界面**

`src/features/settings/DataSection.tsx` 整份替换成：

```tsx
import { useCallback, useEffect, useState } from 'react'
import { readableError } from '@shared/errors'
import type { BackupInfo, DataStats } from '@shared/types'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString('zh-CN', { hour12: false })
}

export function DataSection() {
  const [stats, setStats] = useState<DataStats | null>(null)
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setStats(await window.api.data.stats())
    setBackups(await window.api.data.backups())
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function exporting(): Promise<void> {
    setBusy(true)
    setNotice(null)
    try {
      const result = await window.api.data.exportAll()
      if (result.canceled) return
      setNotice(`已导出 ${result.entries} 项、${formatBytes(result.bytes)}，不含密钥`)
    } catch (error) {
      setNotice(readableError(error, '导出没有成功'))
    } finally {
      setBusy(false)
    }
  }

  async function cleaning(): Promise<void> {
    if (!window.confirm('清理会删除运行日志，并整理数据库文件。书籍、笔记与阅读进度都不会动。')) {
      return
    }
    setBusy(true)
    setNotice(null)
    try {
      const result = await window.api.data.cleanup()
      setNotice(`清理完成：删除 ${result.removedLogs} 个日志文件，释放 ${formatBytes(result.freedBytes)}`)
      await load()
    } catch (error) {
      setNotice(readableError(error, '清理没有成功'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="settings__group">
      <h2 className="settings__title">数据</h2>
      <p className="settings__hint">
        书库、笔记与阅读进度全部保存在本机。导出数据不包含 API Key，换机器后需要重新填写。
      </p>

      <div className="settings__row">
        <span className="settings__label">书库位置</span>
        <code className="data__path" title={stats?.userDataDir ?? ''}>
          {stats?.userDataDir ?? '加载中…'}
        </code>
        <button
          type="button"
          className="btn"
          onClick={() => void window.api.data.openFolder('library')}
        >
          显示
        </button>
      </div>

      <div className="settings__row">
        <span className="settings__label">占用</span>
        <span className="settings__hint">
          {stats
            ? `${stats.bookCount} 本 · 书籍 ${formatBytes(stats.libraryBytes)} · 数据库 ${formatBytes(stats.dbBytes)} · 备份 ${formatBytes(stats.backupBytes)} · 日志 ${formatBytes(stats.logBytes)}`
            : '统计中…'}
        </span>
      </div>

      <div className="settings__row">
        <span className="settings__label">导出</span>
        <button type="button" className="btn" disabled={busy} onClick={() => void exporting()}>
          导出全部数据
        </button>
      </div>

      <div className="settings__row">
        <span className="settings__label">清理缓存</span>
        <button type="button" className="btn" disabled={busy} onClick={() => void cleaning()}>
          清理
        </button>
        <span className="settings__hint">删日志并整理数据库；书籍、笔记与向量索引都不动</span>
      </div>

      <p className="settings__label data__backups-title">数据库备份</p>
      {backups.length === 0 ? (
        <p className="settings__hint">还没有备份。数据库结构升级前会自动留一份，保留最近 3 份。</p>
      ) : (
        <ul className="data__backups">
          {backups.map((backup) => (
            <li key={backup.name} className="data__backup">
              <span className="data__backup-name">{formatTime(backup.createdAt)}</span>
              <span className="settings__hint">{formatBytes(backup.bytes)}</span>
              <button
                type="button"
                className="btn"
                onClick={() => void window.api.data.openFolder('backup', backup.name)}
              >
                显示
              </button>
            </li>
          ))}
        </ul>
      )}

      {notice && <p className="settings__hint data__notice">{notice}</p>}
    </section>
  )
}
```

- [ ] **Step 7: 补数据组样式**

追加到 `src/styles/base.css` 末尾：

```css
.data__path {
  flex: 1;
  min-width: 0;
  padding: 4px var(--s2);
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
}

.data__backups-title {
  margin-top: var(--s4);
}

.data__backups {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.data__backup {
  display: flex;
  align-items: center;
  gap: var(--s3);
  padding: var(--s2) 0;
  border-bottom: 1px solid var(--line);
}

.data__backup:last-child {
  border-bottom: 0;
}

.data__backup-name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.data__notice {
  color: var(--accent-link);
}
```

`direction: rtl` 是让过长的路径从**尾部**截断（`…/userData` 这半边没信息，`/Users/…/library` 的开头才有），代价是末尾的库名可能被吃掉——所以 `title` 上挂了完整路径。

- [ ] **Step 8: 跑测试，确认通过**

Run: `npx tsc --noEmit && npx vitest run && npm run e2e -- e2e/boundary.spec.ts e2e/data.spec.ts`

Expected: `tsc` 无输出；vitest 全绿；boundary.spec 1 passed（`API_SHAPE.data` 五项到此齐了）；data.spec 4 passed。

若导出报 `Cannot find module 'yazl'`：`out/main/index.js` 是 external 引用的，确认 Step 1 把 yazl 放进了 `dependencies`，并重跑一次 `npm run build`。

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json shared electron src e2e/data.spec.ts
git commit -m "feat: 导出全部数据（不含密钥）、清理缓存与设置页数据组（含备份列表）"
```

---

### Task 7: 「关于」与手动检查更新

spec §7 把「自动更新」列为非目标，改为「关于页显示版本 + 手动检查更新（只读一次 Release 的 latest.json）」。

放在哪里要交代一句：spec §4.1 限定一级页面只有三个，所以**不做第四个页面**，把「关于」做成设置页底部的元信息区块——它不是一组功能设置，但设置页是它唯一合理的落脚点。

更新源还没定，所以 `UPDATE_FEED_URL` 是 `null`：这种情况下按钮**禁用并说明原因**，不是留一个点了没反应的按钮，也不是编一个域名。等有 Release 托管时填上这一行，整套逻辑（含超时、版本比较、四种结果）已经在单元测试里覆盖过了。

**Files:**
- Create: `shared/update.ts`, `tests/update.test.ts`
- Create: `electron/main/update.ts`, `electron/main/ipc/app-info.ts`
- Modify: `shared/ipc.ts`, `electron/main/ipc/index.ts`, `electron/preload/index.ts`
- Create: `src/features/settings/AboutSection.tsx`
- Modify: `src/pages/SettingsPage.tsx`, `src/styles/base.css`
- Create: `e2e/about.spec.ts`

- [ ] **Step 1: 写版本比较与结果判定**

新建 `shared/update.ts`：

```ts
/**
 * 手动检查更新的全部判断都在这里，纯函数、可单测。
 *
 * spec §7：第一期不做自动更新，只读一次 Release 上的 latest.json。
 * 发布渠道还没有定，所以 UPDATE_FEED_URL 先留 null——界面上会把
 * 「没有配置更新源」明说出来（硬规则 2：能力缺失要明说，不静默）。
 * 定好托管之后填上这一行即可，下面的逻辑不用改。
 */
export const UPDATE_FEED_URL: string | null = null

export type FeedPayload = {
  version?: unknown
  url?: unknown
  notes?: unknown
}

export type UpdateVerdict =
  | { kind: 'newer'; current: string; latest: string; url: string | null; notes: string | null }
  | { kind: 'latest'; current: string }
  | { kind: 'unknown'; current: string }

/** `1.2.3` / `v1.2.3` / `1.2` 都能解；解不出来返回 null，不抛错 */
export function parseVersion(value: unknown): number[] | null {
  if (typeof value !== 'string') return null
  const match = /^v?(\d+(?:\.\d+)*)$/.exec(value.trim())
  if (!match) return null
  return match[1]!.split('.').map((part) => Number(part))
}

/** a > b 返回正数，a < b 返回负数，相等返回 0；任一侧解不出来按相等处理 */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (!left || !right) return 0

  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

export function pickUpdate(current: string, payload: FeedPayload): UpdateVerdict {
  const latest = payload.version
  if (typeof latest !== 'string' || !parseVersion(latest)) return { kind: 'unknown', current }

  if (compareVersions(latest, current) <= 0) return { kind: 'latest', current }

  return {
    kind: 'newer',
    current,
    latest,
    url: typeof payload.url === 'string' ? payload.url : null,
    notes: typeof payload.notes === 'string' ? payload.notes : null
  }
}

export const UPDATE_URL_PATTERN = /^https:\/\//
```

`UPDATE_URL_PATTERN` 是一条真实的护栏：`url` 来自远端 json，渲染进程只会用它喂给 `shell.openExternal`。主进程侧要挡一次（Step 4），这里把面量单点定义出来。

- [ ] **Step 2: 写它的测试**

新建 `tests/update.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { compareVersions, parseVersion, pickUpdate } from '../shared/update'

describe('parseVersion', () => {
  it('带不带 v 都行，位数不限', () => {
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3])
    expect(parseVersion('v1.2')).toEqual([1, 2])
    expect(parseVersion('0.1.0')).toEqual([0, 1, 0])
  })

  it('解不出来返回 null，不抛错', () => {
    expect(parseVersion('1.2.3-beta.1')).toBeNull()
    expect(parseVersion('latest')).toBeNull()
    expect(parseVersion(undefined)).toBeNull()
    expect(parseVersion(3)).toBeNull()
  })
})

describe('compareVersions', () => {
  it('逐段比较', () => {
    expect(compareVersions('1.2.3', '1.2.4')).toBeLessThan(0)
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0)
    expect(compareVersions('1.2', '1.2.0')).toBe(0)
    expect(compareVersions('2.0.0', '1.99.99')).toBeGreaterThan(0)
  })

  it('有一侧解不出来就按相等处理，不误报有新版', () => {
    expect(compareVersions('0.1.0', 'nightly')).toBe(0)
  })
})

describe('pickUpdate', () => {
  it('远端更新：带上 url 与说明', () => {
    expect(pickUpdate('0.1.0', { version: '0.2.0', url: 'https://x/y', notes: '修了导入' })).toEqual({
      kind: 'newer',
      current: '0.1.0',
      latest: '0.2.0',
      url: 'https://x/y',
      notes: '修了导入'
    })
  })

  it('同版本或更旧：只说已是最新', () => {
    expect(pickUpdate('0.2.0', { version: '0.2.0' })).toEqual({ kind: 'latest', current: '0.2.0' })
    expect(pickUpdate('0.2.0', { version: '0.1.0' })).toEqual({ kind: 'latest', current: '0.2.0' })
  })

  it('json 里没有能认的版本号：unknown，不谎报', () => {
    expect(pickUpdate('0.1.0', {})).toEqual({ kind: 'unknown', current: '0.1.0' })
    expect(pickUpdate('0.1.0', { version: 'nightly' })).toEqual({ kind: 'unknown', current: '0.1.0' })
  })

  it('url 不是字符串时留 null，界面就不会给出打不开的链接', () => {
    const verdict = pickUpdate('0.1.0', { version: '0.2.0', url: 42 })
    expect(verdict.kind).toBe('newer')
    expect(verdict.kind === 'newer' && verdict.url).toBeNull()
  })
})
```

- [ ] **Step 3: 跑它，确认通过**

Run: `npx vitest run tests/update.test.ts`

Expected: PASS，10 passed。

- [ ] **Step 4: 主进程的检查逻辑**

新建 `electron/main/update.ts`：

```ts
import { app, shell } from 'electron'
import { UPDATE_FEED_URL, UPDATE_URL_PATTERN, pickUpdate, type FeedPayload, type UpdateVerdict } from '@shared/update'

const TIMEOUT_MS = 5000

export type CheckOutcome =
  | { status: 'unconfigured'; current: string }
  | { status: 'offline'; current: string }
  | { status: 'ok'; current: string; verdict: UpdateVerdict }

/**
 * 读一次 latest.json。这个函数**只由用户点按钮触发**——
 * 启动时不检查、后台不轮询（硬规则 1：不许有用户没要求的网络行为）。
 */
export async function checkUpdate(): Promise<CheckOutcome> {
  const current = app.getVersion()
  if (!UPDATE_FEED_URL) return { status: 'unconfigured', current }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(UPDATE_FEED_URL, { signal: controller.signal })
    if (!response.ok) return { status: 'offline', current }
    const payload = (await response.json()) as FeedPayload
    return { status: 'ok', current, verdict: pickUpdate(current, payload) }
  } catch {
    // 断网、超时、json 不合法：对用户都是同一件事——这次没查到
    return { status: 'offline', current }
  } finally {
    clearTimeout(timer)
  }
}

/** 只在 http(s) 且非空时打开；远端 json 里的 url 不能拿来当任意外部打开的输入 */
export function openRelease(url: string): void {
  if (!UPDATE_URL_PATTERN.test(url)) return
  void shell.openExternal(url)
}
```

- [ ] **Step 5: 接上 IPC 与白名单**

`shared/ipc.ts` 的 `CH` 追加：

```ts
  appVersion: 'app:version',
  appCheckUpdate: 'app:checkUpdate',
  appOpenRelease: 'app:openRelease'
```

`API_SHAPE` 追加：

```ts
  app: ['version', 'checkUpdate', 'openRelease']
```

新建 `electron/main/ipc/app-info.ts`：

```ts
import { app, ipcMain } from 'electron'
import { CH } from '@shared/ipc'
import { checkUpdate, openRelease } from '../update'

export function registerAppInfoIpc(): void {
  ipcMain.handle(CH.appVersion, () => app.getVersion())
  ipcMain.handle(CH.appCheckUpdate, () => checkUpdate())
  ipcMain.handle(CH.appOpenRelease, (_event, url: string) => openRelease(url))
}
```

`electron/main/ipc/index.ts` 里加一行 `registerAppInfoIpc()`（import 也补上）。

`electron/preload/index.ts` 的 `api` 追加（类型从 `@shared/update` 导入 `UpdateVerdict`，`CheckOutcome` 是主进程类型、不要从主进程导入——渲染进程只需要一个结构化描述，直接把交叉类型写在这里）：

```ts
  app: {
    version: (): Promise<string> => ipcRenderer.invoke(CH.appVersion),
    checkUpdate: (): Promise<
      | { status: 'unconfigured' | 'offline'; current: string }
      | { status: 'ok'; current: string; verdict: UpdateVerdict }
    > => ipcRenderer.invoke(CH.appCheckUpdate),
    openRelease: (url: string): Promise<void> => ipcRenderer.invoke(CH.appOpenRelease, url)
  },
```

- [ ] **Step 6: 写「关于」区块**

新建 `src/features/settings/AboutSection.tsx`：

```tsx
import { useEffect, useState } from 'react'
import { UPDATE_FEED_URL } from '@shared/update'

type CheckState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'unconfigured'; current: string }
  | { kind: 'offline'; current: string }
  | { kind: 'latest'; current: string }
  | { kind: 'newer'; current: string; latest: string; url: string | null; notes: string | null }
  | { kind: 'unknown'; current: string }

export function AboutSection() {
  const [version, setVersion] = useState<string | null>(null)
  const [state, setState] = useState<CheckState>({ kind: 'idle' })

  useEffect(() => {
    void window.api.app.version().then(setVersion)
  }, [])

  async function check(): Promise<void> {
    setState({ kind: 'checking' })
    try {
      const result = await window.api.app.checkUpdate()
      if (result.status !== 'ok') {
        setState({ kind: result.status, current: result.current })
        return
      }
      setState(result.verdict.kind === 'newer' ? { ...result.verdict } : { kind: result.verdict.kind, current: result.verdict.current })
    } catch {
      setState({ kind: 'offline', current: version ?? '' })
    }
  }

  return (
    <section className="settings__group">
      <h2 className="settings__title">关于</h2>
      <div className="settings__row">
        <span className="settings__label">版本</span>
        <span className="settings__hint">{version ?? '读取中…'}</span>
      </div>

      <div className="settings__row">
        <span className="settings__label">更新</span>
        <button
          type="button"
          className="btn"
          disabled={UPDATE_FEED_URL === null || state.kind === 'checking'}
          onClick={() => void check()}
        >
          {state.kind === 'checking' ? '检查中…' : '检查更新'}
        </button>
        <span className="settings__hint">{describe(state, version)}</span>
      </div>

      {state.kind === 'newer' && state.url && (
        <div className="settings__row">
          <span className="settings__label" />
          <button type="button" className="btn" onClick={() => void window.api.app.openRelease(state.url!)}>
            打开下载页
          </button>
        </div>
      )}
    </section>
  )
}

function describe(state: CheckState, version: string | null): string {
  switch (state.kind) {
    case 'idle':
      return UPDATE_FEED_URL === null
        ? '这个版本没有配置更新源，请手动确认版本'
        : '检查更新只在你点它时才发一次请求'
    case 'checking':
      return '正在读取版本信息…'
    case 'unconfigured':
      return '这个版本没有配置更新源，请手动确认版本'
    case 'offline':
      return '没连上或者请求超时，稍后再试'
    case 'latest':
      return '已经是最新版本'
    case 'newer':
      return `有新版本 ${state.latest}${state.notes ? `：${state.notes}` : ''}`
    case 'unknown':
      return '版本信息读不出来，请手动确认'
  }
}
```

`describe` 的 `version` 参数没有用到，删掉它（保留 `state` 一个参数），并把调用处的 `describe(state, version)` 改成 `describe(state)`。`version` 只在上面显示。

- [ ] **Step 7: 装进设置页**

`src/pages/SettingsPage.tsx` 整份替换成：

```tsx
import { AboutSection } from '../features/settings/AboutSection'
import { DataSection } from '../features/settings/DataSection'
import { ModelSection } from '../features/settings/ModelSection'
import { ReadingSection } from '../features/settings/ReadingSection'

export function SettingsPage() {
  return (
    <div className="settings">
      <ModelSection />
      <ReadingSection />
      <DataSection />
      <AboutSection />
    </div>
  )
}
```

- [ ] **Step 8: 写 e2e**

新建 `e2e/about.spec.ts`：

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchAppWithUserData } from './helpers'

test('关于：版本号常显；没有配置更新源时按钮禁用并说明原因', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-about-'))
  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()

  await win.getByRole('button', { name: '设置' }).click()

  const about = win.locator('.settings__group', { hasText: '关于' })
  await expect(about.locator('.settings__hint').first()).not.toHaveText('读取中…')
  expect(await win.evaluate(() => (window as any).api.app.version())).toMatch(/^\d+\.\d+\.\d+$/)

  const button = about.getByRole('button', { name: '检查更新' })
  await expect(button).toBeDisabled()
  await expect(about).toContainText('没有配置更新源')

  await app.close()
})

test('检查更新只由点击触发：启动后没有任何请求', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-about-nonauto-'))
  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()

  let calls = 0
  await app.evaluate(() => {
    const original = globalThis.fetch
    globalThis.fetch = (...args: Parameters<typeof fetch>) => {
      ;(globalThis as { __probe?: number }).__probe = ((globalThis as { __probe?: number }).__probe ?? 0) + 1
      return original(...args)
    }
  })
  expect(calls).toBe(0)

  await win.getByRole('button', { name: '设置' }).click()
  await win.waitForTimeout(500)

  expect(await app.evaluate(() => (globalThis as any).__probe ?? 0)).toBe(0)

  await app.close()
})
```

第二条是**硬规则 1 的守卫**：启动、切到设置页都不许发网络请求。它比第一章更值钱——一旦以后有人在 `App` 里加了「启动时静默检查更新」，这条会立刻红。

- [ ] **Step 9: 跑测试，确认通过**

Run: `npx tsc --noEmit && npx vitest run && npm run e2e -- e2e/boundary.spec.ts e2e/about.spec.ts e2e/settings.spec.ts`

Expected: 全绿，about.spec 2 passed。

- [ ] **Step 10: Commit**

```bash
git add shared electron src tests/update.test.ts e2e/about.spec.ts
git commit -m "feat: 关于区块与手动检查更新（版本比较可单测，未配置更新源时明说而非静默）"
```

---

### Task 8: 打包给别人用

到这一步应用功能完整了，剩下的是**让别人的电脑打得开**。spec §6.5 要的是：macOS dmg（arm64 + x64，签名 + 公证）+ Windows nsis，且首次启动不联网、不需要登录。

这一段最容易被写成「跑个 electron-builder 就完了」，但真正的坑有三个：原生模块（better-sqlite3）必须解出 asar、epub 抽取 worker 必须能被加载、以及**没有 Apple 开发者证书时产物只能自己用**。三个都在这一个 Task 里处理，并把不可自动化的部分写成手动验收清单。

**Files:**
- Create: `electron-builder.yml`, `build/entitlements.mac.plist`
- Modify: `package.json`

- [ ] **Step 1: 写打包配置**

新建 `electron-builder.yml`：

```yaml
appId: com.bookread.app
productName: 书架
copyright: Copyright © 2026

directories:
  output: dist
  buildResources: build

# 只打构建产物与 package.json；源码目录不进包
files:
  - out/**/*
  - package.json

asar: true

# better-sqlite3 的 .node 与 epub 抽取 worker 都不能留在 asar 里：
# 前者是原生二进制（dlopen 不认识 asar 虚拟路径），后者要被 worker_threads 加载
asarUnpack:
  - '**/*.node'
  - out/main/epub-worker.js

mac:
  category: public.app-category.books
  target:
    - target: dmg
      arch:
        - arm64
        - x64
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
  # 有 Apple Developer 账号后改成 true，并设好 APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID
  notarize: false

dmg:
  title: 书架 ${version}

win:
  target:
    - target: nsis
      arch:
        - x64

nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
```

- [ ] **Step 2: 写 entitlements**

新建 `build/entitlements.mac.plist`：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <!-- Electron 的 V8 需要 JIT 与可写可执行内存，加固运行时下必须显式声明 -->
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <!-- 书库在 userData 下，不需要额外沙箱豁免；不声明也就不会多要权限 -->
</dict>
</plist>
```

- [ ] **Step 3: 加脚本**

`package.json` 的 `scripts` 追加：

```json
    "dist:mac": "npm run build && electron-builder --mac",
    "dist:win": "npm run build && electron-builder --win",
    "dist:dir": "npm run build && electron-builder --dir"
```

`dist:dir` 是这一段的验证主入口：它只产出解包后的 `.app`，不签名、不做 dmg，速度最快，用来验证「包起来能不能跑」。

- [ ] **Step 4: 先跑一次目录打包**

Run: `npm run dist:dir`

Expected: 结束时 `dist/mac-arm64/书架.app`（Intel 机器上是 `dist/mac/书架.app`）存在。命令会有几行警告：没有图标（用 Electron 默认图标）、没有签名。**这两条警告在这一步是预期的**，不要为了消掉它们去造一个图标文件。

- [ ] **Step 5: 手动验一次打包后的应用**

这是本计划唯一没法自动化的验证，必须手做一次：

```bash
open "dist/mac-arm64/书架.app"
```

Expected，逐条确认：

1. 窗口能打开，书架页正常渲染（说明 renderer 的静态资源进了包）。
2. 拖一本 epub 进去能导入成功，进度文案出现（说明 **epub 抽取 worker 在 asar 外能被加载**）。
3. 打开那本书能翻页（说明 `epub://` 协议与 `yauzl` 都在）。
4. 划词能建高亮（说明 `better-sqlite3` 的原生二进制解包正确）。
5. 设置 → 数据 → 「书库位置」显示的是 `~/Library/Application Support/书架/library`，不是开发目录。

任一条失败时先看 `~/Library/Logs/书架/main.log`（Electron 的默认日志位置）。最可能需要回退的是第 2 条：若报「找不到 worker」或 worker 报路径不存在，把 `electron-builder.yml` 里 `asarUnpack` 的 worker 那一行改成 `out/main/**`，让整个 main 产物都解包；这比在代码里判断 `app.asar.unpacked` 路径更省事，代价只是包大一点。

- [ ] **Step 6: 打真正的 dmg**

Run: `npm run dist:mac`

Expected: `dist/书架-0.1.0-arm64.dmg` 与 `dist/书架-0.1.0-x64.dmg` 都产出。

把 dmg 拿给**另一台 Mac**（或本机另一个用户）打开，会看到 Gatekeeper 的拦截提示——这是没签名的必然结果，不是打包配错了。这一条要如实告诉使用者：

> 未签名的 dmg 首次打开会被 Gatekeeper 拦住。自己用可以右键「打开」放行；要给别人用，必须有 Apple Developer Program 账号（99 USD/年），拿到 Developer ID 后设置环境变量 `CSC_LINK` / `CSC_KEY_PASSWORD` 并把 `notarize` 改成 `true`，公证通过后用户双击即可打开。

Windows 侧同理：在 Windows 机器上跑 `npm run dist:win` 产出 nsis 安装包；未签名时 SmartScreen 会警告。**macOS 上打不出可用的 Windows 包**（要 wine），这一步必须在 Windows 机器上前行验证。

- [ ] **Step 7: 手动验收清单**

对着 spec §6.7 逐条走一遍，这些事自动化测试覆盖不到（真实网络、真实系统钥匙串、真机滚动）：

| # | 场景 | 期望 |
|---|---|---|
| 1 | 断网状态下导入、阅读、划词、写笔记、看笔记页 | 全部正常；只有 AI 相关操作提示离线 |
| 2 | 阅读到一半强杀进程（活动监视器结束进程），重开 | 阅读位置与全部笔记零丢失 |
| 3 | 导入一本畸形 epub（缺 OPF） | 弹出可读的中文错误，书架上不留半本书，`library/` 下没有残留目录 |
| 4 | 没填 key 时点「问 AI」 | 明确引导到设置页，没有英文报错 |
| 5 | AI 回答过程中切章 | 请求中断，无残留（`~/Library/Logs/书架/main.log` 里能看到 abort） |
| 6 | 拖 10 本 epub 一起进来 | 进度显示「第 n/10 本」，重复的自动跳过，结束有一句汇总 |
| 7 | 建 500 本规模的书库（可以复制同一本书的 epub 改 hash 造数据） | 书架滚动流畅，封面只在滚到可见时才请求 |
| 8 | 设置页导出全部数据，用系统解压打开 | 能解开，有 db.sqlite 与 library/，**没有** secrets.json |

第 7 条做不到 500 本也不要跳过：至少造 50 本，确认网格的 `auto-fill` 在窗口拉到 2560px 宽时列数确实增加、拉到 900px 时不出现横向滚动条。

- [ ] **Step 8: Commit**

```bash
git add electron-builder.yml build package.json
git commit -m "chore: electron-builder 打包配置（mac dmg 双架构 + win nsis，原生模块与 worker 解包）"
```

---

## Self-Review

**1. Spec coverage**

| Spec 章节 | 落在哪 |
|---|---|
| §2.2 `tags` / `book_tags` | 迁移 v2 已建（计划 02），本计划 Task 1 是它第一个使用方 |
| §4.5 网格 / 列表可切换、`auto-fill` 自适应列数 | Task 3 Step 9 / Step 13 |
| §4.5 封面按真实装帧渲染（投影 + 书脊） | Task 2（`epub://` 虚拟 entry + `BookCover`） |
| §4.5 网格末尾是拖放终点、支持一次拖入多本 | Task 3 Step 9 / Step 12 / Step 15 |
| §4.5 空状态明说「只保存在本机」 | Task 3 Step 12 |
| §4.5 侧栏按标签筛选、列表视图显示标签 | Task 4（Sidebar + `book-list__tags`） |
| §4.6 数据组：书库位置与占用 | Task 5（`data:stats`）+ Task 6 Step 6 |
| §4.6 数据组：导出全部数据（不含密钥） | Task 6（`data:exportAll` + zip 断言） |
| §4.6 数据组：数据库备份列表（最近 3 份） | Task 5（`listBackups` + `KEEP_BACKUPS = 3`） |
| §4.6 数据组：清理缓存 | Task 6 Step 3 / Step 6，明确不删向量索引 |
| §6.3 导出 zip 不含 `secrets.json` | Task 6 Step 2 + Step 5 的 e2e 断言 |
| §6.3 迁移前自动备份、保留 3 份 | Task 5 Step 1–4（修正了「每次启动都备份」） |
| §6.3 删书级联 + 二次确认明说笔记一起删 | Task 3 `confirmRemove`（计划 02 已有级联删除） |
| §6.5 electron-builder → mac dmg（arm64+x64，签名+公证）/ win nsis | Task 8 |
| §6.5 首次启动不联网、不需要登录 | Task 8 Step 5 + Task 7 Step 8 的「启动后零请求」e2e |
| §6.6 书库 ≤ 500 本、封面懒加载 | Task 2 Step 7（`loading="lazy"`）+ Task 8 Step 7 第 7 条 |
| §6.7 验收标准 1–5 | Task 8 Step 7 的手动清单逐条对应 |
| §7 「关于」页显示版本 + 手动检查更新 | Task 7（作为设置页底部区块，理由见该 Task 开头） |

**2. 占位符扫描**

```bash
grep -nE "TBD|TODO|待补|待定|类似 Task|加上适当的|此处省略|先这样" docs/superpowers/plans/2026-09-29-06-library-and-packaging.md
```

Expected: 只有本段自己这一行命令命中（它包含这些词），没有真实占位。

另外两处「看起来像占位、其实是真实决定」的东西，这里明确记下来，免得被当成缺口：

- `UPDATE_FEED_URL = null`（Task 7）：不是忘了填，是发布渠道未定。行为已定义——按钮禁用 + 界面说明，且 `pickUpdate` 等纯逻辑有 10 条单测覆盖。
- `notarize: false`（Task 8）：不是没配，是没有 Apple 开发者账号。配置里写清了改成 `true` 需要设的三个环境变量。

**3. 命名与类型一致性**

1. `ImportProgress`（计划 02，`phase/done/total`）与 `ImportProgressEvent`（本计划 Task 3，多 `fileIndex/fileCount/fileName`）：`importEpub` 的回调仍用前者，只有 IPC 推送用后者。两者都不改名。
2. `BookSummary.tags` 是**必填**数组：`listBooks` 在 `BookRow`（`Omit<BookSummary,'tags'>`）上贴完标签再返回。若写成可选，网格与列表都要写 `book.tags ?? []`，两处迟早漏一处。
3. `Tag` = `BookTag & { bookCount: number }`：`tagsByBook` 返回 `BookTag`（不带计数），`listTags` 返回 `Tag`。`TagPicker` 收 `Tag[]` 但只读 `id/name/color`。
4. `toIpcError`（计划 04，`ipc/notes.ts`）/ `toReadable`（计划 05，`ipc/ai.ts`）/ `fail`（本计划，`ipc/library.ts`）是同一个东西的三份实现。本计划**只新增第三份，不合并**——合并要动两份已经通过测试的文件，收益是少 6 行代码，不值得。函数名与语义保持一致（都走 `toAppError(...).message`）。
5. `EPUB_SCHEME` 只有一处定义（`shared/epub.ts`），`electron/main/epub/epub-url.ts` 转出它。`tests/epub-url.test.ts` 的导入路径不变。
6. `COVER_ENTRY = '__cover'` 与 `coverUrl()` 同源在 `shared/epub.ts`：主进程用它判断、渲染进程用它拼 URL，没有第二处字面量。
7. `singleFileBytes` 在 `data/archive.ts` 与 `ipc/data.ts` 各被写过一次（Task 6 Step 3 明确指出只留一份）。落地时以 `archive.ts` 导出、`ipc/data.ts` 导入为准。
8. `readableError` 在 `shared/errors.ts`，与主进程侧的 `toAppError` 成对：一个管「归一化成什么」，一个管「显示成什么」。所有新界面用它，不要再用 `e.message`。
9. `KEEP_BACKUPS = 3` 仍是 3，且只在 `db.ts` 里定义一次。
10. `data:*` 五个方法与 `API_SHAPE.data` 一一对应：`stats` / `backups` / `openFolder`（Task 5）与 `exportAll` / `cleanup`（Task 6）。中间那一档 `boundary.spec.ts` 会红，Task 6 Step 8 绿。

---

## Execution Handoff

计划完成，两种执行方式：

**1. Subagent-Driven（推荐）**

本计划的重活是 Task 3（重写 `LibraryPage`，同时改了 `App` 之外的全部书架文件）、Task 5（动了 `openDatabase` 的签名与启动链路）与 Task 8（打包配置 + 手动验收）。Task 5 尤其值得单独交给一个 subagent：它会让 `settings.spec.ts` 与 `import.spec.ts` 这两条既有测试变成回归哨兵。

每个 Task 开一个新的 subagent，把 Task 全文丢给它，要求它：

- 严格按 Step 顺序执行，不跳过「跑它，确认失败」这一步；
- 每步的 `Run:` 必须真的跑，把输出贴回来；
- 遇到与计划不符的既有代码（比如计划 04 的 `App.tsx` 写法有出入）以仓库现状为准，并在汇报里说明；
- 结束时**一个 commit**，提交信息用 Task 末尾给的那条。

**2. Inline Execution**

在当前会话里逐个 Task 执行。适合先自己走一遍 Task 1（标签仓储）——它是纯新增，风险最低，能先把 `tags` 表的实际形状摸清楚。

**两个前置条件**

- git 身份已配置（见本文开头）；
- 计划 01–05 全部执行完毕且 `npx vitest run` 与 `npm run e2e` 全绿。本计划大量改动既有文件（`repo.ts` / `epub-url.ts` / `db.ts` / `migrate.ts` / `App.tsx` / `preload/index.ts`），在一个红的基线上开工，出问题时无法判断是谁弄红的。

