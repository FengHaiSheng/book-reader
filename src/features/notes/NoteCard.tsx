import { useEffect, useState } from 'react'
import type { HighlightWithBook } from '@shared/types'
import type { HighlightColor } from '@shared/highlights'

/** 相对时间：一周以内按天说，再久就说到日期为止 */
function relativeTime(at: number, now: number): string {
  const days = Math.floor((now - at) / 86_400_000)
  if (days <= 0) return '今天'
  if (days === 1) return '昨天'
  if (days < 7) return `${days} 天前`
  if (days < 30) return `${Math.floor(days / 7)} 周前`
  return new Date(at).toLocaleDateString('zh-CN')
}

export function NoteCard({
  note,
  selected,
  highlightColor,
  onSelect,
  onOpen,
  onSaveNote,
  onRemove
}: {
  note: HighlightWithBook
  selected: boolean
  /** 阅读器里刚改过色时用得上；不传就用笔记自己存的那个颜色 */
  highlightColor?: HighlightColor
  onSelect: () => void
  onOpen: () => void
  onSaveNote: (note: string | null) => void
  onRemove: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(note.note ?? '')
  const [confirming, setConfirming] = useState(false)

  // 换了一条笔记就重置编辑态与草稿，否则会把上一条的批注串过去
  useEffect(() => {
    setEditing(false)
    setConfirming(false)
    setDraft(note.note ?? '')
  }, [note.id, note.note])

  const color = highlightColor ?? note.color

  return (
    <article
      className={`note${selected ? ' note--sel' : ''}`}
      data-color={color}
      onClick={onSelect}
      aria-current={selected || undefined}
    >
      <blockquote className="note__quote">
        <p>{note.text}</p>
      </blockquote>

      {editing ? (
        <div className="note__editor">
          <textarea
            className="note__textarea"
            value={draft}
            autoFocus
            placeholder="写一句批注"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                onSaveNote(draft)
                setEditing(false)
              }
              if (event.key === 'Escape') setEditing(false)
            }}
          />
          <div className="note__editor-foot">
            <button
              type="button"
              className="act"
              onClick={() => {
                onSaveNote(null)
                setEditing(false)
              }}
            >
              清空批注
            </button>
            <span className="notes-side__spacer" />
            <button type="button" className="act" onClick={() => setEditing(false)}>
              取消
            </button>
            <button
              type="button"
              className="act act--accent"
              onClick={() => {
                onSaveNote(draft)
                setEditing(false)
              }}
            >
              保存
            </button>
          </div>
        </div>
      ) : (
        note.note && (
          <div className="note__memo">
            <span className="note__label">批注</span>
            {note.note}
          </div>
        )
      )}

      <div className="note__foot">
        <span>{note.chapterTitle ?? '未知章节'}</span>
        <span className="note__dot">·</span>
        <span>{Math.round(note.percent * 100)}%</span>
        <span className="note__dot">·</span>
        <span>{relativeTime(note.updatedAt, Date.now())}</span>
        <span className="note__spacer" />
        {!editing && (
          <button
            type="button"
            className="act"
            onClick={(event) => {
              event.stopPropagation()
              setEditing(true)
            }}
          >
            {note.note ? '改批注' : '写批注'}
          </button>
        )}
        <button
          type="button"
          className="act act--accent"
          onClick={(event) => {
            event.stopPropagation()
            onOpen()
          }}
        >
          回到原文
        </button>
        <button
          type="button"
          className="act"
          onClick={(event) => {
            event.stopPropagation()
            if (confirming) onRemove()
            else setConfirming(true)
          }}
          onBlur={() => setConfirming(false)}
        >
          {confirming ? '确认删除' : '删除'}
        </button>
      </div>
    </article>
  )
}
