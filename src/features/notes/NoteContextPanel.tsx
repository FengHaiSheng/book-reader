import { useEffect, useState } from 'react'
import type { HighlightContext, HighlightWithBook } from '@shared/types'

export function NoteContextPanel({
  note,
  onOpen
}: {
  note: HighlightWithBook | null
  onOpen: () => void
}) {
  const [context, setContext] = useState<HighlightContext | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!note) {
      setContext(null)
      return
    }
    let alive = true
    setLoading(true)
    void window.api.notes
      .context(note.id)
      .then((result) => {
        if (alive) setContext(result)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [note])

  if (!note) {
    return (
      <aside className="notes-aside">
        <div className="notes-aside__empty">选中左边任意一条笔记，这里显示它在书里的原文上下文。</div>
      </aside>
    )
  }

  return (
    <aside className="notes-aside">
      <div className="notes-aside__head">
        <div className="notes-aside__kicker">所选笔记</div>
        <div className="notes-aside__book">{note.bookTitle}</div>
        <div className="notes-aside__loc">
          {note.chapterTitle ?? '未知章节'} · 全书 {Math.round(note.percent * 100)}%
        </div>
      </div>

      <div className="notes-aside__body">
        {loading && <p className="notes-aside__hint">正在取上下文…</p>}

        {!loading && context?.located && (
          <div className="ctx">
            {context.before && <p>{context.before}</p>}
            <p className="ctx__cur">{context.matched}</p>
            {context.after && <p>{context.after}</p>}
          </div>
        )}

        {!loading && context && !context.located && (
          <div className="ctx">
            <p className="ctx__cur">{context.matched}</p>
            <p className="notes-aside__hint">
              没能在本章正文里重新定位到这段文字（可能跨了分块边界，或原文已被改动），
              这里只显示标注时存下的原句。
            </p>
          </div>
        )}

        <div className="notes-aside__note">上下文只读取当前章节，不解析全书，所以切换笔记是即时的。</div>
      </div>

      <div className="notes-aside__foot">
        <button type="button" className="btn btn--accent" onClick={onOpen}>
          回到原文位置
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => void navigator.clipboard.writeText(note.text)}
        >
          复制
        </button>
      </div>
    </aside>
  )
}
