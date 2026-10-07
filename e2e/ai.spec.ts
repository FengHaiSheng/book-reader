import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { novelFiles, writeEpub } from '../fixtures/make-epub'
import { aiCallCount, installAiStub, launchAppWithUserData } from './helpers'

test('划词解释：流式上屏、引用可点回原文、用量与历史都落地', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-ai-'))
  const epubPath = join(userDataDir, 'novel.epub')
  await writeEpub(epubPath, novelFiles())

  const app = await launchAppWithUserData(userDataDir)
  await installAiStub(app, { deltas: ['这句话的意思是', '月色写的是孤独[1]。'] })
  const win = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1200, 800))

  const bookId = await win.evaluate(async (file) => {
    await (window as any).api.secrets.set('deepseek', 'sk-stub-key')
    return (await (window as any).api.library.importPath(file)).bookId as string
  }, epubPath)

  const chapterId = await win.evaluate(async (id) => {
    const opened = await (window as any).api.reader.open(id)
    const first = opened.chapters.find((chapter: { href: string }) => chapter.href !== '')
    return first.id as number
  }, bookId)

  await win.reload()
  // 书架默认是网格视图，用卡片打开（.book-list__open 只在列表视图里）
  await win.locator('.book-card').first().click()
  await expect(win.locator('.reader__chapter')).toHaveText('第一章 河边')
  await win.locator('iframe.reader__view').waitFor()

  // 先开面板再划词：面板挂载时会异步回填历史，若划词动作与这次回填同时在飞，
  // 后到的空历史会把刚建的用户/助手两条消息覆盖掉 —— 先让面板就位再注入划词动作。
  await win.getByRole('button', { name: 'AI', exact: true }).click()
  await expect(win.locator('.ai-panel__empty')).toBeVisible()

  // 划第一句，点「解释」。这一下本身就是完整的显式指令，会立刻发请求
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

  const answer = win.locator('.ai-msg--assistant').last()
  await expect(answer.locator('.ai-msg__body')).toContainText('月色写的是孤独')
  // 引用上标是一个按钮，不是纯文本
  await expect(answer.locator('.ai-cite').first()).toBeVisible()
  // BYOK 的每一分钱都要看得见
  await expect(answer.locator('.ai-msg__meta')).toContainText('token')

  // 点引用回跳：闪烁高亮注册进章节文档
  await answer.locator('.ai-cite').first().click()
  await expect
    .poll(async () =>
      win.evaluate(() => {
        const frame = document.querySelector('iframe.reader__view') as HTMLIFrameElement
        const css = (frame.contentWindow as any).CSS
        return css?.highlights ? [...css.highlights.keys()] : []
      })
    )
    .toContain('cite-flash')

  // 用户那条 + 助手那条，两条都落了库
  await expect
    .poll(async () =>
      win.evaluate(
        async (arg: { bookId: string; scopeKey: string }) =>
          (await (window as any).api.ai.history(arg.bookId, arg.scopeKey)).length,
        { bookId, scopeKey: `chapter:${chapterId}` }
      )
    )
    .toBe(2)

  // 引用一并落库：历史读回来后 [n] 才能继续点回原文
  const stored = await win.evaluate(
    async (arg: { bookId: string; scopeKey: string }) =>
      (await (window as any).api.ai.history(arg.bookId, arg.scopeKey)) as {
        role: string
        citations: unknown[]
      }[],
    { bookId, scopeKey: `chapter:${chapterId}` }
  )
  expect(stored[1]!.citations.length).toBeGreaterThan(0)

  await app.close()
})

test('本章小结：先说成本、生成后重算走缓存、一次都没多花', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-ai-task-'))
  const epubPath = join(userDataDir, 'novel.epub')
  await writeEpub(epubPath, novelFiles())

  const app = await launchAppWithUserData(userDataDir)
  await installAiStub(app, {
    payload: { overview: '这一章写河边的月色与一次重逢。', keyPoints: ['月色', '重逢'], terms: [] }
  })
  const win = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1200, 800))

  const bookId = await win.evaluate(async (file) => {
    await (window as any).api.secrets.set('deepseek', 'sk-stub-key')
    return (await (window as any).api.library.importPath(file)).bookId as string
  }, epubPath)

  await win.reload()
  await win.locator('.book-card').first().click()
  await expect(win.locator('.reader__chapter')).toHaveText('第一章 河边')
  await win.locator('iframe.reader__view').waitFor()

  await win.getByRole('button', { name: 'AI', exact: true }).click()
  const card = win.locator('.ai-task').filter({ hasText: '本章小结' })

  // 成本要先说清楚，再等一句「开始」
  await card.getByRole('button', { name: '生成' }).click()
  await expect(card.locator('.ai-task__confirm')).toContainText('结构化小结')
  await card.getByRole('button', { name: '开始' }).click()

  await expect(card.locator('.ai-task__text')).toContainText('这一章写河边的月色')
  expect((await aiCallCount(app)).chat).toBe(1)

  // 重算命中缓存：结果照旧，但一次请求都没再发
  await card.getByRole('button', { name: '重新生成' }).click()
  await expect(card.locator('.ai-task__badge')).toHaveText('来自缓存')
  await expect(card.locator('.ai-task__meta')).toContainText('来自缓存，没有花钱')
  expect((await aiCallCount(app)).chat).toBe(1)

  await app.close()
})

test('花钱之前就能看到预估：对话与任务确认框都给数字，且预估自己不花钱', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-ai-est-'))
  const epubPath = join(userDataDir, 'novel.epub')
  await writeEpub(epubPath, novelFiles())

  const app = await launchAppWithUserData(userDataDir)
  await installAiStub(app, {
    payload: { overview: '这一章写河边的月色与一次重逢。', keyPoints: ['月色'], terms: [] }
  })
  const win = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1200, 800))

  await win.evaluate(async (file) => {
    await (window as any).api.secrets.set('deepseek', 'sk-stub-key')
    await (window as any).api.library.importPath(file)
  }, epubPath)

  await win.reload()
  await win.locator('.book-card').first().click()
  await expect(win.locator('.reader__chapter')).toHaveText('第一章 河边')
  await win.locator('iframe.reader__view').waitFor()

  await win.getByRole('button', { name: 'AI', exact: true }).click()
  await expect(win.locator('.ai-panel__empty')).toBeVisible()

  // 对话：输入问题后，发送按钮下方出现输入 tokens 与输出上限
  await win.locator('.ai-panel__input').fill('这本书讲了什么')
  const line = win.locator('.ai-panel__note').filter({ hasText: '预估输入约' })
  await expect(line).toBeVisible()
  await expect(line).toContainText('单次最多')
  await expect(line).toContainText('token 输出')

  // 任务确认框：同样在点击「开始」之前就把数字说清楚
  const card = win.locator('.ai-task').filter({ hasText: '本章小结' })
  await card.getByRole('button', { name: '生成' }).click()
  await expect(card.locator('.ai-task__confirm')).toContainText('预估输入约')
  await expect(card.locator('.ai-task__confirm')).toContainText('token 输出')

  // 预估是纯本地计算：既没有对话，也没有为了向量去调 embedding
  const calls = await aiCallCount(app)
  expect(calls.chat).toBe(0)
  expect(calls.embed).toBe(0)

  await app.close()
})

test('重开面板：结果从库里回填、回填不花钱，长结果在面板内可滚动', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-ai-restore-'))
  const epubPath = join(userDataDir, 'novel.epub')
  await writeEpub(epubPath, novelFiles())

  const app = await launchAppWithUserData(userDataDir)
  // 故意造一份很长的结果：短结果看不出「撑破面板」这个毛病
  await installAiStub(app, {
    payload: {
      overview: '这一章写河边的月色与一次重逢。'.repeat(40),
      keyPoints: Array.from({ length: 30 }, (_, index) => `要点 ${index} —— ${'长内容'.repeat(10)}`),
      terms: []
    }
  })
  const win = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1200, 800))

  await win.evaluate(async (file) => {
    await (window as any).api.secrets.set('deepseek', 'sk-stub-key')
    await (window as any).api.library.importPath(file)
  }, epubPath)

  await win.reload()
  await win.locator('.book-card').first().click()
  await expect(win.locator('.reader__chapter')).toHaveText('第一章 河边')
  await win.locator('iframe.reader__view').waitFor()

  await win.getByRole('button', { name: 'AI', exact: true }).click()
  const card = win.locator('.ai-task').filter({ hasText: '本章小结' })
  await card.getByRole('button', { name: '生成' }).click()
  await card.getByRole('button', { name: '开始' }).click()
  await expect(card.locator('.ai-task__text')).toBeVisible()
  expect((await aiCallCount(app)).chat).toBe(1)

  // 结果区自己滚，且不把面板撑破、不把对话区挤成 0
  const box = await win.evaluate(() => {
    const tasks = document.querySelector('.ai-tasks') as HTMLElement
    const stream = document.querySelector('.ai-panel__stream') as HTMLElement
    const panel = document.querySelector('.ai-panel') as HTMLElement
    return {
      tasksScrollable: tasks.scrollHeight > tasks.clientHeight,
      panelOverflows: panel.scrollHeight > panel.clientHeight,
      streamHeight: stream.clientHeight
    }
  })
  expect(box.tasksScrollable).toBe(true)
  expect(box.panelOverflows).toBe(false)
  expect(box.streamHeight).toBeGreaterThan(0)

  // 收起再打开：结果必须还在，且这一下不能触发任何模型调用
  await win.getByRole('button', { name: '收起', exact: true }).click()
  await win.getByRole('button', { name: 'AI', exact: true }).click()
  // 回填来的结果默认折叠（给对话区留高度），展开后才看得到正文
  await card.getByRole('button', { name: '查看结果（来自缓存）' }).click()
  await expect(card.locator('.ai-task__text')).toBeVisible()
  await expect(card.locator('.ai-task__badge')).toHaveText('来自缓存')
  expect((await aiCallCount(app)).chat).toBe(1)

  // 回填来的结果点「重新生成」要先摆出成本，不能悄悄再花一次
  await card.getByRole('button', { name: '重新生成' }).click()
  await expect(card.locator('.ai-task__confirm')).toBeVisible()

  await app.close()
})