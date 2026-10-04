import type Database from 'better-sqlite3'
import { PROVIDER_AI } from '@shared/ai'
import type { ProviderId } from '@shared/types'
import { embed } from './provider'
import { blobToVector, cosine, topKByVector, vectorToBlob } from './vector'

export type IndexState = { total: number; done: number; running: boolean }
export type IndexProgress = {
  bookId: string
  done: number
  total: number
  label: string
  running: boolean
}

export function indexState(db: Database.Database, bookId: string): IndexState {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN embedding IS NOT NULL THEN 1 ELSE 0 END) AS done
       FROM chunks WHERE book_id = ?`
    )
    .get(bookId) as { total: number; done: number | null }
  return {
    total: row.total,
    done: row.done ?? 0,
    running: running.has(bookId)
  }
}

/** 正在建索引的 bookId → 停止信号。同一时刻只允许一本书在建。 */
const running = new Map<string, { stop: boolean }>()

export function isRunning(bookId: string): boolean {
  return running.has(bookId)
}

export function cancelIndex(bookId: string): void {
  const token = running.get(bookId)
  if (token) token.stop = true
}

/**
 * 建索引。**是显式动作，绝不自动触发。**
 *
 * 断点续靠 `embedding IS NULL` 判定，不另设进度表：中断后重进只算没算过的那些，
 * 已经花过钱的部分不会重算。
 *
 * 换过 embedding 模型时必须把旧向量清空 —— 不同模型的向量空间不同，
 * 混在一起算余弦是在算噪音。
 */
export async function buildIndex(
  db: Database.Database,
  bookId: string,
  providerId: ProviderId,
  onProgress: (progress: IndexProgress) => void
): Promise<IndexState> {
  const previous = db
    .prepare(`SELECT value FROM settings WHERE key = ?`)
    .get(`ai.embedModel.${bookId}`) as { value: string } | undefined
  const current = embedModelOf(providerId)
  if (previous && previous.value !== current) {
    db.prepare('UPDATE chunks SET embedding = NULL WHERE book_id = ?').run(bookId)
  }
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`
  ).run(`ai.embedModel.${bookId}`, current)

  const token = { stop: false }
  running.set(bookId, token)

  const before = indexState(db, bookId)
  onProgress({ bookId, done: before.done, total: before.total, label: '准备中', running: true })

  try {
    for (;;) {
      if (token.stop) break

      const pending = db
        .prepare(
          `SELECT id, text, heading_path AS headingPath FROM chunks
           WHERE book_id = ? AND embedding IS NULL ORDER BY id LIMIT 64`
        )
        .all(bookId) as { id: number; text: string; headingPath: string }[]
      if (pending.length === 0) break

      const result = await embed(providerId, pending.map((row) => row.text))
      if (result.vectors.length !== pending.length) {
        throw new Error('向量服务返回的条数与请求不一致，索引已中止，可以稍后继续')
      }

      // 一个事务写一批：中断发生在批边界，已写入的批次全部保留，可续
      const write = db.transaction(() => {
        const update = db.prepare('UPDATE chunks SET embedding = ? WHERE id = ?')
        pending.forEach((row, index) => {
          update.run(vectorToBlob(result.vectors[index]!), row.id)
        })
      })
      write()

      const now = indexState(db, bookId)
      onProgress({
        bookId,
        done: now.done,
        total: now.total,
        label: pending[pending.length - 1]!.headingPath,
        running: true
      })
    }
  } finally {
    running.delete(bookId)
  }

  const final = indexState(db, bookId)
  onProgress({ bookId, done: final.done, total: final.total, label: '', running: false })
  return final
}

/** 内存里的向量检索。没建索引的行就是没参与，调用方要据此提示降级。 */
export function searchByVector(
  db: Database.Database,
  bookId: string,
  query: readonly number[],
  limit: number
): { chunkId: number; score: number }[] {
  const rows = db
    .prepare('SELECT id, embedding FROM chunks WHERE book_id = ? AND embedding IS NOT NULL')
    .all(bookId) as { id: number; embedding: Buffer }[]

  return topK(
    rows.map((row) => ({ id: row.id, vector: blobToVector(row.embedding) })),
    query,
    limit
  )
}

function topK<T extends { vector: number[] }>(
  items: readonly T[],
  query: readonly number[],
  k: number
): { chunkId: number; score: number }[] {
  return topKByVector(items, query, k).map((item) => ({
    chunkId: (item as unknown as { id: number }).id,
    score: cosine(item.vector, query)
  }))
}

function embedModelOf(providerId: ProviderId): string {
  return PROVIDER_AI[providerId].embedModel ?? ''
}