import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AiStatus, Citation } from '@shared/types'
import { AiIndexBar } from './AiIndexBar'
import { AiMessage, type Turn } from './AiMessage'

/** 划词浮条递给面板的东西。prefill 只填引用，send 立刻发出去 */
export type AiSeed =
  | { kind: 'prefill'; task: 'ask'; text: string }
  | { kind: 'send'; task: 'explain' | 'translate'; text: string }

export function AiPanel({
  bookId,
  chapterId,
  seed,
  onSeedConsumed,
  onCitation,
  onClose
}: {
  bookId: string
  chapterId: number | null
  seed: AiSeed | null
  onSeedConsumed: () => void
  onCitation?: (citation: Citation) => void
  onClose: () => void
}) {
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [turns, setTurns] = useState<Turn[]>([])
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [question, setQuestion] = useState('')
  const [excerpt, setExcerpt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const streamRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  /** 已经发出去、还没结束的 requestId。换章与卸载时要逐个叫停 */
  const inflightRef = useRef<Set<string>>(new Set())

  const scopeKey = chapterId === null ? 'book' : `chapter:${chapterId}`

  const refreshStatus = useCallback(() => {
    void window.api.ai
      .status(bookId)
      .then(setStatus)
      .catch(() => setStatus(null))
  }, [bookId])

  // 换书、换章、卸载都要停流并清掉会话（spec §5.6「中断即停流」）
  useEffect(() => {
    let alive = true
    setTurns([])
    setHistoryLoaded(false)
    setError(null)
    refreshStatus()

    void window.api.ai
      .history(bookId, scopeKey)
      .then((stored) => {
        if (!alive) return
        setTurns(
          stored.map((message) => ({
            id: `m${message.id}`,
            role: message.role,
            text: message.content,
            state: 'done' as const,
            // 历史里没有引用映射与用量：上标退化为普通文字，用量显示「未返回」
            usage: null,
            citations: [],
            degraded: []
          }))
        )
        setHistoryLoaded(true)
      })
      .catch(() => {
        if (alive) setHistoryLoaded(true)
      })

    return () => {
      alive = false
      for (const id of inflightRef.current) void window.api.ai.cancel(id)
      inflightRef.current.clear()
    }
  }, [bookId, scopeKey, refreshStatus])

  useEffect(
    () =>
      window.api.ai.onDelta((event) => {
        setTurns((list) =>
          list.map((turn) =>
            turn.id === event.requestId
              ? { ...turn, state: 'streaming', text: turn.text + event.delta }
              : turn
          )
        )
      }),
    []
  )

  // 新内容进来就滚到底。用 turns 的长度与末条文本长度做依赖，避免每次渲染都滚
  const lastLength = turns.length === 0 ? 0 : turns[turns.length - 1]!.text.length
  useEffect(() => {
    const box = streamRef.current
    if (box) box.scrollTop = box.scrollHeight
  }, [turns.length, lastLength])

  const send = useCallback(
    async (task: 'ask' | 'explain' | 'translate', input: { question?: string; excerpt?: string }) => {
      const requestId = crypto.randomUUID()
      const say = task === 'ask' ? (input.question ?? '') : task === 'explain' ? '解释这段原文' : '翻译这段原文'

      inflightRef.current.add(requestId)
      setError(null)
      setTurns((list) => [
        ...list,
        {
          id: `${requestId}:u`,
          role: 'user',
          text: say,
          excerpt: input.excerpt,
          state: 'done',
          usage: null,
          citations: [],
          degraded: []
        },
        {
          id: requestId,
          role: 'assistant',
          text: '',
          state: 'queued',
          usage: null,
          citations: [],
          degraded: []
        }
      ])

      try {
        const result = await window.api.ai.chat({
          requestId,
          bookId,
          chapterId,
          task,
          ...(input.excerpt ? { excerpt: input.excerpt } : {}),
          ...(input.question ? { question: input.question } : {})
        })
        setTurns((list) =>
          list.map((turn) =>
            turn.id === requestId
              ? {
                  ...turn,
                  state: 'done',
                  text: result.content,
                  usage: result.usage,
                  citations: result.citations,
                  degraded: result.degraded
                }
              : turn
          )
        )
        refreshStatus()
      } catch (e) {
        const message = e instanceof Error ? e.message : 'AI 没有回答成功'
        setTurns((list) =>
          list.map((turn) =>
            turn.id === requestId ? { ...turn, state: 'failed', error: message } : turn
          )
        )
      } finally {
        inflightRef.current.delete(requestId)
      }
    },
    [bookId, chapterId, refreshStatus]
  )

  // 划词浮条递过来的动作
  useEffect(() => {
    if (!seed) return
    onSeedConsumed()
    if (seed.kind === 'prefill') {
      setExcerpt(seed.text)
      inputRef.current?.focus()
      return
    }
    setExcerpt(null)
    void send(seed.task, { excerpt: seed.text })
  }, [seed, send, onSeedConsumed])

  const busy = turns.some(
    (turn) => turn.role === 'assistant' && (turn.state === 'queued' || turn.state === 'streaming')
  )

  const canSend = (question.trim() !== '' || excerpt !== null) && status?.configured !== false

  const submit = (event: React.FormEvent): void => {
    event.preventDefault()
    if (!canSend) return
    const text = question.trim()
    void send(text === '' ? 'explain' : 'ask', {
      ...(text === '' ? {} : { question: text }),
      ...(excerpt ? { excerpt } : {})
    })
    setQuestion('')
    setExcerpt(null)
  }

  const stop = (): void => {
    for (const id of inflightRef.current) void window.api.ai.cancel(id)
  }

  const clear = (): void => {
    stop()
    void window.api.ai.clear(bookId, scopeKey).then(() => {
      setTurns([])
      setHistoryLoaded(false)
    })
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      submit(event)
    }
  }

  const providerLabel = useMemo(() => status?.providerId ?? '', [status])

  return (
    <aside className="ai-panel" aria-label="AI 面板">
      <div className="ai-panel__head">
        <span className="ai-panel__title">AI</span>
        {status && (
          <span className="ai-panel__model">
            {providerLabel} · {status.model}
          </span>
        )}
        <span className="ai-panel__spacer" />
        <button type="button" className="btn btn--quiet" onClick={clear} disabled={turns.length === 0}>
          清空
        </button>
        <button type="button" className="btn btn--quiet" onClick={onClose}>
          收起
        </button>
      </div>

      {status && <AiIndexBar bookId={bookId} status={status} onStatusChanged={refreshStatus} />}

      {status && !status.configured && (
        <p className="ai-notice ai-notice--strong" role="status">
          还没有填这家的 API Key。到「设置 → 模型」里填一个再回来。
        </p>
      )}

      <div className="ai-panel__stream" ref={streamRef}>
        {turns.length === 0 ? (
          <p className="ai-panel__empty">
            在正文里划一句话，选「问 AI」「解释」或「翻译」；也可以直接在这里提问。
          </p>
        ) : (
          <>
            {historyLoaded && (
              <p className="ai-panel__note">
                历史记录只保留文字：回答里的 [n] 不再可点，用量也只在本次会话里显示。
              </p>
            )}
            {turns.map((turn) => (
              <AiMessage key={turn.id} turn={turn} onCitation={onCitation} />
            ))}
          </>
        )}
      </div>

      {error && (
        <p className="ai-notice ai-notice--error" role="status">
          {error}
        </p>
      )}

      <form className="ai-panel__foot" onSubmit={submit}>
        {excerpt && (
          <div className="ai-panel__quote">
            <span>
              {excerpt.slice(0, 60)}
              {excerpt.length > 60 ? '…' : ''}
            </span>
            <button
              type="button"
              className="btn btn--quiet"
              aria-label="去掉引用的原文"
              onClick={() => setExcerpt(null)}
            >
              ×
            </button>
          </div>
        )}
        <textarea
          ref={inputRef}
          className="ai-panel__input"
          rows={2}
          value={question}
          placeholder="就这本书问点什么…（Enter 发送，Shift+Enter 换行）"
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="ai-panel__actions">
          {busy ? (
            <button type="button" className="btn" onClick={stop}>
              停下
            </button>
          ) : (
            <button type="submit" className="btn btn--accent" disabled={!canSend}>
              发送
            </button>
          )}
          {turns.length > 0 && !busy && <span className="ai-panel__hint">已中断的回答不会续跑</span>}
        </div>
      </form>
    </aside>
  )
}