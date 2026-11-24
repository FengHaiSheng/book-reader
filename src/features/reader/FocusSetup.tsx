import { useState } from 'react'
import { Modal } from '../../shell/Modal'

/** 专注时长的常用档位（分钟），与自定义分钟共用同一个值 */
const PRESETS = [15, 25, 45, 60]
const MIN_MINUTES = 1
const MAX_MINUTES = 180
const DEFAULT_MINUTES = 25
/** 上次用的时长。存在本地：专注时长是使用习惯，不值得为它动偏好表 */
const MINUTES_KEY = 'book-read:focusMinutes'

function savedMinutes(): number {
  try {
    const raw = Number(window.localStorage.getItem(MINUTES_KEY))
    if (Number.isInteger(raw) && raw >= MIN_MINUTES && raw <= MAX_MINUTES) return raw
  } catch {
    // 存储读不出来就用默认值：不能因为这一项坏了而进不去专注
  }
  return DEFAULT_MINUTES
}

/**
 * 专注模式入口：先定时长，再进全屏。
 *
 * 时长只影响这一轮的倒计时，不写进 `ReadingPrefs` —— 它是「这一小时怎么过」，
 * 不是「这本书怎么排」，两件事不该混在同一份偏好里。
 */
export function FocusSetup({
  onStart,
  onClose
}: {
  onStart: (minutes: number) => void
  onClose: () => void
}) {
  const [raw, setRaw] = useState(() => String(savedMinutes()))
  const value = Number(raw)
  const valid =
    raw.trim() !== '' &&
    Number.isInteger(value) &&
    value >= MIN_MINUTES &&
    value <= MAX_MINUTES

  const start = (): void => {
    if (!valid) return
    try {
      window.localStorage.setItem(MINUTES_KEY, String(value))
    } catch {
      // 存不下只是下次回到默认时长，不影响这一次
    }
    onStart(value)
  }

  return (
    <Modal title="专注阅读" onClose={onClose}>
      <div className="focus-set">
        <p className="focus-set__hint">进入后全屏显示，只保留正文。按 Esc 退出。</p>

        <div className="focus-set__presets" role="group" aria-label="专注时长">
          {PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={`focus-set__preset${value === preset ? ' is-on' : ''}`}
              aria-pressed={value === preset}
              onClick={() => setRaw(String(preset))}
            >
              {preset} 分钟
            </button>
          ))}
        </div>

        <label className="focus-set__field">
          <span>自定义时长</span>
          <span className="focus-set__unit">
            <input
              className="focus-set__input"
              type="number"
              min={MIN_MINUTES}
              max={MAX_MINUTES}
              step={1}
              value={raw}
              onChange={(event) => setRaw(event.target.value)}
              onKeyDown={(event) => {
                // 输入框里回车的自然含义就是「开始」，不必再去找按钮
                if (event.key === 'Enter') {
                  event.preventDefault()
                  start()
                }
              }}
            />
            <span>分钟</span>
          </span>
        </label>

        {!valid && (
          <p className="focus-set__error">请输入 1 到 180 之间的整数分钟。</p>
        )}

        <div className="focus-set__acts">
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn btn--primary" disabled={!valid} onClick={start}>
            开始专注
          </button>
        </div>
      </div>
    </Modal>
  )
}
