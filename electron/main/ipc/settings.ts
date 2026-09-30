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
