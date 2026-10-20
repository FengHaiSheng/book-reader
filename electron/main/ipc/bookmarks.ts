import { ipcMain } from 'electron'
import { CH } from '@shared/ipc'
import { toAppError } from '@shared/errors'
import type { BookmarkInput } from '@shared/types'
import { addBookmark, listBookmarks, removeBookmark } from '../bookmarks/repo'
import { getDatabase } from '../store/db'

export function registerBookmarksIpc(): void {
  ipcMain.handle(CH.bookmarksList, (_event, bookId: string) => listBookmarks(getDatabase(), bookId))

  ipcMain.handle(CH.bookmarksAdd, (_event, input: BookmarkInput) => {
    try {
      return addBookmark(getDatabase(), input, Date.now())
    } catch (error) {
      // 必须抛 Error：Electron 只把 message 序列化给渲染进程
      throw new Error(toAppError(error, '书签没有加上').message)
    }
  })

  ipcMain.handle(CH.bookmarksRemove, (_event, id: number) => {
    removeBookmark(getDatabase(), id)
  })
}
