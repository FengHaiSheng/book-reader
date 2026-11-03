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
import { ReaderPage } from './features/reader/ReaderPage'
import { LibraryBodySearchOverlay } from './features/library/LibraryBodySearchOverlay'
import { useBodySearch } from './features/library/useBodySearch'
import './styles/base.css'

export default function App() {
  const [page, setPage] = useState<PageId>('library')
  const [reading, setReading] = useState<ReadingTarget | null>(null)
  const [tags, setTags] = useState<Tag[]>([])
  const [tagFilter, setTagFilter] = useState<number | null>(null)
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
  /** 阅读侧栏宽度；进入阅读收成图标轨，可拖宽；退出恢复默认展开宽 */
  const [readingSidebarWidth, setReadingSidebarWidth] = useState(SIDEBAR_COLLAPSED_WIDTH)
  /** 上次展开宽，点「展开」时回到这里（不低于展开最小宽） */
  const lastExpandedWidth = useRef(Math.max(SIDEBAR_WIDTH, SIDEBAR_EXPANDED_MIN_WIDTH))
  const [exitDialog, setExitDialog] = useState<{ to: PageId | null } | null>(null)
  const [readingChrome, setReadingChrome] = useState<ReadingChromeValue | null>(null)
  const flushExitRef = useRef<(() => void) | null>(null)
  const registerFlushExit = useCallback((fn: (() => void) | null) => {
    flushExitRef.current = fn
  }, [])

  // 稳定引用是必须的：target 进了 ReaderPage 开书 effect 的依赖，
  // 每次渲染给一个新对象会让开书 effect 反复重跑，读一次书要重开好几次
  const openBook = useCallback((bookId: string) => {
    setReading({ bookId, chapterId: null, cfi: null })
  }, [])

  const openHit = useCallback(
    (hit: SearchHitWithBook) => {
      collapseBodySearch()
      setReading({
        bookId: hit.bookId,
        chapterId: hit.chapterId,
        cfi: null,
        excerpt: hit.text
      })
    },
    [collapseBodySearch]
  )

  const openAt = useCallback((target: ReadingTarget) => {
    setReading(target)
  }, [])

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

  // 进入阅读自动收成图标轨
  useEffect(() => {
    if (reading) setReadingSidebarWidth(SIDEBAR_COLLAPSED_WIDTH)
  }, [reading])

  const setSidebarWidth = useCallback((width: number) => {
    setReadingSidebarWidth(width)
    if (width > SIDEBAR_COLLAPSED_WIDTH) {
      lastExpandedWidth.current = clampExpandedSidebarWidth(width)
    }
  }, [])

  const toggleCollapsed = useCallback(() => {
    setReadingSidebarWidth((current) => {
      if (current <= SIDEBAR_COLLAPSED_WIDTH) {
        return clampExpandedSidebarWidth(lastExpandedWidth.current)
      }
      lastExpandedWidth.current = clampExpandedSidebarWidth(current)
      return SIDEBAR_COLLAPSED_WIDTH
    })
  }, [])

  /** 立刻离开阅读并可选切到壳层页（侧栏三项走这条，不弹确认） */
  const leaveReading = useCallback((to: PageId | null) => {
    flushExitRef.current?.()
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
            onSelect={(id) => (reading !== null ? leaveReading(id) : setPage(id))}
            tags={reading === null && page === 'library' ? tags : null}
            tagFilter={tagFilter}
            onPickTag={setTagFilter}
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
