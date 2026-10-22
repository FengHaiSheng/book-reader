import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReaderBook } from '@shared/types'
import { BAR_PAD_LEFT } from './chrome'

/** 翻页后延迟落库：连着翻十页不该发十次 IPC */
const SAVE_DEBOUNCE_MS = 500

/**
 * 漫画阅读器：整页图片，左右翻页。
 *
 * 与文字阅读器刻意分开：漫画没有分栏、CFI、划词与书内查找，硬并进分页器只会
 * 把一条本来很清楚的链路搅浑。这里只做三件事——显示、翻页、记进度。
 */
export function ComicReader({
  book,
  startChapterId,
  onExit
}: {
  book: ReaderBook
  /** 上次读到的那一页（chapter id）；找不到就从头开始 */
  startChapterId: number | null
  onExit: () => void
}) {
  /** 每页就是一条 chapter，href 指向 media/ 下的图片 */
  const pages = useMemo(() => book.chapters.filter((item) => item.href !== ''), [book])
  const total = pages.length

  const [index, setIndex] = useState(() => {
    const found = pages.findIndex((item) => item.id === startChapterId)
    return found >= 0 ? found : 0
  })
  /** 窗口够宽时默认双页；用户切过之后以他的选择为准 */
  const [spread, setSpread] = useState(() => window.innerWidth >= 1600)
  const [broken, setBroken] = useState(false)

  const stageRef = useRef<HTMLDivElement | null>(null)

  const step = spread ? 2 : 1
  const lastVisible = Math.min(index + step - 1, total - 1)

  const turn = useCallback(
    (direction: 1 | -1) => {
      setIndex((current) => {
        const next = current + direction * step
        if (next < 0) return 0
        if (next >= total) return Math.max(total - 1, 0)
        return next
      })
      setBroken(false)
    },
    [step, total]
  )

  const saveNow = useCallback(() => {
    const page = pages[index]
    if (!page || total === 0) return
    void window.api.reader.saveProgress({
      bookId: book.id,
      // 漫画的位置就是页码。cfi 列非空，这里存一个不会与文字 CFI 混淆的形状
      cfi: `page:${lastVisible + 1}`,
      chapterId: page.id,
      percent: Math.min(1, (lastVisible + 1) / total)
    })
  }, [book.id, pages, index, lastVisible, total])

  const saveNowRef = useRef(saveNow)
  useEffect(() => {
    saveNowRef.current = saveNow
  }, [saveNow])

  // 翻页后落库；卸载时补一次，防抖窗口里退出也不会丢掉最后几页
  useEffect(() => {
    const timer = window.setTimeout(() => saveNowRef.current(), SAVE_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [index, spread])

  useEffect(() => () => saveNowRef.current(), [])

  // 预取后面两页，翻过去时不用等网络
  useEffect(() => {
    if (total === 0) return
    for (let offset = 1; offset <= 2; offset += 1) {
      const next = pages[index + offset]
      if (!next) continue
      const image = new Image()
      image.src = `epub://${book.id}/${next.href}`
    }
  }, [book.id, pages, index, total])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      // 焦点在输入控件里时方向键归控件自己
      const target = event.target as { closest?: (selector: string) => Element | null } | null
      if (target?.closest?.('input, textarea, select')) return

      if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
        event.preventDefault()
        turn(1)
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault()
        turn(-1)
      } else if (event.key === 'Home') {
        event.preventDefault()
        setIndex(0)
      } else if (event.key === 'End') {
        event.preventDefault()
        setIndex(Math.max(total - 1, 0))
      } else if (event.key === 'Escape') {
        event.preventDefault()
        onExit()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [turn, total, onExit])

  /** 点左半边上一页、右半边下一页：鼠标单手也能读 */
  const onStageClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    const stage = stageRef.current
    if (!stage) return
    const rect = stage.getBoundingClientRect()
    turn(event.clientX - rect.left < rect.width / 2 ? -1 : 1)
  }

  const visible = spread ? pages.slice(index, index + 2) : pages.slice(index, index + 1)

  return (
    <div className="reader reader--comic">
      <div className="reader__bar" style={{ paddingLeft: BAR_PAD_LEFT }}>
        <button type="button" className="btn" onClick={onExit}>
          返回书架
        </button>
        <span className="reader__title">{book.title}</span>
        <span className="reader__spacer" />
        <button
          type="button"
          className={`btn${spread ? ' btn--on' : ''}`}
          aria-pressed={spread}
          onClick={() => setSpread((current) => !current)}
          disabled={total < 2}
        >
          双页
        </button>
        <button type="button" className="btn" onClick={() => turn(-1)}>
          上一页
        </button>
        <span className="reader__page">
          {total === 0
            ? '没有页面'
            : spread && lastVisible > index
              ? `第 ${index + 1}–${lastVisible + 1} / ${total} 页`
              : `第 ${index + 1} / ${total} 页`}
        </span>
        <button type="button" className="btn" onClick={() => turn(1)}>
          下一页
        </button>
      </div>

      <div className="comic" ref={stageRef} onClick={onStageClick}>
        {total === 0 && <p className="reader__status">这本书里没有可显示的页面。</p>}
        {broken && <p className="reader__status">这一页的图片读不出来，可能是文件已损坏。</p>}
        <div className={`comic__pages${spread ? ' comic__pages--spread' : ''}`}>
          {visible.map((page) => (
            <img
              key={page.id}
              className="comic__page"
              src={`epub://${book.id}/${page.href}`}
              alt={`第 ${pages.indexOf(page) + 1} 页`}
              draggable={false}
              onError={() => setBroken(true)}
              onLoad={() => setBroken(false)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
