import { useCallback, useState } from 'react'
import type { SearchHitWithBook } from '@shared/types'
import { isSearchableQuery } from '../reader/search'

/** 与主进程 searchAllChunks 的默认 LIMIT 一致 */
const BODY_LIMIT = 60

export type BodySearchState = {
  bodyQuery: string
  hits: SearchHitWithBook[]
  busy: boolean
  error: string | null
  open: boolean
  page: number
  /** 有一次正文会话（含出错提示）时浮层才挂载 */
  active: boolean
  run: (keyword: string) => Promise<void>
  /** 收起成细条，结果保留 */
  collapse: () => void
  toggle: () => void
  setPage: (page: number) => void
  /** 丢掉结果，保留调用方自己的输入框文字 */
  close: () => void
  /** 书架 Esc：结果与会话一起清掉 */
  clearAll: () => void
}

/**
 * 全库正文搜索状态。挂在 App，进阅读也不丢。
 * 书名筛选的 query 仍由书架页自己管；这里只吃显式触发时的关键词。
 */
export function useBodySearch(): BodySearchState {
  const [bodyQuery, setBodyQuery] = useState('')
  const [hits, setHits] = useState<SearchHitWithBook[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState(0)
  const [active, setActive] = useState(false)

  const run = useCallback(async (keyword: string): Promise<void> => {
    const trimmed = keyword.trim()

    if (!isSearchableQuery(trimmed)) {
      setBusy(false)
      setHits([])
      setBodyQuery('')
      setPage(0)
      setOpen(true)
      setActive(true)
      setError('关键词里没有可检索的字符（标点与空白切不出词）。')
      return
    }

    setBusy(true)
    setError(null)
    setActive(true)
    setOpen(true)
    setPage(0)
    try {
      const next = await window.api.library.searchAll(trimmed, BODY_LIMIT)
      setHits(next)
      setBodyQuery(trimmed)
    } catch (e) {
      setHits([])
      setBodyQuery(trimmed)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [])

  const collapse = useCallback(() => setOpen(false), [])

  const toggle = useCallback(() => setOpen((v) => !v), [])

  const close = useCallback(() => {
    setHits([])
    setBodyQuery('')
    setError(null)
    setOpen(false)
    setBusy(false)
    setPage(0)
    setActive(false)
  }, [])

  const clearAll = useCallback(() => {
    close()
  }, [close])

  return {
    bodyQuery,
    hits,
    busy,
    error,
    open,
    page,
    active,
    run,
    collapse,
    toggle,
    setPage,
    close,
    clearAll
  }
}
