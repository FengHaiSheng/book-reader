import { app, BrowserWindow } from 'electron'
import { registerIpc } from './ipc'
import { closeDatabase, openDatabase } from './store/db'
import { createMainWindow } from './window'

// 单实例锁：第二次启动时聚焦已有窗口，而不是开出第二个库
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    openDatabase(app.getPath('userData'))
    registerIpc()
    createMainWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  app.on('will-quit', () => {
    closeDatabase()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
