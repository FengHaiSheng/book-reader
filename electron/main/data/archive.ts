import { createWriteStream, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { ZipFile } from 'yazl'
import { dirBytes, listDirs, listFiles, singleFileBytes } from './walk'

const README = [
  '这是「阅微」导出的一份完整数据。',
  '',
  'db.sqlite                书库、章节、笔记与高亮、AI 结果、阅读进度、设置',
  'library/<bookId>/        每本书的 epub 与封面',
  '',
  '不含 API Key。换一台机器后需要在设置页重新填写密钥。',
  ''
].join('\n')

/**
 * 导出为一个 zip：数据库一致性快照 + library/**。
 *
 * 三样东西刻意不进包：
 * - `secrets.json`：换机器要重填 key，这是安全的默认；
 * - `backups/`：那是本机的迁移快照，不是用户的数据；
 * - `logs/`：运行痕迹，隐私上要求它只留在本机。
 *
 * 数据库用 `db.backup()` 落到临时文件再打包：WAL 模式下直接读 db.sqlite
 * 可能拿到少了最近写入的版本，而导出必须是一份能开得起来的库。
 */
export async function exportAll(
  db: Database.Database,
  userDataDir: string,
  target: string
): Promise<{ entries: number; bytes: number }> {
  const staging = mkdtempSync(join(tmpdir(), 'book-read-export-'))
  try {
    const snapshot = join(staging, 'db.sqlite')
    await db.backup(snapshot)

    const zip = new ZipFile()
    const output = createWriteStream(target)
    const finished = new Promise<void>((resolve, reject) => {
      output.on('close', resolve)
      output.on('error', reject)
    })
    zip.outputStream.pipe(output)

    let entries = 0
    zip.addFile(snapshot, 'db.sqlite')
    entries += 1

    const library = join(userDataDir, 'library')
    for (const bookDir of listDirs(library)) {
      for (const file of listFiles(join(library, bookDir))) {
        zip.addFile(file.path, `library/${bookDir}/${file.name}`)
        entries += 1
      }
    }

    zip.addBuffer(Buffer.from(README, 'utf8'), 'README.txt')
    entries += 1

    zip.end()
    await finished

    return { entries, bytes: statSync(target).size }
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

/**
 * 清理缓存：删日志 + VACUUM 回收删书后留下的空洞。
 *
 * **不动 `chunks.embedding`**：那是用户花钱算出来的向量，硬规则是
 * 「花钱的事一律显式」，绝不能混在一个叫「清理缓存」的按钮里被人顺手删掉。
 */
export function cleanup(
  db: Database.Database,
  userDataDir: string
): { freedBytes: number; removedLogs: number } {
  const logDir = join(userDataDir, 'logs')
  const before = dirBytes(logDir) + singleFileBytes(join(userDataDir, 'db.sqlite'))
  const removedLogs = listFiles(logDir).length

  rmSync(logDir, { recursive: true, force: true })
  // VACUUM 不能在事务里跑；先把 WAL 收掉，再整理主文件
  db.pragma('wal_checkpoint(TRUNCATE)')
  db.exec('VACUUM')

  const after = singleFileBytes(join(userDataDir, 'db.sqlite'))
  return { freedBytes: Math.max(0, before - after), removedLogs }
}
