import { useEffect, useRef, useState } from 'react'
import { readableError } from '@shared/errors'
import type { Tag } from '@shared/types'

/**
 * 新建 / 改名 / 删除。整块内容由 LibraryPage 套在 Modal 里，这里只管内容与间距。
 *
 * 改名不给每一行常驻一个输入框：平时它只是一行字，点一下才就地变成输入框
 * （回车或失焦提交，Esc 还原）。每敲一个字母就发 IPC 会让中间态也进库，
 * 用户看到的是标签名在闪，所以提交点留在「结束编辑」这一刻。
 */
export function TagManager({ tags, onChanged }: { tags: Tag[]; onChanged: () => Promise<void> }) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** 正在改名的标签 id；null 表示所有行都是只读的一行字 */
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingName, setEditingName] = useState('')
  /** 已点过一次「删除」、正等二次确认的标签 id */
  const [confirmingId, setConfirmingId] = useState<number | null>(null)
  /** Esc 放弃改名时置位：失焦提交要放这一枪空过去，否则会把旧名字又写回库里 */
  const cancelled = useRef(false)

  // 确认态和改名态都只在「还盯着这一行」时成立，点别处就收回去
  useEffect(() => {
    if (confirmingId === null && editingId === null) return
    function onDown(event: MouseEvent): void {
      const target = event.target as Node
      if (!(target instanceof Element) || !target.closest('.tag-manager__row')) {
        setConfirmingId(null)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [confirmingId, editingId])

  async function guard(action: () => Promise<unknown>, fallback: string): Promise<void> {
    setBusy(true)
    try {
      await action()
      setError(null)
      await onChanged()
    } catch (e) {
      setError(readableError(e, fallback))
    } finally {
      setBusy(false)
    }
  }

  function startRename(tag: Tag): void {
    cancelled.current = false
    setConfirmingId(null)
    setEditingId(tag.id)
    setEditingName(tag.name)
  }

  function commitRename(tag: Tag): void {
    const next = editingName.trim()
    setEditingId(null)
    if (!next || next === tag.name) return
    void guard(() => window.api.library.tagRename(tag.id, next), '标签没有改成')
  }

  function create(): Promise<void> {
    return guard(() => window.api.library.tagCreate(draft.trim()), '标签没有建成').then(() =>
      setDraft('')
    )
  }

  return (
    <>
      {tags.length === 0 && <p className="tag-manager__hint">还没有标签，先在下面建一个</p>}

      {tags.map((tag) => (
        <div key={tag.id} className="tag-manager__row">
          <span className={`tag-dot tag-dot--${tag.color}`} />

          {editingId === tag.id ? (
            <input
              className="tag-manager__rename"
              value={editingName}
              maxLength={24}
              disabled={busy}
              autoFocus
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => setEditingName(event.target.value)}
              onBlur={() => {
                if (cancelled.current) {
                  cancelled.current = false
                  return
                }
                commitRename(tag)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
                if (event.key === 'Escape') {
                  // preventDefault 是给 Modal 看的：这次 Esc 只用来放弃改名
                  event.preventDefault()
                  cancelled.current = true
                  setEditingId(null)
                }
              }}
            />
          ) : (
            <button
              type="button"
              className="tag-manager__name"
              title="点击改名"
              disabled={busy}
              onClick={() => startRename(tag)}
            >
              {tag.name}
            </button>
          )}

          <span className="tag-manager__count">{tag.bookCount} 本</span>

          {confirmingId === tag.id ? (
            <button
              type="button"
              className="tag-manager__act tag-manager__act--danger"
              disabled={busy}
              onClick={() => {
                setConfirmingId(null)
                void guard(() => window.api.library.tagDelete(tag.id), '标签没有删掉')
              }}
            >
              确定删除
            </button>
          ) : (
            <button
              type="button"
              className="tag-manager__act"
              disabled={busy}
              onClick={() => setConfirmingId(tag.id)}
            >
              删除
            </button>
          )}
        </div>
      ))}

      <div className="tag-manager__new">
        <input
          value={draft}
          placeholder="新标签名"
          maxLength={24}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && draft.trim()) void create()
          }}
        />
        <button
          type="button"
          className="btn"
          disabled={busy || !draft.trim()}
          onClick={() => void create()}
        >
          新建
        </button>
      </div>

      {/* 这句话原来是原生 confirm 说的。挪进行内确认后，得有个地方一直讲清楚 */}
      <p className="tag-manager__note">删除标签只是让书不再带这个标签，书本身不会被删掉。</p>

      {error && <p className="tag-manager__error">{error}</p>}
    </>
  )
}
