import { test, expect } from '@playwright/test'
import { API_SHAPE } from '../shared/ipc'
import { launchApp } from './helpers'

test('渲染进程没有 Node 能力，且 api 只暴露白名单方法', async () => {
  const app = await launchApp()
  try {
    const win = await app.firstWindow()

    expect(await win.evaluate(() => typeof (window as any).require)).toBe('undefined')

    const actual = await win.evaluate(() =>
      Object.fromEntries(
        Object.entries((window as any).api ?? {}).map(([k, v]) => [k, Object.keys(v as object).sort()])
      )
    )

    const expected = Object.fromEntries(
      Object.entries(API_SHAPE).map(([k, v]) => [k, [...v].sort()])
    )
    expect(actual).toEqual(expected)
  } finally {
    await app.close()
  }
})
