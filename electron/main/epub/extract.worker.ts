import { parentPort, workerData } from 'node:worker_threads'
import { toAppError } from '@shared/errors'
import { extractBookTexts } from './extract-book'
import type { SpineText } from './types'

type Payload = { epubPath: string; entries: string[] }
type Reply = { ok: true; texts: SpineText[] } | { ok: false; error: string }

const { epubPath, entries } = workerData as Payload

async function main(): Promise<void> {
  const texts = await extractBookTexts(epubPath, entries)
  const reply: Reply = { ok: true, texts }
  parentPort?.postMessage(reply)
}

void main().catch((error: unknown) => {
  // 抽取链路里抛的是 appError 产出的普通对象，String() 会变成 "[object Object]"，
  // 所以统一走 toAppError，把中文 message 与 detail 一起带回主进程。
  const normalized = toAppError(error)
  const reason = normalized.detail ? `${normalized.message}：${normalized.detail}` : normalized.message
  const reply: Reply = { ok: false, error: reason }
  parentPort?.postMessage(reply)
})
