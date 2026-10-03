import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { novelFiles, writeEpub } from '../fixtures/make-epub'
import { launchAppWithUserData } from './helpers'

test('导出 Markdown：预览可见、落盘内容与预览一致、取消不报错', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-export-'))
  const epubPath = join(userDataDir, 'novel.epub')
  const outPath = join(userDataDir, 'notes.md')
  await writeEpub(epubPath, novelFiles())

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()

  // 「保存到哪」的系统对话框在测试里点不了，换成固定路径
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath, bookmark: '' })
  }, outPath)

  const bookId = await win.evaluate(
    async (file) => (await (window as any).api.library.importPath(file)).bookId as string,
    epubPath
  )
  const chapterId = await win.evaluate(async (id) => {
    const chapters = await (window as any).api.library.chapters(id)
    return chapters.find((c: { href: string }) => c.href !== '').id as number
  }, bookId)

  // 导出只吃库里存的 text，与这段话在原文里是否真能对上无关
  await win.evaluate(
    async ({ bookId, chapterId }) => {
      await (window as any).api.notes.create({
        bookId,
        chapterId,
        startCfi: 'epubcfi(/6/4!/4/2/1:0)',
        endCfi: 'epubcfi(/6/4!/4/2/1:6)',
        text: '月亮升起来的时候，河面像一条银带。',
        note: '开篇的定调',
        color: 'yellow'
      })
    },
    { bookId, chapterId }
  )

  await win.locator('.nav-item:has-text("笔记")').click()
  await win.locator('.tb-btn--accent').click()

  // 预览可见，而且是真内容
  await expect(win.locator('.pop__preview')).toContainText('# 读书笔记')
  await expect(win.locator('.pop__preview')).toContainText('共 1 条')
  await expect(win.locator('.pop__preview')).toContainText('**我的批注**：开篇的定调')

  // 选项会立刻反映到预览里
  await win.locator('.check:has-text("包含我的批注") input').uncheck()
  await expect(win.locator('.pop__preview')).not.toContainText('我的批注')
  await win.locator('.check:has-text("包含我的批注") input').check()
  await expect(win.locator('.pop__preview')).toContainText('我的批注')

  // 范围切到「当前筛选」：没有筛选时条数不变，但按钮得在
  await expect(win.locator('.seg__b:has-text("全部 1 条")')).toBeVisible()

  await win.locator('.pop__foot .btn--accent').click()
  await expect(win.locator('.pop__done')).toContainText('已导出到')

  // 落盘的那一份必须与浮层里看见的一致
  const written = readFileSync(outPath, 'utf8')
  expect(written).toContain('# 读书笔记')
  expect(written).toContain('> 月亮升起来的时候，河面像一条银带。')
  expect(written).toContain('**我的批注**：开篇的定调')
  expect(written.endsWith('\n')).toBe(true)

  // 用户点取消：不算失败，也不该再写文件
  await app.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => ({ canceled: true, filePath: '', bookmark: '' })
  })
  const before = readFileSync(outPath, 'utf8')
  await win.locator('.pop__foot .btn--accent').click()
  await expect(win.locator('.pop__done')).toContainText('已导出到')
  expect(readFileSync(outPath, 'utf8')).toBe(before)

  await app.close()
})
