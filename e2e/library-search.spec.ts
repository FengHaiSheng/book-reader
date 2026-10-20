import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { longBookFiles, writeEpub } from '../fixtures/make-epub'
import { launchAppWithUserData } from './helpers'

/** 章节文档真正载入（取回 XHTML、加工、注入 #reader-theme 都是异步的） */
async function waitForChapterLoaded(win: import('playwright').Page): Promise<void> {
  await win.waitForFunction(() => {
    const frame = document.querySelector('iframe.reader__view') as HTMLIFrameElement | null
    return frame?.contentDocument?.getElementById('reader-theme') != null
  })
}

/** 章节文档里注册着的临时高亮名（定位成功会闪一下） */
async function flashNames(win: import('playwright').Page): Promise<string[]> {
  return win.evaluate(() => {
    const frame = document.querySelector('iframe.reader__view') as HTMLIFrameElement
    const css = (frame.contentWindow as { CSS?: { highlights?: Map<string, unknown> } }).CSS
    return css?.highlights ? [...css.highlights.keys()] : []
  })
}

/**
 * 全库跨书搜索的一个关键性质：书名筛选（逐字、零 IPC）与正文搜索（显式触发、一条 FTS）
 * 是两件事，输入框里打字只过滤书名，绝不能顺手发检索。
 */
test('全库搜正文：命中分组、点开落到位、纯标点给提示、Esc 清空', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-allsearch-'))
  const epubPath = join(userDataDir, 'long.epub')
  await writeEpub(epubPath, longBookFiles())

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()
  await win.evaluate((file) => (window as any).api.library.importPath(file), epubPath)
  await win.reload()

  // 「蝉声」只在第二章出现，正好用来验「点一条进书并落到那一章」
  await win.locator('.search__input').fill('蝉声')
  await win.locator('.search__input').press('Enter')
  await expect(win.locator('.libsearch')).toBeVisible()
  await expect(win.locator('.libsearch__ghead')).toContainText('《河边的月亮》')
  // 命中词要在摘要里标出来，否则一堆相似句子分不出差别
  await expect(win.locator('.libsearch__mark').first()).toHaveText('蝉声')

  // 只有标点的关键词切不出 token：查不了和查不到是两回事，必须分开说
  await win.locator('.search__input').fill('……')
  await win.locator('.search__input').press('Enter')
  await expect(win.locator('.libsearch__empty')).toContainText('没有可检索的字符')
  await expect(win.locator('.libsearch__list')).toHaveCount(0)

  // Esc 把书名筛选与正文结果一起清掉
  await win.locator('.search__input').press('Escape')
  await expect(win.locator('.libsearch')).toBeHidden()
  await expect(win.locator('.search__input')).toHaveValue('')

  await win.locator('.search__input').fill('蝉声')
  await win.locator('.search__input').press('Enter')
  await expect(win.locator('.libsearch__item').first()).toBeVisible()

  await win.locator('.libsearch__item').first().click()
  await expect(win.locator('.reader__chapter')).toHaveText('第二章 夏夜')
  // 跨章 / 摘录定位要等新文档就位后由定位链完成，闪烁只亮 2 秒 —— 轮询等它出现
  await waitForChapterLoaded(win)
  await expect.poll(async () => (await flashNames(win)).includes('cite-flash')).toBe(true)

  await app.close()
})
