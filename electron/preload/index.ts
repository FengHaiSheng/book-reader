import { contextBridge, ipcRenderer } from 'electron'
import { CH } from '@shared/ipc'

const api = {
  settings: {
    getAll: (): Promise<Record<string, string>> => ipcRenderer.invoke(CH.settingsGetAll),
    set: (key: string, value: string): Promise<void> =>
      ipcRenderer.invoke(CH.settingsSet, key, value)
  },
  secrets: {
    status: (): Promise<{ available: boolean; providers: Record<string, string> }> =>
      ipcRenderer.invoke(CH.secretsStatus),
    set: (provider: string, key: string): Promise<void> =>
      ipcRenderer.invoke(CH.secretsSet, provider, key),
    clear: (provider: string): Promise<void> => ipcRenderer.invoke(CH.secretsClear, provider)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
