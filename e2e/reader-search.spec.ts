import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { longBookFiles, writeEpub } from '../fixtures/make-epub'
import { launchAppWithUserData } from './helpers'

/** 书架默认是网格视图，切到列表再点「打开」，与既有的阅读器用例保持同一条路径 */
async function openFirstBook(win: import('playwright').Page): Promise<void> {
  await win.getByRole('button', { name: '列表' }).click()
  await win.getByRole('button', { name: '打开' }).click()
}

/** 章节文档真正载入（取回 XHTML、加工、注入 #reader-theme 都是异步的） */
async function waitForChapterLoaded(win: import('playwright').Page): Promise<void> {
  await win.waitForFunction(() => {
    const frame = document.querySelector('iframe.reader__view') as HTMLIFrameElement | null
    return frame?.contentDocument?.getElementById('reader-theme') != null
  })
}

/** 章节文档里注册着的临时高亮名（引用回跳与查找定位共用同一个） */
async function flashNames(win: import('playwright').Page): Promise<string[]> {
  return win.evaluate(() => {
    const frame = document.querySelector('iframe.reader__view') as HTMLIFrameElement
    const css = (frame.contentWindow as { CSS?: { highlights?: Map<string, unknown> } }).CSS
    return css?.highlights ? [...css.highlights.keys()] : []
  })
}

/**
 * 书内查找走的是已有的 `library:search`（bigram + FTS5，纯本地不花钱），
 * 这里验的是补上的那层 UI：⌘F 打开一条独立查找条、目录不被顶掉、
 * 结果按章节给出、点一条或回车都能跳过去并闪一下。
 */
test('书内查找：独立查找条不占左栏，点结果跳章并闪一下，回车走下一条', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-find-'))
  const epubPath = join(userDataDir, 'long.epub')
  await writeEpub(epubPath, longBookFiles())

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()
  await win.evaluate((file) => (window as any).api.library.importPath(file), epubPath)
  await win.reload()
  await openFirstBook(win)
  await expect(win.locator('.reader__chapter')).toHaveText('第一章 河边')
  await expect(win.locator('.toc')).toBeVisible()

  await win.keyboard.press('Meta+f')
  await expect(win.locator('.findbar')).toBeVisible()
  await expect(win.locator('.findbar__input')).toBeFocused()
  // 查找条贴工具条下方，目录照旧留在左栏 —— 这次改的就是这一点
  await expect(win.locator('.toc')).toBeVisible()

  // 「蝉声」只在第二章出现，正好用来验证跨章跳转
  await win.locator('.findbar__input').fill('蝉声')
  await expect(win.locator('.findbar__status')).toHaveText('第 1 / 1 条')
  await expect(win.locator('.findbar__chapter')).toHaveText('第二章 夏夜')
  // 命中词要在摘要里标出来，否则一堆相似句子分不出差别
  await expect(win.locator('.findbar__mark')).toHaveText('蝉声')

  await win.locator('.findbar__item').first().click()
  await expect(win.locator('.reader__chapter')).toHaveText('第二章 夏夜')
  // 跨章定位要等新文档就位后由定位链完成，闪烁只亮 2 秒 —— 轮询等它出现，不等固定时长
  await waitForChapterLoaded(win)
  await expect.poll(async () => (await flashNames(win)).includes('cite-flash')).toBe(true)

  // 第一章有 60 段、每段都有这句，切块后必然是多条结果 —— 用来验「回车走下一条」
  // 条数取决于分块大小，所以只断言总数大于 1，不写死
  await win.locator('.findbar__input').fill('薄薄的雾')
  await expect(win.locator('.findbar__status')).toHaveText(/^第 1 \/ \d+ 条$/)
  const total = Number((await win.locator('.findbar__status').innerText()).match(/\/ (\d+) 条/)?.[1])
  expect(total).toBeGreaterThan(1)

  await win.locator('.findbar__input').press('Enter')
  await expect(win.locator('.findbar__status')).toHaveText(`第 2 / ${total} 条`)
  // 当前停在哪一条要在列表里看得出来
  await expect(win.locator('.findbar__item--active')).toHaveCount(1)

  // 单个汉字也要能查到：索引除二字滑窗之外，另有一列「每个汉字一枚」
  await win.locator('.findbar__input').fill('雾')
  await expect(win.locator('.findbar__status')).toHaveText(/^第 1 \/ \d+ 条$/)
  await expect(win.locator('.findbar__mark').first()).toHaveText('雾')

  // 只有标点的关键词切不出 token，不能报成「没找到」——查不了和查不到是两回事
  await win.locator('.findbar__input').fill('……')
  await expect(win.locator('.findbar__status')).toContainText('没有可检索的汉字或字母')
  await expect(win.locator('.findbar__list')).toBeHidden()

  // Esc 只收查找条，不该顺手把阅读也退了
  await win.locator('.findbar__input').press('Escape')
  await expect(win.locator('.findbar')).toBeHidden()
  await expect(win.locator('.toc')).toBeVisible()
  await expect(win.locator('.reader')).toBeVisible()

  await app.close()
})
