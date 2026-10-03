import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReadingPrefs, ReaderBook } from '@shared/types'
import { chapterBlobUrl, prepareChapter } from './document'
import { computeLayout, type ReaderLayout } from './layout'
import { ChapterPaginator } from './paginator'
import { buildReaderCss } from './theme'
import { classifyLink } from './links'
import { TocPanel } from './TocPanel'
import { TypographyPanel } from './TypographyPanel'

/** macOS 上是原生红绿灯占着左上角，标题栏内容要让位 */
const IS_MAC = navigator.userAgent.includes('Mac')
const BAR_PAD_LEFT = IS_MAC ? 78 : 12

/**
 * 章节文档的 base：`epub://<bookId>/<本章所在目录>/`。
 *
 * 这里不复用主进程的 `dirOf`：那一个处理的是 zip entry 名（可能含 `..`），
 * 这一个处理的是 URL，交给标准 URL API 处理 `../` 与编码更可靠。
 */
function chapterBaseHref(bookId: string, entry: string): string {
  const url = new URL(`epub://${bookId}/${entry}`)
  return url.href.slice(0, url.href.lastIndexOf('/') + 1)
}

export function ReaderPage({ bookId, onExit }: { bookId: string; onExit: () => void }) {
  const [book, setBook] = useState<ReaderBook | null>(null)
  const [prefs, setPrefs] = useState<ReadingPrefs | null>(null)
  const [missing, setMissing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [chapterIndex, setChapterIndex] = useState(0)
  const [size, setSize] = useState({ width: 0, height: 0 })
  /** 每换一章 +1，用来触发「重排 → 定位」这条链 */
  const [docVersion, setDocVersion] = useState(0)
  const [page, setPage] = useState(1)
  const [pageCount, setPageCount] = useState(1)
  const [panelOpen, setPanelOpen] = useState(false)

  const stageRef = useRef<HTMLDivElement | null>(null)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const paginatorRef = useRef<ChapterPaginator | null>(null)
  /** 新文档载入后要跳到的位置：恢复进度用 cfi，书内锚点用 fragment，往回翻章用 edge */
  const pendingRef = useRef<{ cfi?: string; fragment?: string; edge?: 'end' } | null>(null)

  /**
   * 版式只在这里算。`windowWidth` 与 `size` 分开传：断点说的是窗口宽度，
   * 而正文区因为左栏被占掉，比窗口窄。
   */
  const layoutRef = useRef<ReaderLayout | null>(null)
  const prefsRef = useRef<ReadingPrefs | null>(null)
  const windowWidth = useWindowWidth()

  /** 只有带正文的节点才进阅读流：目录里的分组节点 href 是空串 */
  const readable = useMemo(() => book?.chapters.filter((item) => item.href !== '') ?? [], [book])

  const layout = useMemo(() => {
    if (!prefs || size.width <= 0 || size.height <= 0) return null
    return computeLayout({
      windowWidth,
      containerWidth: size.width,
      containerHeight: size.height,
      prefs
    })
  }, [prefs, size, windowWidth])

  const canLoad = book !== null && prefs !== null && layout !== null

  // 必须排在载入章节的 effect 之前：同一个 commit 里 ref 先写、再被读到
  useEffect(() => {
    layoutRef.current = layout
    prefsRef.current = prefs
  }, [layout, prefs])

  // ① 开书：书名、目录、上次读到哪里，一次拿齐
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const [opened, saved] = await Promise.all([
          window.api.reader.open(bookId),
          window.api.settings.getPrefs()
        ])
        if (!alive) return
        if (!opened) {
          setMissing(true)
          return
        }
        setPrefs(saved)
        setBook(opened)
        const list = opened.chapters.filter((item) => item.href !== '')
        const found = opened.progress
          ? list.findIndex((item) => item.id === opened.progress?.chapterId)
          : -1
        setChapterIndex(found >= 0 ? found : 0)
        // 定位失败时停在章首即可：进度仍然指向这一章，不会跳到别处
        pendingRef.current = opened.progress ? { cfi: opened.progress.cfi } : null
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : '打开失败')
      }
    })()
    return () => {
      alive = false
    }
  }, [bookId])

  // ② 量正文区。首次同步量一次，之后交给 ResizeObserver
  useEffect(() => {
    const stage = stageRef.current
    if (!stage || !book) return
    const measure = (): void => {
      const rect = stage.getBoundingClientRect()
      setSize({ width: rect.width, height: rect.height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [book])

  // ③ 取回本章 XHTML、加工成无脚本同源文档、装进 iframe、建分页器
  useEffect(() => {
    const pagination = layoutRef.current
    const readingPrefs = prefsRef.current
    const iframe = iframeRef.current
    const chapter = book ? readable[chapterIndex] : undefined
    if (!canLoad || !book || !pagination || !readingPrefs || !iframe || !chapter) return

    let cancelled = false
    let blobUrl: string | null = null
    paginatorRef.current = null

    void (async () => {
      try {
        const response = await fetch(`epub://${book.id}/${chapter.href}`)
        if (!response.ok) throw new Error(`取不到章节内容（HTTP ${response.status}）`)
        const prepared = prepareChapter({
          html: await response.text(),
          baseHref: chapterBaseHref(book.id, chapter.href),
          themeCss: buildReaderCss(pagination, readingPrefs)
        })
        if (cancelled) return

        blobUrl = chapterBlobUrl(prepared)
        const loaded = new Promise<void>((resolve, reject) => {
          iframe.addEventListener('load', () => resolve(), { once: true })
          iframe.addEventListener('error', () => reject(new Error('章节文档没有加载成功')), {
            once: true
          })
        })
        // 尺寸必须在文档载入前定好，否则分页器量到的是错的版式
        iframe.style.width = `${pagination.frameWidth}px`
        iframe.style.height = `${pagination.pageHeight}px`
        iframe.src = blobUrl
        await loaded
        if (cancelled) return

        const doc = iframe.contentDocument
        if (!doc || !doc.body) throw new Error('本章没有正文')

        // 等字体就位再分页：字体晚到会让行高变化，页数就白算了
        await doc.fonts.ready
        if (cancelled) return

        paginatorRef.current = new ChapterPaginator(
          doc,
          pagination,
          chapter.spineIndex ?? chapterIndex
        )
        setError(null)
        setDocVersion((value) => value + 1)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '章节打开失败')
      }
    })()

    return () => {
      cancelled = true
      paginatorRef.current = null
      // Blob URL 不撤销就是内存泄漏，一章一个
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
  }, [canLoad, book, readable, chapterIndex])

  // ④ 版式变化：先尺寸 → 再文档内样式 → 再重排 → 最后上报页数。这个顺序是硬约束
  useEffect(() => {
    const iframe = iframeRef.current
    const paginator = paginatorRef.current
    if (!iframe || !paginator || !layout || !prefs) return

    iframe.style.width = `${layout.frameWidth}px`
    iframe.style.height = `${layout.pageHeight}px`
    const style = iframe.contentDocument?.getElementById('reader-theme')
    if (style) style.textContent = buildReaderCss(layout, prefs)
    paginator.relayout(layout)

    setPage(paginator.page + 1)
    setPageCount(paginator.pages)
  }, [layout, prefs, docVersion])

  // ⑤ 新文档就位后再跳位置。必须排在 ④ 之后，否则会用旧版式的页码
  useEffect(() => {
    const paginator = paginatorRef.current
    const pending = pendingRef.current
    if (!paginator || !pending) return
    pendingRef.current = null
    if (pending.cfi) {
      paginator.goToCfi(pending.cfi)
    } else if (pending.edge === 'end') {
      paginator.goToPage(paginator.pages - 1)
    } else if (pending.fragment) {
      // 锚点找不到就停在章首：链接至少把用户带到了对的那一章
      paginator.goToElement(pending.fragment)
    }
    setPage(paginator.page + 1)
    setPageCount(paginator.pages)
  }, [docVersion])

  // 阅读器自带主题：跟着偏好切，不污染一级页面的主题
  useEffect(() => {
    if (prefs) document.documentElement.dataset.theme = prefs.theme
  }, [prefs])

  const turn = useCallback(
    (direction: 1 | -1) => {
      const paginator = paginatorRef.current
      if (!paginator) return
      if (direction === 1 ? paginator.next() : paginator.prev()) {
        setPage(paginator.page + 1)
        setPageCount(paginator.pages)
        return
      }
      const target = chapterIndex + direction
      if (target < 0 || target >= readable.length) return
      // 往前翻章落到章首（新分页器本来就在章首），往回翻章要落到章尾
      pendingRef.current = direction === -1 ? { edge: 'end' } : null
      setChapterIndex(target)
    },
    [chapterIndex, readable.length]
  )

  const goToChapterById = useCallback(
    (chapterId: number) => {
      const index = readable.findIndex((item) => item.id === chapterId)
      if (index < 0 || index === chapterIndex) return
      pendingRef.current = null
      setChapterIndex(index)
    },
    [readable, chapterIndex]
  )

  /** 处理书内的一次链接点击：内链自己跳，外链交系统，其余忽略 */
  const openLink = useCallback(
    (href: string, currentEntry: string) => {
      if (!book) return
      const target = classifyLink(href, chapterBaseHref(book.id, currentEntry), book.id)

      if (target.kind === 'anchor') {
        paginatorRef.current?.goToElement(target.fragment)
        return
      }
      if (target.kind === 'external') {
        void window.api.shell.openExternal(target.url)
        return
      }
      if (target.kind === 'ignore') return

      const index = readable.findIndex((item) => item.href === target.entry)
      if (index < 0) return
      if (index === chapterIndex) {
        // 同一章里跳锚点：不值得重新载一遍文档
        if (target.fragment) paginatorRef.current?.goToElement(target.fragment)
        return
      }
      pendingRef.current = target.fragment ? { fragment: target.fragment } : null
      setChapterIndex(index)
    },
    [book, readable, chapterIndex]
  )

  /**
   * 落库当前位置。
   *
   * 全书进度按「可读章节数」折算，不按字数 —— 正文没有全量分页统计，
   * 拿字数当分母只会造出一个看着精确、实际是猜的百分比。
   */
  const saveNow = useCallback(() => {
    const paginator = paginatorRef.current
    const chapter = readable[chapterIndex]
    if (!book || !paginator || !chapter) return
    const share = 1 / Math.max(1, readable.length)
    void window.api.reader.saveProgress({
      bookId: book.id,
      cfi: paginator.currentCfi(),
      chapterId: chapter.id,
      percent: Math.min(1, chapterIndex * share + paginator.chapterFraction() * share)
    })
  }, [book, readable, chapterIndex])

  const saveNowRef = useRef(saveNow)
  useEffect(() => {
    saveNowRef.current = saveNow
  }, [saveNow])

  // 翻页/换章后延迟落库：每翻一页写一次 IPC 没有意义
  useEffect(() => {
    if (!book) return
    const timer = window.setTimeout(() => saveNowRef.current(), 600)
    return () => window.clearTimeout(timer)
  }, [book, page, chapterIndex, docVersion])

  // 防抖窗口内直接退出（关窗、Cmd+Q）会丢掉最后一次翻页，所以失焦时补一次
  useEffect(() => {
    const flush = (): void => saveNowRef.current()
    window.addEventListener('blur', flush)
    return () => window.removeEventListener('blur', flush)
  }, [])

  /** 待落库的偏好改动：拖滑块期间累积，防抖 300ms 后一次写回，不每动一下就发一次 IPC */
  const pendingPrefsRef = useRef<Partial<ReadingPrefs>>({})
  const prefsTimerRef = useRef<number | null>(null)

  const flushPrefs = useCallback((): void => {
    if (prefsTimerRef.current !== null) {
      window.clearTimeout(prefsTimerRef.current)
      prefsTimerRef.current = null
    }
    const patch = pendingPrefsRef.current
    pendingPrefsRef.current = {}
    if (Object.keys(patch).length === 0) return
    // 主进程会夹取区间，它回传的才是权威值（滑块的 min/max 只是 UI 约束，不是保证）
    void window.api.settings.setPrefs(patch).then((saved) => {
      // 落库期间用户又动了滑块：以他的新值为准，别把滑块拽回去
      if (Object.keys(pendingPrefsRef.current).length === 0) setPrefs(saved)
    })
  }, [])

  const applyPrefs = useCallback(
    (patch: Partial<ReadingPrefs>): void => {
      // 乐观更新：拖滑块必须跟手，等 IPC 回来再改会顿
      setPrefs((current) => (current ? { ...current, ...patch } : current))
      pendingPrefsRef.current = { ...pendingPrefsRef.current, ...patch }
      if (prefsTimerRef.current !== null) window.clearTimeout(prefsTimerRef.current)
      prefsTimerRef.current = window.setTimeout(flushPrefs, 300)
    },
    [flushPrefs]
  )

  /**
   * 退出前把偏好与阅读位置都补一次。
   *
   * 两者都是防抖写库，用户改完字号立刻按返回（或直接关窗）会落在防抖窗口里，
   * 不补这一次就白改了。
   */
  const exit = useCallback(() => {
    flushPrefs()
    saveNow()
    onExit()
  }, [flushPrefs, saveNow, onExit])

  // 卸载时补一次：防抖窗口内直接关窗，偏好改动不能丢
  useEffect(
    () => () => {
      flushPrefs()
    },
    [flushPrefs]
  )

  /**
   * 拦下正文里的每一次链接点击。
   *
   * 放行就等于让 iframe 自己导航走 —— 正文当场丢失，而且会把远程页面装进我们的窗口。
   * 注意这里不能用 `instanceof Element`：事件对象来自 iframe 的 realm，
   * 跨 realm 的 instanceof 恒为 false，只能按方法是否存在来判。
   */
  useEffect(() => {
    const doc = iframeRef.current?.contentDocument
    const currentEntry = readable[chapterIndex]?.href
    if (!doc || !currentEntry) return

    const handler = (event: Event): void => {
      const node = event.target as { closest?: (selector: string) => Element | null } | null
      const href = node?.closest?.('a[href]')?.getAttribute('href')
      if (!href) return
      event.preventDefault()
      openLink(href, currentEntry)
    }

    doc.addEventListener('click', handler)
    return () => doc.removeEventListener('click', handler)
  }, [docVersion, readable, chapterIndex, openLink])

  /** 键盘要在两个文档上都听：焦点在 iframe 里时父文档收不到 keydown */
  const onKeyRef = useRef<(event: KeyboardEvent) => void>(() => {})
  useEffect(() => {
    onKeyRef.current = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      // 焦点在表单控件上时，方向键是控件自己的操作（Aa 面板的滑块就靠它改字号），
      // 不能被翻页抢走；这里不用 instanceof，跨 realm 的事件对象 instanceof 恒为 false
      const target = event.target as { closest?: (selector: string) => Element | null } | null
      if (target?.closest?.('input, textarea, select')) return
      if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        event.preventDefault()
        turn(1)
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault()
        turn(-1)
      } else if (event.key === 'Escape') {
        event.preventDefault()
        exit()
      }
    }
  })

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => onKeyRef.current(event)
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    const doc = iframeRef.current?.contentDocument
    if (!doc) return
    const handler = (event: KeyboardEvent): void => onKeyRef.current(event)
    doc.addEventListener('keydown', handler)
    return () => doc.removeEventListener('keydown', handler)
  }, [docVersion])

  if (missing) {
    return (
      <div className="reader">
        <div className="reader__bar" style={{ paddingLeft: BAR_PAD_LEFT }}>
          <button type="button" className="btn" onClick={onExit}>
            返回书架
          </button>
        </div>
        <p className="reader__status">这本书不在书库里，可能已经被删除了。</p>
      </div>
    )
  }

  return (
    <div className="reader">
      <div className="reader__bar" style={{ paddingLeft: BAR_PAD_LEFT }}>
        <button type="button" className="btn" onClick={exit}>
          返回书架
        </button>
        <span className="reader__title">{book?.title ?? '正在打开…'}</span>
        <span className="reader__chapter">{readable[chapterIndex]?.title ?? ''}</span>
        <span className="reader__spacer" />
        <button type="button" className="btn" onClick={() => turn(-1)}>
          上一页
        </button>
        <span className="reader__page">
          {page} / {pageCount}
        </span>
        <button type="button" className="btn" onClick={() => turn(1)}>
          下一页
        </button>
        <button type="button" className="btn" onClick={() => setPanelOpen((open) => !open)}>
          排版
        </button>
      </div>
      {layout?.clamped && (
        <p className="reader__degrade" role="status">
          窗口宽度只够 {layout.charsPerLine} 字／行，已按上限显示
          {layout.fontSizeClamped && `；字号已从 ${prefs?.fontSize} 降到 ${layout.fontSize} 显示`}
        </p>
      )}
      <div className="reader__body">
        <TocPanel
          chapters={book?.chapters ?? []}
          currentId={readable[chapterIndex]?.id ?? null}
          onSelect={goToChapterById}
        />
        <div className="reader__stage" ref={stageRef}>
          {error && <p className="reader__status">{error}</p>}
          <div className="reader__frame">
            <iframe
              ref={iframeRef}
              className="reader__view"
              title={book?.title ?? '正文'}
              // 第四道锁：即便 CSP 与摘脚本都失效，沙箱也不给脚本执行的机会。
              // allow-same-origin 是功能前提（父文档要读它的 DOM），且不再放开其他任何一项
              sandbox="allow-same-origin"
            />
          </div>
        </div>
        {panelOpen && prefs && layout && (
          <TypographyPanel
            prefs={prefs}
            layout={layout}
            onChange={applyPrefs}
            onClose={() => setPanelOpen(false)}
          />
        )}
      </div>
    </div>
  )
}

/** 窗口宽度：`computeLayout` 的断点看的是窗口，不是正文区 */
function useWindowWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth)
  useEffect(() => {
    const onResize = (): void => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return width
}
