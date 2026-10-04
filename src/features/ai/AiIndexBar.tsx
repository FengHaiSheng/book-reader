import { useEffect, useState } from 'react'
import { PROVIDERS } from '@shared/types'
import type { AiProgressEvent, AiStatus } from '@shared/types'

/**
 * 向量索引的提示条。三种状态互斥，任何一种都**不能静默**（硬规则 2）：
 * 不支持、已停用、还没建 / 正在建。
 *
 * 这里没有任何 effect 会自己去建索引——只有按钮能触发（硬规则 1）。
 */
export function AiIndexBar({
  bookId,
  status,
  onStatusChanged
}: {
  bookId: string
  status: AiStatus
  onStatusChanged: () => void
}) {
  const [progress, setProgress] = useState<AiProgressEvent | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(
    () =>
      window.api.ai.onProgress((event) => {
        if (event.kind === 'index' && event.bookId === bookId) setProgress(event)
      }),
    [bookId]
  )

  // 进度事件说「不跑了」，说明这一轮结束了，去主进程拿一次真实状态
  useEffect(() => {
    if (progress && !progress.running) onStatusChanged()
  }, [progress, onStatusChanged])

  const providerName = PROVIDERS.find((item) => item.id === status.providerId)?.name ?? status.providerId

  if (!status.caps.embed) {
    return (
      <p className="ai-notice" role="status">
        {providerName} 不提供向量检索，本面板用的是关键词检索 + 当前章节窗口，跨章节召回会变弱。
      </p>
    )
  }

  if (status.unavailable.includes('embed')) {
    return (
      <p className="ai-notice" role="status">
        {providerName} 这次拒绝了向量检索请求，已停用该能力，改用关键词检索 + 当前章节窗口。
      </p>
    )
  }

  const { total, done, running } = progress ?? status.index
  const remaining = Math.max(0, total - done)
  const batches = Math.ceil(remaining / (status.caps.embedBatch ?? 1))

  const start = async (): Promise<void> => {
    setConfirming(false)
    setError(null)
    try {
      await window.api.ai.buildIndex(bookId)
    } catch (e) {
      setError(e instanceof Error ? e.message : '建立索引没有成功')
    } finally {
      onStatusChanged()
    }
  }

  if (running) {
    return (
      <div className="ai-index-bar" role="status">
        <span>
          正在建立向量索引：{done} / {total}
          {progress?.label ? `（${progress.label}）` : ''}
        </span>
        <button type="button" className="btn btn--quiet" onClick={() => void window.api.ai.cancelIndex(bookId)}>
          停下
        </button>
      </div>
    )
  }

  if (confirming) {
    return (
      <div className="ai-index-bar ai-index-bar--confirm">
        <p>
          将为这本书剩下的 {remaining} 段文本建立向量索引，约发起 {batches} 次请求。
          这是要花钱的调用，中途可以停，已经算过的不会重算。
        </p>
        <div className="ai-index-bar__actions">
          <button type="button" className="btn btn--accent" onClick={() => void start()}>
            开始
          </button>
          <button type="button" className="btn" onClick={() => setConfirming(false)}>
            算了
          </button>
        </div>
        {error && <p className="ai-notice ai-notice--error">{error}</p>}
      </div>
    )
  }

  if (remaining === 0) {
    return (
      <p className="ai-notice" role="status">
        向量索引已建立（{total} 段），跨章节的问题召回更准。
      </p>
    )
  }

  return (
    <div className="ai-index-bar">
      <span>
        {done === 0
          ? '这本书还没有建立向量索引，跨章节的问题只能靠关键词召回。'
          : `向量索引建了一半（${done} / ${total}），可以接着建。`}
      </span>
      <button type="button" className="btn" onClick={() => setConfirming(true)}>
        {done === 0 ? '建立向量索引' : '继续建立'}
      </button>
      {error && <p className="ai-notice ai-notice--error">{error}</p>}
    </div>
  )
}