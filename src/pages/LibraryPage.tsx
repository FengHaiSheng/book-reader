import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  BookStatus,
  BookSummary,
  LibrarySort,
  ReadingTarget,
  SearchHitWithBook,
  Tag
} from '@shared/types'
import { isBookFile } from '@shared/types'
import { BookGrid } from '../features/library/BookGrid'
import { BookList } from '../features/library/BookList'
import { EmptyShelf } from '../features/library/EmptyShelf'
import { LibrarySearchResults } from '../features/library/LibrarySearchResults'
import { LibraryTitlebarTools } from '../features/library/LibraryTitlebarTools'
import { LibraryToolbar } from '../features/library/LibraryToolbar'
import { TagManager } from '../features/library/TagManager'
import { TagPicker } from '../features/library/TagPicker'
import { Modal } from '../shell/Modal'
import { isSearchableQuery } from '../features/reader/search'
import {
  filterBooks,
  parseView,
  progressText,
  sortBooks,
  statusLabel,
  type LibraryView
} from '../features/library/shelf'
import { useImport } from '../features/library/useImport'

/** 与主进程 searchAllChunks 的默认 LIMIT 一致；界面据此说明结果被截断 */
const BODY_LIMIT = 60

export function LibraryPage({
  onOpen,
  onOpenAt,
  tags,
  tagFilter,
  statusFilter,
  onLibraryChanged
}: {
  onOpen: (id: string) => void
  /** 打开一条跨书搜索命中：走摘录定位，与「从书架点书」是两条路 */
  onOpenAt: (target: ReadingTarget) => void
  tags: Tag[]
  tagFilter: number | null
  statusFilter: BookStatus | null
  onLibraryChanged: () => Promise<void>
}) {
  const [books, setBooks] = useState<BookSummary[] | null>(null)
  const [view, setView] = useState<LibraryView>('grid')
  const [query, setQuery] = useState('')
  /** 全库正文搜索自成一摊，与书名筛选的 query 无关：query 逐字过滤书名、零 IPC */
  const [bodyQuery, setBodyQuery] = useState('')
  const [bodyHits, setBodyHits] = useState<SearchHitWithBook[]>([])
  const [bodyBusy, setBodyBusy] = useState(false)
  const [bodyError, setBodyError] = useState<string | null>(null)
  const [bodyOpen, setBodyOpen] = useState(false)
  const [sort, setSort] = useState<LibrarySort>('recent')
  const [dropping, setDropping] = useState(false)
  const [managing, setManaging] = useState(false)
  /**
   * 只记 id，不记那本书本身：指派之后要重新拉列表，记对象的话拿到的还是旧快照，
   * 复选框会在改完之后弹回原状。
   */
  const [taggingId, setTaggingId] = useState<string | null>(null)
  const dragDepth = useRef(0)

  const refresh = useCallback(async () => {
    setBooks(await window.api.library.list(tagFilter))
  }, [tagFilter])

  /** 手段之后要刷新三处：列表（这里）、侧栏标签计数与书库汇总（在 App 里） */
  const refreshAll = useCallback(async () => {
    await refresh()
    await onLibraryChanged()
  }, [refresh, onLibraryChanged])

  const { progress, busy, notice, setNotice, run } = useImport(refreshAll)

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    void window.api.settings.getAll().then((all) => setView(parseView(all['library.view'])))
  }, [])

  // 切换标签或状态筛选相当于换了个上下文，模态框跟着收起，避免停在旧上下文里
  useEffect(() => {
    setManaging(false)
    setTaggingId(null)
  }, [tagFilter, statusFilter])

  /*
   * 必须挡住窗口级的 dragover / drop 默认行为：不挡的话，文件掉进窗口时
   * Chromium 会直接导航到 file://，整个应用界面被替换成那张文件列表。
   */
  useEffect(() => {
    const block = (event: DragEvent): void => event.preventDefault()
    window.addEventListener('dragover', block)
    window.addEventListener('drop', block)
    return () => {
      window.removeEventListener('dragover', block)
      window.removeEventListener('drop', block)
    }
  }, [])

  function pickView(next: LibraryView): void {
    setView(next)
    void window.api.settings.set('library.view', next)
  }

  function onPick(): void {
    void run(() => window.api.library.pickAndImport())
  }

  function onPickFolder(): void {
    void run(() => window.api.library.pickFolder())
  }

  /**
   * 全库跨书搜索：只在显式触发（回车 / 点「搜正文」）时发一次 FTS，
   * 关键词取书名筛选框里的当前文本 —— 输入本身依旧只过滤书名，一个 IPC 都不发。
   */
  async function runBodySearch(): Promise<void> {
    const keyword = query.trim()

    // 纯标点 / 空白切不出 token，查了必然是空 —— 与书内查找同一口径，先拦下来说明原因
    if (!isSearchableQuery(keyword)) {
      setBodyBusy(false)
      setBodyHits([])
      setBodyQuery('')
      setBodyOpen(false)
      setBodyError('关键词里没有可检索的字符（标点与空白切不出词）。')
      return
    }

    setBodyBusy(true)
    setBodyError(null)
    try {
      const hits = await window.api.library.searchAll(keyword, BODY_LIMIT)
      setBodyHits(hits)
      setBodyQuery(keyword)
      setBodyOpen(true)
    } catch (e) {
      // 请求本身失败与「正文里没找到」是两回事，都要说清楚，不静默降级
      setBodyError(e instanceof Error ? e.message : String(e))
    } finally {
      setBodyBusy(false)
    }
  }

  /** Escape：书名筛选与正文结果一起清掉 */
  function clearSearch(): void {
    setQuery('')
    setBodyQuery('')
    setBodyHits([])
    setBodyError(null)
    setBodyOpen(false)
    setBodyBusy(false)
  }

  async function onDrop(event: React.DragEvent<HTMLDivElement>): Promise<void> {
    event.preventDefault()
    dragDepth.current = 0
    setDropping(false)

    const paths = Array.from(event.dataTransfer.files)
      .map((file) => window.api.library.pathForFile(file))
      .filter((path) => isBookFile(path))

    if (paths.length === 0) {
      setNotice('拖进来的文件里没有 .epub 或 .pdf')
      return
    }
    await run(() => window.api.library.importPaths(paths))
  }

  if (!books) return <div className="page-placeholder">加载中…</div>

  const trimmed = query.trim()
  const visible = sortBooks(filterBooks(books, { status: statusFilter, query }), sort)
  const title =
    statusFilter !== null
      ? statusLabel(statusFilter)
      : tagFilter !== null
        ? (tags.find((tag) => tag.id === tagFilter)?.name ?? '全部书籍')
        : '全部书籍'
  const pristine =
    books.length === 0 && statusFilter === null && tagFilter === null && trimmed === ''
  // 每轮刷新都从列表里现取，指派完 chip 与复选框一起变
  const tagging = taggingId === null ? null : (books.find((book) => book.id === taggingId) ?? null)

  return (
    <div
      className={`library${dropping ? ' library--dropping' : ''}`}
      onDragEnter={(event) => {
        event.preventDefault()
        dragDepth.current += 1
        setDropping(true)
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => {
        // dragleave 会在子元素之间来回冒泡，靠计数判断是不是真的离开了这一页
        dragDepth.current -= 1
        if (dragDepth.current <= 0) setDropping(false)
      }}
      onDrop={(event) => void onDrop(event)}
    >
      <LibraryTitlebarTools
        query={query}
        onQuery={setQuery}
        onSearchBody={() => void runBodySearch()}
        onEscape={clearSearch}
        busy={busy}
        onPick={onPick}
        managing={managing}
        onToggleTags={() => setManaging(!managing)}
      />

      <LibraryToolbar
        title={title}
        count={visible.length}
        sort={sort}
        onSort={setSort}
        view={view}
        onView={pickView}
      />

      {(bodyQuery !== '' || bodyBusy || bodyError !== null) && (
        <LibrarySearchResults
          query={bodyQuery}
          hits={bodyHits}
          busy={bodyBusy}
          error={bodyError}
          open={bodyOpen}
          onToggle={() => setBodyOpen(!bodyOpen)}
          onOpen={(hit) =>
            onOpenAt({
              bookId: hit.bookId,
              chapterId: hit.chapterId,
              cfi: null,
              excerpt: hit.text
            })
          }
        />
      )}

      <div className="library__status" role="status">
        {progress && <span className="import__progress">{progressText(progress)}</span>}
        {notice && <span className="import__notice">{notice}</span>}
      </div>

      {managing && (
        <Modal title="标签" onClose={() => setManaging(false)}>
          <TagManager tags={tags} onChanged={refreshAll} />
        </Modal>
      )}

      {tagging && (
        <Modal title={`《${tagging.title}》的标签`} onClose={() => setTaggingId(null)}>
          <TagPicker book={tagging} tags={tags} onChanged={refreshAll} />
        </Modal>
      )}

      <div className="library__shelf">
        {pristine ? (
          <EmptyShelf onPick={onPick} onPickFolder={onPickFolder} />
        ) : visible.length === 0 ? (
          <p className="library__empty">
            {trimmed !== '' ? `没有匹配「${trimmed}」的书。` : '这里还没有书。'}
          </p>
        ) : view === 'grid' ? (
          <BookGrid
            books={visible}
            onOpen={onOpen}
            onRemove={(id) => void window.api.library.remove(id).then(refreshAll)}
            onTag={(book) => setTaggingId(book.id)}
          />
        ) : (
          <BookList
            books={visible}
            onOpen={onOpen}
            onRemove={(id) => void window.api.library.remove(id).then(refreshAll)}
            onTag={(book) => setTaggingId(book.id)}
          />
        )}
      </div>

      {dropping && <div className="library__dropmask">松手即导入</div>}
    </div>
  )
}