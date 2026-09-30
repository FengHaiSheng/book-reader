import { useEffect, useState } from 'react'
import { PROVIDERS, type ProviderId } from '@shared/types'

export function ModelSection() {
  const [provider, setProvider] = useState<ProviderId>('deepseek')
  const [masked, setMasked] = useState<string | null>(null)
  const [available, setAvailable] = useState(true)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void window.api.secrets.status().then((s) => {
      if (!active) return
      setAvailable(s.available)
      setMasked(s.providers[provider] ?? null)
    })
    setDraft('')
    setError(null)
    return () => {
      active = false
    }
  }, [provider])

  async function save() {
    const key = draft.trim()
    if (!key) return
    setSaving(true)
    setError(null)
    try {
      await window.api.secrets.set(provider, key)
      setDraft('')
      setMasked((await window.api.secrets.status()).providers[provider] ?? null)
    } catch {
      setError('保存失败，请重试')
    } finally {
      setSaving(false)
    }
  }

  async function clear() {
    setError(null)
    try {
      await window.api.secrets.clear(provider)
      setMasked(null)
    } catch {
      setError('清除失败，请重试')
    }
  }

  return (
    <section className="settings__group">
      <h2 className="settings__title">模型</h2>

      {!available && (
        <p className="settings__notice">
          当前系统无法提供安全的密钥存储，API Key 无法保存。你仍然可以阅读和记笔记。
        </p>
      )}

      {error && <p className="settings__notice">{error}</p>}

      <div className="settings__row">
        <label className="settings__label" htmlFor="provider">
          服务商
        </label>
        <select
          id="provider"
          value={provider}
          onChange={(e) => setProvider(e.target.value as ProviderId)}
        >
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div className="settings__row">
        <label className="settings__label" htmlFor="api-key">
          API Key
        </label>
        {masked ? (
          <>
            <code className="settings__masked">{masked}</code>
            <button type="button" className="btn" onClick={() => void clear()}>
              清除
            </button>
          </>
        ) : (
          <>
            <input
              id="api-key"
              type="password"
              value={draft}
              placeholder="sk-…"
              disabled={!available}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button
              type="button"
              className="btn"
              disabled={!available || saving || !draft.trim()}
              onClick={() => void save()}
            >
              保存
            </button>
          </>
        )}
      </div>

      <p className="settings__hint">
        密钥用系统钥匙串加密后只存在这台电脑上，不会上传，也不会随「导出全部数据」一起导出。
      </p>
    </section>
  )
}
