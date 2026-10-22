import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { writeEpub } from '../fixtures/make-epub'
import { launchAppWithUserData } from './helpers'

/** 8×12 的合法 PNG：与 fixtures 里封面用的是同一张，浏览器能解码 */
const PAGE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAMCAIAAADQ/GvKAAAAEklEQVR4nGPItjLCihhGJdARAFcNUKHg/FojAAAAAElFTkSuQmCC',
  'base64'
)

/** 一本混了资源叉与元数据文件的漫画包：只有三张图算页面，且要按数字自然排序 */
function comicFiles(): Record<string, Buffer | string> {
  return {
    'ComicInfo.xml': '<ComicInfo><Title>海边</Title></ComicInfo>',
    '__MACOSX/._page1.png': PAGE,
    '.DS_Store': 'not a page',
    'page10.png': PAGE,
    'page2.png': PAGE,
    'page1.png': PAGE
  }
}

test('导入 CBZ：过滤杂项、自然排序、图片能读回、漫画模式翻页并记住进度', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-cbz-'))
  const cbzPath = join(userDataDir, '海边漫画.cbz')
  await writeEpub(cbzPath, comicFiles())

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()

  const imported = await win.evaluate(
    (file) => (window as any).api.library.importPath(file),
    cbzPath
  )
  expect(imported.status).toBe('imported')
  // 漫画没有元数据，书名用文件名兜底
  expect(imported.title).toBe('海边漫画')
  const bookId = imported.bookId as string

  const chapters = await win.evaluate((id) => (window as any).api.library.chapters(id), bookId)
  expect(chapters.map((c: { title: string }) => c.title)).toEqual(['第 1 页', '第 2 页', '第 3 页'])
  // 每页一条章节，href 指向 media/ 下补零后的图片；压缩包里的乱序与杂项都不影响页码
  expect(chapters.map((c: { href: string }) => c.href)).toEqual([
    'media/00001.png',
    'media/00002.png',
    'media/00003.png'
  ])

  const image = await win.evaluate(async (id: string) => {
    const res = await fetch(`epub://${id}/media/00001.png`)
    return { status: res.status, type: res.headers.get('content-type') ?? '' }
  }, bookId)
  expect(image.status).toBe(200)
  expect(image.type).toContain('image/png')

  // 不存在的页不能因为 media/ 白名单而被放行
  const missing = await win.evaluate(
    async (id: string) => (await fetch(`epub://${id}/media/00009.png`)).status,
    bookId
  )
  expect(missing).toBe(404)

  // 漫画不进全文索引：搜索应当明确没有结果，而不是报错
  const hits = await win.evaluate(
    (id) => (window as any).api.library.search(id, '海边', 5),
    bookId
  )
  expect(hits).toEqual([])

  await win.reload()
  await win.getByRole('button', { name: '列表' }).click()
  await win.getByRole('button', { name: '打开' }).click()

  await expect(win.locator('.reader--comic')).toBeVisible()
  // 默认窗口 1440px，不够对开双页，单页显示
  await expect(win.locator('.comic__page')).toHaveCount(1)
  await expect(win.locator('.reader__page')).toHaveText('第 1 / 3 页')

  // 方向键翻页；封面页失败提示不应出现
  await win.keyboard.press('ArrowRight')
  await expect(win.locator('.reader__page')).toHaveText('第 2 / 3 页')
  await win.keyboard.press('ArrowRight')
  await expect(win.locator('.reader__page')).toHaveText('第 3 / 3 页')
  // 到头不越界
  await win.keyboard.press('ArrowRight')
  await expect(win.locator('.reader__page')).toHaveText('第 3 / 3 页')
  await expect(win.locator('.reader__status')).toHaveCount(0)

  // 进度是防抖落库，等它写完再回书架
  await win.waitForTimeout(700)
  await win.getByRole('button', { name: '返回书架' }).click()
  await expect(win.locator('.reader--comic')).toHaveCount(0)

  // 重新打开回到上次读到的那一页
  await win.getByRole('button', { name: '打开' }).click()
  await expect(win.locator('.reader--comic')).toBeVisible()
  await expect(win.locator('.reader__page')).toHaveText('第 3 / 3 页')

  await win.evaluate((id) => (window as any).api.library.remove(id), bookId)
  expect(await win.evaluate(() => (window as any).api.library.list())).toHaveLength(0)

  await app.close()
  expect(readdirSync(join(userDataDir, 'library'))).toEqual([])
})

test('CBR 按文件头识别：扩展名与真实格式不一致也能导入', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-cbr-'))
  // 内容其实是 zip。漫画包里扩展名写错很常见，导入应按魔数兜底
  const cbrPath = join(userDataDir, '伪装成 rar.cbr')
  await writeEpub(cbrPath, { '001.png': PAGE })

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()

  const imported = await win.evaluate(
    (file) => (window as any).api.library.importPath(file),
    cbrPath
  )
  expect(imported.status).toBe('imported')
  expect(imported.title).toBe('伪装成 rar')
  const bookId = imported.bookId as string

  const chapters = await win.evaluate((id) => (window as any).api.library.chapters(id), bookId)
  expect(chapters).toHaveLength(1)
  expect(chapters[0].href).toBe('media/00001.png')

  const image = await win.evaluate(
    async (id: string) => (await fetch(`epub://${id}/media/00001.png`)).status,
    bookId
  )
  expect(image).toBe(200)

  await app.close()
})

test('既不是 zip 也不是 rar 的假漫画：给出中文提示，不留半本书', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-bad-comic-'))
  const badPath = join(userDataDir, '坏掉的漫画.cbz')
  writeFileSync(badPath, '这不是一个压缩包')

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()

  await expect(
    win.evaluate((file) => (window as any).api.library.importPath(file), badPath)
  ).rejects.toThrow(/CBZ \/ CBR/)

  expect(await win.evaluate(() => (window as any).api.library.list())).toHaveLength(0)
  await app.close()
  expect(readdirSync(join(userDataDir, 'library'))).toEqual([])
})
