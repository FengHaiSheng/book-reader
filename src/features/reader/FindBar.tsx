import { useEffect, useRef } from 'react'
import type { SearchHit } from '@shared/types'
import { isSearchableQuery, snippetOf } from './search'

/**
 * 书内查找条（贴阅读器工具条下方的独立一条）。
 *
 * 不占左栏：目录一直留在那儿，查找只是盖在正文上方的一条。
 * 结果来自主进程的 `library:search` —— bigram 切分 + FTS5，纯本地、不调模型、不花钱。
 * 定位由 ReaderPage 负责：这里只管「第几条」与「上一条 / 下一条」。
 */
export function FindBar({
  query,
  onQuery,
  hits,
  busy,
  error,
  note,
  activeIndex,
  focusToken,
  chapterTitleOf,
  onPick,
  onStep,
  onClose
}: {
  query: string
  onQuery: (value: string) => void
  hits: SearchHit[]
  /** 正在查（含 250ms 防抖窗口） */
  busy: boolean
  /** 这一次查找本身失败了，与「没找到」是两回事 */
  error: string | null
  /** 点了某条结果但定位失败之类的临时提示 */
  note: string | null
  /** 当前停在第几条，从 0 数 */
  activeIndex: number
  /** 每次打开查找都 +1：查找条已经开着时也要把焦点还给输入框 */
  focusToken: number
  chapterTitleOf: (chapterId: number | null) => string
  onPick: (index: number) => void
  /** 1 下一条 / -1 上一条，到头绕回去 */
  onStep: (delta: 1 | -1) => void
  onClose: () => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusToken])

  // 用键盘走到列表外的条目时，把它滚进可见区，否则「1 / 12」跳到哪条看不见
  useEffect(() => {
    const item = listRef.current?.children[activeIndex] as HTMLElement | undefined
    item?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, hits])

  const empty = hits.length === 0

  return (
    <div className="findbar" role="search" aria-label="书内查找">
      <div className="findbar__row">
        <input
          ref={inputRef}
          className="findbar__input"
          type="search"
          value={query}
          placeholder="查找本书内容"
          aria-label="查找关键词"
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={(event) => {
            // 回车翻到上/下一条是查找条的通用手感；Esc 收条，再按一次才轮到退出阅读
            if (event.key === 'Enter') {
              event.preventDefault()
              onStep(event.shiftKey ? -1 : 1)
            } else if (event.key === 'Escape') {
              event.preventDefault()
              onClose()
            }
          }}
        />
        <span className={`findbar__status${error ? ' findbar__status--error' : ''}`} role="status">
          {error ?? statusText({ query, hits, busy, activeIndex })}
        </span>
        <button
          type="button"
          className="findbar__btn"
          onClick={() => onStep(-1)}
          disabled={empty}
          aria-label="上一条"
          title="上一条（Shift+Enter）"
        >
          上一条
        </button>
        <button
          type="button"
          className="findbar__btn"
          onClick={() => onStep(1)}
          disabled={empty}
          aria-label="下一条"
          title="下一条（Enter）"
        >
          下一条
        </button>
        <span className="findbar__spacer" />
        <button type="button" className="findbar__btn" onClick={onClose} aria-label="关闭查找">
          关闭
        </button>
      </div>

      {note && <p className="findbar__note">{note}</p>}

      {!empty && (
        <ul className="findbar__list" ref={listRef}>
          {hits.map((hit, index) => {
            const snippet = snippetOf(hit.text, query)
            return (
              <li key={hit.chunkId}>
                <button
                  type="button"
                  className={`findbar__item${index === activeIndex ? ' findbar__item--active' : ''}`}
                  title={hit.headingPath || undefined}
                  onClick={() => onPick(index)}
                >
                  <span className="findbar__chapter">{chapterTitleOf(hit.chapterId)}</span>
                  <span className="findbar__snippet">
                    {snippet.before}
                    {snippet.hit !== '' && <mark className="findbar__mark">{snippet.hit}</mark>}
                    {snippet.after}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/**
 * 状态行的口径。四件事必须分开说，不能都糊成一句「没有结果」：
 * 还没输入 / 正在查 / 关键词查不了 / 真的没找到。有结果时报「第几条 / 共几条」。
 */
function statusText({
  query,
  hits,
  busy,
  activeIndex
}: {
  query: string
  hits: SearchHit[]
  busy: boolean
  activeIndex: number
}): string {
  const keyword = query.trim()
  if (keyword === '') return '输入关键词，边打边找；回车走下一条'
  if (busy) return '查找中…'
  if (!isSearchableQuery(keyword)) return '关键词里没有可检索的汉字或字母，换个词试试'
  if (hits.length === 0) return `没有找到包含「${keyword}」的段落`
  return `第 ${activeIndex + 1} / ${hits.length} 条`
}
