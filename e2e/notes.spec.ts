import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { nestedTocFiles, novelFiles, writeEpub } from '../fixtures/make-epub'
import { launchAppWithUserData } from './helpers'

test('跨书汇总、类型筛选、右栏上下文、回到原文', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-notes-'))
  const novelPath = join(userDataDir, 'novel.epub')
  const techPath = join(userDataDir, 'tech.epub')
  await writeEpub(novelPath, novelFiles())
  await writeEpub(techPath, nestedTocFiles())

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()

  const novelId = await win.evaluate(
    async (file) => (await (window as any).api.library.importPath(file)).bookId as string,
    novelPath
  )
  const techId = await win.evaluate(
    async (file) => (await (window as any).api.library.importPath(file)).bookId as string,
    techPath
  )

  // 书架按「最近打开」排序，后导入的技术书此时在最上面。先 open 一次小说，
  // 把它顶到第一位，再 reload 拿到新顺序，这样点第一本就是《河边的月亮》。
  await win.evaluate((id) => (window as any).api.reader.open(id), novelId)
  await win.reload()
  await win.locator('.book-list__open').first().click()
  await expect(win.locator('.reader__chapter')).toHaveText('第一章 河边')
  await win.locator('iframe.reader__view').waitFor()
  // 章节文档是异步加工装进 iframe 的，等它在位再选区，否则选到的是初始空白文档
  await win.waitForFunction(
    () =>
      (document.querySelector('iframe.reader__view') as HTMLIFrameElement | null)
        ?.contentDocument?.getElementById('reader-theme') != null
  )

  // 走真实划词路径：选中前 9 个字，用浮条上的「笔记」建一条带批注的高亮
  const picked = await win.evaluate(() => {
    const frame = document.querySelector('iframe.reader__view') as HTMLIFrameElement
    const doc = frame.contentDocument!
    const node = doc.querySelector('p')!.firstChild as Text
    const end = Math.min(9, node.length)
    const range = doc.createRange()
    range.setStart(node, 0)
    range.setEnd(node, end)
    const selection = doc.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    return node.nodeValue!.slice(0, end)
  })
  await win.locator('.sel-toolbar__btn:has-text("笔记")').click()
  await win.locator('.annot__note').fill('开篇就把手机瘾写出来了')
  await win.locator('button:has-text("保存批注")').click()
  await win.locator('button:has-text("返回书架")').click()

  // 第二本：《深入理解定位》，直接用 API 建一条纯高亮（原文取自夹具）
  const techChapterId = await win.evaluate(async (id) => {
    const chapters = await (window as any).api.library.chapters(id)
    return chapters.find((c: { title: string }) => c.title === '第 1 节 笛卡尔').id as number
  }, techId)
  await win.evaluate(
    async ({ bookId, chapterId }) => {
      await (window as any).api.notes.create({
        bookId,
        chapterId,
        startCfi: 'epubcfi(/6/4!/4/2/1:0)',
        endCfi: 'epubcfi(/6/4!/4/2/1:6)',
        text: '笛卡尔坐标系用两根轴描述平面上的点。',
        color: 'blue'
      })
    },
    { bookId: techId, chapterId: techChapterId }
  )

  await win.locator('.nav-item:has-text("笔记")').click()

  // 分组与计数
  await expect(win.locator('.notes-group__head')).toHaveCount(2)
  await expect(win.locator('.notes-bar__count')).toHaveText('2 条 · 跨 2 本书')
  await expect(win.locator('.note')).toHaveCount(2)

  // 类型筛选
  await win.locator('.notes-side__item:has-text("仅有批注")').click()
  await expect(win.locator('.note')).toHaveCount(1)
  await expect(win.locator('.note__memo')).toContainText('开篇就把手机瘾写出来了')

  // 右栏上下文：命中那一段的原文要出现
  await expect(win.locator('.ctx__cur')).toHaveText(picked)

  // 回到原文：应该打开《河边的月亮》并停在第一章
  await win.locator('button:has-text("回到原文位置")').click()
  await expect(win.locator('.reader__chapter')).toHaveText('第一章 河边')

  // 回笔记页确认删掉后计数跟着变
  await win.locator('button:has-text("返回书架")').click()
  await win.locator('.nav-item:has-text("笔记")').click()
  await win.locator('.notes-side__item:has-text("全部笔记")').click()
  await win.locator('.note').first().locator('button:has-text("删除")').click()
  await win.locator('.note').first().locator('button:has-text("确认删除")').click()
  await expect(win.locator('.notes-bar__count')).toHaveText('1 条 · 跨 1 本书')

  expect(await win.evaluate(() => (window as any).api.notes.listAll())).toHaveLength(1)

  await app.close()
})
