import { useState } from 'react'
import type {
  AiResultView,
  BookDigestPayload,
  ChapterSummaryPayload,
  MindmapNode,
  TermsPayload
} from '@shared/types'

export type TaskKey = 'summary' | 'digest' | 'terms' | 'mindmap'

const TASK_LABELS: Record<TaskKey, string> = {
  summary: '本章小结',
  digest: '全书要点',
  terms: '关键词',
  mindmap: '思维导图'
}

/**
 * 每个任务开跑前要说清「大概要发几次请求」。
 * 这是 BYOK 产品的底线：多步任务的成本必须在点击之前可见（硬规则 1）。
 */
const TASK_CONFIRM: Record<TaskKey, string> = {
  summary: '会把这一章的正文发给模型做一次结构化小结。',
  digest: '会逐章请求一次。已经做过小结的章会直接复用，不重复花钱。',
  terms: '会用已有的逐章小结请求一次。没有小结时先做「全书要点」。',
  mindmap: '不调用模型：它是把「关键词」的结果按章节重新组织的。'
}

export function AiTasks({
  bookId,
  chapterId,
  chapterCount,
  hasSummary,
  onError,
  onResult
}: {
  bookId: string
  /** null 表示还没有打开具体某一章，「本章小结」据此禁用 */
  chapterId: number | null
  /** 正文里有多少章。全书要点的成本提示要用它 */
  chapterCount: number
  /** 本章是否已有小结 —— 决定「本章小结」是不是「查看已有小结」 */
  hasSummary: boolean
  onError: (message: string | null) => void
  /** 每次拿到结果后通知父组件。父组件用它记住「本章已有小结」这类跨任务状态 */
  onResult?: (task: TaskKey, result: AiResultView<unknown>) => void
}) {
  const [results, setResults] = useState<Partial<Record<TaskKey, AiResultView<unknown>>>>({})
  const [running, setRunning] = useState<TaskKey | null>(null)
  const [confirming, setConfirming] = useState<TaskKey | null>(null)

  const run = async (task: TaskKey): Promise<void> => {
    setConfirming(null)
    setRunning(task)
    onError(null)
    try {
      const value =
        task === 'summary'
          ? await window.api.ai.summary(bookId, chapterId ?? 0)
          : task === 'digest'
            ? await window.api.ai.digest(bookId)
            : task === 'terms'
              ? await window.api.ai.terms(bookId)
              : await window.api.ai.mindmap(bookId)
      setResults((list) => ({ ...list, [task]: value as AiResultView<unknown> }))
      onResult?.(task, value as AiResultView<unknown>)
    } catch (e) {
      onError(e instanceof Error ? e.message : `${TASK_LABELS[task]}没有生成成功`)
    } finally {
      setRunning(null)
    }
  }

  return (
    <section className="ai-tasks" aria-label="本书分析">
      {(Object.keys(TASK_LABELS) as TaskKey[]).map((task) => {
        const result = results[task]
        const disabled = running !== null || (task === 'summary' && chapterId === null)
        return (
          <div className="ai-task" key={task}>
            <div className="ai-task__head">
              <span className="ai-task__name">{TASK_LABELS[task]}</span>
              {result?.cached && <span className="ai-task__badge">来自缓存</span>}
              <span className="ai-panel__spacer" />
              {task === 'digest' && running === 'digest' ? (
                <button
                  type="button"
                  className="btn btn--quiet"
                  onClick={() => void window.api.ai.cancelDigest(bookId)}
                >
                  停下
                </button>
              ) : (
                <button
                  type="button"
                  className="btn"
                  disabled={disabled}
                  onClick={() => (result ? void run(task) : setConfirming(task))}
                >
                  {running === task ? '生成中…' : result ? '重新生成' : '生成'}
                </button>
              )}
            </div>

            {task === 'summary' && chapterId === null && (
              <p className="ai-task__hint">先在正文里翻到具体某一章，才能做本章小结。</p>
            )}

            {confirming === task && (
              <div className="ai-task__confirm">
                <p>
                  {TASK_CONFIRM[task]}
                  {task === 'digest' && chapterCount > 0
                    ? `本书正文共 ${chapterCount} 章，最多发起 ${chapterCount + 1} 次请求。`
                    : ''}
                  {task === 'summary' && hasSummary
                    ? '这一章已有小结，重新生成会再发一次请求。'
                    : ''}
                </p>
                <div className="ai-index-bar__actions">
                  <button type="button" className="btn btn--accent" onClick={() => void run(task)}>
                    开始
                  </button>
                  <button type="button" className="btn" onClick={() => setConfirming(null)}>
                    算了
                  </button>
                </div>
              </div>
            )}

            {result && <TaskResult task={task} result={result} />}
          </div>
        )
      })}
    </section>
  )
}

function TaskResult({ task, result }: { task: TaskKey; result: AiResultView<unknown> }) {
  return (
    <div className="ai-task__result">
      {result.note && <p className="ai-degrade">{result.note}</p>}
      <TaskBody task={task} result={result} />
      <p className="ai-task__meta">{usageLine(result)}</p>
    </div>
  )
}

function TaskBody({ task, result }: { task: TaskKey; result: AiResultView<unknown> }) {
  // 没解析成结构就按纯文本展示。绝不显示一个空框（硬规则 2）
  if (!result.payload) {
    return <p className="ai-task__text">{result.text ?? '这次没有拿到内容。'}</p>
  }
  if (task === 'summary') return <SummaryBody payload={result.payload as ChapterSummaryPayload} />
  if (task === 'digest') return <DigestBody payload={result.payload as BookDigestPayload} />
  if (task === 'terms') return <TermsBody payload={result.payload as TermsPayload} />
  return <MindmapBody node={result.payload as MindmapNode} />
}

function SummaryBody({ payload }: { payload: ChapterSummaryPayload }) {
  return (
    <>
      <p className="ai-task__text">{payload.overview}</p>
      <ul className="ai-msg__list">
        {payload.keyPoints.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
      {payload.terms.length > 0 && (
        <ul className="ai-terms">
          {payload.terms.map((item) => (
            <li key={item.term}>
              <strong>{item.term}</strong>：{item.gloss}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function DigestBody({ payload }: { payload: BookDigestPayload }) {
  return (
    <>
      <Section title="主题脉络" items={payload.threads} />
      <Section title="核心论点" items={payload.arguments} />
      <p className="ai-task__text">{payload.conclusion}</p>
    </>
  )
}

function Section({ title, items }: { title: string; items: readonly string[] }) {
  if (items.length === 0) return null
  return (
    <>
      <p className="ai-task__label">{title}</p>
      <ul className="ai-msg__list">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </>
  )
}

function TermsBody({ payload }: { payload: TermsPayload }) {
  return (
    <ul className="ai-terms">
      {payload.terms.map((item) => (
        <li key={`${item.term}-${item.where}`}>
          <strong>{item.term}</strong>：{item.gloss}
          {item.where !== '' && <span className="ai-terms__where">（{item.where}）</span>}
        </li>
      ))}
    </ul>
  )
}

function MindmapBody({ node }: { node: MindmapNode }) {
  return (
    <ul className="ai-mindmap">
      <li>
        {node.label}
        {node.children.length > 0 && (
          <ul>
            {node.children.map((child) => (
              <li key={child.label}>
                {child.label}
                {child.children.length > 0 && (
                  <ul>
                    {child.children.map((leaf) => (
                      <li key={`${child.label}-${leaf.label}`}>{leaf.label}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </li>
    </ul>
  )
}

function usageLine(result: AiResultView<unknown>): string {
  if (!result.usage) return '这次没有产生用量'
  const spent = `输入 ${result.usage.inputTokens} / 输出 ${result.usage.outputTokens} token`
  return result.cached ? `来自缓存，没有花钱（上次用量 ${spent}）` : `用量：${spent}`
}