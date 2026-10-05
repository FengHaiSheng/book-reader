import { useState } from 'react'
import { readableError } from '@shared/errors'
import type { BookSummary, Tag } from '@shared/types'

/**
 * 单本书的标签指派。用浮层而不是右键菜单：指派本身要能一眼看到「已经打了哪些」，
 * 复选框比菜单里的勾更直白。
 *
 * `mine` 由 props 现算，父组件在每次改动后重新拉列表，所以这里不维护本地副本——
 * 本地副本与真相源两份，迟早会出现「关掉标签后 chip 还在」。
 */
export function TagPicker({
  book,
  tags,
  onChanged,
  onClose
}: {
  book: BookSummary
  tags: Tag[]
  onChanged: () => Promise<void>
  onClose: () => void
}) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /**
   * 只在一次指派飞行途中暂存勾选结果。真相源始终是 props 里的 `book.tags`：
   * 勾选后 DOM 必须立刻反映点击（受控复选框的即时回弹会让自动化点击判定为失败），
   * 而 IPC 落库是异步的，所以先给一个飞行中的临时值，等 `onChanged()` 拉回真相再清掉。
   */
  const [optimistic, setOptimistic] = useState<Record<number, boolean>>({})
  const mine = new Set(book.tags.map((tag) => tag.id))
  const isOn = (tag: Tag): boolean => optimistic[tag.id] ?? mine.has(tag.id)

  async function toggle(tag: Tag): Promise<void> {
    const next = !isOn(tag)
    setOptimistic((prev) => ({ ...prev, [tag.id]: next }))
    setBusy(true)
    try {
      await window.api.library.tagAssign(book.id, tag.id, next)
      await onChanged()
    } catch (e) {
      setError(readableError(e, '标签没有指派成功'))
    } finally {
      setBusy(false)
      setOptimistic((prev) => {
        const rest = { ...prev }
        delete rest[tag.id]
        return rest
      })
    }
  }

  async function create(): Promise<void> {
    const name = draft.trim()
    if (!name) return
    setBusy(true)
    try {
      const tag = await window.api.library.tagCreate(name)
      setDraft('')
      setError(null)
      await window.api.library.tagAssign(book.id, tag.id, true)
      await onChanged()
    } catch (e) {
      setError(readableError(e, '标签没有建成'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="tag-picker">
      <p className="tag-picker__title">《{book.title}》的标签</p>

      {tags.length === 0 && <p className="tag-picker__hint">还没有标签，先在下面建一个</p>}

      {tags.map((tag) => (
        <label key={tag.id} className="tag-picker__row">
          <input
            type="checkbox"
            checked={isOn(tag)}
            disabled={busy}
            onChange={() => void toggle(tag)}
          />
          <span className={`tag-dot tag-dot--${tag.color}`} />
          <span className="tag-picker__name">{tag.name}</span>
        </label>
      ))}

      <div className="tag-picker__new">
        <input
          value={draft}
          placeholder="新标签名"
          maxLength={24}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void create()
          }}
        />
        <button type="button" className="btn" disabled={busy || !draft.trim()} onClick={() => void create()}>
          新建并打上
        </button>
      </div>

      {error && <p className="tag-picker__error">{error}</p>}

      <button type="button" className="btn" onClick={onClose}>
        收起
      </button>
    </div>
  )
}
