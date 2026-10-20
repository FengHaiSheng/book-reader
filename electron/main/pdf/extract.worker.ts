import { parentPort, workerData } from 'node:worker_threads'
import { toAppError } from '@shared/errors'
import { extractPdf } from './extract'

type Payload = { pdfPath: string }

const { pdfPath } = workerData as Payload

async function main(): Promise<void> {
  const result = await extractPdf(pdfPath, (done, total) => {
    parentPort?.postMessage({ type: 'progress', done, total })
  })
  parentPort?.postMessage({ type: 'done', result })
}

void main().catch((error: unknown) => {
  // 抽取链路抛的是 appError 产出的普通对象，统一走 toAppError 才能把中文原因带回主进程
  parentPort?.postMessage({ type: 'error', error: toAppError(error) })
})
