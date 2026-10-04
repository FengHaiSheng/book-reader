import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import {
  bodyMarginFiles,
  longBookFiles,
  novelFiles,
  oneParagraphFiles,
  secureFiles,
  writeEpub
} from '../fixtures/make-epub'
import { launchAppWithUserData } from './helpers'

test('打开一本书返回目录与空进度，存进去的进度能读回来，删书连进度一起清', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-reader-'))
  const epubPath = join(userDataDir, 'novel.epub')
  await writeEpub(epubPath, novelFiles())

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()
  const imported = await win.evaluate(
    (file) => (window as any).api.library.importPath(file),
    epubPath
  )
  const bookId = imported.bookId as string

  const opened = await win.evaluate((id) => (window as any).api.reader.open(id), bookId)
  expect(opened.title).toBe('河边的月亮')
  expect(opened.author).toBe('测试作者')
  expect(opened.chapters.map((c: { title: string }) => c.title)).toEqual(['第一章 河边', '第二章 夏夜'])
  expect(opened.chapters[0].spineIndex).toBe(0)
  expect(opened.chapters[0].href).toBe('OEBPS/ch1.xhtml')
  expect(opened.progress).toBeNull()

  await win.evaluate(
    (id) =>
      (window as any).api.reader.saveProgress({
        bookId: id,
        cfi: 'epubcfi(/6/2!/4/2/1:0)',
        chapterId: 2,
        percent: 0.4
      }),
    bookId
  )

  const again = await win.evaluate((id) => (window as any).api.reader.open(id), bookId)
  expect(again.progress.cfi).toBe('epubcfi(/6/2!/4/2/1:0)')
  expect(again.progress.chapterId).toBe(2)
  expect(again.progress.percent).toBeCloseTo(0.4, 5)

  const books = await win.evaluate(() => (window as any).api.library.list())
  expect(books[0].status).toBe('reading')
  expect(books[0].lastOpenedAt).not.toBeNull()

  await win.evaluate((id) => (window as any).api.library.remove(id), bookId)
  expect(await win.evaluate((id) => (window as any).api.reader.open(id), bookId)).toBeNull()

  await app.close()
})

/** 从工具条上的「1 / 12」里读出总页数 */
async function readPageCount(win: import('playwright').Page): Promise<number> {
  const text = await win.locator('.reader__page').innerText()
  return Number(text.split('/')[1]!.trim())
}

/**
 * 等章节文档真正载入。
 *
 * 取回 XHTML、加工、装进 iframe、注入 `#reader-theme` 全是异步的，
 * 在这之前读 iframe 拿到的是初始空白文档（body 字号是浏览器默认的 16px）。
 */
async function waitForChapterLoaded(win: import('playwright').Page): Promise<void> {
  await win.waitForFunction(() => {
    const frame = document.querySelector('iframe.reader__view') as HTMLIFrameElement | null
    return frame?.contentDocument?.getElementById('reader-theme') != null
  })
}

test('打开一本书：正文渲染出来、能翻页、到边界停在原地', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-page-'))
  const epubPath = join(userDataDir, 'long.epub')
  await writeEpub(epubPath, longBookFiles())

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()
  await win.evaluate((file) => (window as any).api.library.importPath(file), epubPath)
  // 这里走的是 API 导入，绕过了界面上的导入按钮，书架不会自己刷新 —— 重载一次让列表读到新书
  await win.reload()

  await win.getByRole('button', { name: '打开' }).click()
  await expect(win.locator('.reader')).toBeVisible()
  await expect(win.locator('.reader__chapter')).toHaveText('第一章 河边')

  // 长章必须跨页，否则这个测试什么也没证明
  await waitForChapterLoaded(win)
  const total = await readPageCount(win)
  expect(total).toBeGreaterThan(1)
  await expect(win.locator('.reader__page')).toHaveText(`1 / ${total}`)

  await win.getByRole('button', { name: '下一页' }).click()
  await expect(win.locator('.reader__page')).toHaveText(`2 / ${total}`)

  // 翻页是正文真的位移了：body 的 translateX 变成负的
  const shifted = await win.evaluate(() => {
    const doc = (document.querySelector('iframe') as HTMLIFrameElement).contentDocument!
    return Math.round(new DOMMatrix(getComputedStyle(doc.body).transform).m41)
  })
  expect(shifted).toBeLessThan(0)

  await win.getByRole('button', { name: '上一页' }).click()
  await expect(win.locator('.reader__page')).toHaveText(`1 / ${total}`)
  // 已经是第一页，再往前应该停在原地（换章是 Task 7 的事）
  await win.getByRole('button', { name: '上一页' }).click()
  await expect(win.locator('.reader__page')).toHaveText(`1 / ${total}`)

  // 键盘也要能用
  await win.locator('.reader__stage').click()
  await win.keyboard.press('ArrowRight')
  await expect(win.locator('.reader__page')).toHaveText(`2 / ${total}`)

  await app.close()
})

test('目录换章、翻到章尾进下一章，进度在重启后仍在', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-resume-'))
  const epubPath = join(userDataDir, 'long.epub')
  await writeEpub(epubPath, longBookFiles())

  let app = await launchAppWithUserData(userDataDir)
  let win = await app.firstWindow()
  await win.evaluate((file) => (window as any).api.library.importPath(file), epubPath)
  await win.reload()
  await win.getByRole('button', { name: '打开' }).click()
  await expect(win.locator('.reader__chapter')).toHaveText('第一章 河边')
  await waitForChapterLoaded(win)

  // 目录换章：第二章只有一页
  await win.getByRole('button', { name: '第二章 夏夜' }).click()
  await expect(win.locator('.reader__chapter')).toHaveText('第二章 夏夜')
  await expect(win.locator('.reader__page')).toHaveText('1 / 1')

  // 回到第一章，翻到第 2 页
  await win.getByRole('button', { name: '第一章 河边' }).click()
  await expect(win.locator('.reader__chapter')).toHaveText('第一章 河边')
  await win.getByRole('button', { name: '下一页' }).click()
  const total = await readPageCount(win)
  await expect(win.locator('.reader__page')).toHaveText(`2 / ${total}`)

  // 翻到章尾再往前翻，应该进第二章
  for (let index = 2; index < total; index += 1) {
    await win.getByRole('button', { name: '下一页' }).click()
  }
  await expect(win.locator('.reader__page')).toHaveText(`${total} / ${total}`)
  await win.getByRole('button', { name: '下一页' }).click()
  await expect(win.locator('.reader__chapter')).toHaveText('第二章 夏夜')

  // 往回翻也应该回到第一章的最后一页
  await win.getByRole('button', { name: '上一页' }).click()
  await expect(win.locator('.reader__chapter')).toHaveText('第一章 河边')
  await expect(win.locator('.reader__page')).toHaveText(`${total} / ${total}`)

  // 停在第 2 页，等防抖落库后退出
  for (let index = total; index > 2; index -= 1) {
    await win.getByRole('button', { name: '上一页' }).click()
  }
  await expect(win.locator('.reader__page')).toHaveText('2 / ' + total)
  await win.waitForTimeout(900)
  await win.getByRole('button', { name: '返回书架' }).click()
  await expect(win.locator('.reader')).toBeHidden()

  // 重启：位置必须还在第一章第 2 页
  await app.close()
  app = await launchAppWithUserData(userDataDir)
  win = await app.firstWindow()
  await win.getByRole('button', { name: '打开' }).click()
  await expect(win.locator('.reader__chapter')).toHaveText('第一章 河边')
  await expect(win.locator('.reader__page')).toHaveText(`2 / ${total}`)

  await app.close()
})

/**
 * 恢复进度要按「这个字真正画在哪一栏」算。
 *
 * 页首那个字落在分栏边界上时，Chromium 把折叠 Range 报在两栏之间 —— 量到的 left
 * 比本栏左沿还小一个栏间距，页码就会倒退一页。这里逐页验：存进度、重新打开，
 * 页码不跳。用 `oneParagraphFiles()` 正是为了让第 2 页起都从段落中间起排。
 */
test('每页存进度再打开都回到原页，段落中间起排的页也不例外', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-restore-'))
  const epubPath = join(userDataDir, 'one-paragraph.epub')
  await writeEpub(epubPath, oneParagraphFiles())

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()
  await win.evaluate((file) => (window as any).api.library.importPath(file), epubPath)
  await win.reload()
  await win.getByRole('button', { name: '打开' }).click()
  await expect(win.locator('.reader__chapter')).toHaveText('第一章 河边')
  await waitForChapterLoaded(win)

  const total = await readPageCount(win)
  // 页数太少就没有「段落中间起排」的页，这个测试也就什么也没证明
  expect(total).toBeGreaterThan(2)

  for (let page = 1; page <= total; page += 1) {
    if (page > 1) await win.getByRole('button', { name: '下一页' }).click()
    await expect(win.locator('.reader__page')).toHaveText(`${page} / ${total}`)

    // 「返回书架」会立刻落库，不必等 600ms 的防抖
    await win.getByRole('button', { name: '返回书架' }).click()
    await win.getByRole('button', { name: '打开' }).click()
    await expect(win.locator('.reader__chapter')).toHaveText('第一章 河边')
    await waitForChapterLoaded(win)
    await expect(win.locator('.reader__page')).toHaveText(`${page} / ${total}`)
  }

  await app.close()
})

/**
 * 当前页里最靠左那行文字的位置，相对 iframe 左沿 —— 被裁掉就是负值。
 *
 * 只算横向落在可视区里的行，所以量到的是「这一页画出来的最左沿」，
 * 而不是被移到可视区外的那几栏。
 */
async function leftmostTextLeft(win: import('playwright').Page): Promise<number> {
  return win.evaluate(() => {
    const iframe = document.querySelector('iframe.reader__view') as HTMLIFrameElement
    const doc = iframe.contentDocument as Document
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
    let left = Infinity
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!(node.textContent ?? '').trim()) continue
      const range = doc.createRange()
      range.selectNodeContents(node)
      for (const rect of Array.from(range.getClientRects())) {
        if (rect.width < 1 || rect.right < 0 || rect.left > iframe.clientWidth) continue
        left = Math.min(left, rect.left)
      }
    }
    return left === Infinity ? 0 : left
  })
}

/**
 * 书自带样式给 body 垫外边距时（calibre 转出来的 epub 几乎都这样），分栏容器不能被挤窄。
 *
 * 书里的规则是类选择器，优先级压过阅读器注入的 `body { margin: 0 }`。容器一窄，
 * 浏览器就按更小的栏距排栏，而翻页步长仍按版心宽算 —— 每翻一页多走一个外边距，
 * 页码越大正文左边被切得越多，第 3 页起就切掉整个字。
 */
test('书自带 body 外边距时，每页正文左边都不被切掉', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-body-margin-'))
  const epubPath = join(userDataDir, 'body-margin.epub')
  await writeEpub(epubPath, bodyMarginFiles())

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()
  await win.evaluate((file) => (window as any).api.library.importPath(file), epubPath)
  await win.reload()
  await win.getByRole('button', { name: '打开' }).click()
  await expect(win.locator('.reader__chapter')).toHaveText('第一章 河边')
  await waitForChapterLoaded(win)

  const total = await readPageCount(win)
  // 只有一两页就攒不出位移，这个测试也就什么也没证明
  expect(total).toBeGreaterThan(2)

  for (let page = 1; page <= Math.min(total, 4); page += 1) {
    if (page > 1) await win.getByRole('button', { name: '下一页' }).click()
    await expect(win.locator('.reader__page')).toHaveText(`${page} / ${total}`)
    expect(await leftmostTextLeft(win)).toBeGreaterThanOrEqual(-0.5)
  }

  await app.close()
})

/**
 * 从父页面里探一眼章节文档的内部。
 *
 * 能这么读，正是因为 iframe 的 sandbox 里有 allow-same-origin —— 这是**功能前提**
 * （父文档要读它的 DOM 才能分页与画高亮），不是安全让步：脚本仍被 CSP 与摘除挡在门外，
 * 下面每一条断言都在验这一点。
 */
async function readChapterDom(win: import('playwright').Page) {
  return win.evaluate(() => {
    const frame = document.querySelector('iframe.reader__view') as HTMLIFrameElement | null
    const doc = frame?.contentDocument ?? null
    const image = doc?.querySelector('#book-img') as HTMLImageElement | null
    const heading = doc?.querySelector('#book-h') as HTMLElement | null
    return {
      sandbox: frame?.getAttribute('sandbox') ?? null,
      scriptCount: doc ? doc.getElementsByTagName('script').length : -1,
      pwned: (frame?.contentWindow as unknown as { __pwned?: boolean } | null)?.__pwned ?? null,
      bodyPwned: doc?.body?.getAttribute('data-pwned') ?? null,
      imgSrc: image?.getAttribute('src') ?? null,
      imgComplete: image?.complete ?? null,
      imgNaturalWidth: image?.naturalWidth ?? null,
      headingColor: heading ? getComputedStyle(heading).color : null,
      bodyFontSize: doc?.body ? getComputedStyle(doc.body).fontSize : null
    }
  })
}

test('书内脚本一律不执行，书内图片与样式照常生效', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-secure-'))
  const epubPath = join(userDataDir, 'secure.epub')
  await writeEpub(epubPath, secureFiles())

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()
  await win.evaluate((file) => (window as any).api.library.importPath(file), epubPath)
  await win.reload()

  await win.getByRole('button', { name: '打开' }).click()
  await expect(win.locator('.reader__chapter')).toHaveText('第一章 河边')

  // 图片解码完成是异步的，先等到 complete 再一次性取样
  await win.waitForFunction(() => {
    const frame = document.querySelector('iframe.reader__view') as HTMLIFrameElement | null
    const image = frame?.contentDocument?.querySelector('#book-img') as HTMLImageElement | null
    return image?.complete === true
  })

  const dom = await readChapterDom(win)

  // 四道锁：摘 script 节点 → 文档内 meta CSP → 协议响应头 → iframe sandbox
  expect(dom.sandbox).toBe('allow-same-origin')
  expect(dom.scriptCount).toBe(0)
  expect(dom.pwned).toBeNull()
  expect(dom.bodyPwned).toBeNull()

  // 反面：不能为了安全把书读废 —— 图片要显示、书内样式表要生效
  expect(dom.imgSrc).toBe('images/dot.gif')
  expect(dom.imgComplete).toBe(true)
  expect(dom.imgNaturalWidth).toBe(1)
  expect(dom.headingColor).toBe('rgb(1, 2, 3)')

  await app.close()
})

test('窗口变窄时排版降级，界面明说而不是静默处理', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-degrade-'))
  const epubPath = join(userDataDir, 'long.epub')
  await writeEpub(epubPath, longBookFiles())

  const app = await launchAppWithUserData(userDataDir)
  const win = await app.firstWindow()
  await win.evaluate((file) => (window as any).api.library.importPath(file), epubPath)
  await win.reload()
  await win.getByRole('button', { name: '打开' }).click()
  await expect(win.locator('.reader__chapter')).toHaveText('第一章 河边')
  await waitForChapterLoaded(win)

  // 默认 1440 宽：34 字放得下，不该有任何降级提示
  await expect(win.locator('.reader__degrade')).toBeHidden()

  // 900 仍高于 NARROW_WIDTH(840)：只该压「每行字数」，不该降字号。
  // 用 900 而不是贴着 840，是为了躲开 macOS 上窗口边框带来的几像素误差。
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]!.setSize(900, 700)
  })

  const notice = win.locator('.reader__degrade')
  await expect(notice).toBeVisible()
  await expect(notice).toContainText('字／行')
  await expect(notice).not.toContainText('字号已从')

  await app.close()
})

test('Aa 面板改字号立刻生效，重进应用后仍然是新值', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-typo-'))
  const epubPath = join(userDataDir, 'long.epub')
  await writeEpub(epubPath, longBookFiles())

  let app = await launchAppWithUserData(userDataDir)
  let win = await app.firstWindow()
  await win.evaluate((file) => (window as any).api.library.importPath(file), epubPath)
  await win.reload()
  await win.getByRole('button', { name: '打开' }).click()
  await expect(win.locator('.reader__chapter')).toHaveText('第一章 河边')

  // 默认字号 19，面板没打开时没有滑块可拖
  await waitForChapterLoaded(win)
  expect((await readChapterDom(win)).bodyFontSize).toBe('19px')
  await win.getByRole('button', { name: '排版' }).click()

  // step=1，按一次右键就是 +1
  await win.locator('#prefs-fontSize').focus()
  await win.keyboard.press('ArrowRight')
  await expect.poll(async () => (await readChapterDom(win)).bodyFontSize).toBe('20px')

  // 等过 300ms 的防抖窗口，再退出
  await win.waitForTimeout(500)
  await win.getByRole('button', { name: '返回书架' }).click()
  await expect(win.locator('.reader')).toBeHidden()
  await app.close()

  // 重启：偏好存在 settings 表里，与书无关
  app = await launchAppWithUserData(userDataDir)
  win = await app.firstWindow()
  await win.getByRole('button', { name: '打开' }).click()
  await expect(win.locator('.reader__chapter')).toHaveText('第一章 河边')
  await expect.poll(async () => (await readChapterDom(win)).bodyFontSize).toBe('20px')

  await app.close()
})
