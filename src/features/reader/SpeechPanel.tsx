import { useState } from 'react'
import { PREFS_LIMITS, type TtsEngineId, type TtsVoice } from '@shared/types'

/**
 * 朗读面板。
 *
 * 系统语音只选音色；自建服务多一个地址与探活。两个音色字段分开存：
 * 切回系统语音时不会把服务端音色 id 当成 voiceURI 用。
 */
export function SpeechPanel({
  engine,
  endpoint,
  systemVoice,
  serverVoice,
  voices,
  rate,
  onEngine,
  onEndpoint,
  onSystemVoice,
  onServerVoice,
  onRate,
  onCheck,
  onClose
}: {
  engine: TtsEngineId
  endpoint: string
  systemVoice: string
  serverVoice: string
  voices: TtsVoice[]
  rate: number
  onEngine: (engine: TtsEngineId) => void
  onEndpoint: (endpoint: string) => void
  onSystemVoice: (voice: string) => void
  onServerVoice: (voice: string) => void
  onRate: (rate: number) => void
  onCheck: () => Promise<string | null>
  onClose: () => void
}) {
  const [minRate, maxRate] = PREFS_LIMITS.ttsRate
  const [testing, setTesting] = useState(false)
  const [checkNote, setCheckNote] = useState<{ ok: boolean; text: string } | null>(null)

  const chinese = voices.filter((item) => item.lang.toLowerCase().startsWith('zh'))
  const others = voices.filter((item) => !item.lang.toLowerCase().startsWith('zh'))
  const known = voices.some((item) => item.id === serverVoice)

  const test = async (): Promise<void> => {
    setTesting(true)
    setCheckNote(null)
    const problem = await onCheck()
    setTesting(false)
    setCheckNote(
      problem === null
        ? { ok: true, text: '连接正常。' }
        : { ok: false, text: problem }
    )
  }

  return (
    <aside className="typo" aria-label="朗读设置">
      <div className="typo__head">
        <span className="typo__title">朗读</span>
        <button type="button" className="btn" onClick={onClose}>
          收起
        </button>
      </div>

      <div className="typo__field">
        <label className="typo__label" htmlFor="tts-engine">
          引擎
        </label>
        <select
          id="tts-engine"
          className="typo__select"
          value={engine}
          onChange={(event) => onEngine(event.target.value === 'http' ? 'http' : 'system')}
        >
          <option value="system">系统语音（离线）</option>
          <option value="http">自建 CosyVoice 服务</option>
        </select>
      </div>

      {engine === 'system' ? (
        <div className="typo__field">
          <label className="typo__label" htmlFor="tts-voice">
            声音
          </label>
          <select
            id="tts-voice"
            className="typo__select"
            value={voices.some((item) => item.id === systemVoice) ? systemVoice : ''}
            onChange={(event) => onSystemVoice(event.target.value)}
          >
            <option value="">自动（中文优先）</option>
            {chinese.length > 0 && (
              <optgroup label="中文">
                {chinese.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}（{item.lang}）
                  </option>
                ))}
              </optgroup>
            )}
            {others.length > 0 && (
              <optgroup label="其他">
                {others.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}（{item.lang}）
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          {voices.length === 0 && (
            <span className="typo__label">没有读到系统语音，朗读时会用系统默认声音。</span>
          )}
        </div>
      ) : (
        <>
          <div className="typo__field">
            <label className="typo__label" htmlFor="tts-endpoint">
              服务地址
            </label>
            <input
              id="tts-endpoint"
              className="typo__input"
              type="url"
              value={endpoint}
              placeholder="http://127.0.0.1:8000"
              onChange={(event) => onEndpoint(event.target.value)}
            />
            <button type="button" className="btn" disabled={testing} onClick={() => void test()}>
              {testing ? '连接中…' : '测试连接'}
            </button>
            {checkNote && (
              <span className={`typo__label${checkNote.ok ? '' : ' typo__label--error'}`}>
                {checkNote.text}
              </span>
            )}
          </div>

          <div className="typo__field">
            <label className="typo__label" htmlFor="tts-server-voice">
              服务音色
            </label>
            {voices.length > 0 ? (
              <select
                id="tts-server-voice"
                className="typo__select"
                value={known ? serverVoice : ''}
                onChange={(event) => onServerVoice(event.target.value)}
              >
                <option value="">服务默认音色</option>
                {voices.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                    {item.lang === '' ? '' : `（${item.lang}）`}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="tts-server-voice"
                className="typo__input"
                type="text"
                value={serverVoice}
                placeholder="留空使用服务默认音色"
                onChange={(event) => onServerVoice(event.target.value)}
              />
            )}
            <span className="typo__label">
              服务需实现 GET /health 与 POST /tts（WAV）。合成的句子缓存在本地，上限 200MB。
            </span>
          </div>
        </>
      )}

      <div className="typo__field">
        <label className="typo__label" htmlFor="tts-rate">
          语速 · {rate.toFixed(1)}×
        </label>
        <input
          id="tts-rate"
          type="range"
          min={minRate}
          max={maxRate}
          step={0.1}
          value={rate}
          onChange={(event) => onRate(Number(event.target.value))}
        />
      </div>

      <p className="typo__hint">
        从当前页开始朗读，读到页底会自动翻页；本章读完会接着读下一章。
        {engine === 'http' ? ' 自建服务会提前合成后两句，第一次朗读的等待主要花在第一句。' : ''}
      </p>
    </aside>
  )
}
