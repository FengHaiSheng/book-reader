import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { appError } from '@shared/errors'
import type { SpineText } from './types'

type Reply = { ok: true; texts: SpineText[] } | { ok: false; error: string }

/** 在独立线程里抽取纯文本，避免大书导入时主进程（以及 UI）被占住。 */
export function extractInWorker(epubPath: string, entries: string[]): Promise<SpineText[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(join(__dirname, 'epub-worker.js'), {
      workerData: { epubPath, entries }
    })

    let settled = false
    const fail = (detail: string): void => {
      if (settled) return
      settled = true
      void worker.terminate()
      reject(appError('EPUB_PARSE_FAILED', '解析这本书的正文失败了', { detail }))
    }

    worker.once('message', (reply: Reply) => {
      if (settled) return
      settled = true
      void worker.terminate()
      if (reply.ok) resolve(reply.texts)
      else reject(appError('EPUB_PARSE_FAILED', '解析这本书的正文失败了', { detail: reply.error }))
    })
    worker.once('error', (error: Error) => fail(error.message))
    // worker 没回消息就退出时兜底，否则 Promise 永不 settle，导入会一直卡住
    worker.once('exit', (code) => fail(`抽取线程提前退出（code ${code}）`))
  })
}
