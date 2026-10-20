import { ipcMain } from 'electron'
import { CH } from '@shared/ipc'
import { addReadingSeconds, readingStats } from '../reading/repo'
import { getDatabase } from '../store/db'

export function registerReadingIpc(): void {
  ipcMain.handle(CH.readingStats, () => readingStats(getDatabase(), Date.now()))

  // 只收增量：日期串是主键，由主进程生成，渲染层送进来的只有一个秒数
  ipcMain.handle(CH.readingAddSeconds, (_event, seconds: number) => {
    addReadingSeconds(getDatabase(), seconds, Date.now())
  })
}
