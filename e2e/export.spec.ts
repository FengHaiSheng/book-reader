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

/**
 * 三条导出通道共用同一个 `buildExport`，所以「浮层里看见的就是落盘的那一份」对三种格式
 * 都必须成立。CSV 与 HTML 是给别的软件吃的：BOM 与表头元数据决定 Anki / Excel 认不认，
 * 零外部引用决定这份文件能不能离线打开、随手发人。
 */
test('导出三格式：预览随格式切换，CSV 带 BOM 与表头元数据，HTML 自包含', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-export-format-'))
  const epubPath = join(userDataDir, 'novel.epub')
  const csvPath = join(userDataDir, 'notes.csv')
  const htmlPath = join(userDataDir, 'notes.html')
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

  // 批注里故意塞进 ASCII 逗号与双引号：CSV 的 RFC 4180 转义与 HTML 的实体转义都要经得起
  await win.evaluate(
    async ({ bookId, chapterId }) => {
      await (window as any).api.notes.create({
        bookId,
        chapterId,
        startCfi: 'epubcfi(/6/4!/4/2/1:0)',
        endCfi: 'epubcfi(/6/4!/4/2/1:6)',
        text: '月亮升起来的时候，河面像一条银带。',
        note: '开篇的定调, 带个"引号"',
        color: 'yellow'
      })
    },
    { bookId, chapterId }
  )

  await win.locator('.nav-item:has-text("笔记")').click()
  await win.locator('.tb-btn--accent').click()

  // 默认还是 Markdown，既有那条断言的口径不变
  await expect(win.locator('.pop__preview')).toContainText('# 读书笔记')

  // 切到 Anki CSV：预览必须换成 CSV，并带上 Anki 2.1.55+ 直接识别的表头元数据
  await win.locator('.seg__b:has-text("Anki CSV")').click()
  await expect(win.locator('.pop__preview')).toContainText('#separator:Comma')
  await expect(win.locator('.pop__preview')).toContainText(
    '#columns:Front,Back,Tags,Book,Chapter,Location'
  )
  // 更早的 Anki 要手动勾「跳过头两行」，这一点得在浮层里明说
  await expect(win.locator('.pop > .hint2')).toContainText('2.1.55')

  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath, bookmark: '' })
  }, csvPath)
  await win.locator('.pop__foot .btn--accent').click()
  await expect(win.locator('.pop__done')).toContainText('已导出到')

  const csv = readFileSync(csvPath, 'utf8')
  // BOM 在最前：不写的话旧版 Excel 打开会把中文显示成乱码
  expect(csv.charCodeAt(0)).toBe(0xfeff)
  expect(csv).toContain('#separator:Comma')
  expect(csv).toContain('#columns:Front,Back,Tags,Book,Chapter,Location')
  // 含逗号与引号的字段必须被引起来，字段里的引号翻倍
  expect(csv).toContain('""引号""')

  // 切到 HTML 卡片：单文件自包含，绝不引用任何外部资源
  await win.locator('.seg__b:has-text("HTML 卡片")').click()
  await expect(win.locator('.pop__preview')).toContainText('<!DOCTYPE html>')
  await expect(win.locator('.pop__preview')).not.toContainText('http')

  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath, bookmark: '' })
  }, htmlPath)
  await win.locator('.pop__foot .btn--accent').click()
  await expect(win.locator('.pop__done')).toContainText('已导出到')

  const html = readFileSync(htmlPath, 'utf8')
  expect(html).toContain('<article class="card">')
  expect(html).not.toContain('http')
  // 所有文本来源都过同一个 escapeHtml，漏一处即破版
  expect(html).toContain('&quot;引号&quot;')

  await app.close()
})
