import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { API_SHAPE, CH } from '../shared/ipc'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const TRACK_METHODS = [
  'getActive',
  'listNodes',
  'setBookLinks',
  'renameNode',
  'computeSignals',
  'getLatestGap',
  'build',
  'gap',
  'cancel'
] as const

describe('学习脉络 IPC 白名单', () => {
  it('通道只增不改，进度复用 ai:progress', () => {
    expect(CH.trackGetActive).toBe('track:getActive')
    expect(CH.trackListNodes).toBe('track:listNodes')
    expect(CH.trackSetBookLinks).toBe('track:setBookLinks')
    expect(CH.trackRenameNode).toBe('track:renameNode')
    expect(CH.trackComputeSignals).toBe('track:computeSignals')
    expect(CH.trackGetLatestGap).toBe('track:getLatestGap')
    expect(CH.trackBuild).toBe('track:build')
    expect(CH.trackGap).toBe('track:gap')
    expect(CH.trackCancel).toBe('track:cancel')
    expect(CH).not.toHaveProperty('trackOnProgress')
    expect(Object.values(CH)).not.toContain('track:onProgress')
    expect(CH.aiProgress).toBe('ai:progress')
    expect([...API_SHAPE.track]).toEqual([...TRACK_METHODS])
    expect(API_SHAPE.ai).toContain('onProgress')
  })

  it('preload 的 track 方法与 API_SHAPE 同名，且没有单独的 onProgress', () => {
    const source = readFileSync(resolve(root, 'electron/preload/index.ts'), 'utf8')
    const block = source.match(/\n  track: \{([\s\S]*?)\n  \},/)
    const body = block?.[1]
    if (body === undefined) throw new Error('preload 里没有 track 块')
    const names = [...body.matchAll(/\n {4}([A-Za-z]+):/g)].map((match) => match[1])
    expect(names).toEqual([...TRACK_METHODS])
    expect(names).not.toContain('onProgress')
  })

  it('AI 与脉络共用同一条花钱队列，没配密钥时有明确文案', () => {
    const queue = readFileSync(resolve(root, 'electron/main/ai/queue.ts'), 'utf8')
    const aiIpc = readFileSync(resolve(root, 'electron/main/ipc/ai.ts'), 'utf8')
    const trackIpc = readFileSync(resolve(root, 'electron/main/ipc/track.ts'), 'utf8')
    expect(queue).toContain('export const aiSpendQueue = new AiQueue()')
    expect(aiIpc).toContain('aiSpendQueue')
    expect(aiIpc).not.toContain('new AiQueue(')
    expect(trackIpc).toContain('aiSpendQueue')
    expect(trackIpc).not.toContain('new AiQueue(')
    expect(trackIpc).toContain('CH.aiProgress')
    expect(trackIpc).not.toContain('track:onProgress')
    expect(trackIpc).toContain('请先在设置里配置模型密钥')
  })
})
