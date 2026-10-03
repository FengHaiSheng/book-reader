import { ipcMain, shell } from 'electron'
import { CH } from '@shared/ipc'

/**
 * 把外链交给系统浏览器。
 *
 * 只认 http/https：书是外来文件，不该有本事让应用去打开 file:// 或任意自定义协议。
 * 校验不通过就静默返回——书里的链接不值得弹错误框打断阅读。
 */
export function registerShellIpc(): void {
  ipcMain.handle(CH.shellOpenExternal, async (_event, url: string) => {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return
    await shell.openExternal(parsed.href)
  })
}
