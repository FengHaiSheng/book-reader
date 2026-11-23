import { useState } from 'react'
import { readableError } from '@shared/errors'
import type { BookSummary, Tag } from '@shared/types'

/**
 * 一本书的标签指派。整块内容由 LibraryPage 套在 Modal 里：
 * 单本指派直接打开，批量导入后则逐本打开（同一个组件，每次只面对一本）。
 * 用复选框而不是菜单：指派本身要能一眼看到「已经打了哪些」。
 * 标签的创建、改名、删除只在侧栏标签列表里做，这里只负责打上 / 取消。
 *
 * `mine` 由 props 现算，父组件在每次改动后重新拉列表，所以这里不维护本地副本——
 * 本地副本与真相源两份，迟早会出现「关掉标签后 chip 还在」。
 */
export function TagPicker({
  book,
  tags,
  onChanged
}: {
  book: BookSummary
  tags: Tag[]
  onChanged: () => Promise<void>
}) {
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

  return (
    <>
      {tags.length === 0 && (
        <p className="tag-picker__hint">还没有标签，先在侧栏的标签列表里建一个</p>
      )}

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

      {error && <p className="tag-picker__error">{error}</p>}
    </>
  )
}
