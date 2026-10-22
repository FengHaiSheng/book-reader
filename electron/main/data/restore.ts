import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { appError } from '@shared/errors'
import { closeDatabase, getDatabase, openDatabase } from '../store/db'
import { migrations } from '../store/migrations'
import { extractArchive } from './archive-import'

const KEEP_BACKUPS = 3
const SCHEMA_VERSION = Math.max(...migrations.map((migration) => migration.version))

export type ImportSummary = { bookCount: number; entries: number; bytes: number }

/**
 * 从导出包恢复整份数据：数据库 + library/**。
 *
 * 跨设备迁移的语义是「换成这份数据」，所以是覆盖而不是合并。
 * 覆盖前一定先备份当前库；替换过程中任何一步失败都退回原状——
 * 一个导入按钮不该把用户已有的笔记赌进去。
 *
 * 包里的 secrets.json 即使存在也不会被采纳：密钥不跨设备，要求重填。
 */
export async function importAll(userDataDir: string, zipPath: string): Promise<ImportSummary> {
  // 解到 userData 里面：交换书库用的是 rename，跨卷会失败
  const staging = mkdtempSync(join(userDataDir, '.import-'))
  try {
    const pack = await extractArchive(zipPath, staging)
    const incomingDb = join(staging, 'db.sqlite')
    if (!existsSync(incomingDb)) {
      throw appError('DB_ERROR', '这个压缩包里没有 db.sqlite，不像是「阅微」导出的数据包')
    }
    inspectDatabase(incomingDb)

    const backupPath = await backupCurrent(getDatabase(), userDataDir)

    const library = join(userDataDir, 'library')
    const dbPath = join(userDataDir, 'db.sqlite')
    const oldLibrary = join(staging, 'old-library')
    const hadLibrary = existsSync(library)

    closeDatabase()
    try {
      if (hadLibrary) renameSync(library, oldLibrary)

      const incomingLibrary = join(staging, 'library')
      if (existsSync(incomingLibrary)) renameSync(incomingLibrary, library)
      else mkdirSync(library, { recursive: true })

      for (const suffix of ['', '-wal', '-shm']) rmSync(`${dbPath}${suffix}`, { force: true })
      copyFileSync(incomingDb, dbPath)

      const db = openDatabase(userDataDir)
      const bookCount = (
        db.prepare('SELECT COUNT(*) AS n FROM books').get() as { n: number }
      ).n
      return { bookCount, entries: pack.entries, bytes: pack.bytes }
    } catch (error) {
      rollback(userDataDir, backupPath, hadLibrary ? oldLibrary : null)
      throw error
    }
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

/** 用 SQLite 的在线备份留一份当前库（会把 WAL 里的内容一起带上） */
async function backupCurrent(
  db: Database.Database,
  userDataDir: string
): Promise<string> {
  const dir = join(userDataDir, 'backups')
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const target = join(dir, `db-${stamp}.sqlite`)
  await db.backup(target)

  const all = readdirSync(dir)
    .filter((file) => file.startsWith('db-') && file.endsWith('.sqlite'))
    .map((file) => ({ file: join(dir, file), mtime: statSync(join(dir, file)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
  for (const old of all.slice(KEEP_BACKUPS)) rmSync(old.file, { force: true })

  return target
}

/** 把包里的库当成别家的库对待：只读打开、验版本、验表，不碰本机数据 */
function inspectDatabase(dbPath: string): void {
  let db: Database.Database
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true })
  } catch {
    throw appError('DB_ERROR', '导出包里的数据库打不开，文件可能不完整')
  }

  try {
    const version = Number(db.pragma('user_version', { simple: true }))
    if (version > SCHEMA_VERSION) {
      throw appError('DB_ERROR', '这份数据来自更新版本的应用，请先升级后再导入')
    }
    db.prepare('SELECT COUNT(*) AS n FROM books').get()
  } catch (error) {
    if ((error as { code?: string }).code === 'DB_ERROR') throw error
    throw appError('DB_ERROR', '导出包里的数据库不完整，无法导入')
  } finally {
    db.close()
  }
}

function rollback(
  userDataDir: string,
  backupPath: string,
  oldLibrary: string | null
): void {
  const library = join(userDataDir, 'library')
  const dbPath = join(userDataDir, 'db.sqlite')

  closeDatabase()
  rmSync(library, { recursive: true, force: true })
  if (oldLibrary && existsSync(oldLibrary)) renameSync(oldLibrary, library)

  for (const suffix of ['', '-wal', '-shm']) rmSync(`${dbPath}${suffix}`, { force: true })
  copyFileSync(backupPath, dbPath)
  openDatabase(userDataDir)
}
