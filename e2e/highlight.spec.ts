import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { novelFiles, writeEpub } from '../fixtures/make-epub'
import { launchAppWithUserData } from './helpers'

test('划词标注不插 mark、能改色、能写批注、能点回去', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-hl-'))
  const epubPath = join(userDataDir, 'novel.epub')
  await writeEpub(epubPath, novelFiles())

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()
  const bookId = await win.evaluate(async (file) => {
    const outcome = await (window as any).api.library.importPath(file)
    return outcome.bookId as string
  }, epubPath)

  await win.evaluate((id) => (window as any).api.reader.open(id), bookId)
  await win.reload()
  await win.locator('.book-card').first().click()
  await expect(win.locator('.reader__chapter')).toHaveText('第一章 河边')
  await win.locator('iframe.reader__view').waitFor()
  // 章节文档是异步加工装进 iframe 的，等它在位再选区，否则选到的是初始空白文档
  await win.waitForFunction(
    () =>
      (document.querySelector('iframe.reader__view') as HTMLIFrameElement | null)
        ?.contentDocument?.getElementById('reader-theme') != null
  )

  // 在章节文档里选前 8 个字。setSelection 会触发 selectionchange，React 那边据此弹浮条
  const picked = await win.evaluate(() => {
    const frame = document.querySelector('iframe.reader__view') as HTMLIFrameElement
    const doc = frame.contentDocument!
    const node = doc.querySelector('p')!.firstChild as Text
    const end = Math.min(8, node.length)
    const range = doc.createRange()
    range.setStart(node, 0)
    range.setEnd(node, end)
    const selection = doc.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    return node.nodeValue!.slice(0, end)
  })
  expect(picked).toBe('月色沉入河底，量')

  await expect(win.locator('.sel-toolbar')).toBeVisible()
  await win.locator('.sel-dot--green').click()

  // 高亮注册进了章节文档的 CSS.highlights，而不是插了 <mark>
  // 建标注是异步 IPC，注册发生在它回来之后，所以要轮询而不是读一次
  await expect
    .poll(async () =>
      win.evaluate(() => {
        const frame = document.querySelector('iframe.reader__view') as HTMLIFrameElement
        const css = (frame.contentWindow as any).CSS
        return css?.highlights ? [...css.highlights.keys()] : []
      })
    )
    .toEqual(['hl-green'])
  const marksAfterMark = await win.evaluate(
    () =>
      (document.querySelector('iframe.reader__view') as HTMLIFrameElement).contentDocument!
        .querySelectorAll('mark').length
  )
  expect(marksAfterMark).toBe(0)

  // 点回高亮上：用这段话第 2 个字的坐标去点
  const point = await win.evaluate(() => {
    const frame = document.querySelector('iframe.reader__view') as HTMLIFrameElement
    const doc = frame.contentDocument!
    const node = doc.querySelector('p')!.firstChild as Text
    const range = doc.createRange()
    range.setStart(node, 2)
    range.setEnd(node, 3)
    const rect = range.getBoundingClientRect()
    const outer = frame.getBoundingClientRect()
    return {
      x: outer.left + rect.left + rect.width / 2,
      y: outer.top + rect.top + rect.height / 2
    }
  })
  await win.mouse.click(point.x, point.y)

  const pop = win.locator('.annot')
  await expect(pop).toBeVisible()
  await expect(pop.locator('.annot__quote')).toHaveText(picked)

  // 改色
  await pop.locator('.sel-dot--pink').click()
  await expect
    .poll(async () =>
      win.evaluate(async () => {
        const list = await (window as any).api.notes.listAll()
        return list[0]?.color
      })
    )
    .toBe('pink')

  // 写批注
  await pop.locator('.annot__note').fill('这一句是全书第一次写他的手机瘾')
  await pop.locator('button:has-text("保存批注")').click()
  await expect
    .poll(async () =>
      win.evaluate(async () => {
        const list = await (window as any).api.notes.listAll()
        return list[0]?.note
      })
    )
    .toBe('这一句是全书第一次写他的手机瘾')

  // 高亮随颜色改名重新注册，仍然没有 mark
  await expect
    .poll(async () =>
      win.evaluate(() => {
        const frame = document.querySelector('iframe.reader__view') as HTMLIFrameElement
        const css = (frame.contentWindow as any).CSS
        return css?.highlights ? [...css.highlights.keys()] : []
      })
    )
    .toEqual(['hl-pink'])
  const marksAfterColor = await win.evaluate(
    () =>
      (document.querySelector('iframe.reader__view') as HTMLIFrameElement).contentDocument!
        .querySelectorAll('mark').length
  )
  expect(marksAfterColor).toBe(0)

  await app.close()
})
