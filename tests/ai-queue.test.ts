import { describe, expect, it } from 'vitest'
import { AiQueue } from '../electron/main/ai/queue'

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('AiQueue', () => {
  it('同一时刻只有一个任务在跑，其余排队', async () => {
    const queue = new AiQueue()
    const running: string[] = []
    let concurrent = 0
    let peak = 0

    const job = (name: string) => async (): Promise<string> => {
      concurrent += 1
      peak = Math.max(peak, concurrent)
      running.push(name)
      await tick()
      await tick()
      concurrent -= 1
      return name
    }

    const all = Promise.all([
      queue.run('a', job('a')),
      queue.run('b', job('b')),
      queue.run('c', job('c'))
    ])
    expect(queue.pending).toBe(2)
    expect(await all).toEqual(['a', 'b', 'c'])
    expect(peak).toBe(1)
    expect(running).toEqual(['a', 'b', 'c'])
  })

  it('前一个抛错不会卡死队列', async () => {
    const queue = new AiQueue()
    const first = queue.run('first', async () => {
      throw new Error('boom')
    })
    const second = queue.run('second', async () => 'ok')
    await expect(first).rejects.toThrow('boom')
    await expect(second).resolves.toBe('ok')
    expect(queue.pending).toBe(0)
  })

  it('排队中的任务可以被取消，且不会真的执行', async () => {
    const queue = new AiQueue()
    let ran = false
    const first = queue.run('first', async () => {
      await tick()
      return 1
    })
    const second = queue.run('second', async () => {
      ran = true
      return 2
    })
    void second.catch(() => undefined)
    queue.cancel('second')
    await expect(first).resolves.toBe(1)
    await tick()
    expect(ran).toBe(false)
  })
})