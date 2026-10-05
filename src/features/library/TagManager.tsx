import { useState } from 'react'
import { readableError } from '@shared/errors'
import type { Tag } from '@shared/types'

/**
 * 新建 / 改名 / 删除。
 *
 * 改名是「失焦或回车才提交」：每敲一个字母就发一次 IPC，会让中间态
 * （比如删到只剩一个字）也进库，用户看到的是标签名在闪。
 */
export function TagManager({ tags, onChanged }: { tags: Tag[]; onChanged: () => Promise<void> }) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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

  return (
    <div className="tag-manager">
      <p className="tag-manager__title">标签</p>

      {tags.length === 0 && <p className="tag-manager__hint">还没有标签</p>}

      {tags.map((tag) => (
        <div key={tag.id} className="tag-manager__row">
          <span className={`tag-dot tag-dot--${tag.color}`} />
          <input
            className="tag-manager__name"
            defaultValue={tag.name}
            maxLength={24}
            disabled={busy}
            onBlur={(event) => {
              const next = event.target.value.trim()
              if (!next || next === tag.name) {
                event.target.value = tag.name
                return
              }
              void guard(() => window.api.library.tagRename(tag.id, next), '标签没有改成')
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              if (event.key === 'Escape') {
                event.currentTarget.value = tag.name
                event.currentTarget.blur()
              }
            }}
          />
          <span className="tag-manager__count">{tag.bookCount} 本</span>
          <button
            type="button"
            className="tag-manager__remove"
            disabled={busy}
            onClick={() => {
              // 「书不会一起删」必须说出来，否则没人敢点
              if (window.confirm(`删除标签「${tag.name}」？书不会删，只是不再带这个标签。`)) {
                void guard(() => window.api.library.tagDelete(tag.id), '标签没有删掉')
              }
            }}
          >
            删除
          </button>
        </div>
      ))}

      <div className="tag-manager__new">
        <input
          value={draft}
          placeholder="新标签名"
          maxLength={24}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && draft.trim()) {
              void guard(() => window.api.library.tagCreate(draft.trim()), '标签没有建成').then(() =>
                setDraft('')
              )
            }
          }}
        />
        <button
          type="button"
          className="btn"
          disabled={busy || !draft.trim()}
          onClick={() =>
            void guard(() => window.api.library.tagCreate(draft.trim()), '标签没有建成').then(() =>
              setDraft('')
            )
          }
        >
          新建
        </button>
      </div>

      {error && <p className="tag-manager__error">{error}</p>}
    </div>
  )
}
