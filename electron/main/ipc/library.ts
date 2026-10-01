import { rmSync } from 'node:fs'
import { basename } from 'node:path'
import { dialog, ipcMain } from 'electron'
import { CH } from '@shared/ipc'
import type { ImportOutcome, ImportProgress, IpcResult } from '@shared/types'
import { appError, toAppError } from '@shared/errors'
import { importEpub } from '../library/importer'
import { bookDir } from '../library/paths'
import { deleteBookRows, listBooks, listChapters, searchChunks } from '../library/repo'
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

        const outcomes: ImportOutcome[] = []
        for (const filePath of picked.filePaths) {
          outcomes.push(await runImport(filePath, event.sender as Electron.WebContents))
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
        return { ok: true, value: await runImport(filePath, event.sender as Electron.WebContents) }
      } catch (error) {
        return { ok: false, error: toAppError(error, '导入失败') }
      }
    }
  )

  ipcMain.handle(CH.libraryList, () => listBooks(getDatabase()))

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

async function runImport(filePath: string, sender: Electron.WebContents): Promise<ImportOutcome> {
  if (!filePath.toLowerCase().endsWith('.epub')) {
    throw appError('EPUB_PARSE_FAILED', `${basename(filePath)} 不是 epub 文件`)
  }
  try {
    return await importEpub(getDatabase(), filePath, (progress: ImportProgress) => {
      if (!sender.isDestroyed()) sender.send(CH.libraryImportProgress, progress)
    })
  } catch (error) {
    throw toAppError(error, '导入失败')
  }
}
