import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { novelFiles, writeEpub } from '../fixtures/make-epub'
import { launchAppWithUserData } from './helpers'

test('标签：创建、指派、按标签筛选、改名、删除后书还在', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-tags-'))
  const epubPath = join(userDataDir, 'novel.epub')
  await writeEpub(epubPath, novelFiles())

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()

  const imported = await win.evaluate((p) => (window as any).api.library.importPath(p), epubPath)
  const bookId = imported.bookId as string

  expect(await win.evaluate(() => (window as any).api.library.tagsList())).toEqual([])

  const tag = await win.evaluate(() => (window as any).api.library.tagCreate('待读'))
  expect(tag.name).toBe('待读')
  expect(tag.bookCount).toBe(0)
  expect(['yellow', 'green', 'blue', 'pink']).toContain(tag.color)

  await win.evaluate(
    (args: { bookId: string; tagId: number }) =>
      (window as any).api.library.tagAssign(args.bookId, args.tagId, true),
    { bookId, tagId: tag.id }
  )

  const tagged = await win.evaluate(() => (window as any).api.library.list())
  expect(tagged[0].tags).toEqual([{ id: tag.id, name: '待读', color: tag.color }])

  const counted = await win.evaluate(() => (window as any).api.library.tagsList())
  expect(counted[0].bookCount).toBe(1)

  expect(await win.evaluate((id: number) => (window as any).api.library.list(id), tag.id)).toHaveLength(1)
  expect(await win.evaluate(() => (window as any).api.library.list(9999))).toHaveLength(0)

  const renamed = await win.evaluate(
    (args: { id: number; name: string }) =>
      (window as any).api.library.tagRename(args.id, args.name),
    { id: tag.id, name: '在读' }
  )
  expect(renamed.name).toBe('在读')
  expect(renamed.bookCount).toBe(1)

  await win.evaluate((id: number) => (window as any).api.library.tagDelete(id), tag.id)
  expect(await win.evaluate(() => (window as any).api.library.tagsList())).toEqual([])

  // 删标签绝不能连带删书
  const after = await win.evaluate(() => (window as any).api.library.list())
  expect(after).toHaveLength(1)
  expect(after[0].tags).toEqual([])

  await app.close()
})

test('标签的错误信息是中文，且不带 Electron 的 IPC 前缀', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-tags-dup-'))
  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()

  await win.evaluate(() => (window as any).api.library.tagCreate('待读'))
  const message = await win.evaluate(() =>
    (window as any).api.library
      .tagCreate('待读')
      .then(() => '')
      .catch((e: Error) => e.message)
  )

  expect(message).toContain('已经有叫「待读」的标签了')
  expect(await win.evaluate(() => (window as any).api.library.tagsList())).toHaveLength(1)

  await app.close()
})