import { useEffect, useState } from 'react'
import { DEFAULT_PREFS, type ReadingPrefs } from '@shared/types'

const FIELDS: {
  key: keyof ReadingPrefs
  label: string
  min: number
  max: number
  step: number
}[] = [
  { key: 'fontSize', label: '字号', min: 15, max: 24, step: 1 },
  { key: 'charsPerLine', label: '每行字数', min: 24, max: 48, step: 1 },
  { key: 'lineHeight', label: '行距', min: 1.5, max: 2.2, step: 0.05 }
]

export function ReadingSection() {
  const [prefs, setPrefs] = useState<ReadingPrefs | null>(null)

  useEffect(() => {
    void window.api.settings.getAll().then((all) => {
      const raw = all.prefs
      if (!raw) return setPrefs({ ...DEFAULT_PREFS })
      try {
        setPrefs({ ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<ReadingPrefs>) })
      } catch {
        setPrefs({ ...DEFAULT_PREFS })
      }
    })
  }, [])

  if (!prefs) return <p className="settings__hint">加载中…</p>

  function commit(next: ReadingPrefs) {
    setPrefs(next)
    void window.api.settings.set('prefs', JSON.stringify(next))
  }

  return (
    <section className="settings__group">
      <h2 className="settings__title">阅读偏好</h2>

      <div className="settings__row">
        <span className="settings__label">字体</span>
        <div className="seg">
          {(['serif', 'sans'] as const).map((font) => (
            <button
              key={font}
              type="button"
              className={`seg__b${prefs.font === font ? ' is-on' : ''}`}
              onClick={() => commit({ ...prefs, font })}
            >
              {font === 'serif' ? '宋体' : '黑体'}
            </button>
          ))}
        </div>
      </div>

      {FIELDS.map((field) => {
        const value = Number(prefs[field.key])
        return (
          <div className="settings__row" key={field.key}>
            <label className="settings__label" htmlFor={`pref-${field.key}`}>
              {field.label}
            </label>
            <input
              id={`pref-${field.key}`}
              type="range"
              min={field.min}
              max={field.max}
              step={field.step}
              value={value}
              onChange={(e) => commit({ ...prefs, [field.key]: Number(e.target.value) })}
            />
            <span className="settings__value">
              {field.key === 'lineHeight' ? value.toFixed(2) : value}
            </span>
          </div>
        )
      })}

      <div className="settings__row">
        <span className="settings__label">主题</span>
        <div className="seg">
          {(['light', 'dark'] as const).map((theme) => (
            <button
              key={theme}
              type="button"
              className={`seg__b${prefs.theme === theme ? ' is-on' : ''}`}
              onClick={() => {
                document.documentElement.dataset.theme = theme
                commit({ ...prefs, theme })
              }}
            >
              {theme === 'light' ? '亮色' : '暗色'}
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}
