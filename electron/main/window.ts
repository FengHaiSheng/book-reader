import { join } from 'node:path'
import { BrowserWindow, shell } from 'electron'

// 只把 http/https 链接交给系统浏览器，避免 file: 或自定义 scheme 被丢给 OS 处理
function openExternalIfSafe(url: string): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return
  }
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    shell.openExternal(url)
  }
}

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 840,
    minHeight: 600,
    show: false,
    backgroundColor: '#E8E3DA',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.once('ready-to-show', () => win.show())

  // 书内外链一律交给系统浏览器，不在应用内打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalIfSafe(url)
    return { action: 'deny' }
  })

  // 普通 <a> 点击会把窗口本身导航走（等于在应用内打开外链），这里拦下并改交系统浏览器。
  // 相等判断是必要的：Vite HMR 的整页刷新导航到同一 URL，不能挡。
  win.webContents.on('will-navigate', (details) => {
    if (details.url === win.webContents.getURL()) return
    details.preventDefault()
    openExternalIfSafe(details.url)
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}
