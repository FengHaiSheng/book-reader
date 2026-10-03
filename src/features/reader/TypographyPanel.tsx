import { PREFS_LIMITS, type ReadingPrefs } from '@shared/types'
import type { ReaderLayout } from './layout'

/**
 * Aa 排版面板。
 *
 * 与设置页的「阅读偏好」共用同一份 `ReadingPrefs`（spec §4.6），所以这里只负责发出增量改动，
 * 落库、夹取、失败回滚都归调用方。
 *
 * 三件事值得说明：
 * 1. 滑块的 min/max/step 全部来自 `PREFS_LIMITS`，与主进程落库时的校验是同一份常量。
 *    两边各写一份，迟早会出现「界面能拖到 60 字、存进去被截成 48」。
 * 2. 「每行字数」是独立控件，不是字号的副产物（spec §4.4）：字号大了想放大、一行太长了想收窄，
 *    是两个不同的诉求。
 * 3. slider 的 value 用 `prefs.*`（用户设定值）而不是 `layout.*`（实际生效值）。
 *    版心宽被窗口压窄时，滑块不该自己滑回去 —— 否则用户会以为是自己拖错了，
 *    实际生效值显示在标签里（`layout.charsPerLine`），降级提示在阅读器条上。
 */
export function TypographyPanel({
  prefs,
  layout,
  onChange,
  onClose
}: {
  prefs: ReadingPrefs
  layout: ReaderLayout
  onChange: (patch: Partial<ReadingPrefs>) => void
  onClose: () => void
}) {
  const [minFontSize, maxFontSize] = PREFS_LIMITS.fontSize
  const [minChars, maxChars] = PREFS_LIMITS.charsPerLine
  const [minLineHeight, maxLineHeight] = PREFS_LIMITS.lineHeight

  return (
    <aside className="typo" aria-label="排版">
      <div className="typo__head">
        <span className="typo__title">排版</span>
        <button type="button" className="btn" onClick={onClose}>
          收起
        </button>
      </div>

      <div className="typo__field">
        <span className="typo__label">字体</span>
        <div className="typo__segment" role="group" aria-label="字体">
          <button
            type="button"
            className={`typo__option${prefs.font === 'serif' ? ' typo__option--on' : ''}`}
            aria-pressed={prefs.font === 'serif'}
            onClick={() => onChange({ font: 'serif' })}
          >
            宋体
          </button>
          <button
            type="button"
            className={`typo__option${prefs.font === 'sans' ? ' typo__option--on' : ''}`}
            aria-pressed={prefs.font === 'sans'}
            onClick={() => onChange({ font: 'sans' })}
          >
            黑体
          </button>
        </div>
      </div>

      <div className="typo__field">
        <label className="typo__label" htmlFor="prefs-fontSize">
          字号 · 实际 {layout.fontSize}
          {layout.fontSizeClamped ? `（设定 ${prefs.fontSize}）` : ''}
        </label>
        <input
          id="prefs-fontSize"
          type="range"
          min={minFontSize}
          max={maxFontSize}
          step={1}
          value={prefs.fontSize}
          onChange={(event) => onChange({ fontSize: Number(event.target.value) })}
        />
      </div>

      <div className="typo__field">
        <label className="typo__label" htmlFor="prefs-charsPerLine">
          每行字数 · 实际 {layout.charsPerLine}
          {layout.clamped ? `（设定 ${prefs.charsPerLine}）` : ''}
        </label>
        <input
          id="prefs-charsPerLine"
          type="range"
          min={minChars}
          max={maxChars}
          step={1}
          value={prefs.charsPerLine}
          onChange={(event) => onChange({ charsPerLine: Number(event.target.value) })}
        />
      </div>

      <div className="typo__field">
        <label className="typo__label" htmlFor="prefs-lineHeight">
          行距 · {prefs.lineHeight}
        </label>
        <input
          id="prefs-lineHeight"
          type="range"
          min={minLineHeight}
          max={maxLineHeight}
          step={0.05}
          value={prefs.lineHeight}
          onChange={(event) => onChange({ lineHeight: Number(event.target.value) })}
        />
      </div>

      <div className="typo__field">
        <span className="typo__label">主题</span>
        <div className="typo__segment" role="group" aria-label="主题">
          <button
            type="button"
            className={`typo__option${prefs.theme === 'light' ? ' typo__option--on' : ''}`}
            aria-pressed={prefs.theme === 'light'}
            onClick={() => onChange({ theme: 'light' })}
          >
            亮
          </button>
          <button
            type="button"
            className={`typo__option${prefs.theme === 'dark' ? ' typo__option--on' : ''}`}
            aria-pressed={prefs.theme === 'dark'}
            onClick={() => onChange({ theme: 'dark' })}
          >
            暗
          </button>
        </div>
      </div>
    </aside>
  )
}
