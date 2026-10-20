import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ImportButton } from './ImportButton'

/**
 * 书架页写进标题栏工具槽的搜索框、导入与标签按钮。
 *
 * 与 ExportPopover 同一套路：标题栏由外壳渲染，页面自己的动作用 portal 塞进
 * `#titlebar-tools`，避免把筛选 / 导入状态一路提到 App。
 */
export function LibraryTitlebarTools({
  query,
  onQuery,
  onSearchBody,
  onEscape,
  busy,
  onPick,
  managing,
  onToggleTags
}: {
  query: string
  onQuery: (value: string) => void
  /** 回车或点「搜正文」时显式发起一次全库正文搜索（输入本身只过滤书名，不发请求） */
  onSearchBody: () => void
  /** Escape 要同时清掉书名筛选与正文结果，所以不能只是清输入框 */
  onEscape: () => void
  busy: boolean
  onPick: () => void
  managing: boolean
  onToggleTags: () => void
}) {
  const [host, setHost] = useState<HTMLElement | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // 标题栏先于页面渲染，挂载后再取槽位；取不到就先不渲染
  useEffect(() => {
    setHost(document.getElementById('titlebar-tools'))
  }, [])

  // ⌘K / Ctrl+K 聚焦搜索框；Esc 清空交给输入框自己的 keydown
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const isMac = navigator.userAgent.includes('Mac')

  if (!host) return null

  return createPortal(
    <div className="lib-tools">
      <label className="search">
        <span className="search__icon" aria-hidden="true">
          ⌕
        </span>
        <input
          ref={inputRef}
          type="text"
          className="search__input"
          placeholder="搜索书名、作者或标签"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={(event) => {
            // 输入只过滤书名；正文搜索必须显式触发，所以 onChange 里绝不清正文结果，
            // 否则用户边打字边看着结果消失，还看不出结果其实是旧的
            if (event.key === 'Enter') {
              event.preventDefault()
              onSearchBody()
            } else if (event.key === 'Escape') {
              onEscape()
            }
          }}
        />
        <kbd>{isMac ? '⌘K' : 'Ctrl K'}</kbd>
      </label>
      <button type="button" className="tb-btn" onClick={onSearchBody}>
        搜正文
      </button>
      <span className="tb-sep" aria-hidden="true" />
      <ImportButton busy={busy} onPick={onPick} />
      <button type="button" className="tb-btn" aria-expanded={managing} onClick={onToggleTags}>
        标签
      </button>
    </div>,
    host
  )
}