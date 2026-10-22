import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { migrations } from './migrations'
import { migrate, type MigrationDb } from './migrate'

const KEEP_BACKUPS = 3

let instance: Database.Database | null = null

export function openDatabase(userDataDir: string): Database.Database {
  if (instance) return instance

  const dbPath = join(userDataDir, 'db.sqlite')
  // 先记下「这次是不是全新的库」：new Database 会立刻把文件建出来
  const existed = existsSync(dbPath)
  const db = new Database(dbPath)

  // 只在「这次真的要升结构」时备份。每次启动都复制一份会让备份列表
  // 变成启动次数，而不是升级前的快照。
  if (existed && hasPendingMigrations(db)) backupBeforeMigrate(dbPath, userDataDir)

  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(asMigrationDb(db), migrations)

  instance = db
  return db
}

/**
 * 把真实的库收成迁移需要的那几个方法。
 *
 * 不直接传 `db`，是因为 better-sqlite3 的 `prepare` 是重载、Statement 类型随绑定参数形状变化，
 * 与 `MigrationDb` 的最小签名对不上；在这里收口一次，迁移那边就能保持窄而可测的接口。
 */
function asMigrationDb(db: Database.Database): MigrationDb {
  return {
    pragma: (source, options) => db.pragma(source, options),
    exec: (sql) => db.exec(sql),
    transaction: (fn) => db.transaction(fn),
    prepare: (sql) => ({
      // 参数类型定为 unknown[]，重载联合里的每个签名都接得住
      all: (...params) => db.prepare(sql).all(...(params as never[])),
      run: (...params) => db.prepare(sql).run(...(params as never[]))
    })
  }
}

export function getDatabase(): Database.Database {
  if (!instance) throw new Error('数据库尚未打开')
  return instance
}

export function closeDatabase(): void {
  instance?.close()
  instance = null
}

function hasPendingMigrations(db: Database.Database): boolean {
  const current = Number(db.pragma('user_version', { simple: true }))
  return migrations.some((m) => m.version > current)
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
