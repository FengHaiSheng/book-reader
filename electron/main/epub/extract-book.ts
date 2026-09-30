import { htmlToText, firstHeading } from './text'
import { readEntries } from './zip'
import type { SpineText } from './types'

/** 一次最多并行读几个 entry。大书单篇就有几 MB，批量读是为了不让内存同时驻留整本。 */
const BATCH_SIZE = 8

const decoder = new TextDecoder('utf-8')

/**
 * 按传入顺序抽取每篇正文。纯 Node 实现，既能在 worker 里跑，
 * 也能在 vitest 里直接调用——这是本计划能被单测覆盖的关键。
 */
export async function extractBookTexts(zipPath: string, entries: string[]): Promise<SpineText[]> {
  const out: SpineText[] = []

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE)
    const files = await readEntries(zipPath, batch)

    for (const entry of batch) {
      const buffer = files.get(entry)
      // 声明的文件不在 zip 里：跳过这一篇，不打断整本书
      if (!buffer) continue
      const html = decoder.decode(buffer)
      out.push({ entry, text: htmlToText(html), heading: firstHeading(html) })
    }
  }

  return out
}
