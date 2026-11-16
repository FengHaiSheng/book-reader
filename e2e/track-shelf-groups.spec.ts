import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { installAiStub, launchApp } from './helpers'

/**
 * 书架按脉络分节（窄覆盖）：
 * 1. 没有 active 脉络时不出现「按脉络」，标签入口照旧；
 * 2. 有脉络时切到分节视图，节点节（含空节点）与未归类末节都在；
 * 3. 书名筛选叠加后节内只剩可见的书，空节仍然保留。
 */

test('没有脉络时书架不显示按脉络，标签入口仍在', async () => {
  const app = await launchApp()
  try {
    const win = await app.firstWindow()
    await expect(win.locator('.tag-new input')).toBeVisible()
    await expect(win.getByRole('group', { name: '分组' })).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test('有脉络时按脉络分节，节点、空节点与未归类都在', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-track-shelf-'))
  writeFileSync(
    join(userDataDir, '竞争战略精解.txt'),
    ['第一章 定位', '战略是取舍。', '第二章 取舍', '取舍决定资源配置。'].join('\n')
  )
  writeFileSync(
    join(userDataDir, '诗歌选集.txt'),
    ['第一章 春', '春天的河。', '第二章 夏', '夏天的夜。'].join('\n')
  )

  const app = await launchApp()
  try {
    const win = await app.firstWindow()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1200, 800))

    const bookIds = await win.evaluate(async (dir) => {
      const strategy = await (window as any).api.library.importPath(joinPath(dir, '竞争战略精解.txt'))
      const poetry = await (window as any).api.library.importPath(joinPath(dir, '诗歌选集.txt'))
      return { strategy: strategy.bookId as string, poetry: poetry.bookId as string }

      function joinPath(base: string, name: string): string {
        return base.endsWith('/') ? `${base}${name}` : `${base}/${name}`
      }
    }, userDataDir)

    // 两阶段：骨架给三节点，挂书建议留空；挂载由后面的 setBookLinks 直接落库
    await installAiStub(app, {
      payloads: [
        {
          nodes: [
            { id: 'n1', parentId: null, title: '战略', summary: '公司战略', depth: 1, sortOrder: 0 },
            {
              id: 'n2',
              parentId: 'n1',
              title: '竞争战略',
              summary: '定位与取舍',
              depth: 2,
              sortOrder: 0
            },
            { id: 'n3', parentId: null, title: '财务', summary: '财报', depth: 1, sortOrder: 1 }
          ]
        },
        { mounts: [] }
      ]
    })

    const built = await win.evaluate(async () => {
      await (window as any).api.secrets.set('deepseek', 'sk-stub-key')
      return (window as any).api.track.build({ goalText: '学战略' })
    })
    expect(built.trackId).toBeTruthy()

    const nodes = await win.evaluate(() => (window as any).api.track.listNodes())
    const competition = nodes.find((node: { title: string }) => node.title === '竞争战略')
    expect(competition).toBeTruthy()
    await win.evaluate(
      ({ nodeId, bookId }) => (window as any).api.track.setBookLinks(nodeId, [bookId]),
      { nodeId: competition.id as string, bookId: bookIds.strategy }
    )

    await win.reload()

    const group = win.getByRole('group', { name: '分组' })
    await expect(group.getByRole('button', { name: '按列表' })).toHaveAttribute('aria-pressed', 'true')
    await group.getByRole('button', { name: '按脉络' }).click()

    const titles = win.locator('.track-shelf__title')
    await expect(titles).toHaveCount(4)
    await expect(titles.nth(0)).toHaveText('战略')
    await expect(titles.nth(1)).toHaveText('竞争战略')
    await expect(titles.nth(2)).toHaveText('财务')
    await expect(titles.nth(3)).toHaveText('未归类')

    const competitionSection = win.locator('.track-shelf__section').filter({ hasText: '竞争战略' })
    await expect(competitionSection).toContainText('竞争战略精解')
    const financeSection = win.locator('.track-shelf__section').filter({ hasText: '财务' })
    await expect(financeSection).toContainText('暂无挂书')
    const untracked = win.locator('.track-shelf__section.is-untracked')
    await expect(untracked).toContainText('诗歌选集')

    // 筛选叠加：只剩一本时节点节仍保留，未归类因无书而省略
    await win.getByPlaceholder('搜索书名、作者或标签').fill('竞争')
    await expect(win.locator('.track-shelf__title')).toHaveCount(3)
    await expect(financeSection).toContainText('暂无挂书')
    await expect(untracked).toHaveCount(0)
    await expect(competitionSection).toContainText('竞争战略精解')
  } finally {
    await app.close()
  }
})
