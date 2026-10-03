type Entry = {
  key: string
  job: () => Promise<unknown>
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
}

/**
 * 单通道串行队列。
 *
 * 存在的唯一理由：**手快连点、同时开两个面板都不该并发烧钱**。
 * BYOK 产品里一次误并发就是用户账上真实的钱，所以这里不做并发度配置。
 */
export class AiQueue {
  private readonly waiting: Entry[] = []
  private active = false

  get pending(): number {
    return this.waiting.length
  }

  run<T>(key: string, job: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.waiting.push({
        key,
        job: job as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject
      })
      void this.drain()
    })
  }

  /**
   * 取消。只对**还没开始**的任务有效——已经发出去的请求不该被队列取消，
   * 那是请求自己的 AbortController 的事（见 provider.ts 的 cancel）。
   */
  cancel(key: string): void {
    const index = this.waiting.findIndex((entry) => entry.key === key)
    if (index === -1) return
    const [entry] = this.waiting.splice(index, 1)
    entry?.reject(new Error('已取消'))
  }

  /** 队列里还剩哪些 key，界面用它显示「排队中」 */
  queued(): string[] {
    return this.waiting.map((entry) => entry.key)
  }

  private async drain(): Promise<void> {
    if (this.active) return
    this.active = true
    try {
      for (;;) {
        const entry = this.waiting.shift()
        if (!entry) break
        try {
          entry.resolve(await entry.job())
        } catch (error) {
          entry.reject(error)
        }
      }
    } finally {
      this.active = false
    }
  }
}