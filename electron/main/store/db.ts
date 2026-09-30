import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { migrations } from './migrations'
import { migrate } from './migrate'

const KEEP_BACKUPS = 3

let instance: Database.Database | null = null

export function openDatabase(userDataDir: string): Database.Database {
  if (instance) return instance

  const dbPath = join(userDataDir, 'db.sqlite')
  const needsMigration = existsSync(dbPath)

  if (needsMigration) backupBeforeMigrate(dbPath, userDataDir)

  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db, migrations)

  instance = db
  return db
}

export function getDatabase(): Database.Database {
  if (!instance) throw new Error('数据库尚未打开')
  return instance
}

export function closeDatabase(): void {
  instance?.close()
  instance = null
}

/** 迁移前留一份备份，保留最近 3 份。用户的数据不该被一次迁移赌掉。 */
function backupBeforeMigrate(dbPath: string, userDataDir: string): void {
  const dir = join(userDataDir, 'backups')
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  copyFileSync(dbPath, join(dir, `db-${stamp}.sqlite`))

  const backups = readdirSync(dir)
    .filter((f) => f.startsWith('db-') && f.endsWith('.sqlite'))
    .map((f) => ({ file: join(dir, f), mtime: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)

  for (const old of backups.slice(KEEP_BACKUPS)) rmSync(old.file, { force: true })
}
