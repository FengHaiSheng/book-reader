import { ipcMain } from 'electron'
import { CH } from '@shared/ipc'
import { synthesizeTts, ttsHealth } from '../tts/client'

/** 自建朗读服务。请求与缓存都在主进程，渲染进程不需要放宽 CSP 去连本地端口 */
export function registerTtsIpc(): void {
  ipcMain.handle(CH.ttsHealth, (_event, endpoint: unknown) => ttsHealth(endpoint))
  ipcMain.handle(CH.ttsSynthesize, (_event, request: unknown) => synthesizeTts(request))
}
