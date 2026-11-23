import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  BookStatus,
  LibraryStats,
  ReadingPrefs,
  ReadingTarget,
  SearchHitWithBook,
  Tag
} from '@shared/types'
import { TitleBar } from './shell/TitleBar'
import { Sidebar, type PageId } from './shell/Sidebar'
import {
  ReadingChromeProvider,
  type ReadingChromeValue
} from './shell/ReadingChromeContext'
import { ExitReadingModal } from './shell/ExitReadingModal'
import {
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_EXPANDED_MIN_WIDTH,
  SIDEBAR_WIDTH,
  clampExpandedSidebarWidth
} from './shell/sidebarWidth'
import { LibraryPage } from './pages/LibraryPage'
import { NotesPage } from './pages/NotesPage'
import { SettingsPage } from './pages/SettingsPage'
import { TrackPage } from './features/track/TrackPage'
import { ReaderPage } from './features/reader/ReaderPage'
import { LibraryBodySearchOverlay } from './features/library/LibraryBodySearchOverlay'
import { useBodySearch } from './features/library/useBodySearch'
import './styles/base.css'

export default function App() {
  const [page, setPage] = useState<PageId>('library')
  const [reading, setReading] = useState<ReadingTarget | null>(null)
  const [tags, setTags] = useState<Tag[]>([])
  const [tagFilter, setTagFilter] = useState<number | null>(null)
  /** 侧栏标签增删改后递增，用来通知 LibraryPage 重取书列（tag chip / 筛选结果） */
  const [tagRevision, setTagRevision] = useState(0)
  const [statusFilter, setStatusFilter] = useState<BookStatus | null>(null)
  const [stats, setStats] = useState<LibraryStats | null>(null)
  /** 书架搜索框：与正文浮层同挂 App，进阅读回来不丢字 */
  const [libraryQuery, setLibraryQuery] = useState('')
  const {
    bodyQuery,
    hits: bodyHits,
    busy: bodyBusy,
    error: bodyError,
    open: bodyOpen,
    page: bodyPage,
    active: bodyActive,
    run: runBodySearch,
    collapse: collapseBodySearch,
    toggle: toggleBodySearch,
    setPage: setBodyPage,
    close: closeBodySearch,
    clearAll: clearBodySearch
  } = useBodySearch()
  /** 阅读侧栏宽度；进阅读默认展开看目录，退出恢复默认展开宽 */
  const [readingSidebarWidth, setReadingSidebarWidth] = useState(SIDEBAR_COLLAPSED_WIDTH)
  /** 上次展开宽，点「展开」时回到这里（不低于展开最小宽） */
  const lastExpandedWidth = useRef(Math.max(SIDEBAR_WIDTH, SIDEBAR_EXPANDED_MIN_WIDTH))
  /** 进阅读后还要确认一次：漫画没有目录，书打开后要收回去；用户自己动过侧栏就不再插手 */
  const autoTocSidebarRef = useRef(false)
  const [exitDialog, setExitDialog] = useState<{ to: PageId | null } | null>(null)
  const [readingChrome, setReadingChrome] = useState<ReadingChromeValue | null>(null)
  const flushExitRef = useRef<(() => void) | null>(null)
  const registerFlushExit = useCallback((fn: (() => void) | null) => {
    flushExitRef.current = fn
  }, [])

  /**
   * 进入阅读：文字书目录默认展开，所以先把侧栏展开再开书 ——
   * 若等书打开后再展开，正文会先按收起态的宽度分页，随后重排把页码带偏。
   * 漫画没有目录，等阅读器报来 `showToc: false` 再收起。
   */
  const enterReading = useCallback((target: ReadingTarget) => {
    autoTocSidebarRef.current = true
    setReadingSidebarWidth(clampExpandedSidebarWidth(lastExpandedWidth.current))
    setReading(target)
  }, [])

  // 稳定引用是必须的：target 进了 ReaderPage 开书 effect 的依赖，
  // 每次渲染给一个新对象会让开书 effect 反复重跑，读一次书要重开好几次
  const openBook = useCallback(
    (bookId: string) => {
      enterReading({ bookId, chapterId: null, cfi: null })
    },
    [enterReading]
  )

  const openHit = useCallback(
    (hit: SearchHitWithBook) => {
      collapseBodySearch()
      enterReading({
        bookId: hit.bookId,
        chapterId: hit.chapterId,
        cfi: null,
        excerpt: hit.text
      })
    },
    [collapseBodySearch, enterReading]
  )

  const openAt = useCallback(
    (target: ReadingTarget) => {
      enterReading(target)
    },
    [enterReading]
  )

  const refreshTags = useCallback(async () => {
    setTags(await window.api.library.tagsList())
  }, [])

  const refreshStats = useCallback(async () => {
    setStats(await window.api.library.stats())
  }, [])

  // 进书架页拉一次侧栏汇总；导入 / 删除 / 打标签之后由 onLibraryChanged 再拉
  useEffect(() => {
    if (page === 'library' && !reading) void refreshTags()
  }, [page, reading, refreshTags])

  useEffect(() => {
    if (page === 'library' && !reading) void refreshStats()
  }, [page, reading, refreshStats])

  /** 书库发生变化时，侧栏的标签计数与书库汇总都要重算 */
  const onLibraryChanged = useCallback(async () => {
    await refreshTags()
    await refreshStats()
  }, [refreshTags, refreshStats])

  /** 标签列表里的增删改：除了侧栏本身，书架上的书也要重取一遍 */
  const onTagsChanged = useCallback(async () => {
    await onLibraryChanged()
    setTagRevision((revision) => revision + 1)
  }, [onLibraryChanged])

  // 正在筛的那个标签被删掉时把筛选退回「全部」，否则列表会一直是空的
  useEffect(() => {
    if (tagFilter !== null && !tags.some((tag) => tag.id === tagFilter)) setTagFilter(null)
  }, [tags, tagFilter])

  // 启动时应用已持久化的主题。index.html 里只写了默认亮色，
  // 不做这一步的话「切暗色后重启」会回到亮色。
  useEffect(() => {
    void window.api.settings.getAll().then((all) => {
      const raw = all.prefs
      if (!raw) return
      try {
        const theme = (JSON.parse(raw) as Partial<ReadingPrefs>).theme
        if (theme === 'light' || theme === 'dark') {
          document.documentElement.dataset.theme = theme
        }
      } catch {
        // 偏好损坏时保持 index.html 的默认亮色
      }
    })
  }, [])

  /**
   * 书打开后拿目录的有无做最终判断：漫画没有目录，把侧栏收回图标轨，
   * 不让它白占正文宽度。文字书此时目录已就位，侧栏从进阅读起就是展开的。
   */
  useEffect(() => {
    if (!reading || !autoTocSidebarRef.current || readingChrome === null) return
    autoTocSidebarRef.current = false
    if (!readingChrome.showToc) setReadingSidebarWidth(SIDEBAR_COLLAPSED_WIDTH)
  }, [reading, readingChrome])

  const setSidebarWidth = useCallback((width: number) => {
    autoTocSidebarRef.current = false
    setReadingSidebarWidth(width)
    if (width > SIDEBAR_COLLAPSED_WIDTH) {
      lastExpandedWidth.current = clampExpandedSidebarWidth(width)
    }
  }, [])

  const toggleCollapsed = useCallback(() => {
    autoTocSidebarRef.current = false
    setReadingSidebarWidth((current) => {
      if (current <= SIDEBAR_COLLAPSED_WIDTH) {
        return clampExpandedSidebarWidth(lastExpandedWidth.current)
      }
      lastExpandedWidth.current = clampExpandedSidebarWidth(current)
      return SIDEBAR_COLLAPSED_WIDTH
    })
  }, [])

  /** 收起轨里点「目录」：展开侧栏，目录就在展开态里 */
  const openToc = useCallback(() => {
    autoTocSidebarRef.current = false
    setReadingSidebarWidth((current) =>
      current <= SIDEBAR_COLLAPSED_WIDTH
        ? clampExpandedSidebarWidth(lastExpandedWidth.current)
        : current
    )
  }, [])

  /** 立刻离开阅读并可选切到壳层页（侧栏导航走这条，不弹确认） */
  const leaveReading = useCallback((to: PageId | null) => {
    flushExitRef.current?.()
    autoTocSidebarRef.current = false
    setReading(null)
    setReadingChrome(null)
    flushExitRef.current = null
    if (to !== null) setPage(to)
    setReadingSidebarWidth(SIDEBAR_WIDTH)
    setExitDialog(null)
  }, [])

  /** Esc 等路径仍先确认 */
  const requestExit = useCallback((to: PageId | null) => {
    setExitDialog((current) => (current !== null ? current : { to }))
  }, [])

  /**
   * 阅读中 Esc：查找由 ReaderPage 先关；这里再挡一层 ——
   * 正文浮层展开时先收起，已收起才走离开确认。
   */
  const requestExitFromReader = useCallback(() => {
    if (bodyActive && bodyOpen) {
      collapseBodySearch()
      return
    }
    requestExit(null)
  }, [bodyActive, bodyOpen, collapseBodySearch, requestExit])

  const confirmExit = useCallback(() => {
    if (exitDialog === null) return
    leaveReading(exitDialog.to)
  }, [exitDialog, leaveReading])

  const shellSidebarWidth = reading !== null ? readingSidebarWidth : SIDEBAR_WIDTH

  return (
    <ReadingChromeProvider value={readingChrome}>
      <div className="app">
        {reading === null && <TitleBar />}
        <div className="body">
          <Sidebar
            current={page}
            reading={reading !== null}
            width={shellSidebarWidth}
            onWidthChange={reading !== null ? setSidebarWidth : undefined}
            onToggleCollapsed={reading !== null ? toggleCollapsed : undefined}
            onOpenToc={reading !== null ? openToc : undefined}
            onSelect={(id) => (reading !== null ? leaveReading(id) : setPage(id))}
            tags={reading === null && page === 'library' ? tags : null}
            tagFilter={tagFilter}
            onPickTag={setTagFilter}
            onTagsChanged={onTagsChanged}
            statusFilter={statusFilter}
            onPickStatus={setStatusFilter}
            stats={stats}
          />
          <main className={`content${reading !== null ? ' content--reading' : ''}`}>
            {bodyActive && (
              <LibraryBodySearchOverlay
                query={bodyQuery}
                hits={bodyHits}
                busy={bodyBusy}
                error={bodyError}
                open={bodyOpen}
                page={bodyPage}
                reading={reading !== null}
                onToggle={toggleBodySearch}
                onClose={closeBodySearch}
                onPage={setBodyPage}
                onOpen={openHit}
              />
            )}
            {reading !== null ? (
              <ReaderPage
                bookId={reading.bookId}
                target={reading}
                shellSidebarWidth={shellSidebarWidth}
                exitConfirmOpen={exitDialog !== null}
                onRequestExit={requestExitFromReader}
                registerFlushExit={registerFlushExit}
                onChromeChange={setReadingChrome}
              />
            ) : (
              <>
                {page === 'library' && (
                  <LibraryPage
                    onOpen={openBook}
                    tags={tags}
                    tagFilter={tagFilter}
                    tagRevision={tagRevision}
                    statusFilter={statusFilter}
                    onLibraryChanged={onLibraryChanged}
                    query={libraryQuery}
                    onQuery={setLibraryQuery}
                    onSearchBody={() => void runBodySearch(libraryQuery)}
                    onEscapeSearch={() => {
                      setLibraryQuery('')
                      clearBodySearch()
                    }}
                  />
                )}
                {page === 'track' && (
                  <TrackPage onOpenBook={openBook} onOpenSettings={() => setPage('settings')} />
                )}
                {page === 'notes' && <NotesPage onOpenAt={openAt} />}
                {page === 'settings' && <SettingsPage />}
              </>
            )}
          </main>
        </div>
        {exitDialog !== null && (
          <ExitReadingModal
            to={exitDialog.to}
            onCancel={() => setExitDialog(null)}
            onConfirm={confirmExit}
          />
        )}
      </div>
    </ReadingChromeProvider>
  )
}
