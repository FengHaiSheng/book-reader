import { join } from 'node:path'
import { app, dialog, ipcMain, shell } from 'electron'
import { CH } from '@shared/ipc'
import { toAppError } from '@shared/errors'
import type { CleanupResult, DataStats, ExportResult, ImportAllResult } from '@shared/types'
import { cleanup, exportAll } from '../data/archive'
import { listBackups } from '../data/backups'
import { importAll } from '../data/restore'
import { dirBytes, singleFileBytes } from '../data/walk'
import { getDatabase } from '../store/db'

export function registerDataIpc(): void {
  ipcMain.handle(CH.dataStats, () => stats())

  ipcMain.handle(CH.dataBackups, () => listBackups(app.getPath('userData')))

  ipcMain.handle(
    CH.dataOpenFolder,
    (_event, kind: 'library' | 'backup' | 'userData', name?: string): Promise<string> => {
      const userData = app.getPath('userData')
      if (kind === 'backup') {
        // name 从渲染进程来，所以按「只允许纯文件名」校验，别让它拼出目录穿越
        if (!name || name !== name.split(/[\\/]/).pop()) return Promise.resolve('')
        shell.showItemInFolder(join(userData, 'backups', name))
        return Promise.resolve('')
      }
      return shell.openPath(kind === 'library' ? join(userData, 'library') : userData)
    }
  )

  ipcMain.handle(CH.dataExportAll, async (): Promise<ExportResult> => {
    const picked = await dialog.showSaveDialog({
      title: '导出全部数据',
      defaultPath: `阅微数据-${new Date().toISOString().slice(0, 10)}.zip`,
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

  ipcMain.handle(CH.dataImportAll, async (): Promise<ImportAllResult> => {
    const picked = await dialog.showOpenDialog({
      title: '导入全部数据',
      properties: ['openFile'],
      filters: [{ name: 'ZIP', extensions: ['zip'] }]
    })
    if (picked.canceled || !picked.filePaths[0]) {
      return { canceled: true, bookCount: 0, entries: 0, bytes: 0 }
    }

    try {
      const result = await importAll(app.getPath('userData'), picked.filePaths[0])
      return { canceled: false, ...result }
    } catch (error) {
      throw new Error(toAppError(error, '导入没有成功').message)
    }
  })

  ipcMain.handle(CH.dataCleanup, (): CleanupResult => {
    try {
      return cleanup(getDatabase(), app.getPath('userData'))
    } catch (error) {
      throw new Error(toAppError(error, '清理没有成功').message)
    }
  })
}

function stats(): DataStats {
  const userData = app.getPath('userData')
  const bookCount = (
    getDatabase().prepare('SELECT COUNT(*) AS n FROM books').get() as { n: number }
  ).n

  return {
    userDataDir: userData,
    dbBytes: singleFileBytes(join(userData, 'db.sqlite')),
    libraryBytes: dirBytes(join(userData, 'library')),
    backupBytes: dirBytes(join(userData, 'backups')),
    logBytes: dirBytes(join(userData, 'logs')),
    bookCount
  }
}
