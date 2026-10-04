import { useEffect, useState } from 'react'
import { CAPABILITY_LABELS, modelsFor } from '@shared/ai'
import { PROVIDERS, type AiStatus, type ProviderId } from '@shared/types'

export function ModelSection() {
  const [provider, setProvider] = useState<ProviderId>('deepseek')
  const [model, setModel] = useState('')
  const [masked, setMasked] = useState<string | null>(null)
  const [available, setAvailable] = useState(true)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [testing, setTesting] = useState(false)
  const [verdict, setVerdict] = useState<string | null>(null)

  useEffect(() => {
    void window.api.secrets.status().then((s) => {
      setAvailable(s.available)
      setMasked(s.providers[provider] ?? null)
    })
  }, [provider])

  /**
   * 首屏只问主进程要一次。
   *
   * 「哪家的默认模型是哪个」「存的模型还在这家的清单里吗」这两件事的答案在
   * `aiSettings` 里，渲染进程不重写一遍 —— 重写就会出现两处规则各自演化。
   */
  useEffect(() => {
    void window.api.ai.status(null).then((next) => {
      setProvider(next.providerId)
      setModel(next.model)
      setStatus(next)
    })
  }, [])

  async function pickProvider(next: ProviderId) {
    setProvider(next)
    setVerdict(null)
    await window.api.settings.set('ai.provider', next)
    // 清掉旧模型：留着会变成「别家的模型配在这家」，aiSettings 下次按新家回落到默认值
    await window.api.settings.set('ai.model', '')
    const fresh = await window.api.ai.status(null)
    setModel(fresh.model)
    setStatus(fresh)
  }

  async function pickModel(next: string) {
    setModel(next)
    await window.api.settings.set('ai.model', next)
    setStatus(await window.api.ai.status(null))
  }

  async function save() {
    const key = draft.trim()
    if (!key) return
    setSaving(true)
    try {
      await window.api.secrets.set(provider, key)
      setDraft('')
      setMasked((await window.api.secrets.status()).providers[provider] ?? null)
      setStatus(await window.api.ai.status(null))
    } finally {
      setSaving(false)
    }
  }

  async function clear() {
    await window.api.secrets.clear(provider)
    setMasked(null)
    setStatus(await window.api.ai.status(null))
  }

  /** 真的发一次最短的请求。成功失败都要说话，不能只转个圈 */
  async function test() {
    setTesting(true)
    setVerdict(null)
    try {
      const outcome = await window.api.ai.test(provider, model)
      setVerdict(`连接成功：${outcome.model} 回话了。`)
    } catch (e) {
      setVerdict(`没能连上：${e instanceof Error ? e.message : '原因未知'}。`)
    } finally {
      setTesting(false)
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

      <div className="settings__row">
        <label className="settings__label" htmlFor="provider">
          服务商
        </label>
        <select
          id="provider"
          value={provider}
          onChange={(e) => void pickProvider(e.target.value as ProviderId)}
        >
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div className="settings__row">
        <label className="settings__label" htmlFor="model">
          模型
        </label>
        <select id="model" value={model} onChange={(e) => void pickModel(e.target.value)}>
          {modelsFor(provider).map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn"
          disabled={testing || model === ''}
          onClick={() => void test()}
        >
          {testing ? '测试中…' : '测试连接'}
        </button>
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
              onBlur={() => setDraft('')}
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

      {verdict && (
        <p className="settings__hint" role="status">
          {verdict}
        </p>
      )}

      <div className="settings__caps">
        <p className="settings__hint">
          这家的能力。写的是内置声明；哪一项被服务商真的拒绝过，这里会标出来并说明替代方案。
        </p>
        <ul className="caps">
          {CAPABILITY_LABELS.map((row) => {
            const declared = status ? status.caps[row.key] : false
            const rejected = status?.unavailable.includes(row.key) ?? false
            const usable = declared && !rejected
            return (
              <li className="caps__row" key={row.key}>
                <span className="caps__name">{row.label}</span>
                <span className={`caps__state${usable ? ' caps__state--on' : ''}`}>
                  {usable ? '可用' : rejected ? '被服务商拒绝，已记下' : '不提供'}
                </span>
                {!usable && <span className="caps__fallback">{row.fallback}</span>}
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}