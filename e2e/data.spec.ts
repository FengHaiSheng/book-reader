import {
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { open as openZip } from 'yauzl'
import { ZipFile } from 'yazl'
import { novelFiles, writeEpub } from '../fixtures/make-epub'
import { launchAppWithUserData } from './helpers'

/** 造一个测试用的 zip，用来验证坏包不会动到本机数据 */
function writeZip(entries: { name: string; content: string }[], target: string): Promise<void> {
  const zip = new ZipFile()
  const output = createWriteStream(target)
  const done = new Promise<void>((resolve, reject) => {
    output.on('close', resolve)
    output.on('error', reject)
    zip.outputStream.on('error', reject)
  })
  zip.outputStream.pipe(output)
  for (const entry of entries) zip.addBuffer(Buffer.from(entry.content, 'utf8'), entry.name)
  zip.end()
  return done
}

/**
 * 带 `../` 的恶意包：yazl 自己就拒绝这种 entry 名，
 * 所以先写一个同样长度的安全名，再把字节替换掉——名字长度不变，CRC 只覆盖内容。
 */
async function writeTraversalZip(target: string): Promise<void> {
  await writeZip(
    [
      { name: 'aa/evil.txt', content: 'pwned' },
      { name: 'README.txt', content: 'x' }
    ],
    target
  )
  const patched = readFileSync(target).toString('latin1').replaceAll('aa/evil.txt', '../evil.txt')
  writeFileSync(target, Buffer.from(patched, 'latin1'))
}

/** 用 yauzl 列 zip 里的 entry 名：导出物是给用户拿走的，必须真的能解开 */
function readZipNames(file: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    openZip(file, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error ?? new Error('打不开 zip'))
      const names: string[] = []
      zip.on('entry', (entry) => {
        names.push(entry.fileName)
        zip.readEntry()
      })
      zip.on('end', () => resolve(names))
      zip.on('error', reject)
      zip.readEntry()
    })
  })
}

test('数据统计：书库占用随导入增长，界面显示统计数字', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-data-'))
  const epubPath = join(userDataDir, 'novel.epub')
  await writeEpub(epubPath, novelFiles())

  const app = await launchAppWithUserData(userDataDir)
  try {
    const win = await app.firstWindow()

    const before = await win.evaluate(() => (window as any).api.data.stats())
    expect(before.bookCount).toBe(0)
    expect(before.libraryBytes).toBe(0)
    expect(before.dbBytes).toBeGreaterThan(0)

    await win.evaluate((p: string) => (window as any).api.library.importPath(p), epubPath)

    const after = await win.evaluate(() => (window as any).api.data.stats())
    expect(after.bookCount).toBe(1)
    expect(after.libraryBytes).toBeGreaterThan(0)

    // 没有待执行迁移时不该产生备份：重启一次也还是 0 份
    expect(await win.evaluate(() => (window as any).api.data.backups())).toEqual([])
  } finally {
    await app.close()
  }

  const second = await launchAppWithUserData(userDataDir)
  try {
    const win = await second.firstWindow()
    expect(await win.evaluate(() => (window as any).api.data.backups())).toEqual([])

    // 设置页真的把统计与路径画出来了，不是一个空壳
    await win.getByRole('button', { name: '设置' }).click()
    const group = win.locator('.settings__group:has-text("数据库备份")')
    await expect(group).toBeVisible()
    await expect(group).toContainText('共 1 本')
    await expect(group.locator('.data__path')).toContainText(userDataDir)
  } finally {
    await second.close()
  }
})

test('备份列表：按时间倒序，界面能显示', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-data-backup-'))
  mkdirSync(join(userDataDir, 'backups'), { recursive: true })
  writeFileSync(join(userDataDir, 'backups', 'db-2026-01-01T00-00-00-000Z.sqlite'), 'old')
  writeFileSync(join(userDataDir, 'backups', 'db-2026-02-01T00-00-00-000Z.sqlite'), 'newer-content')

  const app = await launchAppWithUserData(userDataDir)
  try {
    const win = await app.firstWindow()

    const backups = await win.evaluate(() => (window as any).api.data.backups())
    expect(backups).toHaveLength(2)
    expect(backups[0].name).toContain('2026-02-01')
    expect(backups[0].bytes).toBeGreaterThan(backups[1].bytes)

    await win.getByRole('button', { name: '设置' }).click()
    await expect(win.locator('.data__backup')).toHaveCount(2)
  } finally {
    await app.close()
  }
})

test('导出全部数据：含 db 与书库，不含密钥与日志', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-export-'))
  const epubPath = join(userDataDir, 'novel.epub')
  await writeEpub(epubPath, novelFiles())
  mkdirSync(join(userDataDir, 'logs'), { recursive: true })
  writeFileSync(join(userDataDir, 'logs', 'app-2026-01-01.log'), 'noise')

  const target = join(userDataDir, 'out.zip')

  const app = await launchAppWithUserData(userDataDir)
  try {
    const win = await app.firstWindow()

    await win.evaluate((p: string) => (window as any).api.library.importPath(p), epubPath)
    await win.evaluate(() => (window as any).api.secrets.set('deepseek', 'sk-test-1234567890'))

    await app.evaluate(({ dialog }, file: string) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file, bookmark: '' })
    }, target)

    const result = await win.evaluate(() => (window as any).api.data.exportAll())
    expect(result.canceled).toBe(false)
    expect(result.bytes).toBeGreaterThan(0)
    expect(statSync(target).size).toBe(result.bytes)

    const names = await readZipNames(target)
    expect(names).toContain('db.sqlite')
    expect(names).toContain('README.txt')
    expect(names.some((name) => name.startsWith('library/') && name.endsWith('book.epub'))).toBe(true)
    expect(names.some((name) => name.includes('secrets.json'))).toBe(false)
    expect(names.some((name) => name.includes('logs/'))).toBe(false)
  } finally {
    await app.close()
  }
})

test('清理缓存：删日志、回收空洞，库还能用', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-cleanup-'))
  mkdirSync(join(userDataDir, 'logs'), { recursive: true })
  writeFileSync(join(userDataDir, 'logs', 'app-2026-01-01.log'), 'x'.repeat(4096))

  const app = await launchAppWithUserData(userDataDir)
  try {
    const win = await app.firstWindow()

    const result = await win.evaluate(() => (window as any).api.data.cleanup())
    expect(result.removedLogs).toBe(1)
    expect(existsSync(join(userDataDir, 'logs'))).toBe(false)

    // 库还能用
    expect(await win.evaluate(() => (window as any).api.library.list())).toEqual([])
  } finally {
    await app.close()
  }
})

test('导入全部数据：导出包能在另一台设备上完整恢复', async () => {
  const sourceDir = mkdtempSync(join(tmpdir(), 'book-read-migrate-source-'))
  const epubPath = join(sourceDir, 'novel.epub')
  await writeEpub(epubPath, novelFiles())
  const packPath = join(sourceDir, 'pack.zip')

  const source = await launchAppWithUserData(sourceDir)
  try {
    const win = await source.firstWindow()
    await win.evaluate((p: string) => (window as any).api.library.importPath(p), epubPath)
    await source.evaluate(({ dialog }, file: string) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file, bookmark: '' })
    }, packPath)

    const exported = await win.evaluate(() => (window as any).api.data.exportAll())
    expect(exported.canceled).toBe(false)
    expect(existsSync(packPath)).toBe(true)
  } finally {
    await source.close()
  }

  const targetDir = mkdtempSync(join(tmpdir(), 'book-read-migrate-target-'))
  const target = await launchAppWithUserData(targetDir)
  try {
    const win = await target.firstWindow()

    // 目标机先有一本书：导入是覆盖，所以它应该被换掉，且旧库自动备份
    const otherEpub = join(targetDir, 'other.epub')
    await writeEpub(otherEpub, novelFiles())
    await win.evaluate((p: string) => (window as any).api.library.importPath(p), otherEpub)
    expect(await win.evaluate(() => (window as any).api.library.list())).toHaveLength(1)

    await target.evaluate(({ dialog }, file: string) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file], bookmarks: [] })
    }, packPath)

    const result = await win.evaluate(() => (window as any).api.data.importAll())
    expect(result.canceled).toBe(false)
    expect(result.bookCount).toBe(1)
    expect(result.entries).toBeGreaterThan(2)

    const books = await win.evaluate(() => (window as any).api.library.list())
    expect(books).toHaveLength(1)
    expect(books[0].title).toContain('河边的月亮')

    // 文件真的落地到新机器
    const libraryDir = join(targetDir, 'library')
    const copied = readdirSync(libraryDir).flatMap((dir) => readdirSync(join(libraryDir, dir)))
    expect(copied).toContain('book.epub')

    // 覆盖前的旧库留了备份
    expect((await win.evaluate(() => (window as any).api.data.backups())).length).toBeGreaterThan(0)

    // 恢复后的库可用：章节能读
    const chapters = await win.evaluate((id: string) => (window as any).api.library.chapters(id), books[0].id)
    expect(chapters.length).toBeGreaterThan(0)
  } finally {
    await target.close()
  }
})

test('导入坏包：拒绝并保持本机数据原样', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-import-bad-'))
  const epubPath = join(userDataDir, 'novel.epub')
  await writeEpub(epubPath, novelFiles())

  const noDb = join(userDataDir, 'no-db.zip')
  await writeZip([{ name: 'README.txt', content: 'not a package' }], noDb)

  const traversal = join(userDataDir, 'traversal.zip')
  await writeTraversalZip(traversal)

  const app = await launchAppWithUserData(userDataDir)
  try {
    const win = await app.firstWindow()
    await win.evaluate((p: string) => (window as any).api.library.importPath(p), epubPath)

    for (const [file, expected] of [
      [noDb, /没有 db\.sqlite/],
      [traversal, /不安全的路径/]
    ] as const) {
      await app.evaluate(({ dialog }, target: string) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target], bookmarks: [] })
      }, file)
      await expect(win.evaluate(() => (window as any).api.data.importAll())).rejects.toThrow(expected)
    }

    // 失败后本机书库仍在，且没有文件被写到 userData 之外
    expect(await win.evaluate(() => (window as any).api.library.list())).toHaveLength(1)
    expect(existsSync(join(userDataDir, 'evil.txt'))).toBe(false)
  } finally {
    await app.close()
  }
})
