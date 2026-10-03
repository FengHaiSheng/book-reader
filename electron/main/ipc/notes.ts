import { writeFile } from 'node:fs/promises'
import { dialog, ipcMain } from 'electron'
import { CH } from '@shared/ipc'
import { toAppError } from '@shared/errors'
import type {
  HighlightInput,
  HighlightPatch,
  NotesExportOptions,
  NotesExportResult
} from '@shared/types'
import {
  createHighlight,
  deleteHighlight,
  highlightContext,
  listAllHighlights,
  listChapterHighlights,
  updateHighlight
} from '../notes/repo'
import { fileStamp, previewExport } from '../notes/export'
import { getDatabase } from '../store/db'

export function registerNotesIpc(): void {
  ipcMain.handle(CH.notesListChapter, (_event, bookId: string, chapterId: number) =>
    listChapterHighlights(getDatabase(), bookId, chapterId)
  )

  ipcMain.handle(CH.notesListAll, () => listAllHighlights(getDatabase()))

  ipcMain.handle(CH.notesCreate, (_event, input: HighlightInput) => {
    try {
      return createHighlight(getDatabase(), input, Date.now())
    } catch (error) {
      // 必须抛 Error：Electron 只把 message 序列化给渲染进程，
      // 抛普通对象过去会变成一行 `[object Object]`，用户看不到任何有用信息。
      throw new Error(toAppError(error, '标注没有保存成功').message)
    }
  })

  ipcMain.handle(CH.notesUpdate, (_event, id: number, patch: HighlightPatch) =>
    updateHighlight(getDatabase(), id, patch, Date.now())
  )

  ipcMain.handle(CH.notesRemove, (_event, id: number) => {
    deleteHighlight(getDatabase(), id)
  })

  ipcMain.handle(CH.notesContext, (_event, id: number) => highlightContext(getDatabase(), id))

  ipcMain.handle(
    CH.notesPreviewExport,
    (_event, ids: number[] | null, options: NotesExportOptions) =>
      previewExport(getDatabase(), ids, options, Date.now())
  )

  ipcMain.handle(
    CH.notesExportMarkdown,
    async (_event, ids: number[] | null, options: NotesExportOptions): Promise<NotesExportResult> => {
      const now = new Date()
      const preview = previewExport(getDatabase(), ids, options, now.getTime())

      // 保存对话框归主进程：渲染进程碰不到 fs，也不该知道用户选了哪个目录
      const picked = await dialog.showSaveDialog({
        title: '导出 Markdown',
        defaultPath: `读书笔记-${fileStamp(now)}.md`,
        filters: [{ name: 'Markdown', extensions: ['md'] }]
      })
      if (picked.canceled || !picked.filePath) return { saved: false, path: null }

      try {
        await writeFile(picked.filePath, preview.markdown, 'utf8')
      } catch (error) {
        throw new Error(toAppError(error, '文件没有写成功').message)
      }
      return { saved: true, path: picked.filePath }
    }
  )
}
