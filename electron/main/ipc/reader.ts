import { ipcMain } from 'electron'
import { CH } from '@shared/ipc'
import type { ProgressInput, ReaderBook } from '@shared/types'
import { openBook, saveProgress } from '../reader/repo'
import { getDatabase } from '../store/db'

export function registerReaderIpc(): void {
  ipcMain.handle(
    CH.readerOpen,
    (_event, bookId: string): ReaderBook | null => openBook(getDatabase(), bookId, Date.now())
  )

  ipcMain.handle(CH.readerSaveProgress, (_event, input: ProgressInput) => {
    saveProgress(getDatabase(), input, Date.now())
  })
}
