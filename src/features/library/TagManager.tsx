import { useEffect, useRef, useState } from 'react'
import { readableError } from '@shared/errors'
import type { Tag } from '@shared/types'

/**
 * 侧栏标签列表：筛选、新建、改名、删除都在这一个列表里完成，不再另开管理弹窗。
 *
 * 改名不给每一行常驻一个输入框：平时它只是一行字，点「改名」才就地变成输入框
 * （回车或失焦提交，Esc 还原）。每敲一个字母就发 IPC 会让中间态也进库，
 * 用户看到的是标签名在闪，所以提交点留在「结束编辑」这一刻。
 */
export function TagManager({
  tags,
  activeId,
  onPick,
  onChanged
}: {
  tags: Tag[]
  /** 当前正在筛选的标签；null 是「全部」 */
  activeId: number | null
  onPick: (tagId: number | null) => void
  onChanged: () => Promise<void>
}) {
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

  // 确认态只在「还盯着这一行」时成立，点别处就收回去
  useEffect(() => {
    if (confirmingId === null) return
    function onDown(event: MouseEvent): void {
      const target = event.target as Node
      if (!(target instanceof Element) || !target.closest('.tag-row')) {
        setConfirmingId(null)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [confirmingId])

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
      <ul className="side-list">
        <li>
          <button
            type="button"
            className={`tag-item${activeId === null ? ' tag-item--active' : ''}`}
            onClick={() => onPick(null)}
          >
            <span className="tag-item__name">全部</span>
          </button>
        </li>

        {tags.map((tag) => {
          const editing = editingId === tag.id
          const confirming = confirmingId === tag.id
          return (
            <li
              key={tag.id}
              className={`tag-row${activeId === tag.id ? ' tag-row--active' : ''}`}
            >
              {editing ? (
                <input
                  className="tag-row__rename"
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
                      event.preventDefault()
                      cancelled.current = true
                      setEditingId(null)
                    }
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="tag-item"
                  title={`按「${tag.name}」筛选`}
                  onClick={() => onPick(tag.id)}
                >
                  <span className={`tag-dot tag-dot--${tag.color}`} />
                  <span className="tag-item__name">{tag.name}</span>
                  <span className="tag-item__count">{tag.bookCount}</span>
                </button>
              )}

              {!editing && (
                <span className="tag-row__acts">
                  {confirming ? (
                    <button
                      type="button"
                      className="tag-row__act tag-row__act--danger"
                      disabled={busy}
                      onClick={() => {
                        setConfirmingId(null)
                        void guard(() => window.api.library.tagDelete(tag.id), '标签没有删掉')
                      }}
                    >
                      确定删除
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="tag-row__act"
                        title="改名"
                        aria-label={`改名 ${tag.name}`}
                        disabled={busy}
                        onClick={() => startRename(tag)}
                      >
                        改名
                      </button>
                      <button
                        type="button"
                        className="tag-row__act"
                        title="删除（书不会被删掉）"
                        aria-label={`删除 ${tag.name}`}
                        disabled={busy}
                        onClick={() => setConfirmingId(tag.id)}
                      >
                        删除
                      </button>
                    </>
                  )}
                </span>
              )}
            </li>
          )
        })}
      </ul>

      {tags.length === 0 && <p className="sidebar__hint">还没有标签</p>}

      <div className="tag-new">
        <input
          value={draft}
          placeholder="新标签"
          maxLength={24}
          aria-label="新标签名"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && draft.trim()) void create()
          }}
        />
        <button
          type="button"
          className="tag-new__go"
          disabled={busy || !draft.trim()}
          onClick={() => void create()}
        >
          新建
        </button>
      </div>

      {error && <p className="tag-new__error">{error}</p>}
    </>
  )
}
