import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { jfifCoverFiles, scriptedFiles, writeEpub } from '../fixtures/make-epub'
import { launchAppWithUserData } from './helpers'

test('epub:// 只服务本书目录里的静态资源', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-protocol-'))
  const epubPath = join(userDataDir, 'scripted.epub')
  await writeEpub(epubPath, scriptedFiles())

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()
  const imported = await win.evaluate(
    (file) => (window as any).api.library.importPath(file),
    epubPath
  )
  const bookId = imported.bookId as string

  const probe = await win.evaluate(async (id) => {
    const get = async (url: string) => {
      try {
        const res = await fetch(url)
        return { status: res.status, type: res.headers.get('content-type') ?? '' }
      } catch (e) {
        return { status: -1, type: String(e) }
      }
    }
    return {
      chapter: await get(`epub://${id}/OEBPS/ch1.xhtml`),
      css: await get(`epub://${id}/OEBPS/style.css`),
      image: await get(`epub://${id}/OEBPS/images/dot.jpg`),
      script: await get(`epub://${id}/OEBPS/evil.js`),
      noextDoc: await get(`epub://${id}/OEBPS/plain`),
      noextJunk: await get(`epub://${id}/mimetype`),
      otherBook: await get(`epub://11111111-2222-3333-4444-555555555555/OEBPS/ch1.xhtml`),
      badHost: await get(`epub://not-a-uuid/OEBPS/ch1.xhtml`),
      missing: await get(`epub://${id}/OEBPS/nope.xhtml`)
    }
  }, bookId)

  expect(probe.chapter.status).toBe(200)
  expect(probe.chapter.type).toContain('xhtml')
  expect(probe.css.status).toBe(200)
  expect(probe.image.status).toBe(200)
  // 书内脚本永远拿不到
  expect(probe.script.status).toBe(403)
  // 没有扩展名的正文文档照样读得到（按内容认），同样没有扩展名的 mimetype 读不到
  expect(probe.noextDoc.status).toBe(200)
  expect(probe.noextDoc.type).toContain('xhtml')
  expect(probe.noextJunk.status).toBe(403)
  // 换一个合法 uuid 也读不到这本书 —— 路径只由 bookId 决定
  expect(probe.otherBook.status).toBe(404)
  expect(probe.badHost.status).toBe(400)
  expect(probe.missing.status).toBe(404)

  await app.close()
})

test('封面走虚拟 entry：从书目录直接读文件，不解压 zip', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-cover-'))
  const epubPath = join(userDataDir, 'scripted.epub')
  await writeEpub(epubPath, scriptedFiles())

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()
  const imported = await win.evaluate(
    (file) => (window as any).api.library.importPath(file),
    epubPath
  )
  const bookId = imported.bookId as string

  const byId = await win.evaluate((id: string) =>
    window.fetch(`epub://${id}/__cover`).then(async (r) => ({
      status: r.status,
      contentType: r.headers.get('content-type') ?? '',
      bytes: (await r.arrayBuffer()).byteLength
    })), bookId)

  expect(byId.status).toBe(200)
  expect(byId.contentType).toContain('image/')
  expect(byId.bytes).toBeGreaterThan(0)

  const missing = await win.evaluate((id: string) =>
    window.fetch(`epub://${id}/__cover`).then((r) => r.status), '11111111-2222-3333-4444-555555555555')
  expect(missing).toBe(404)

  await app.close()
})

test('封面后缀是 .jfif 时按文件头认格式，不再 404', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-cover-jfif-'))
  const epubPath = join(userDataDir, 'jfif.epub')
  await writeEpub(epubPath, jfifCoverFiles())

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()
  const imported = await win.evaluate(
    (file) => (window as any).api.library.importPath(file),
    epubPath
  )

  const books = await win.evaluate(() => (window as any).api.library.list())
  expect(books[0].coverPath).toContain('cover.jfif')

  const cover = await win.evaluate((id: string) =>
    window.fetch(`epub://${id}/__cover`).then((r) => ({
      status: r.status,
      contentType: r.headers.get('content-type') ?? ''
    })), imported.bookId as string)

  expect(cover.status).toBe(200)
  expect(cover.contentType).toContain('image/jpeg')

  await app.close()
})
