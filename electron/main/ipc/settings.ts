import { ipcMain } from 'electron'
import { CH } from '@shared/ipc'
import type { ReadingPrefs } from '@shared/types'
import { getDatabase } from '../store/db'
import { getAll, readPrefs, set, writePrefs } from '../store/settings'

export function registerSettingsIpc(): void {
  ipcMain.handle(CH.settingsGetAll, () => getAll(getDatabase()))
  ipcMain.handle(CH.settingsSet, (_event, key: string, value: string) => {
    set(getDatabase(), key, value)
  })
  ipcMain.handle(CH.settingsGetPrefs, () => readPrefs(getDatabase()))
  ipcMain.handle(CH.settingsSetPrefs, (_event, prefs: Partial<ReadingPrefs>) =>
    writePrefs(getDatabase(), prefs)
  )
}
