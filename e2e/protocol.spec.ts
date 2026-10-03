import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { scriptedFiles, writeEpub } from '../fixtures/make-epub'
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
  // 换一个合法 uuid 也读不到这本书 —— 路径只由 bookId 决定
  expect(probe.otherBook.status).toBe(404)
  expect(probe.badHost.status).toBe(400)
  expect(probe.missing.status).toBe(404)

  await app.close()
})
