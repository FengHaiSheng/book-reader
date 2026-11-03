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
 * 全库跨书搜索：书名筛选与正文搜索分离；点命中进阅读后浮层仍在，可再点下一条。
 */
test('全库搜正文：浮层分页、进阅读仍可点、关闭保留输入、Esc 清空', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-allsearch-'))
  const epubPath = join(userDataDir, 'long.epub')
  await writeEpub(epubPath, longBookFiles())

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()
  await win.evaluate((file) => (window as any).api.library.importPath(file), epubPath)
  await win.reload()

  // 「蝉声」只在第二章出现
  await win.locator('.search__input').fill('蝉声')
  await win.locator('.search-group__go').click()
  await expect(win.locator('.libsearch')).toBeVisible()
  await expect(win.locator('.libsearch__ghead')).toContainText('《河边的月亮》')
  await expect(win.locator('.libsearch__mark').first()).toHaveText('蝉声')

  // 纯标点
  await win.locator('.search__input').fill('……')
  await win.locator('.search__input').press('Enter')
  await expect(win.locator('.libsearch__empty')).toContainText('没有可检索的字符')
  await expect(win.locator('.libsearch__list')).toHaveCount(0)

  // Esc：输入与结果一起清
  await win.locator('.search__input').press('Escape')
  await expect(win.locator('.libsearch')).toBeHidden()
  await expect(win.locator('.search__input')).toHaveValue('')

  // 多命中词：进阅读后浮层细条还在，展开可再点
  await win.locator('.search__input').fill('薄薄的雾')
  await win.locator('.search__input').press('Enter')
  await expect(win.locator('.libsearch__item').first()).toBeVisible()
  const hitCount = await win.locator('.libsearch__item').count()
  expect(hitCount).toBeGreaterThan(1)

  await win.locator('.libsearch__item').first().click()
  await expect(win.locator('.reader__chapter')).toHaveText('第一章 河边')
  await waitForChapterLoaded(win)
  await expect.poll(async () => (await flashNames(win)).includes('cite-flash')).toBe(true)

  // 点开后浮层应收成细条，但仍挂在壳层上
  await expect(win.locator('.libsearch')).toBeVisible()
  await expect(win.locator('.libsearch')).toHaveClass(/libsearch--collapsed/)
  await expect(win.locator('.libsearch__list')).toHaveCount(0)

  await win.locator('.libsearch__acts button', { hasText: '展开' }).click()
  await expect(win.locator('.libsearch__item').nth(1)).toBeVisible()
  await win.locator('.libsearch__item').nth(1).click()
  await waitForChapterLoaded(win)
  await expect.poll(async () => (await flashNames(win)).includes('cite-flash')).toBe(true)
  await expect(win.locator('.libsearch')).toHaveClass(/libsearch--collapsed/)

  // 关闭：丢掉结果，回到书架后输入仍在
  await win.locator('.libsearch__acts button', { hasText: '关闭' }).click()
  await expect(win.locator('.libsearch')).toBeHidden()

  // 侧栏回书架（阅读中点书架会直接离开，见壳层行为）
  await win.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '书架' }).click()
  await expect(win.locator('.search__input')).toHaveValue('薄薄的雾')

  await app.close()
})
