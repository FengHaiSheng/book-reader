import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { novelFiles, writeEpub } from '../fixtures/make-epub'
import { launchAppWithUserData } from './helpers'

test('pinAi 找或建划线，清空对话后笔记仍在，删划线级联', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-pin-ai-'))
  const epubPath = join(userDataDir, 'novel.epub')
  await writeEpub(epubPath, novelFiles())

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()

  const bookId = await win.evaluate(
    async (file) => (await (window as any).api.library.importPath(file)).bookId as string,
    epubPath
  )
  const chapterId = await win.evaluate(async (id) => {
    const chapters = await (window as any).api.library.chapters(id)
    return chapters.find((c: { href: string }) => c.href !== '').id as number
  }, bookId)

  const pinText = '月亮升起来的时候，河面像一条银带。pin-ai-unique'

  const first = await win.evaluate(
    async ({ bookId, chapterId, text }) =>
      (await (window as any).api.notes.pinAi({
        bookId,
        chapterId,
        text,
        content: '解释正文',
        source: 'explain',
        startCfi: 'epubcfi(/6/4!/4/2/1:0)',
        endCfi: 'epubcfi(/6/4!/4/2/1:6)'
      })) as { highlight: { id: number; note: string | null; aiNotes: { content: string }[] } },
    { bookId, chapterId, text: pinText }
  )

  expect(first.highlight.note).toBeNull()
  expect(first.highlight.aiNotes).toHaveLength(1)
  expect(first.highlight.aiNotes[0]!.content).toBe('解释正文')

  const afterFirst = await win.evaluate(async () => {
    const all = (await (window as any).api.notes.listAll()) as {
      id: number
      text: string
      note: string | null
      aiNotes: { content: string }[]
    }[]
    return all.find((h) => h.text === '月亮升起来的时候，河面像一条银带。pin-ai-unique')
  })
  expect(afterFirst).toBeTruthy()
  expect(afterFirst!.note).toBeNull()
  expect(afterFirst!.aiNotes).toHaveLength(1)
  expect(afterFirst!.aiNotes[0]!.content).toBe('解释正文')

  await win.evaluate(
    async ({ bookId, chapterId, text }) =>
      (window as any).api.notes.pinAi({
        bookId,
        chapterId,
        text,
        content: '第二次解释',
        source: 'explain',
        startCfi: 'epubcfi(/6/4!/4/2/1:0)',
        endCfi: 'epubcfi(/6/4!/4/2/1:6)'
      }),
    { bookId, chapterId, text: pinText }
  )

  const afterSecond = await win.evaluate(
    async (highlightId) => {
      const all = (await (window as any).api.notes.listAll()) as {
        id: number
        aiNotes: { content: string }[]
      }[]
      return all.find((h) => h.id === highlightId)
    },
    first.highlight.id
  )
  expect(afterSecond!.aiNotes).toHaveLength(2)

  await win.evaluate(
    async ({ bookId, scopeKey }) => (window as any).api.ai.clear(bookId, scopeKey),
    { bookId, scopeKey: `chapter:${chapterId}` }
  )

  const afterClear = await win.evaluate(
    async (highlightId) => {
      const all = (await (window as any).api.notes.listAll()) as {
        id: number
        aiNotes: { content: string }[]
      }[]
      return all.find((h) => h.id === highlightId)
    },
    first.highlight.id
  )
  expect(afterClear!.aiNotes).toHaveLength(2)

  await win.evaluate(
    async (highlightId) => (window as any).api.notes.remove(highlightId),
    first.highlight.id
  )

  const afterRemove = await win.evaluate(async (highlightId) => {
    const all = (await (window as any).api.notes.listAll()) as { id: number }[]
    const aiNotes = (await (window as any).api.notes.listAiNotes(highlightId)) as unknown[]
    return {
      stillListed: all.some((h) => h.id === highlightId),
      aiNotes
    }
  }, first.highlight.id)

  expect(afterRemove.stillListed).toBe(false)
  expect(afterRemove.aiNotes).toEqual([])

  await app.close()
})

test('缺 CFI 且无同文划线时 pinAi 失败且不留脏划线', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-pin-ai-no-cfi-'))
  const epubPath = join(userDataDir, 'novel.epub')
  await writeEpub(epubPath, novelFiles())

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()

  const bookId = await win.evaluate(
    async (file) => (await (window as any).api.library.importPath(file)).bookId as string,
    epubPath
  )
  const chapterId = await win.evaluate(async (id) => {
    const chapters = await (window as any).api.library.chapters(id)
    return chapters.find((c: { href: string }) => c.href !== '').id as number
  }, bookId)

  const orphanText = '从未划过的句子-pin-ai-no-cfi-xyz'

  const message = await win.evaluate(
    async ({ bookId, chapterId, text }) =>
      (window as any).api.notes
        .pinAi({
          bookId,
          chapterId,
          text,
          content: '不该落库',
          source: 'explain'
        })
        .then(() => '')
        .catch((e: Error) => e.message),
    { bookId, chapterId, text: orphanText }
  )

  expect(message).toContain('没法定位到原文')

  const dirty = await win.evaluate(async (text) => {
    const all = (await (window as any).api.notes.listAll()) as { text: string }[]
    return all.some((h) => h.text === text)
  }, orphanText)

  expect(dirty).toBe(false)

  await app.close()
})
