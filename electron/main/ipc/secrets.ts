import { ipcMain } from 'electron'
import { CH } from '@shared/ipc'
import { clearKey, setKey, status } from '../secrets'

export function registerSecretsIpc(): void {
  ipcMain.handle(CH.secretsStatus, () => status())
  ipcMain.handle(CH.secretsSet, (_event, provider: string, key: string) => {
    setKey(provider, key)
  })
  ipcMain.handle(CH.secretsClear, (_event, provider: string) => {
    clearKey(provider)
  })
}
