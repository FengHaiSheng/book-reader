import { ipcMain, type WebContents } from 'electron'
import { modelsFor } from '@shared/ai'
import { CH } from '@shared/ipc'
import type { AiChatResult, AiDegradeEvent, AiProgressEvent, ProviderId } from '@shared/types'
import { AiQueue } from '../ai/queue'
import { buildIndex, cancelIndex, indexState } from '../ai/index-builder'
import { appendMessage, clearScope, listMessages } from '../ai/repo'
import { estimateTokens } from '../ai/retrieve'
import { testConnection } from '../ai/provider'
import {
  aiSettings,
  chapterTextOf,
  runChat,
  statusOf,
  toReadable,
  type ChatInput
} from '../ai/service'
import {
  runBookDigest,
  runChapterSummary,
  runMindmap,
  runTerms,
  type TaskProgress
} from '../ai/tasks'
import { getDatabase } from '../store/db'

/** 单通道串行：手快连点也不会并发烧钱（spec §5.6） */
const queue = new AiQueue()

/** requestId → 中止信号。切章、关面板、关窗口都要能停流。 */
const inflight = new Map<string, AbortController>()

/** 全书要点是长任务：它按 bookId 停，而不是按 requestId */
const digestInflight = new Map<string, AbortController>()

type ChatRequest = Omit<ChatInput, 'chapterText' | 'scopeKey'> & {
  /** 章节级会话；传 null 表示这本书的全局会话 */
  chapterId: number | null
}

export function registerAiIpc(): void {
  ipcMain.handle(CH.aiStatus, (_event, bookId: string) => statusOf(getDatabase(), bookId))

  ipcMain.handle(CH.aiModels, (_event, providerId: ProviderId) => modelsFor(providerId))

  ipcMain.handle(CH.aiTest, async (_event, providerId: ProviderId, model: string) =>
    queue.run(`test:${providerId}`, async () => {
      try {
        return await testConnection(providerId, model)
      } catch (error) {
        throw toReadable(error, '连接测试没有通过')
      }
    })
  )

  ipcMain.handle(CH.aiChat, async (event, request: ChatRequest): Promise<AiChatResult> => {
    if (inflight.has(request.requestId)) {
      throw new Error('这个请求已经在进行中了')
    }

    const controller = new AbortController()
    inflight.set(request.requestId, controller)
    const database = getDatabase()
    const sender = event.sender

    try {
      const result = await queue.run(request.requestId, () =>
        runChat(
          database,
          {
            ...request,
            chapterText:
              request.chapterId === null ? '' : chapterTextOf(database, request.chapterId),
            scopeKey: request.chapterId === null ? 'book' : `chapter:${request.chapterId}`
          },
          {
            signal: controller.signal,
            onDelta: (text) => emitDelta(sender, { requestId: request.requestId, delta: text })
          }
        )
      )

      // 落库放在这里而不是服务层：服务层要能被单测单独调，不该顺手写表。
      // 用量按输出 token 记回答、按估算记提问（服务商不给我们算输入的那一份）。
      const scopeKey = request.chapterId === null ? 'book' : `chapter:${request.chapterId}`
      const now = Date.now()
      appendMessage(
        database,
        {
          bookId: request.bookId,
          chapterId: request.chapterId,
          scopeKey,
          role: 'user',
          content: (request.question ?? request.excerpt ?? '').trim(),
          tokens: estimateTokens(request.question ?? request.excerpt ?? '')
        },
        now
      )
      appendMessage(
        database,
        {
          bookId: request.bookId,
          chapterId: request.chapterId,
          scopeKey,
          role: 'assistant',
          content: result.content,
          tokens: result.usage?.outputTokens ?? 0
        },
        now + 1
      )

      return result
    } catch (error) {
      throw toReadable(error, 'AI 没有回答成功')
    } finally {
      inflight.delete(request.requestId)
    }
  })

  ipcMain.handle(CH.aiCancel, (_event, requestId: string) => {
    // 先撤排队中的（还没花钱），再中止在跑的（已经花出去的不追回，但必须停流）
    queue.cancel(requestId)
    inflight.get(requestId)?.abort()
    inflight.delete(requestId)
  })

  ipcMain.handle(CH.aiHistory, (_event, bookId: string, scopeKey: string) =>
    listMessages(getDatabase(), bookId, scopeKey)
  )

  ipcMain.handle(CH.aiClear, (_event, bookId: string, scopeKey: string) => {
    clearScope(getDatabase(), bookId, scopeKey)
  })

  ipcMain.handle(CH.aiIndexState, (_event, bookId: string) => indexState(getDatabase(), bookId))

  ipcMain.handle(CH.aiBuildIndex, async (event, bookId: string) => {
    const database = getDatabase()
    const { providerId } = aiSettings(database)
    try {
      return await queue.run(`index:${bookId}`, () =>
        buildIndex(database, bookId, providerId, (progress) => emitProgress(event.sender, progress))
      )
    } catch (error) {
      throw toReadable(error, '建立索引没有成功')
    }
  })

  ipcMain.handle(CH.aiCancelIndex, (_event, bookId: string) => {
    cancelIndex(bookId)
  })

  ipcMain.handle(CH.aiSummary, async (_event, bookId: string, chapterId: number) => {
    const database = getDatabase()
    const { providerId, model } = aiSettings(database)
    const controller = new AbortController()
    try {
      return await queue.run(`summary:${chapterId}`, () =>
        runChapterSummary(database, {
          bookId,
          chapterId,
          providerId,
          model,
          signal: controller.signal
        })
      )
    } catch (error) {
      throw toReadable(error, '本章小结没有生成成功')
    }
  })

  ipcMain.handle(CH.aiDigest, async (event, bookId: string) => {
    if (digestInflight.has(bookId)) throw new Error('这本书的全书要点正在生成中')
    const database = getDatabase()
    const { providerId, model } = aiSettings(database)
    const controller = new AbortController()
    digestInflight.set(bookId, controller)
    try {
      return await queue.run(`digest:${bookId}`, () =>
        runBookDigest(
          database,
          { bookId, providerId, model, signal: controller.signal },
          (progress) => emitDigestProgress(event.sender, bookId, progress)
        )
      )
    } catch (error) {
      throw toReadable(error, '全书要点没有生成成功')
    } finally {
      digestInflight.delete(bookId)
    }
  })

  ipcMain.handle(CH.aiTerms, async (_event, bookId: string) => {
    const database = getDatabase()
    const { providerId, model } = aiSettings(database)
    const controller = new AbortController()
    try {
      return await queue.run(`terms:${bookId}`, () =>
        runTerms(database, { bookId, providerId, model, signal: controller.signal })
      )
    } catch (error) {
      throw toReadable(error, '关键词没有生成成功')
    }
  })

  ipcMain.handle(CH.aiMindmap, (_event, bookId: string) => {
    const database = getDatabase()
    const { providerId, model } = aiSettings(database)
    try {
      return runMindmap(database, { bookId, providerId, model })
    } catch (error) {
      throw toReadable(error, '思维导图没有生成成功')
    }
  })

  ipcMain.handle(CH.aiCancelDigest, (_event, bookId: string) => {
    digestInflight.get(bookId)?.abort()
  })
}

function emitDelta(sender: WebContents, payload: AiDegradeEvent): void {
  if (!sender.isDestroyed()) sender.send(CH.aiDelta, payload)
}

// 入参是 index-builder 的 IndexProgress（没有 kind），在这里补上事件类型再发出去。
function emitProgress(sender: WebContents, payload: Omit<AiProgressEvent, 'kind'>): void {
  if (!sender.isDestroyed()) {
    sender.send(CH.aiProgress, {
      ...payload,
      kind: 'index',
      bookId: payload.bookId
    })
  }
}

function emitDigestProgress(sender: WebContents, bookId: string, progress: TaskProgress): void {
  if (!sender.isDestroyed()) sender.send(CH.aiProgress, { kind: 'digest', bookId, ...progress })
}