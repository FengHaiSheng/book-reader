import type Database from 'better-sqlite3'
import { PROMPT_VERSION, type CapabilityKey } from '@shared/ai'
import type { AiMessage, AiMessageRole, AiUsage, Citation, ProviderId } from '@shared/types'

export type ResultKey = {
  bookId: string
  task: string
  scopeKey: string
  provider: ProviderId
  model: string
}

export type StoredResult<T> = {
  payload: T
  inputTokens: number
  outputTokens: number
  createdAt: number
}

/**
 * 命中唯一键即复用。
 *
 * 唯一键含 prompt_version 与 model：**改提示词或换模型都自动失效重算**，
 * 用户不需要理解缓存这回事，也不会拿到旧模型的结果。
 */
export function getResult<T>(db: Database.Database, key: ResultKey): StoredResult<T> | null {
  const row = db
    .prepare(
      `SELECT payload, input_tokens AS inputTokens, output_tokens AS outputTokens, created_at AS createdAt
       FROM ai_results
       WHERE book_id = ? AND task = ? AND scope_key = ? AND prompt_version = ? AND model = ?`
    )
    .get(key.bookId, key.task, key.scopeKey, PROMPT_VERSION, key.model) as
    | StoredResult<string>
    | undefined

  if (!row) return null
  try {
    return { ...row, payload: JSON.parse(row.payload) as T }
  } catch {
    // 库里的 payload 坏了就当没缓存：重算一次，比抛错卡住用户强
    return null
  }
}

export function saveResult<T>(
  db: Database.Database,
  key: ResultKey,
  payload: T,
  usage: AiUsage,
  now: number
): void {
  db.prepare(
    `INSERT INTO ai_results
       (book_id, task, scope_key, prompt_version, provider, model, payload, input_tokens, output_tokens, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (book_id, task, scope_key, prompt_version, model)
     DO UPDATE SET payload = excluded.payload,
                   input_tokens = excluded.input_tokens,
                   output_tokens = excluded.output_tokens,
                   created_at = excluded.created_at`
  ).run(
    key.bookId,
    key.task,
    key.scopeKey,
    PROMPT_VERSION,
    key.provider,
    key.model,
    JSON.stringify(payload),
    usage.inputTokens,
    usage.outputTokens,
    now
  )
}

export function listMessages(
  db: Database.Database,
  bookId: string,
  scopeKey: string
): AiMessage[] {
  const rows = db
    .prepare(
      `SELECT id, book_id AS bookId, chapter_id AS chapterId, scope_key AS scopeKey,
              role, content, tokens, citations, created_at AS createdAt
       FROM ai_messages WHERE book_id = ? AND scope_key = ?
       ORDER BY id`
    )
    .all(bookId, scopeKey) as (Omit<AiMessage, 'citations'> & { citations: string | null })[]

  return rows.map((row) => ({ ...row, citations: parseCitations(row.citations) }))
}

/** 落库的引用是 JSON 串。解析失败就当没有引用，绝不因为一条脏数据让整段历史读不出来 */
function parseCitations(raw: string | null): Citation[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as Citation[]) : []
  } catch {
    return []
  }
}

export function appendMessage(
  db: Database.Database,
  message: {
    bookId: string
    chapterId: number | null
    scopeKey: string
    role: AiMessageRole
    content: string
    tokens: number
    /** 只有助手回答带引用；用户消息传空数组 */
    citations?: Citation[]
  },
  now: number
): AiMessage {
  const citations = message.citations ?? []
  const info = db
    .prepare(
      `INSERT INTO ai_messages (book_id, chapter_id, scope_key, role, content, tokens, citations, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      message.bookId,
      message.chapterId,
      message.scopeKey,
      message.role,
      message.content,
      message.tokens,
      citations.length > 0 ? JSON.stringify(citations) : null,
      now
    )
  return {
    id: Number(info.lastInsertRowid),
    ...message,
    citations,
    tokens: message.tokens,
    createdAt: now
  }
}

export function clearScope(db: Database.Database, bookId: string, scopeKey: string): void {
  db.prepare('DELETE FROM ai_messages WHERE book_id = ? AND scope_key = ?').run(bookId, scopeKey)
}

/**
 * 能力降级要持久化。
 *
 * 只在那里记「不可用」，不记「可用」——下次版本更新把内置声明改回可用时，
 * 用户不需要去清理一个陈旧的阳性记录。
 */
export function markUnavailable(
  db: Database.Database,
  providerId: ProviderId,
  key: CapabilityKey
): void {
  const settingKey = `ai.caps.${providerId}.${key}`
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, 'unavailable')
     ON CONFLICT (key) DO UPDATE SET value = 'unavailable'`
  ).run(settingKey)
}

export function unavailableCaps(db: Database.Database, providerId: ProviderId): CapabilityKey[] {
  const rows = db
    .prepare(`SELECT key FROM settings WHERE key LIKE ? AND value = 'unavailable'`)
    .all(`ai.caps.${providerId}.%`) as { key: string }[]
  return rows
    .map((row) => row.key.split('.').pop())
    .filter((key): key is CapabilityKey => typeof key === 'string')
}