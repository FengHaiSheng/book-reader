import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_HIGHLIGHT_COLOR, MAX_HIGHLIGHT_CHARS, type HighlightColor } from '@shared/highlights'
import { DEFAULT_PREFS } from '@shared/types'
import type { Citation, Highlight, ReadingPrefs, ReaderBook, ReadingTarget } from '@shared/types'
import { chapterBlobUrl, prepareChapter } from './document'
import { computeLayout, PAGE_PAD_Y, type ReaderLayout } from './layout'
import { ChapterPaginator } from './paginator'
import { buildReaderCss } from './theme'
import { classifyLink } from './links'
import { anchorOf, rangeFromSpan, spanFromSelection } from './cfi'
import { clearHighlights, highlightAt, paintHighlights, supportsHighlights } from './highlights'
import { HighlightPopover, POPOVER_MAX_HEIGHT } from './HighlightPopover'
import { SelectionToolbar, type SelectionState } from './SelectionToolbar'
import { TocPanel } from './TocPanel'
import { TypographyPanel } from './TypographyPanel'
import { AiPanel, type AiSeed } from '../ai/AiPanel'

/** macOS 上是原生红绿灯占着左上角，标题栏内容要让位 */
const IS_MAC = navigator.userAgent.includes('Mac')
const BAR_PAD_LEFT = IS_MAC ? 78 : 12

/** 引用回跳失败时的口径：说清「没定位到」，不假装成功 */
const CITATION_MISS = '没能在这章正文里定位到这段原文（正文与检索用的文本对不上）。'

/** 引用指向的章节没了。书被重新导入过就会这样 */
const CITATION_NO_CHAPTER = '这条引用对应的章节现在不在书里了，书可能被重新导入过。'

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

export function ReaderPage({
  bookId,
  target,
  onExit
}: {
  bookId: string
  /** 从笔记「回到原文」进来时指定落点；从书架进来传 null，沿用上次进度 */
  target?: ReadingTarget | null
  onExit: () => void
}) {
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
  const [highlights, setHighlights] = useState<Highlight[]>([])
  const [selection, setSelection] = useState<SelectionState | null>(null)
  const [active, setActive] = useState<{ highlight: Highlight; x: number; y: number } | null>(null)
  const [annotError, setAnnotError] = useState<string | null>(null)
  /** 当前环境不支持 CSS Custom Highlight API 时，界面上要明说，而不是静静地不画 */
  const [canHighlight, setCanHighlight] = useState(true)
  const [aiOpen, setAiOpen] = useState(false)
  const [aiSeed, setAiSeed] = useState<AiSeed | null>(null)
  const [citationNote, setCitationNote] = useState<string | null>(null)

  const stageRef = useRef<HTMLDivElement | null>(null)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const paginatorRef = useRef<ChapterPaginator | null>(null)
  /** 新文档载入后要跳到的位置：进度用 cfi、书内锚点用 fragment、往回翻章用 edge、引用回跳用 excerpt */
  const pendingRef = useRef<{ cfi?: string; fragment?: string; edge?: 'end'; excerpt?: string } | null>(
    null
  )

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

  const chapter = readable[chapterIndex] ?? null

  // ⑥ 取本章标注。换章、换书都要重取，翻页不用——标注是章级的
  useEffect(() => {
    if (!book || !chapter) {
      setHighlights([])
      return
    }
    let alive = true
    void window.api.notes
      .listChapter(book.id, chapter.id)
      .then((list) => {
        if (alive) setHighlights(list)
      })
      .catch((e: unknown) => {
        if (alive) setAnnotError(e instanceof Error ? e.message : '本章的标注没读出来')
      })
    return () => {
      alive = false
    }
  }, [book, chapter])

  // ⑦ 画高亮。文档换了、本章标注变了都要重画；翻页不用，Range 跟着 DOM 走，与 translateX 无关
  useEffect(() => {
    const win = iframeRef.current?.contentWindow
    const doc = iframeRef.current?.contentDocument
    if (!win || !doc) return
    if (!supportsHighlights(win)) {
      setCanHighlight(false)
      return
    }
    setCanHighlight(true)
    paintHighlights(win, doc, highlights)
    return () => clearHighlights(win)
  }, [highlights, docVersion])

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
        // 指定了章节就用它，否则回到上次读到的位置
        const wanted = target?.chapterId ?? opened.progress?.chapterId ?? null
        const found = list.findIndex((item) => item.id === wanted)
        setChapterIndex(found >= 0 ? found : 0)
        // cfi 只在「确实要落在指定章节」时才跟着 target 走，
        // 否则会拿 A 章的 cfi 去定位 B 章，必然失败并退化成章首
        const cfi = target?.chapterId != null ? target.cfi : (opened.progress?.cfi ?? null)
        pendingRef.current = cfi ? { cfi } : null
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : '打开失败')
      }
    })()
    return () => {
      alive = false
    }
  }, [bookId, target])

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
    } else if (pending.excerpt) {
      // 引用回跳：跨章时摘录要等新文档就位才能匹配，失败也必须明说
      setCitationNote(paginator.goToExcerpt(pending.excerpt) ? null : CITATION_MISS)
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
      // 翻页时收掉浮条与浮层：它们的坐标锚在上一页的正文上，留着就是错位
      setActive(null)
      setSelection(null)
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

  /**
   * 点引用上标：跳到那一章的原文处，并把那段原文闪一下。
   *
   * 三种结果都要如实呈现：定位成功（闪烁）、跳到章了但没匹配上（提示条）、
   * 章节都不在了（提示条）。没有第四种「什么都不发生」。
   */
  const goToCitation = useCallback(
    (citation: Citation) => {
      setCitationNote(null)
      const index =
        citation.chapterId === null
          ? -1
          : readable.findIndex((item) => item.id === citation.chapterId)

      if (index >= 0 && index !== chapterIndex) {
        // 跨章：摘录挂上，等新文档就位后由 ⑤ 号 effect 去定位
        pendingRef.current = { excerpt: citation.excerpt }
        setChapterIndex(index)
        return
      }
      if (index < 0 && citation.chapterId !== null) {
        setCitationNote(CITATION_NO_CHAPTER)
        return
      }
      // 就在本章，或引用没带章节号：只在本章里找，不动文档
      const found = paginatorRef.current?.goToExcerpt(citation.excerpt) ?? false
      if (!found) setCitationNote(CITATION_MISS)
    },
    [readable, chapterIndex]
  )

  useEffect(() => {
    if (!citationNote) return
    const timer = window.setTimeout(() => setCitationNote(null), 6000)
    return () => window.clearTimeout(timer)
  }, [citationNote])

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
    if (!book || !paginator || !chapter) return
    const share = 1 / Math.max(1, readable.length)
    void window.api.reader.saveProgress({
      bookId: book.id,
      cfi: paginator.currentCfi(),
      chapterId: chapter.id,
      percent: Math.min(1, chapterIndex * share + paginator.chapterFraction() * share)
    })
  }, [book, readable, chapter, chapterIndex])

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

  // ⑧ 划词：文档里任何一次选区变化都先落到 state，坐标换算到 .reader__stage 上
  useEffect(() => {
    const doc = iframeRef.current?.contentDocument
    const iframe = iframeRef.current
    const stage = stageRef.current
    if (!doc || !iframe || !stage || !chapter) return

    setSelection(null)

    const onSelectionChange = (): void => {
      const current = doc.getSelection()
      if (!current || current.rangeCount === 0 || current.isCollapsed) {
        setSelection(null)
        return
      }
      const range = current.getRangeAt(0)
      const anchor = anchorOf(range)
      if (!anchor) {
        setSelection(null)
        return
      }
      const span = spanFromSelection(doc, range, chapter.spineIndex ?? chapterIndex)
      if (!span) {
        setSelection(null)
        return
      }
      const iframeRect = iframe.getBoundingClientRect()
      const stageRect = stage.getBoundingClientRect()
      setSelection({
        ...span,
        tooLong: span.text.length > MAX_HIGHLIGHT_CHARS,
        x: iframeRect.left - stageRect.left + anchor.x,
        y: iframeRect.top - stageRect.top + anchor.y
      })
      setActive(null)
    }

    doc.addEventListener('selectionchange', onSelectionChange)
    return () => doc.removeEventListener('selectionchange', onSelectionChange)
  }, [docVersion, chapter, chapterIndex])

  // ⑨ 点已有高亮。链接优先于标注：点链接是导航，不该被批注浮层抢走
  useEffect(() => {
    const doc = iframeRef.current?.contentDocument
    const iframe = iframeRef.current
    const stage = stageRef.current
    if (!doc || !iframe || !stage) return

    const onClick = (event: MouseEvent): void => {
      const node = event.target as { closest?: (selector: string) => Element | null } | null
      if (node?.closest?.('a[href]')) return

      const caret = doc.caretRangeFromPoint(event.clientX, event.clientY)
      if (!caret) {
        setActive(null)
        return
      }
      const hit = highlightAt(doc, highlights, caret.startContainer, caret.startOffset)
      if (!hit) {
        setActive(null)
        return
      }

      const range = rangeFromSpan(doc, hit.startCfi, hit.endCfi)
      const anchor = range ? anchorOf(range) : null
      const iframeRect = iframe.getBoundingClientRect()
      const stageRect = stage.getBoundingClientRect()
      const rawTop = iframeRect.top - stageRect.top + (anchor ? anchor.y : event.clientY)
      const left = iframeRect.left - stageRect.left + (anchor ? anchor.x : event.clientX)
      setSelection(null)
      setActive({
        highlight: hit,
        // 夹在正文区里：贴底时往上收，贴顶时往下放，避免被 .reader__stage 的 overflow 裁掉
        x: Math.min(Math.max(8, left), Math.max(8, stageRect.width - 8)),
        y: Math.min(Math.max(8, rawTop + 8), Math.max(8, stageRect.height - POPOVER_MAX_HEIGHT - 8))
      })
    }

    doc.addEventListener('click', onClick)
    return () => doc.removeEventListener('click', onClick)
  }, [docVersion, highlights])

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

  const markSelection = useCallback(
    async (color: HighlightColor, withNote: boolean) => {
      if (!book || !chapter || !selection || selection.tooLong) return
      const anchor = { x: selection.x, y: selection.y }
      try {
        const created = await window.api.notes.create({
          bookId: book.id,
          chapterId: chapter.id,
          startCfi: selection.startCfi,
          endCfi: selection.endCfi,
          text: selection.text,
          note: null,
          color
        })
        setHighlights((list) => [...list, created])
        setAnnotError(null)
        setSelection(null)
        // 选区不清掉，下一次 selectionchange 会把浮条又唤醒
        iframeRef.current?.contentWindow?.getSelection()?.removeAllRanges()
        if (withNote) {
          setActive({
            highlight: created,
            x: Math.min(Math.max(8, anchor.x), 400),
            y: Math.min(Math.max(8, anchor.y + 8), Math.max(8, 400))
          })
        }
      } catch (e) {
        setAnnotError(e instanceof Error ? e.message : '标注没有保存成功')
      }
    },
    [book, chapter, selection]
  )

  const copySelection = useCallback(() => {
    if (!selection) return
    void navigator.clipboard.writeText(selection.text)
    setSelection(null)
    iframeRef.current?.contentWindow?.getSelection()?.removeAllRanges()
  }, [selection])

  /**
   * 浮条上的三个 AI 动作。
   *
   * 「问 AI」只把原文放进引用槽、把焦点给输入框，**不发请求**——点击它的时候
   * 用户还没说想问什么，替他猜一个问题就是在花他的钱（硬规则 1）。
   * 「解释」「翻译」按一下就发：那一下本身就是完整的显式指令。
   */
  const askFromSelection = useCallback(
    (task: 'ask' | 'explain' | 'translate') => {
      if (!selection) return
      setAiSeed(
        task === 'ask'
          ? { kind: 'prefill', task: 'ask', text: selection.text }
          : { kind: 'send', task, text: selection.text }
      )
      setAiOpen(true)
      setSelection(null)
      // 选区不清掉，下一次 selectionchange 会把浮条又唤醒
      iframeRef.current?.contentWindow?.getSelection()?.removeAllRanges()
    },
    [selection]
  )

  const changeActiveColor = useCallback(
    async (color: HighlightColor) => {
      if (!active) return
      const updated = await window.api.notes.update(active.highlight.id, { color })
      if (!updated) return
      setHighlights((list) => list.map((item) => (item.id === updated.id ? updated : item)))
      setActive({ ...active, highlight: updated })
    },
    [active]
  )

  const saveActiveNote = useCallback(
    async (note: string | null) => {
      if (!active) return
      try {
        const updated = await window.api.notes.update(active.highlight.id, { note })
        if (!updated) return
        setHighlights((list) => list.map((item) => (item.id === updated.id ? updated : item)))
        setActive({ ...active, highlight: updated })
        setAnnotError(null)
      } catch (e) {
        setAnnotError(e instanceof Error ? e.message : '批注没有保存成功')
      }
    },
    [active]
  )

  const removeActive = useCallback(async () => {
    if (!active) return
    const id = active.highlight.id
    await window.api.notes.remove(id)
    setHighlights((list) => list.filter((item) => item.id !== id))
    setActive(null)
  }, [active])

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
        <button
          type="button"
          className={`btn${aiOpen ? ' btn--on' : ''}`}
          aria-pressed={aiOpen}
          onClick={() => setAiOpen((open) => !open)}
        >
          AI
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
      {citationNote && (
        <p className="reader__degrade" role="status">
          {citationNote}
        </p>
      )}
      {!canHighlight && docVersion > 0 && (
        <p className="reader__degrade" role="status">
          当前环境不支持无侵入高亮，书内标注只保存不显示；笔记页仍能看到全部内容。
        </p>
      )}
      {annotError && (
        <p className="reader__degrade reader__degrade--error" role="status">
          {annotError}
        </p>
      )}
      <div className="reader__body">
        <TocPanel
          chapters={book?.chapters ?? []}
          currentId={readable[chapterIndex]?.id ?? null}
          onSelect={goToChapterById}
        />
        {/* 阅读区整块是纸，上留白由舞台给，正文块在纸面上上下居中 */}
        <div className="reader__stage" ref={stageRef} style={{ paddingTop: PAGE_PAD_Y }}>
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
          {selection && (
            <SelectionToolbar
              selection={selection}
              onMark={(color) => void markSelection(color, false)}
              onNote={() => void markSelection(DEFAULT_HIGHLIGHT_COLOR, true)}
              onCopy={copySelection}
              onExplain={() => askFromSelection('explain')}
              onTranslate={() => askFromSelection('translate')}
              onAsk={() => askFromSelection('ask')}
            />
          )}
          {active && (
            <HighlightPopover
              highlight={active.highlight}
              x={active.x}
              y={active.y}
              onColor={(color) => void changeActiveColor(color)}
              onSaveNote={(note) => void saveActiveNote(note)}
              onRemove={() => void removeActive()}
              onClose={() => setActive(null)}
            />
          )}
        </div>
        {aiOpen && (
          <AiPanel
            bookId={bookId}
            chapterId={chapter?.id ?? null}
            seed={aiSeed}
            panelWidth={prefs?.aiPanelWidth ?? DEFAULT_PREFS.aiPanelWidth}
            onPanelWidth={(width) => applyPrefs({ aiPanelWidth: width })}
            onSeedConsumed={() => setAiSeed(null)}
            onCitation={goToCitation}
            onClose={() => setAiOpen(false)}
          />
        )}
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
