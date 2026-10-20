import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { appError, type AppError } from '@shared/errors'
import type { PdfExtract } from './extract'

type Reply =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; result: PdfExtract }
  | { type: 'error'; error: AppError }

/** 在独立线程里抽取 PDF，避免几百页的书把主进程和界面卡住。 */
export function extractPdfInWorker(
  pdfPath: string,
  onProgress?: (done: number, total: number) => void
): Promise<PdfExtract> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(join(__dirname, 'pdf-worker.js'), { workerData: { pdfPath } })

    let settled = false
    const finish = (): void => {
      settled = true
      void worker.terminate()
    }
    const fail = (error: AppError): void => {
      if (settled) return
      finish()
      reject(error)
    }

    worker.on('message', (reply: Reply) => {
      if (reply.type === 'progress') {
        onProgress?.(reply.done, reply.total)
        return
      }
      if (settled) return
      finish()
      if (reply.type === 'done') resolve(reply.result)
      else reject(reply.error)
    })
    worker.once('error', (error: Error) =>
      fail(appError('PDF_PARSE_FAILED', '解析这本 PDF 的正文失败了', { detail: error.message }))
    )
    // worker 没回消息就退出时兜底，否则这个 Promise 永远不会 settle
    worker.once('exit', (code) => {
      if (settled) return
      fail(appError('PDF_PARSE_FAILED', '解析这本 PDF 的正文失败了', { detail: `抽取线程提前退出（code ${code}）` }))
    })
  })
}
