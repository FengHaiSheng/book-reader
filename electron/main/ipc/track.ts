import { ipcMain, type WebContents } from 'electron'
import type Database from 'better-sqlite3'
import { appError } from '@shared/errors'
import { CH } from '@shared/ipc'
import type { AiProgressEvent, ProviderId } from '@shared/types'
import { aiSpendQueue } from '../ai/queue'
import { statusOf, toReadable } from '../ai/service'
import { getDatabase } from '../store/db'
import {
  getActiveTrack,
  latestGapResult,
  listNodesWithBooks,
  renameNode,
  setNodeBooks
} from '../track/repo'
import { computeTrackSignals } from '../track/signals'
import { runTrackBuild, runTrackGap } from '../track/tasks'

/**
 * 与阅读器 AI 共用 aiSpendQueue。key 与进度 label 前缀一致。
 * 进度走 CH.aiProgress，不另开脉络自己的进度通道。
 */
const TRACK_TASK = {
  build: 'track:build',
  gap: 'track:gap'
} as const

type TrackTask = keyof typeof TRACK_TASK

const BUSY: Record<TrackTask, string> = {
  build: '脉络正在生成中',
  gap: '问缺正在进行中'
}

/** key → 中止信号。取消时先撤队列里还没开始的，再中止已经在跑的。 */
const inflight = new Map<string, AbortController>()

type SpendContext = {
  db: Database.Database
  signal: AbortSignal
  providerId: ProviderId
  model: string
  report: (done: number, label: string) => void
}

export function registerTrackIpc(): void {
  ipcMain.handle(CH.trackGetActive, () => getActiveTrack(getDatabase()))

  ipcMain.handle(CH.trackListNodes, () => {
    const db = getDatabase()
    const track = getActiveTrack(db)
    if (!track) return []
    return listNodesWithBooks(db, track.id)
  })

  ipcMain.handle(CH.trackSetBookLinks, (_event, nodeId: string, bookIds: string[]) => {
    try {
      const db = getDatabase()
      const track = getActiveTrack(db)
      if (!track) throw appError('DB_ERROR', '还没有学习脉络')
      if (!Array.isArray(bookIds) || bookIds.some((id) => typeof id !== 'string')) {
        throw appError('DB_ERROR', '挂书列表不正确')
      }
      setNodeBooks(db, track.id, nodeId, bookIds, Date.now())
    } catch (error) {
      throw asIpcError(error, '挂书没有改成')
    }
  })

  ipcMain.handle(CH.trackRenameNode, (_event, nodeId: string, title: string, summary: string) => {
    try {
      renameNode(getDatabase(), nodeId, title, summary, Date.now())
    } catch (error) {
      throw asIpcError(error, '节点没有改成')
    }
  })

  ipcMain.handle(CH.trackComputeSignals, () => {
    const db = getDatabase()
    const track = getActiveTrack(db)
    if (!track) return null
    return computeTrackSignals(db, track.id)
  })

  ipcMain.handle(CH.trackGetLatestGap, () => {
    const db = getDatabase()
    const track = getActiveTrack(db)
    if (!track) return null
    return latestGapResult(db, track.id)
  })

  ipcMain.handle(
    CH.trackBuild,
    (event, input: { goalText?: string; rebuild?: boolean } | null) =>
      runSpend(event.sender, 'build', 2, '脉络没有生成成功', ({ db, signal, providerId, model, report }) =>
        runTrackBuild(db, {
          goalText: typeof input?.goalText === 'string' ? input.goalText : '',
          rebuild: input?.rebuild === true,
          providerId,
          model,
          signal,
          onProgress: (progress) => report(progress.phase, progress.label)
        })
      )
  )

  ipcMain.handle(
    CH.trackGap,
    (event, input: { question?: string; forceRefresh?: boolean } | null) =>
      runSpend(event.sender, 'gap', 1, '问缺没有完成', ({ db, signal, providerId, model, report }) => {
        report(0, '正在分析缺口')
        return runTrackGap(db, {
          question: typeof input?.question === 'string' ? input.question : undefined,
          forceRefresh: input?.forceRefresh === true,
          providerId,
          model,
          signal
        })
      })
  )

  ipcMain.handle(CH.trackCancel, (_event, task: TrackTask) => {
    if (task !== 'build' && task !== 'gap') throw new Error('未知的脉络任务')
    const key = TRACK_TASK[task]
    aiSpendQueue.cancel(key)
    inflight.get(key)?.abort()
    inflight.delete(key)
  })
}

/**
 * 花钱之前先看密钥。返回值原样交给渲染进程：
 * build 带上任务层算好的 uncategorizedBookIds，gap 带上 cached，这里不重算。
 */
async function runSpend<T>(
  sender: WebContents,
  task: TrackTask,
  phases: number,
  fallback: string,
  job: (ctx: SpendContext) => Promise<T>
): Promise<T> {
  const key = TRACK_TASK[task]
  let controller: AbortController | undefined
  try {
    const db = getDatabase()
    const { providerId, model } = requireModel(db)
    if (inflight.has(key)) throw appError('DB_ERROR', BUSY[task])
    controller = new AbortController()
    inflight.set(key, controller)
    const active = controller
    return await aiSpendQueue.run(key, async () => {
      const report = (done: number, label: string): void =>
        emitTrackProgress(sender, task, { done, total: phases, label, running: true })
      try {
        const result = await job({ db, signal: active.signal, providerId, model, report })
        emitTrackProgress(sender, task, { done: phases, total: phases, label: '已完成', running: false })
        return result
      } catch (error) {
        emitTrackProgress(sender, task, { done: phases, total: phases, label: '已停下', running: false })
        throw error
      }
    })
  } catch (error) {
    throw asIpcError(error, fallback)
  } finally {
    if (controller && inflight.get(key) === controller) inflight.delete(key)
  }
}

/** 与设置页同一条 statusOf：没配密钥就不要进队列，更不要发请求。 */
function requireModel(db: Database.Database): { providerId: ProviderId; model: string } {
  const status = statusOf(db, null)
  if (!status.configured) {
    throw appError('AI_AUTH', '请先在设置里配置模型密钥', { action: 'openSettings' })
  }
  return { providerId: status.providerId, model: status.model }
}

function emitTrackProgress(
  sender: WebContents,
  task: TrackTask,
  progress: { done: number; total: number; label: string; running: boolean }
): void {
  if (sender.isDestroyed()) return
  const event: AiProgressEvent = {
    kind: 'track',
    bookId: '',
    done: progress.done,
    total: progress.total,
    label: `track:${task} ${progress.label}`,
    running: progress.running,
    task: TRACK_TASK[task]
  }
  sender.send(CH.aiProgress, event)
}

/**
 * 队列对「还没开始」的任务 reject 的是普通 Error('已取消')，不是 AppError。
 * 这里留住这句话；其余仍走 toReadable，避免把对象抛成 [object Object]。
 */
function asIpcError(error: unknown, fallback: string): Error {
  if (error instanceof Error && error.message === '已取消') return error
  return toReadable(error, fallback)
}
