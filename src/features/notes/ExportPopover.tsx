import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { NotesExportOptions, NotesExportPreview } from '@shared/types'

const EMPTY: NotesExportPreview = { markdown: '', total: 0, unlocated: 0 }

/**
 * 导出浮层。
 *
 * 浮在标题栏里（spec §4.5），但状态属于笔记页——所以用 portal 把按钮塞进
 * `TitleBar` 留下的 `#titlebar-tools` 槽位，而不是把筛选结果一路提到 `App`。
 */
export function ExportPopover({
  allIds,
  filteredIds
}: {
  allIds: readonly number[]
  filteredIds: readonly number[]
}) {
  const [host, setHost] = useState<HTMLElement | null>(null)
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<'all' | 'filtered'>('all')
  const [options, setOptions] = useState<NotesExportOptions>({
    includeNotes: true,
    includeLocation: true,
    includeContext: false
  })
  const [preview, setPreview] = useState<NotesExportPreview>(EMPTY)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // 标题栏先于页面渲染，所以挂载后再取槽位；取不到就先不渲染
  useEffect(() => {
    setHost(document.getElementById('titlebar-tools'))
  }, [])

  const ids = useMemo(
    () => (scope === 'all' ? allIds : filteredIds),
    [scope, allIds, filteredIds]
  )

  // 预览永远跟着当前选项重算一次。数据在本地 sqlite，条数几十到几千，
  // 重算是毫秒级——比加一层缓存再处理失效便宜得多。
  useEffect(() => {
    if (!open) return
    let alive = true
    window.api.notes
      .previewExport([...ids], options)
      .then((result) => {
        if (!alive) return
        setPreview(result)
        setError(null)
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : '预览没生成出来')
      })
    return () => {
      alive = false
    }
  }, [open, ids, options])

  // 浮层压在正文之上，点别处或按 Esc 都要收起来
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (!target?.closest('.pop-wrap')) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = useCallback((key: keyof NotesExportOptions) => {
    setOptions((current) => ({ ...current, [key]: !current[key] }))
  }, [])

  const save = useCallback(async () => {
    setBusy(true)
    try {
      const result = await window.api.notes.exportMarkdown([...ids], options)
      // 用户点了取消不是错误：不清空上一次的「已导出」提示，也不报错
      if (result.saved) {
        setSaved(result.path)
        setError(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '导出没有成功')
    } finally {
      setBusy(false)
    }
  }, [ids, options])

  if (!host) return null

  return createPortal(
    <div className="pop-wrap">
      <button
        type="button"
        className="tb-btn tb-btn--accent"
        onClick={() => {
          setOpen((value) => !value)
          setSaved(null)
        }}
      >
        导出 Markdown
      </button>

      {open && (
        <div className="pop" role="dialog" aria-label="导出 Markdown">
          <div className="pop__title">导出 Markdown</div>

          <div className="pop__row">
            <span className="lb">范围</span>
            <div className="seg">
              <button
                type="button"
                className={`seg__b${scope === 'all' ? ' is-on' : ''}`}
                onClick={() => setScope('all')}
              >
                全部 {allIds.length} 条
              </button>
              <button
                type="button"
                className={`seg__b${scope === 'filtered' ? ' is-on' : ''}`}
                onClick={() => setScope('filtered')}
              >
                当前筛选 {filteredIds.length} 条
              </button>
            </div>
          </div>

          <label className="check">
            <input
              type="checkbox"
              checked={options.includeNotes}
              onChange={() => toggle('includeNotes')}
            />
            包含我的批注
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={options.includeLocation}
              onChange={() => toggle('includeLocation')}
            />
            包含章节与位置
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={options.includeContext}
              onChange={() => toggle('includeContext')}
            />
            附上原文上下文
            <span className="hint2">前后各一段</span>
          </label>

          {options.includeContext && preview.unlocated > 0 && (
            <p className="pop__warn">
              有 {preview.unlocated} 条没能在这本书的正文里重新定位到，
              导出时只会带上标注当时的原文。
            </p>
          )}

          {error && <p className="pop__warn">{error}</p>}

          <div className="pop__preview">
            {preview.total === 0 ? '还没有可导出的笔记。' : preview.markdown}
          </div>

          <div className="pop__foot">
            <span className="pop__done">{saved ? `已导出到 ${saved}` : ''}</span>
            <button
              type="button"
              className="btn btn--accent"
              disabled={busy || preview.total === 0}
              onClick={() => void save()}
            >
              {busy ? '导出中…' : '导出'}
            </button>
          </div>
        </div>
      )}
    </div>,
    host
  )
}
