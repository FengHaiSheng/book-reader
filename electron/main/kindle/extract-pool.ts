import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { appError } from '@shared/errors'
import type { KindleExtract, KindleKind, KindleWorkerReply } from './types'

/**
 * 在独立线程里解包 MOBI/AZW3/FB2，避免大书把主进程和界面卡住。
 * 线程只回 HTML 片段与目录，纯文本与标题由主进程计算。
 */
export function extractKindleInWorker(
  kind: KindleKind | 'fb2',
  sourcePath: string,
  mediaDir: string,
  onProgress?: (done: number, total: number) => void
): Promise<KindleExtract> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(join(__dirname, 'kindle-worker.js'), {
      workerData: { kind, sourcePath, mediaDir }
    })

    let settled = false
    const finish = (): void => {
      settled = true
      void worker.terminate()
    }
    const fail = (message: string, detail?: string): void => {
      if (settled) return
      finish()
      reject(appError('BOOK_PARSE_FAILED', message, { detail }))
    }

    worker.on('message', (reply: KindleWorkerReply) => {
      if (reply.type === 'progress') {
        onProgress?.(reply.done, reply.total)
        return
      }
      if (settled) return
      finish()
      if (reply.type === 'done') resolve(reply.result)
      else reject(appError('BOOK_PARSE_FAILED', reply.message, { detail: reply.detail }))
    })
    worker.once('error', (error: Error) => fail('解析这本书失败了', error.message))
    // worker 没回消息就退出时兜底，否则这个 Promise 永远不会 settle
    worker.once('exit', (code) => {
      if (settled) return
      fail('解析这本书失败了', `解析线程提前退出（code ${code}）`)
    })
  })
}
