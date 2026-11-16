import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BookSummary } from '@shared/types'
import type { TrackMatchResult } from '@shared/track-match'
import { readableError } from '@shared/errors'
import { Modal } from '../../shell/Modal'
import { GapPanel } from './GapPanel'
import {
  errorNeedsSettings,
  formatTrackUsage,
  gapPanelFromResult,
  isQuietStop,
  trackPhaseLabel,
  trackProgressTask,
  unlinkedBookIds,
  type SignalStrength
} from './state'
import { TrackTree } from './TrackTree'
import type { GapView, TrackNode, TrackRecord } from './types'
import './track.css'

const NO_KEY = '还没有模型密钥。请先到设置里填写，再生成脉络或问缺。'
const SPEND_COPY = '将调用模型，分两阶段生成骨架并建议挂书。'
const REBUILD_COPY =
  '仍然存在的节点会留下原来的挂载，不只是手改的；对不上的节点会丢掉。'

type SpendConfirm = { rebuild: boolean; goalText: string }
type BusyTask = 'build' | 'gap'
type PendingMatch = TrackMatchResult['pending'][number]

export function TrackPage({
  onOpenBook,
  onOpenSettings
}: {
  onOpenBook: (bookId: string) => void
  onOpenSettings: () => void
}) {
  const alive = useRef(true)
  const busyRef = useRef<BusyTask | null>(null)
  const linkBusyRef = useRef(false)
  const matchBusyRef = useRef(false)
  const settingsHintRef = useRef<HTMLButtonElement>(null)

  const [ready, setReady] = useState(false)
  const [track, setTrack] = useState<TrackRecord | null>(null)
  const [nodes, setNodes] = useState<TrackNode[]>([])
  const [fingerprint, setFingerprint] = useState<string | null>(null)
  const [strengthById, setStrengthById] = useState<ReadonlyMap<string, SignalStrength>>(new Map())
  const [gap, setGap] = useState<GapView | null>(null)
  const [gapCached, setGapCached] = useState(false)
  const [books, setBooks] = useState<BookSummary[]>([])
  const [uncategorizedIds, setUncategorizedIds] = useState<string[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [goalDraft, setGoalDraft] = useState('')
  const [editingGoal, setEditingGoal] = useState(false)
  const [question, setQuestion] = useState('')
  const [keyReady, setKeyReady] = useState<boolean | null>(null)
  const [busy, setBusy] = useState<BusyTask | null>(null)
  const [linkBusy, setLinkBusy] = useState(false)
  const [matchBusy, setMatchBusy] = useState(false)
  const [pending, setPending] = useState<PendingMatch[]>([])
  /** bookId → 已勾选的候选节点；默认全选，确认时写库为 user */
  const [picked, setPicked] = useState<Record<string, string[]>>({})
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [buildUsage, setBuildUsage] = useState<{ inputTokens: number; outputTokens: number } | null>(null)
  const [confirm, setConfirm] = useState<SpendConfirm | null>(null)
  const buildUsageLine = formatTrackUsage(buildUsage, false)

  const reload = useCallback(async () => {
    try {
      const data = await loadTrackScreen()
      if (!alive.current) return
      setTrack(data.active)
      setNodes(data.nodes)
      const read = readSignals(data.signals)
      setFingerprint(read.fingerprint)
      setStrengthById(read.strength)
      setGap(data.gap)
      setGapCached(false)
      setBooks(data.books)
      setKeyReady(data.configured)
      setUncategorizedIds(data.active ? unlinkedBookIds(data.books, data.nodes) : [])
      setGoalDraft(data.active?.goalText ?? '')
      setSelectedId((current) =>
        current && data.nodes.some((node) => node.id === current) ? current : null
      )
      setError(null)
      setReady(true)
    } catch (e) {
      if (!alive.current) return
      setError(readableError(e, '脉络没有读出来'))
    }
  }, [])

  useEffect(() => {
    alive.current = true
    void reload()
    const unsubscribe = window.api.ai.onProgress((event) => {
      const task = trackProgressTask(event)
      if (!task || busyRef.current !== task || !alive.current) return
      setProgress(event.running ? trackPhaseLabel(event.label) : null)
    })
    return () => {
      alive.current = false
      unsubscribe()
      const task = busyRef.current
      if (task) void window.api.track.cancel(task)
    }
  }, [reload])

  const blockIfNoKey = (): boolean => {
    if (keyReady !== false) return false
    settingsHintRef.current?.focus()
    return true
  }

  const fail = (e: unknown, fallback: string): void => {
    if (!alive.current) return
    const message = readableError(e, fallback)
    if (!isQuietStop(message)) setError(message)
  }

  const runBuild = async (goalText: string, rebuild: boolean): Promise<void> => {
    if (busyRef.current) return
    setError(null)
    setNotice(null)
    setBuildUsage(null)
    setProgress(null)
    busyRef.current = 'build'
    setBusy('build')
    let built = false
    try {
      const result = await window.api.track.build({ goalText, rebuild })
      built = true
      if (!alive.current) return
      const [active, nodeList, signals, latest, library] = await Promise.all([
        window.api.track.getActive(),
        window.api.track.listNodes(),
        window.api.track.computeSignals(),
        window.api.track.getLatestGap(),
        window.api.library.list()
      ])
      if (!alive.current) return
      const nextNodes = toNodes(nodeList)
      setTrack(toTrack(active))
      setNodes(nextNodes)
      const read = readSignals(signals)
      setFingerprint(read.fingerprint)
      setStrengthById(read.strength)
      setGap(latest ? toGap(latest) : null)
      setGapCached(false)
      setBooks(library)
      // 生成结果里的未归类用接口原样带回，不在这里按书架重算。
      setUncategorizedIds(result.uncategorizedBookIds)
      setNotice(result.note)
      // 重生后节点 id 可能整批换掉，旧的待确认候选不再有意义
      setPending([])
      setPicked({})
      setBuildUsage(result.usage)
      setEditingGoal(false)
      setGoalDraft(active?.goalText ?? goalText)
      setSelectedId((current) =>
        current && nextNodes.some((node) => node.id === current) ? current : null
      )
      setReady(true)
    } catch (e) {
      fail(e, built ? '脉络已经生成，但界面没有刷新' : '脉络没有生成成功')
      if (built && alive.current) void reload()
    } finally {
      if (busyRef.current === 'build') busyRef.current = null
      if (alive.current) {
        setBusy((current) => (current === 'build' ? null : current))
        setProgress(null)
      }
    }
  }

  const runGap = async (asked: string | undefined, forceRefresh: boolean): Promise<void> => {
    if (busyRef.current) return
    if (blockIfNoKey()) return
    setError(null)
    setProgress(null)
    busyRef.current = 'gap'
    setBusy('gap')
    try {
      const result = await window.api.track.gap({ question: asked, forceRefresh })
      if (!alive.current) return
      const shown = gapPanelFromResult(result, null, {
        question: asked,
        forceRefresh,
        now: Date.now()
      })
      setGap(shown.gap)
      setGapCached(shown.cached)
      const signals = await window.api.track.computeSignals()
      if (!alive.current) return
      const read = readSignals(signals)
      setFingerprint(read.fingerprint)
      setStrengthById(read.strength)
    } catch (e) {
      fail(e, '问缺没有完成')
    } finally {
      if (busyRef.current === 'gap') busyRef.current = null
      if (alive.current) {
        setBusy((current) => (current === 'gap' ? null : current))
        setProgress(null)
      }
    }
  }

  const requestBuild = (rebuild: boolean): void => {
    if (busyRef.current) return
    if (blockIfNoKey()) return
    const goal = (rebuild && !editingGoal ? track?.goalText ?? goalDraft : goalDraft).trim()
    if (goal === '') {
      setError('请先写下学习目标')
      return
    }
    setError(null)
    setConfirm({ rebuild, goalText: goal })
  }

  /** 本地归位：不花钱，高置信已由主进程落库，中置信留在这里等确认 */
  const matchUncategorized = async (): Promise<void> => {
    if (busyRef.current || matchBusyRef.current) return
    matchBusyRef.current = true
    setMatchBusy(true)
    setError(null)
    try {
      const result = await window.api.track.matchBooks({})
      if (!alive.current) return
      setPending(result.pending)
      setPicked(
        Object.fromEntries(
          result.pending.map((item) => [item.bookId, item.candidates.map((c) => c.nodeId)])
        )
      )
      setNotice(`已归位 ${result.mounted.length} 本，待确认 ${result.pending.length} 本`)
      await reload()
    } catch (e) {
      fail(e, '归位没有完成')
    } finally {
      matchBusyRef.current = false
      if (alive.current) setMatchBusy(false)
    }
  }

  const togglePendingNode = (bookId: string, nodeId: string): void => {
    setPicked((current) => {
      const chosen = current[bookId] ?? []
      return {
        ...current,
        [bookId]: chosen.includes(nodeId)
          ? chosen.filter((id) => id !== nodeId)
          : [...chosen, nodeId]
      }
    })
  }

  const confirmPending = async (bookId: string): Promise<void> => {
    if (busyRef.current || matchBusyRef.current) return
    const nodeIds = picked[bookId] ?? []
    if (nodeIds.length === 0) {
      setError('至少选一个节点')
      return
    }
    matchBusyRef.current = true
    setMatchBusy(true)
    setError(null)
    try {
      await window.api.track.confirmMatch(bookId, nodeIds)
      if (!alive.current) return
      setPending((list) => list.filter((item) => item.bookId !== bookId))
      await reload()
    } catch (e) {
      fail(e, '归位没有确认成')
    } finally {
      matchBusyRef.current = false
      if (alive.current) setMatchBusy(false)
    }
  }

  const changeLinks = async (nodeId: string, bookIds: string[]): Promise<void> => {
    if (busyRef.current || linkBusyRef.current || matchBusyRef.current) return
    linkBusyRef.current = true
    setLinkBusy(true)
    setError(null)
    try {
      await window.api.track.setBookLinks(nodeId, bookIds)
      if (!alive.current) return
      const [nodeList, signals, latest, library] = await Promise.all([
        window.api.track.listNodes(),
        window.api.track.computeSignals(),
        window.api.track.getLatestGap(),
        window.api.library.list()
      ])
      if (!alive.current) return
      const nextNodes = toNodes(nodeList)
      setNodes(nextNodes)
      const read = readSignals(signals)
      setFingerprint(read.fingerprint)
      setStrengthById(read.strength)
      setGap(latest ? toGap(latest) : null)
      setGapCached(false)
      setBooks(library)
      setUncategorizedIds(unlinkedBookIds(library, nextNodes))
    } catch (e) {
      fail(e, '挂书没有改成')
    } finally {
      linkBusyRef.current = false
      if (alive.current) setLinkBusy(false)
    }
  }

  const rename = async (nodeId: string, title: string, summary: string): Promise<boolean> => {
    if (title.trim() === '') {
      setError('节点标题不能为空')
      return false
    }
    setError(null)
    try {
      await window.api.track.renameNode(nodeId, title.trim(), summary)
      if (!alive.current) return false
      setNodes((list) =>
        list.map((node) => (node.id === nodeId ? { ...node, title: title.trim(), summary } : node))
      )
      return true
    } catch (e) {
      fail(e, '节点没有改成')
      return false
    }
  }

  const nodeTitle = useMemo(() => {
    const titles = new Map(nodes.map((node) => [node.id, node.title]))
    return (id: string): string | null => titles.get(id) ?? null
  }, [nodes])

  const gapMode = busy === 'gap' ? 'gap' : busy === 'build' || linkBusy ? 'blocked' : 'idle'
  const alertMessage =
    error && !(keyReady === false && errorNeedsSettings(error)) ? error : null

  if (!ready && !track) {
    return (
      <div className="track-page">
        {error ? (
          <div className="track-empty">
            <div className="track-empty__inner">
              <h1 className="track-empty__title">脉络没有读出来</h1>
              <p className="track-error" role="alert">
                {error}
              </p>
              <div className="track-empty__acts">
                <button type="button" className="btn" onClick={() => void reload()}>
                  重试
                </button>
              </div>
            </div>
          </div>
        ) : (
          <p className="track-loading">读取中…</p>
        )}
      </div>
    )
  }

  if (!track) {
    return (
      <div className="track-page">
        <div className="track-empty">
          <div className="track-empty__inner">
            <h1 className="track-empty__title">学习脉络</h1>
            <p className="track-empty__lead">
              写下你想练成的能力。生成时会调用模型：先搭能力骨架，再建议把书架上的书挂到节点。之后可以问自己还缺什么。
            </p>
            <label className="track-field">
              <span>学习目标</span>
              <textarea
                value={goalDraft}
                rows={4}
                placeholder="例如：当好 CEO"
                disabled={busy === 'build'}
                onChange={(event) => setGoalDraft(event.target.value)}
              />
            </label>
            {keyReady === false && (
              <p className="track-note">
                <span>{NO_KEY}</span>
                <button
                  ref={settingsHintRef}
                  type="button"
                  className="btn btn--quiet"
                  onClick={onOpenSettings}
                >
                  去设置
                </button>
              </p>
            )}
            {alertMessage && <Alert message={alertMessage} onOpenSettings={onOpenSettings} />}
            {progress && (
              <p className="track-progress" role="status">
                {progress}
              </p>
            )}
            <div className="track-empty__acts">
              {busy === 'build' ? (
                <button type="button" className="btn" onClick={() => void window.api.track.cancel('build')}>
                  停下
                </button>
              ) : (
                <button type="button" className="btn btn--primary" onClick={() => requestBuild(false)}>
                  生成脉络
                </button>
              )}
            </div>
            {buildUsageLine && <p className="track-empty__note">{buildUsageLine}</p>}
            <p className="track-empty__note">只根据这台电脑上的书架来挂书，不推荐外链。</p>
          </div>
        </div>
        {confirm && (
          <SpendDialog
            confirm={confirm}
            onCancel={() => setConfirm(null)}
            onStart={() => {
              const pending = confirm
              setConfirm(null)
              void runBuild(pending.goalText, pending.rebuild)
            }}
          />
        )}
      </div>
    )
  }

  return (
    <div className="track-page">
      <header className="track-bar">
        <div>
          <h1 className="track-bar__title">{track.title}</h1>
          {!editingGoal && <p className="track-bar__goal">{track.goalText}</p>}
        </div>
        <div className="track-bar__acts">
          {progress && (
            <span className="track-progress" role="status">
              {progress}
            </span>
          )}
          <button
            type="button"
            className="btn btn--quiet"
            disabled={busy !== null || linkBusy || matchBusy}
            onClick={() => void matchUncategorized()}
          >
            归位未归类
          </button>
          <button
            type="button"
            className="btn btn--quiet"
            disabled={busy !== null}
            onClick={() => {
              setEditingGoal((open) => {
                if (!open) setGoalDraft(track.goalText)
                return !open
              })
            }}
          >
            {editingGoal ? '收起目标' : '改目标'}
          </button>
          {busy === 'build' ? (
            <button type="button" className="btn" onClick={() => void window.api.track.cancel('build')}>
              停下
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy !== null || linkBusy || matchBusy}
              onClick={() => requestBuild(true)}
            >
              重生骨架
            </button>
          )}
        </div>
      </header>
      {editingGoal && (
        <div className="track-goal">
          <label className="track-field">
            <span>学习目标</span>
            <textarea
              value={goalDraft}
              rows={3}
              disabled={busy === 'build'}
              onChange={(event) => setGoalDraft(event.target.value)}
            />
          </label>
        </div>
      )}
      {keyReady === false && (
        <p className="track-note">
          <span>{NO_KEY}</span>
          <button ref={settingsHintRef} type="button" className="btn btn--quiet" onClick={onOpenSettings}>
            去设置
          </button>
        </p>
      )}
      {notice && <p className="track-note">{notice}</p>}
      {buildUsageLine && <p className="track-note">{buildUsageLine}</p>}
      {alertMessage && <Alert message={alertMessage} onOpenSettings={onOpenSettings} />}
      {pending.length > 0 && (
        <section className="track-pending" aria-label="待确认归位">
          <div className="track-pending__head">
            <span className="track-section">待确认归位</span>
            <button
              type="button"
              className="btn btn--quiet"
              disabled={matchBusy}
              onClick={() => setPending([])}
            >
              全部跳过
            </button>
          </div>
          <ul className="track-pending__list">
            {pending.map((item) => {
              const book = books.find((candidate) => candidate.id === item.bookId)
              const chosen = picked[item.bookId] ?? []
              return (
                <li key={item.bookId} className="track-pending__item">
                  <span className="track-pending__book">{book?.title ?? '已不在书架'}</span>
                  <div className="track-pending__opts">
                    {item.candidates.map((candidate) => (
                      <label key={candidate.nodeId} className="track-pending__opt">
                        <input
                          type="checkbox"
                          checked={chosen.includes(candidate.nodeId)}
                          disabled={matchBusy}
                          onChange={() => togglePendingNode(item.bookId, candidate.nodeId)}
                        />
                        <span>{candidate.title || candidate.nodeId}</span>
                        <span className="track-pending__score">
                          {Math.round(candidate.score * 100)}%
                        </span>
                      </label>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="btn"
                    disabled={matchBusy || chosen.length === 0}
                    onClick={() => void confirmPending(item.bookId)}
                  >
                    确认
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}
      <div className="track-body">
        <TrackTree
          nodes={nodes}
          strengthById={strengthById}
          selectedId={selectedId}
          books={books}
          uncategorizedIds={uncategorizedIds}
          locked={busy !== null || linkBusy || matchBusy}
          onSelect={setSelectedId}
          onOpenBook={onOpenBook}
          onChangeLinks={(nodeId, bookIds) => void changeLinks(nodeId, bookIds)}
          onRename={rename}
        />
        <GapPanel
          fingerprint={fingerprint}
          gap={gap}
          cached={gapCached}
          question={question}
          mode={gapMode}
          onQuestion={setQuestion}
          onAsk={() => void runGap(undefined, false)}
          onFollowUp={() => void runGap(question.trim(), false)}
          onForce={() => {
            const asked = question.trim()
            void runGap(asked === '' ? undefined : asked, true)
          }}
          onStop={() => void window.api.track.cancel('gap')}
          nodeTitle={nodeTitle}
        />
      </div>
      {confirm && (
        <SpendDialog
          confirm={confirm}
          onCancel={() => setConfirm(null)}
          onStart={() => {
            const pending = confirm
            setConfirm(null)
            void runBuild(pending.goalText, pending.rebuild)
          }}
        />
      )}
    </div>
  )
}

function Alert({ message, onOpenSettings }: { message: string; onOpenSettings: () => void }) {
  return (
    <p className="track-error" role="alert">
      <span>{message}</span>
      {errorNeedsSettings(message) && (
        <button type="button" className="btn btn--quiet" onClick={onOpenSettings}>
          去设置
        </button>
      )}
    </p>
  )
}

function SpendDialog({
  confirm,
  onCancel,
  onStart
}: {
  confirm: SpendConfirm
  onCancel: () => void
  onStart: () => void
}) {
  return (
    <Modal title={confirm.rebuild ? '重生骨架？' : '生成脉络？'} onClose={onCancel}>
      <p className="exit-reading__text">
        {SPEND_COPY}
        {confirm.rebuild ? REBUILD_COPY : ''}
      </p>
      <div className="exit-reading__acts">
        <button type="button" className="btn" autoFocus onClick={onCancel}>
          取消
        </button>
        <button type="button" className="btn btn--primary" onClick={onStart}>
          开始
        </button>
      </div>
    </Modal>
  )
}

async function loadTrackScreen(): Promise<{
  active: TrackRecord | null
  nodes: TrackNode[]
  signals: Awaited<ReturnType<typeof window.api.track.computeSignals>>
  gap: GapView | null
  books: BookSummary[]
  configured: boolean
}> {
  const [active, nodes, signals, gap, books, status] = await Promise.all([
    window.api.track.getActive(),
    window.api.track.listNodes(),
    window.api.track.computeSignals(),
    window.api.track.getLatestGap(),
    window.api.library.list(),
    window.api.ai.status(null)
  ])
  return {
    active: toTrack(active),
    nodes: toNodes(nodes),
    signals,
    gap: gap ? toGap(gap) : null,
    books,
    configured: status.configured
  }
}

function toTrack(
  track: Awaited<ReturnType<typeof window.api.track.getActive>>
): TrackRecord | null {
  if (!track) return null
  return { id: track.id, title: track.title, goalText: track.goalText }
}

function toNodes(nodes: Awaited<ReturnType<typeof window.api.track.listNodes>>): TrackNode[] {
  return nodes.map((node) => ({
    id: node.id,
    parentId: node.parentId,
    title: node.title,
    summary: node.summary,
    sortOrder: node.sortOrder,
    depth: node.depth,
    books: node.books.map((book) => ({
      bookId: book.bookId,
      title: book.title,
      author: book.author,
      source: book.source
    }))
  }))
}

function toGap(gap: NonNullable<Awaited<ReturnType<typeof window.api.track.getLatestGap>>>): GapView {
  return {
    payload: gap.payload,
    scopeKey: gap.scopeKey,
    createdAt: gap.createdAt,
    usage:
      Number.isFinite(gap.inputTokens) && Number.isFinite(gap.outputTokens)
        ? { inputTokens: gap.inputTokens, outputTokens: gap.outputTokens }
        : null
  }
}

function readSignals(signals: Awaited<ReturnType<typeof window.api.track.computeSignals>>): {
  fingerprint: string | null
  strength: Map<string, SignalStrength>
} {
  const strength = new Map<string, SignalStrength>()
  if (!signals) return { fingerprint: null, strength }
  for (const row of signals.nodes) strength.set(row.nodeId, row.strength)
  return { fingerprint: signals.fingerprint, strength }
}
