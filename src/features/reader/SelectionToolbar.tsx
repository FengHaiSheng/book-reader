import {
  HIGHLIGHT_COLORS,
  HIGHLIGHT_COLOR_LABELS,
  MAX_HIGHLIGHT_CHARS,
  type HighlightColor
} from '@shared/highlights'

/** 浮条大致高度，用来判断往上放还是往下放 */
const TOOLBAR_HEIGHT = 40

export type SelectionState = {
  text: string
  startCfi: string
  endCfi: string
  /** 相对于 .reader__stage 的锚点横坐标（选区第一行的中点） */
  x: number
  /** 锚点的上沿 */
  y: number
  tooLong: boolean
}

export function SelectionToolbar({
  selection,
  onMark,
  onNote,
  onCopy,
  onAsk,
  onTranslate
}: {
  selection: SelectionState
  onMark: (color: HighlightColor) => void
  onNote: () => void
  onCopy: () => void
  /** 计划 05 接上。不传就不渲染按钮，避免出现点不动的空壳 */
  onAsk?: () => void
  onTranslate?: () => void
}) {
  // 贴到正文最上沿时，浮条往上放会被 .reader__stage 的 overflow 裁掉，翻到下面去
  const below = selection.y < TOOLBAR_HEIGHT + 12

  return (
    <div
      className={`sel-toolbar${below ? ' sel-toolbar--below' : ''}`}
      style={{ left: selection.x, top: selection.y }}
      role="toolbar"
      aria-label="标注选中的内容"
    >
      {selection.tooLong ? (
        <span className="sel-toolbar__warn">
          选中的内容共 {selection.text.length} 字，超过 {MAX_HIGHLIGHT_CHARS} 字上限，请选短一些再标注
        </span>
      ) : (
        <>
          {HIGHLIGHT_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className={`sel-dot sel-dot--${color}`}
              title={`标注为${HIGHLIGHT_COLOR_LABELS[color]}色`}
              aria-label={`标注为${HIGHLIGHT_COLOR_LABELS[color]}色`}
              onClick={() => onMark(color)}
            />
          ))}
          <span className="sel-toolbar__sep" />
          <button type="button" className="sel-toolbar__btn" onClick={onNote}>
            笔记
          </button>
          <button type="button" className="sel-toolbar__btn" onClick={onCopy}>
            复制
          </button>
          {onTranslate && (
            <button type="button" className="sel-toolbar__btn" onClick={onTranslate}>
              翻译
            </button>
          )}
          {onAsk && (
            <button
              type="button"
              className="sel-toolbar__btn sel-toolbar__btn--accent"
              onClick={onAsk}
            >
              问 AI
            </button>
          )}
        </>
      )}
    </div>
  )
}
