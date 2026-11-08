import type { TrackGapPayload } from '@shared/track'
import { gapReportIsStale, gapTypeLabel } from './state'
import type { GapView } from './types'

export function GapPanel({
  fingerprint,
  gap,
  cached,
  question,
  mode,
  onQuestion,
  onAsk,
  onFollowUp,
  onForce,
  onStop,
  nodeTitle
}: {
  fingerprint: string | null
  gap: GapView | null
  /** 刚这次问缺是否命中缓存。从库里读回的旧报告不标。 */
  cached: boolean
  question: string
  mode: 'idle' | 'gap' | 'blocked'
  onQuestion: (value: string) => void
  onAsk: () => void
  onFollowUp: () => void
  onForce: () => void
  onStop: () => void
  nodeTitle: (nodeId: string) => string | null
}) {
  const stale = gapReportIsStale(fingerprint, gap?.scopeKey)
  const running = mode === 'gap'
  const blocked = mode !== 'idle'

  return (
    <section className="track-gap" aria-label="我缺什么">
      <div className="track-gap__body">
        <h2 className="track-gap__title">我缺什么</h2>
        <p className="track-hint">按当前书架、阅读进度和笔记看这棵脉络还缺哪一块。不会自动重跑。</p>
        {stale && (
          <p className="track-stale">信号已变，可重新问缺。下面仍是上次的报告。</p>
        )}
        <div className="track-actions">
          {running ? (
            <button type="button" className="btn" onClick={onStop}>
              停下
            </button>
          ) : (
            <button type="button" className="btn btn--primary" disabled={blocked} onClick={onAsk}>
              我缺什么
            </button>
          )}
          {gap && !running && (
            <button type="button" className="btn btn--quiet" disabled={blocked} onClick={onForce}>
              无视缓存再问
            </button>
          )}
        </div>
        <form
          className="track-follow"
          onSubmit={(event) => {
            event.preventDefault()
            if (question.trim() === '' || blocked) return
            onFollowUp()
          }}
        >
          <input
            aria-label="追问"
            value={question}
            placeholder="可以再追问一句，例如先补哪一块"
            disabled={blocked}
            onChange={(event) => onQuestion(event.target.value)}
          />
          <button type="submit" className="btn" disabled={blocked || question.trim() === ''}>
            追问
          </button>
        </form>
        {cached && !stale && <p className="track-hint">沿用上次结果，未重新计费。</p>}
        {gap ? <Report gap={gap} nodeTitle={nodeTitle} /> : <p className="track-hint">还没有问过。点「我缺什么」看当前还缺哪一块。</p>}
      </div>
    </section>
  )
}

function Report({
  gap,
  nodeTitle
}: {
  gap: GapView
  nodeTitle: (nodeId: string) => string | null
}) {
  const payload: TrackGapPayload = gap.payload
  const overall = typeof payload.overall === 'string' ? payload.overall.trim() : ''
  const gaps = Array.isArray(payload.gaps) ? payload.gaps : []
  const steps = Array.isArray(payload.nextSteps) ? payload.nextSteps : []
  const when = formatWhen(gap.createdAt)

  return (
    <div>
      {when && <p className="track-hint">问于 {when}</p>}
      {overall !== '' && <p className="track-gap__overall">{overall}</p>}
      {gaps.map((item, index) => {
        const kinds = Array.isArray(item.suggestBookKinds) ? item.suggestBookKinds.filter(Boolean) : []
        const title = nodeTitle(item.nodeId)
        return (
          <article key={`${item.nodeId}-${index}`} className="track-gap__card">
            <div className="track-gap__type">
              {gapTypeLabel(item.type)}
              {title ? ` · ${title}` : ''}
            </div>
            <p>{item.summary}</p>
            {kinds.length > 0 && <p>可补的一类书：{kinds.join('、')}</p>}
          </article>
        )
      })}
      {steps.length > 0 && (
        <div>
          <div className="track-section">下一步</div>
          <ol className="track-steps">
            {steps.map((step, index) => (
              <li key={index}>{step}</li>
            ))}
          </ol>
        </div>
      )}
      {payload.rawText && payload.rawText.trim() !== '' && (
        <div className="track-gap__card">
          <div className="track-gap__type">模型原文</div>
          <pre className="track-gap__raw">{payload.rawText}</pre>
        </div>
      )}
      {payload.note && <p className="track-hint">{payload.note}</p>}
    </div>
  )
}

function formatWhen(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return ''
  try {
    return new Date(ms).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return ''
  }
}
