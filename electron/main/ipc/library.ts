import { readdirSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { dialog, ipcMain } from 'electron'
import { CH } from '@shared/ipc'
import type { ImportOutcome, ImportProgress, ImportProgressEvent, IpcResult } from '@shared/types'
import { appError, toAppError } from '@shared/errors'
import { assignTag, createTag, deleteTag, listTags, renameTag } from '../library/tags'
import { importEpub } from '../library/importer'
import { bookDir } from '../library/paths'
import { deleteBookRows, libraryStats, listBooks, listChapters, searchChunks } from '../library/repo'
import { getDatabase } from '../store/db'

export function registerLibraryIpc(): void {
  // 导入类调用用结果信封回传错误：Electron 会给 throw 出去的错误套上英文前缀，
  // 中文提示会被埋进 "Error invoking remote method '...'" 里，界面没法直接展示。
  ipcMain.handle(
    CH.libraryPickAndImport,
    async (event): Promise<IpcResult<ImportOutcome[] | null>> => {
      try {
        const picked = await dialog.showOpenDialog({
          title: '选择 epub 文件',
          properties: ['openFile', 'multiSelections'],
          filters: [{ name: 'EPUB', extensions: ['epub'] }]
        })
        if (picked.canceled || picked.filePaths.length === 0) return { ok: true, value: null }

        const sender = event.sender as Electron.WebContents
        const outcomes: ImportOutcome[] = []
        for (const [index, filePath] of picked.filePaths.entries()) {
          outcomes.push(await runImport(filePath, sender, { index, count: picked.filePaths.length }))
        }
        return { ok: true, value: outcomes }
      } catch (error) {
        return { ok: false, error: toAppError(error, '导入失败') }
      }
    }
  )

  ipcMain.handle(
    CH.libraryPickFolder,
    async (event): Promise<IpcResult<ImportOutcome[] | null>> => {
      try {
        const picked = await dialog.showOpenDialog({
          title: '从文件夹导入',
          properties: ['openDirectory']
        })
        if (picked.canceled || picked.filePaths.length === 0) return { ok: true, value: null }

        const dir = picked.filePaths[0]!
        const paths = readdirSync(dir)
          .filter((name) => name.toLowerCase().endsWith('.epub'))
          .sort()
          .map((name) => join(dir, name))
        // 空文件夹不是「导入成功 0 本」：要让用户知道这个文件夹里没有 epub
        if (paths.length === 0) {
          throw appError('FILE_MISSING', '这个文件夹里没有 epub 文件')
        }

        const sender = event.sender as Electron.WebContents
        const outcomes: ImportOutcome[] = []
        for (const [index, filePath] of paths.entries()) {
          outcomes.push(await runImport(filePath, sender, { index, count: paths.length }))
        }
        return { ok: true, value: outcomes }
      } catch (error) {
        return { ok: false, error: toAppError(error, '导入失败') }
      }
    }
  )

  ipcMain.handle(
    CH.libraryImportPath,
    async (event, filePath: string): Promise<IpcResult<ImportOutcome>> => {
      try {
        return {
          ok: true,
          value: await runImport(filePath, event.sender as Electron.WebContents, { index: 0, count: 1 })
        }
      } catch (error) {
        return { ok: false, error: toAppError(error, '导入失败') }
      }
    }
  )

  ipcMain.handle(
    CH.libraryImportPaths,
    async (event, paths: string[]): Promise<IpcResult<ImportOutcome[]>> => {
      try {
        if (paths.length === 0) return { ok: true, value: [] }
        const sender = event.sender as Electron.WebContents
        const outcomes: ImportOutcome[] = []
        for (const [index, filePath] of paths.entries()) {
          outcomes.push(await runImport(filePath, sender, { index, count: paths.length }))
        }
        return { ok: true, value: outcomes }
      } catch (error) {
        return { ok: false, error: toAppError(error, '导入失败') }
      }
    }
  )

  ipcMain.handle(CH.libraryList, (_event, tagId?: number | null) =>
    listBooks(getDatabase(), tagId ?? null)
  )

  ipcMain.handle(CH.libraryStats, () => libraryStats(getDatabase()))

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

  ipcMain.handle(CH.libraryChapters, (_event, bookId: string) => listChapters(getDatabase(), bookId))

  ipcMain.handle(CH.librarySearch, (_event, bookId: string, query: string, limit?: number) =>
    searchChunks(getDatabase(), bookId, query, limit)
  )

  ipcMain.handle(CH.libraryRemove, (_event, bookId: string) => {
    const db = getDatabase()
    db.transaction(() => deleteBookRows(db, bookId))()
    rmSync(bookDir(bookId), { recursive: true, force: true })
  })
}

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
