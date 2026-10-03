import { useEffect, useRef, useState } from 'react'
import { HIGHLIGHT_COLORS, HIGHLIGHT_COLOR_LABELS, type HighlightColor } from '@shared/highlights'
import type { Highlight } from '@shared/types'

/** 浮层最大高度，ReaderPage 用它把落点夹在正文区里，避免贴底被裁 */
export const POPOVER_MAX_HEIGHT = 240

export function HighlightPopover({
  highlight,
  x,
  y,
  onColor,
  onSaveNote,
  onRemove,
  onClose
}: {
  highlight: Highlight
  x: number
  y: number
  onColor: (color: HighlightColor) => void
  onSaveNote: (note: string | null) => void
  onRemove: () => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState(highlight.note ?? '')
  const [confirming, setConfirming] = useState(false)
  const boxRef = useRef<HTMLDivElement | null>(null)

  // 换了一条高亮就重置草稿与二次确认，否则会把上一条的批注串过去
  useEffect(() => {
    setDraft(highlight.note ?? '')
    setConfirming(false)
  }, [highlight.id, highlight.note])

  // 点浮层外面关掉。用 mousedown 而不是 click：正文里的 click 已经被链接拦截用掉了
  useEffect(() => {
    const onDown = (event: MouseEvent): void => {
      if (!boxRef.current) return
      const target = event.target as Node | null
      if (target && !boxRef.current.contains(target)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])

  const dirty = draft.trim() !== (highlight.note ?? '')

  return (
    <div
      className="annot"
      ref={boxRef}
      style={{ left: x, top: y, maxHeight: POPOVER_MAX_HEIGHT }}
      role="dialog"
      aria-label="编辑标注"
    >
      <div className="annot__dots">
        {HIGHLIGHT_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            className={`sel-dot${highlight.color === color ? ' is-on' : ''} sel-dot--${color}`}
            title={`改成${HIGHLIGHT_COLOR_LABELS[color]}色`}
            aria-label={`改成${HIGHLIGHT_COLOR_LABELS[color]}色`}
            aria-pressed={highlight.color === color}
            onClick={() => onColor(color)}
          />
        ))}
        <span className="annot__spacer" />
        <button type="button" className="annot__x" onClick={onClose} aria-label="关闭">
          ×
        </button>
      </div>

      <p className="annot__quote">{highlight.text}</p>

      <textarea
        className="annot__note"
        value={draft}
        placeholder="写一句批注"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            onSaveNote(draft)
          }
        }}
      />

      <div className="annot__foot">
        <button
          type="button"
          className="annot__del"
          onClick={() => (confirming ? onRemove() : setConfirming(true))}
          onBlur={() => setConfirming(false)}
        >
          {confirming ? '确认删除' : '删除'}
        </button>
        <span className="annot__spacer" />
        <button
          type="button"
          className="btn btn--accent"
          disabled={!dirty}
          onClick={() => onSaveNote(draft)}
        >
          保存批注
        </button>
      </div>
    </div>
  )
}
