import { useCallback, useEffect, useRef, useState } from 'react'
import type { BookStatus, BookSummary, ImportOutcome, LibrarySort, Tag } from '@shared/types'
import { isBookFile } from '@shared/types'
import { BookGrid } from '../features/library/BookGrid'
import { BookList } from '../features/library/BookList'
import { EmptyShelf } from '../features/library/EmptyShelf'
import { LibraryTitlebarTools } from '../features/library/LibraryTitlebarTools'
import { LibraryToolbar } from '../features/library/LibraryToolbar'
import { TagPicker } from '../features/library/TagPicker'
import { TrackShelf } from '../features/library/TrackShelf'
import { Modal } from '../shell/Modal'
import {
  filterBooks,
  importedBookIds,
  parseGroupBy,
  parseView,
  progressText,
  sortBooks,
  statusLabel,
  type LibraryGroupBy,
  type LibraryView
} from '../features/library/shelf'
import { groupBooksByTrack, type TrackShelfNode } from '../features/library/track-groups'
import { useImport } from '../features/library/useImport'

export function LibraryPage({
  onOpen,
  tags,
  tagFilter,
  tagRevision,
  statusFilter,
  onLibraryChanged,
  query,
  onQuery,
  onSearchBody,
  onEscapeSearch
}: {
  onOpen: (id: string) => void
  tags: Tag[]
  tagFilter: number | null
  /** 侧栏里增删改标签后递增：书卡上的 tag chip 与筛选结果要跟着重取 */
  tagRevision: number
  statusFilter: BookStatus | null
  onLibraryChanged: () => Promise<void>
  /** 书名筛选与正文搜索共用输入；状态在 App，进阅读后回来不丢 */
  query: string
  onQuery: (value: string) => void
  onSearchBody: () => void
  onEscapeSearch: () => void
}) {
  const [books, setBooks] = useState<BookSummary[] | null>(null)
  const [view, setView] = useState<LibraryView>('grid')
  const [groupBy, setGroupBy] = useState<LibraryGroupBy>('list')
  /** null 表示没有 active 脉络；空数组是「有脉络但还没节点」 */
  const [trackNodes, setTrackNodes] = useState<TrackShelfNode[] | null>(null)
  const [sort, setSort] = useState<LibrarySort>('recent')
  const [dropping, setDropping] = useState(false)
  /**
   * 只记 id，不记那本书本身：指派之后要重新拉列表，记对象的话拿到的还是旧快照，
   * 复选框会在改完之后弹回原状。数组同时覆盖「单本指派」与「导入后逐本打标签」。
   */
  const [taggingIds, setTaggingIds] = useState<string[] | null>(null)
  /** 批量打标签时当前进行到第几本；单本指派恒为 0 */
  const [taggingIndex, setTaggingIndex] = useState(0)
  const dragDepth = useRef(0)

  // 拉全量、本地筛标签：导入后要按 id 找回新书并弹出打标签框，
  // 若这里按标签筛选取列表，新书不在结果里就找不到了。
  const refresh = useCallback(async () => {
    setBooks(await window.api.library.list())
  }, [])

  /** 脉络挂载会随导入、打标签之外的改动变化，分节视图要靠它重取 */
  const refreshTrack = useCallback(async () => {
    const active = await window.api.track.getActive()
    if (!active) {
      setTrackNodes(null)
      return
    }
    const list = await window.api.track.listNodes()
    setTrackNodes(
      list.map((node) => ({
        id: node.id,
        parentId: node.parentId,
        title: node.title,
        depth: node.depth,
        sortOrder: node.sortOrder,
        bookIds: node.books.map((book) => book.bookId)
      }))
    )
  }, [])

  /** 手段之后要刷新三处：列表（这里）、脉络分节、侧栏标签计数与书库汇总（在 App 里） */
  const refreshAll = useCallback(async () => {
    await Promise.all([refresh(), refreshTrack()])
    await onLibraryChanged()
  }, [refresh, refreshTrack, onLibraryChanged])

  const { progress, busy, notice, setNotice, run } = useImport(refreshAll)

  useEffect(() => {
    void refresh()
  }, [refresh, tagRevision])

  useEffect(() => {
    void refreshTrack()
  }, [refreshTrack])

  useEffect(() => {
    void window.api.settings.getAll().then((all) => {
      setView(parseView(all['library.view']))
      setGroupBy(parseGroupBy(all['library.groupBy']))
    })
  }, [])

  // 切换标签或状态筛选相当于换了个上下文，指派模态框跟着收起，避免停在旧上下文里
  useEffect(() => {
    setTaggingIds(null)
    setTaggingIndex(0)
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

  function pickGroupBy(next: LibraryGroupBy): void {
    setGroupBy(next)
    void window.api.settings.set('library.groupBy', next)
  }

  /** 导入完成后把新书逐本交给打标签模态框；全是重复导入时什么都不弹 */
  function openTaggingForImport(outcomes: ImportOutcome[] | null): void {
    const ids = importedBookIds(outcomes ?? [])
    if (ids.length > 0) {
      setTaggingIndex(0)
      setTaggingIds(ids)
    }
  }

  function openTaggingForBook(id: string): void {
    setTaggingIndex(0)
    setTaggingIds([id])
  }

  function closeTagging(): void {
    setTaggingIds(null)
    setTaggingIndex(0)
  }

  /** 逐本打标签：当前这本处理完就下一本，最后一本点「完成」收工 */
  function nextTaggingBook(): void {
    if (taggingIds && taggingIndex + 1 >= taggingIds.length) {
      closeTagging()
      return
    }
    setTaggingIndex((index) => index + 1)
  }

  function onPick(): void {
    void run(() => window.api.library.pickAndImport()).then(openTaggingForImport)
  }

  function onPickFolder(): void {
    void run(() => window.api.library.pickFolder()).then(openTaggingForImport)
  }

  async function onDrop(event: React.DragEvent<HTMLDivElement>): Promise<void> {
    event.preventDefault()
    dragDepth.current = 0
    setDropping(false)

    const paths = Array.from(event.dataTransfer.files)
      .map((file) => window.api.library.pathForFile(file))
      .filter((path) => isBookFile(path))

    if (paths.length === 0) {
      setNotice(
        '拖进来的文件里没有可导入的电子书或漫画（EPUB / PDF / TXT / MOBI / AZW3 / FB2 / HTMLZ / CBZ / CBR）'
      )
      return
    }
    openTaggingForImport(await run(() => window.api.library.importPaths(paths)))
  }

  if (!books) return <div className="page-placeholder">加载中…</div>

  const trimmed = query.trim()
  const tagged =
    tagFilter === null
      ? books
      : books.filter((book) => book.tags.some((tag) => tag.id === tagFilter))
  const visible = sortBooks(filterBooks(tagged, { status: statusFilter, query }), sort)
  const title =
    statusFilter !== null
      ? statusLabel(statusFilter)
      : tagFilter !== null
        ? (tags.find((tag) => tag.id === tagFilter)?.name ?? '全部书籍')
        : '全部书籍'
  const pristine =
    books.length === 0 && statusFilter === null && tagFilter === null && trimmed === ''
  // 没有 active 脉络时分组只能是平铺：控件不显示，也不让设置里的旧值把书架卡成空节
  const hasTrack = trackNodes !== null
  const activeGroupBy: LibraryGroupBy = hasTrack ? groupBy : 'list'
  const sections =
    trackNodes !== null && activeGroupBy === 'track'
      ? groupBooksByTrack(
          visible.map((book) => book.id),
          trackNodes
        )
      : null
  // 每轮刷新都从列表里现取，指派完 chip 与复选框一起变。逐本打标签时只取当前这一本。
  const taggingQueue = (taggingIds ?? [])
    .map((id) => books.find((book) => book.id === id))
    .filter((book): book is BookSummary => book !== undefined)
  const taggingBook = taggingQueue[taggingIndex] ?? null
  const taggingTotal = taggingQueue.length

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
        onQuery={onQuery}
        onSearchBody={onSearchBody}
        onEscape={onEscapeSearch}
        busy={busy}
        onPick={onPick}
      />

      <LibraryToolbar
        title={title}
        count={visible.length}
        sort={sort}
        onSort={setSort}
        view={view}
        onView={pickView}
        groupBy={activeGroupBy}
        onGroupBy={pickGroupBy}
        showTrackGroup={hasTrack}
      />

      <div className="library__status" role="status">
        {progress && <span className="import__progress">{progressText(progress)}</span>}
        {notice && <span className="import__notice">{notice}</span>}
      </div>

      {taggingBook && (
        <Modal
          title={
            taggingTotal === 1
              ? `《${taggingBook.title}》的标签`
              : `给新书打标签（${taggingIndex + 1}/${taggingTotal}）`
          }
          onClose={closeTagging}
        >
          {taggingTotal > 1 && (
            <p className="tag-picker__hint">
              《{taggingBook.title}》 · 不勾选直接「下一本」即跳过
            </p>
          )}
          <TagPicker
            key={taggingBook.id}
            book={taggingBook}
            tags={tags}
            onChanged={refreshAll}
          />
          {taggingTotal > 1 && (
            <div className="tag-picker__actions">
              <button type="button" className="btn btn--quiet" onClick={closeTagging}>
                全部跳过
              </button>
              <button type="button" className="btn btn--primary" onClick={nextTaggingBook}>
                {taggingIndex + 1 >= taggingTotal ? '完成' : '下一本'}
              </button>
            </div>
          )}
        </Modal>
      )}

      <div className="library__shelf">
        {pristine ? (
          <EmptyShelf onPick={onPick} onPickFolder={onPickFolder} />
        ) : visible.length === 0 ? (
          <p className="library__empty">
            {trimmed !== '' ? `没有匹配「${trimmed}」的书。` : '这里还没有书。'}
          </p>
        ) : sections ? (
          <TrackShelf
            sections={sections}
            books={visible}
            view={view}
            onOpen={onOpen}
            onRemove={(id) => void window.api.library.remove(id).then(refreshAll)}
            onTag={(book) => openTaggingForBook(book.id)}
          />
        ) : view === 'grid' ? (
          <BookGrid
            books={visible}
            onOpen={onOpen}
            onRemove={(id) => void window.api.library.remove(id).then(refreshAll)}
            onTag={(book) => openTaggingForBook(book.id)}
          />
        ) : (
          <BookList
            books={visible}
            onOpen={onOpen}
            onRemove={(id) => void window.api.library.remove(id).then(refreshAll)}
            onTag={(book) => openTaggingForBook(book.id)}
          />
        )}
      </div>

      {dropping && <div className="library__dropmask">松手即导入</div>}
    </div>
  )
}
