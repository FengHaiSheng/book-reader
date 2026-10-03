import { ipcMain } from 'electron'
import { CH } from '@shared/ipc'
import { toAppError } from '@shared/errors'
import type { HighlightInput, HighlightPatch } from '@shared/types'
import {
  createHighlight,
  deleteHighlight,
  highlightContext,
  listAllHighlights,
  listChapterHighlights,
  updateHighlight
} from '../notes/repo'
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
}
