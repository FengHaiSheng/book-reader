import { useEffect, useRef, useState } from 'react'
import type {
  AiEstimate,
  AiEstimateRequest,
  AiProgressEvent,
  AiResultView,
  BookDigestPayload,
  CachedTaskResults,
  ChapterSummaryPayload,
  MindmapNode,
  TermsPayload
} from '@shared/types'

export type TaskKey = 'summary' | 'digest' | 'terms' | 'mindmap'

/** 能中途停下的任务。思维导图不调模型、同步返回，没有可停的余地 */
function isCancelable(task: TaskKey): boolean {
  return task === 'summary' || task === 'digest' || task === 'terms'
}

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

/**
 * 预估数字的展示口径。`calls === 0` 表示这次根本不调模型（缓存命中或前置缺失），
 * 那种情况没有数字可给，只有 note 里的说明。
 */
export function estimateLine(estimate: AiEstimate): string {
  if (estimate.calls === 0) return ''
  const input = `输入约 ${formatTokens(estimate.inputTokens)} token`
  const output = `单次最多 ${formatTokens(estimate.maxOutputTokens)} token 输出`
  if (estimate.calls === 1) return `预估${input} / ${output}`
  return (
    `预估${input}（共 ${estimate.calls} 次请求）/ ${output}` +
    `，输出合计最多 ${formatTokens(estimate.maxOutputTokens * estimate.calls)} token`
  )
}

function formatTokens(value: number): string {
  return value.toLocaleString('en-US')
}

/** TaskKey → 预估请求。四个任务的 kind 都是 'task'，只有 task 字段不同 */
function estimateRequestOf(
  task: TaskKey,
  bookId: string,
  chapterId: number | null
): AiEstimateRequest {
  return {
    kind: 'task',
    bookId,
    chapterId,
    task:
      task === 'summary'
        ? 'chapterSummary'
        : task === 'digest'
          ? 'bookDigest'
          : task === 'terms'
            ? 'terms'
            : 'mindmap'
  }
}

export function AiTasks({
  bookId,
  chapterId,
  hasSummary,
  onError,
  onResult
}: {
  bookId: string
  /** null 表示还没有打开具体某一章，「本章小结」据此禁用 */
  chapterId: number | null
  /** 本章是否已有小结 —— 决定「本章小结」是不是「查看已有小结」 */
  hasSummary: boolean
  onError: (message: string | null) => void
  /** 每次拿到结果后通知父组件。父组件用它记住「本章已有小结」这类跨任务状态 */
  onResult?: (task: TaskKey, result: AiResultView<unknown>) => void
}) {
  /** 本次会话里真的生成出来的结果。它决定了「重新生成」可不可以直接跑 */
  const [results, setResults] = useState<Partial<Record<TaskKey, AiResultView<unknown>>>>({})
  /** 打开面板时从库里回填的已有结果。只读缓存，不花钱 */
  const [restored, setRestored] = useState<CachedTaskResults>({})
  const [running, setRunning] = useState<TaskKey | null>(null)
  const [confirming, setConfirming] = useState<TaskKey | null>(null)
  /** 「本书分析」整块是否展开。默认展开；收起来能给对话区腾出整屏高度 */
  const [open, setOpen] = useState(true)
  /** 每个任务的结果是否展开。回填的（缓存）默认收起，亲手生成的默认展开 */
  const [openResults, setOpenResults] = useState<Partial<Record<TaskKey, boolean>>>({})
  /** 全书要点逐章生成的进度。主进程一直在发，之前没人接 */
  const [progress, setProgress] = useState<AiProgressEvent | null>(null)
  /** 确认框里的预估。null 且 estimating 为真表示还在算 */
  const [estimate, setEstimate] = useState<AiEstimate | null>(null)
  const [estimating, setEstimating] = useState(false)
  const [estimateError, setEstimateError] = useState<string | null>(null)
  /** 连点会发出多个预估请求，只认最后一个的结果 */
  const estimateSeq = useRef(0)
  /** 换书/换章会重新回填，只认最后一次的结果 */
  const restoreSeq = useRef(0)
  // onResult 是父组件每次渲染新建的内联函数，放进依赖会让回填 effect 转个不停；
  // 用 ref 拿最新的那个，effect 只依赖书与章。
  const onResultRef = useRef(onResult)
  onResultRef.current = onResult

  /**
   * 打开面板（或换书/换章）时把库里已有的结果读回来。
   *
   * 这一路**只读缓存、不调模型**（硬规则 1）：打开面板本身不该花任何 token。
   * 换章时同时清掉上一次的会话结果，免得把上一章的小结显示成这一章的。
   */
  useEffect(() => {
    const seq = restoreSeq.current + 1
    restoreSeq.current = seq
    setResults({})
    setRestored({})
    // 换书/换章时把展开态与进度一起清掉，免得把上一本书的进度显示成本书的
    setOpenResults({})
    setProgress(null)
    void window.api.ai
      .cachedResults(bookId, chapterId)
      .then((value) => {
        if (restoreSeq.current !== seq) return
        setRestored(value)
        // 让「本章已有小结」这类跨任务判断在打开面板时就是准的
        if (value.summary) onResultRef.current?.('summary', value.summary)
      })
      .catch(() => {
        // 回填失败不拦着用户：结果区空着，生成按钮照常可用
      })
  }, [bookId, chapterId])

  // 全书要点逐章生成的进度。只要事件属于这本书就收下，渲染时只在它跑的时候显示
  useEffect(
    () =>
      window.api.ai.onProgress((event) => {
        if (event.kind === 'digest' && event.bookId === bookId) setProgress(event)
      }),
    [bookId]
  )

  /**
   * 打开确认框，同时去问这次要花多少。
   *
   * 预估失败**不拦着开始**：拿不到数字也要让用户能继续，只是照实说「算不出来」。
   */
  const confirm = (task: TaskKey): void => {
    setConfirming(task)
    setEstimate(null)
    setEstimateError(null)
    setEstimating(true)
    const seq = estimateSeq.current + 1
    estimateSeq.current = seq
    void window.api.ai
      .estimate(estimateRequestOf(task, bookId, chapterId))
      .then((value) => {
        if (estimateSeq.current !== seq) return
        setEstimate(value)
      })
      .catch((e) => {
        if (estimateSeq.current !== seq) return
        setEstimateError(e instanceof Error ? e.message : '暂时算不出这次要花多少 token')
      })
      .finally(() => {
        if (estimateSeq.current === seq) setEstimating(false)
      })
  }

  const run = async (task: TaskKey): Promise<void> => {
    setConfirming(null)
    setRunning(task)
    setProgress(null)
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
      // 亲手生成的结果直接展开：用户刚点了按钮，就该看到内容
      setOpenResults((list) => ({ ...list, [task]: true }))
      onResult?.(task, value as AiResultView<unknown>)
    } catch (e) {
      onError(e instanceof Error ? e.message : `${TASK_LABELS[task]}没有生成成功`)
    } finally {
      setRunning(null)
      setProgress(null)
    }
  }

  /** 停下正在跑的任务。key 的拼法在主进程，这里只说「哪个任务、哪本书」 */
  const stop = (task: TaskKey): void => {
    if (task === 'digest') void window.api.ai.cancelDigest(bookId)
    else if (task === 'summary') void window.api.ai.cancelTask('summary', bookId, chapterId ?? 0)
    else if (task === 'terms') void window.api.ai.cancelTask('terms', bookId, null)
  }

  // 有任务在跑时强制展开：不能让用户收起后连「停下」都找不着
  const expanded = open || running !== null

  return (
    <section className="ai-tasks" aria-label="本书分析">
      <div className="ai-tasks__head">
        <button
          type="button"
          className="ai-tasks__toggle"
          aria-expanded={expanded}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="ai-tasks__caret" aria-hidden="true">
            {expanded ? '▾' : '▸'}
          </span>
          本书分析
        </button>
      </div>
      {expanded &&
        (Object.keys(TASK_LABELS) as TaskKey[]).map((task) => {
          /** 本次会话生成的优先。回填的只是「上次存下的」，所以按钮仍走一次确认框 */
          const session = results[task]
          const result = session ?? restored[task]
          const disabled = running !== null || (task === 'summary' && chapterId === null)
          const isRunning = running === task
          return (
            <div className="ai-task" key={task}>
              <div className="ai-task__head">
                <span className="ai-task__name">{TASK_LABELS[task]}</span>
                {result?.cached && <span className="ai-task__badge">来自缓存</span>}
                <span className="ai-panel__spacer" />
                {isRunning && isCancelable(task) ? (
                  // 能停的任务在跑时，按钮直接变成「停下」——不用去别处找
                  <button type="button" className="btn btn--quiet" onClick={() => stop(task)}>
                    停下
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn"
                    disabled={disabled}
                    // 只有「这次亲手生成过」才允许跳过确认框直接重跑：
                    // 回填来的结果点一下可能真的再花一次钱，成本必须先摆出来（硬规则 1）
                    onClick={() => (session ? void run(task) : confirm(task))}
                  >
                    {isRunning ? '生成中…' : result ? '重新生成' : '生成'}
                  </button>
                )}
              </div>

              {/* 逐章生成时把进度摆出来，别让用户对着「生成中…」干等 */}
              {isRunning && task === 'digest' && progress && progress.total > 0 && (
                <p className="ai-task__hint" role="status">
                  正在逐章生成：{progress.done} / {progress.total}
                  {progress.label ? `（${progress.label}）` : ''}
                </p>
              )}

              {task === 'summary' && chapterId === null && (
                <p className="ai-task__hint">先在正文里翻到具体某一章，才能做本章小结。</p>
              )}

              {confirming === task && (
                <div className="ai-task__confirm">
                  <p>
                    {TASK_CONFIRM[task]}
                    {task === 'summary' && hasSummary
                      ? '这一章已有小结，重新生成会再发一次请求。'
                      : ''}
                  </p>
                  {estimating ? (
                    <p className="ai-task__hint">正在估算这次要花多少 token…</p>
                  ) : estimateError ? (
                    <p className="ai-task__hint">暂时无法预估：{estimateError}</p>
                  ) : (
                    estimate && (
                      <>
                        {estimateLine(estimate) !== '' && (
                          <p>{estimateLine(estimate)}</p>
                        )}
                        {estimate.note && <p className="ai-task__hint">{estimate.note}</p>}
                      </>
                    )
                  )}
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

              {result && (
                <TaskResult
                  task={task}
                  result={result}
                  open={openResults[task] ?? false}
                  onToggle={() => setOpenResults((list) => ({ ...list, [task]: !list[task] }))}
                />
              )}
            </div>
          )
        })}
    </section>
  )
}

function TaskResult({
  task,
  result,
  open,
  onToggle
}: {
  task: TaskKey
  result: AiResultView<unknown>
  open: boolean
  onToggle: () => void
}) {
  return (
    <div className="ai-task__result">
      <button type="button" className="ai-task__result-toggle" aria-expanded={open} onClick={onToggle}>
        {open ? '收起结果' : result.cached ? '查看结果（来自缓存）' : '查看结果'}
      </button>
      {open && (
        <>
          {result.note && <p className="ai-degrade">{result.note}</p>}
          <TaskBody task={task} result={result} />
          <p className="ai-task__meta">{usageLine(result)}</p>
        </>
      )}
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