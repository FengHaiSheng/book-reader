import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { aiBookFiles, novelFiles, writeEpub } from '../fixtures/make-epub'
import { aiPrompts, installAiStub, launchAppWithUserData } from './helpers'

test('这家不提供向量检索 —— 面板明说降级，不静默', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-ai-noembed-'))
  const epubPath = join(userDataDir, 'novel.epub')
  await writeEpub(epubPath, novelFiles())

  const app = await launchAppWithUserData(userDataDir)
  await installAiStub(app, {})
  const win = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1200, 800))

  await win.evaluate(async (file) => {
    await (window as any).api.secrets.set('deepseek', 'sk-stub-key')
    await (window as any).api.library.importPath(file)
  }, epubPath)

  await win.reload()
  await win.locator('.book-list__open').first().click()
  await expect(win.locator('.reader__chapter')).toHaveText('第一章 河边')
  await win.locator('iframe.reader__view').waitFor()

  // 先开面板再划词：面板挂载时会异步回填历史，若划词动作与这次回填同时在飞，
  // 后到的空历史会把刚建的用户/助手两条消息覆盖掉 —— 先让面板就位再注入划词动作。
  await win.getByRole('button', { name: 'AI', exact: true }).click()
  await expect(win.locator('.ai-panel__empty')).toBeVisible()

  await win.evaluate(() => {
    const frame = document.querySelector('iframe.reader__view') as HTMLIFrameElement
    const doc = frame.contentDocument!
    const node = doc.querySelector('p')!.firstChild as Text
    const range = doc.createRange()
    range.setStart(node, 0)
    range.setEnd(node, 8)
    const selection = doc.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
  })
  await win.locator('.sel-toolbar').waitFor()
  await win.getByRole('button', { name: '解释' }).click()

  // deepseek 的声明里 embed 是 false，说明必须出现在回答上方
  const answer = win.locator('.ai-msg--assistant').last()
  await expect(answer.locator('.ai-degrade')).toContainText('不提供向量检索')
  await expect(answer.locator('.ai-degrade')).toContainText('关键词检索')

  await app.close()
})

test('模型其实不支持结构化输出 —— 结果里说明改用了提示词约束', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-ai-nojson-'))
  const epubPath = join(userDataDir, 'novel.epub')
  await writeEpub(epubPath, novelFiles())

  const app = await launchAppWithUserData(userDataDir)
  await installAiStub(app, {
    payload: { overview: '这一章写河边的月色。', keyPoints: ['月色'], terms: [] }
  })
  const win = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1200, 800))

  await win.evaluate(async (file) => {
    await (window as any).api.secrets.set('deepseek', 'sk-stub-key')
    await (window as any).api.library.importPath(file)
    // deepseek-reasoner 在内置清单里 jsonMode 为 false
    await (window as any).api.settings.set('ai.model', 'deepseek-reasoner')
  }, epubPath)

  await win.reload()
  await win.locator('.book-list__open').first().click()
  await expect(win.locator('.reader__chapter')).toHaveText('第一章 河边')
  await win.locator('iframe.reader__view').waitFor()

  await win.getByRole('button', { name: 'AI', exact: true }).click()
  const card = win.locator('.ai-task').filter({ hasText: '本章小结' })
  await card.getByRole('button', { name: '生成' }).click()
  await card.getByRole('button', { name: '开始' }).click()

  await expect(card.locator('.ai-task__text')).toContainText('这一章写河边的月色')
  await expect(card.locator('.ai-task__result .ai-degrade')).toContainText('已改为提示词约束')

  await app.close()
})

test('正文超出上下文上限 —— 结果里说明有段落没有送进去', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-ai-long-'))
  const epubPath = join(userDataDir, 'long.epub')
  await writeEpub(epubPath, aiBookFiles())

  const app = await launchAppWithUserData(userDataDir)
  await installAiStub(app, {
    payload: { overview: '第一章是一整夜。', keyPoints: ['长夜'], terms: [] }
  })
  const win = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1200, 800))

  await win.evaluate(async (file) => {
    await (window as any).api.secrets.set('kimi', 'sk-stub-key')
    await (window as any).api.library.importPath(file)
    // moonshot-v1-8k 的窗口只有 8000 token，装不下这一章
    await (window as any).api.settings.set('ai.provider', 'kimi')
    await (window as any).api.settings.set('ai.model', 'moonshot-v1-8k')
  }, epubPath)

  await win.reload()
  await win.locator('.book-list__open').first().click()
  await expect(win.locator('.reader__chapter')).toHaveText('第一章 长夜')
  await win.locator('iframe.reader__view').waitFor()

  await win.getByRole('button', { name: 'AI', exact: true }).click()
  const card = win.locator('.ai-task').filter({ hasText: '本章小结' })
  await card.getByRole('button', { name: '生成' }).click()
  await card.getByRole('button', { name: '开始' }).click()

  // 分段读取与「丢了多少段」必须同时出现：只说「分 N 段」，用户无从知道剩下几段被扔了
  await expect(card.locator('.ai-task__result .ai-degrade')).toContainText('分 6 段读取后合成')
  await expect(card.locator('.ai-task__result .ai-degrade')).toContainText(
    '超出当前模型的上下文上限'
  )

  await app.close()
})

test('全书要点：长章节的正文真的进了提示词，不会被自己的长度挤成空串', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-ai-digest-long-'))
  const epubPath = join(userDataDir, 'long.epub')
  await writeEpub(epubPath, aiBookFiles())

  const app = await launchAppWithUserData(userDataDir)
  await installAiStub(app, {
    payload: {
      overview: '第一章是一整夜。',
      keyPoints: ['长夜'],
      terms: [],
      threads: ['长夜'],
      arguments: ['夜色沉入河底'],
      conclusion: '一夜过去。'
    }
  })
  const win = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1200, 800))

  await win.evaluate(async (file) => {
    await (window as any).api.secrets.set('kimi', 'sk-stub-key')
    await (window as any).api.library.importPath(file)
    // 8k 窗口是最能暴露这个 bug 的场景：整章正文比窗口还大
    await (window as any).api.settings.set('ai.provider', 'kimi')
    await (window as any).api.settings.set('ai.model', 'moonshot-v1-8k')
  }, epubPath)

  await win.reload()
  await win.locator('.book-list__open').first().click()
  await expect(win.locator('.reader__chapter')).toHaveText('第一章 长夜')
  await win.locator('iframe.reader__view').waitFor()

  await win.getByRole('button', { name: 'AI', exact: true }).click()
  const card = win.locator('.ai-task').filter({ hasText: '全书要点' })
  await card.getByRole('button', { name: '生成' }).click()
  await card.getByRole('button', { name: '开始' }).click()
  await expect(card.locator('.ai-task__result .ai-degrade')).toContainText('逐章读取了 2 章')
  await expect(card.locator('.ai-task__result .ai-degrade')).toContainText('只读了前半部分')

  // 两章各一次 + 最后归纳一次
  const prompts = await aiPrompts(app)
  expect(prompts).toHaveLength(3)

  // 关键断言：第一章（长章）的那次请求里必须真的有正文。
  // 旧口径把整章正文当 query 又扣了一次预算，bookDigest 直接掉到 400 的下限，
  // 于是一段都装不下 —— 请求次数、返回结果全都正常，只有提示词里的正文是空的。
  const chapterPrompt = prompts[0]!
  expect(chapterPrompt).toContain('月色沉入河底')
  const paragraphs = chapterPrompt.match(/第\s*\d+\s*段/g) ?? []
  expect(paragraphs.length).toBeGreaterThanOrEqual(6)

  await app.close()
})