import { join } from 'node:path'
import type { BackupInfo } from '@shared/types'
import { listFiles } from './walk'

/** 备份目录里的 db-*.sqlite，最新的在最前 */
export function listBackups(userDataDir: string): BackupInfo[] {
  return listFiles(join(userDataDir, 'backups'))
    .filter((file) => file.name.startsWith('db-') && file.name.endsWith('.sqlite'))
    .map((file) => ({ name: file.name, bytes: file.bytes, createdAt: file.mtime }))
    .sort((a, b) => b.createdAt - a.createdAt)
}
