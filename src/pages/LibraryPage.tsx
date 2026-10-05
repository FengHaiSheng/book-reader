import { useCallback, useEffect, useRef, useState } from 'react'
import type { BookStatus, BookSummary, LibrarySort, Tag } from '@shared/types'
import { BookGrid } from '../features/library/BookGrid'
import { BookList } from '../features/library/BookList'
import { EmptyShelf } from '../features/library/EmptyShelf'
import { LibraryTitlebarTools } from '../features/library/LibraryTitlebarTools'
import { LibraryToolbar } from '../features/library/LibraryToolbar'
import { TagManager } from '../features/library/TagManager'
import {
  filterBooks,
  parseView,
  progressText,
  sortBooks,
  statusLabel,
  type LibraryView
} from '../features/library/shelf'
import { useImport } from '../features/library/useImport'

export function LibraryPage({
  onOpen,
  tags,
  tagFilter,
  statusFilter,
  onLibraryChanged
}: {
  onOpen: (id: string) => void
  tags: Tag[]
  tagFilter: number | null
  statusFilter: BookStatus | null
  onLibraryChanged: () => Promise<void>
}) {
  const [books, setBooks] = useState<BookSummary[] | null>(null)
  const [view, setView] = useState<LibraryView>('grid')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<LibrarySort>('recent')
  const [dropping, setDropping] = useState(false)
  const [managing, setManaging] = useState(false)
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

  // 切换标签或状态筛选相当于换了个上下文，管理面板跟着收起，避免停在旧上下文里
  useEffect(() => {
    setManaging(false)
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

  async function onDrop(event: React.DragEvent<HTMLDivElement>): Promise<void> {
    event.preventDefault()
    dragDepth.current = 0
    setDropping(false)

    const paths = Array.from(event.dataTransfer.files)
      .map((file) => window.api.library.pathForFile(file))
      .filter((path) => path.toLowerCase().endsWith('.epub'))

    if (paths.length === 0) {
      setNotice('拖进来的文件里没有 .epub')
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

      <div className="library__status" role="status">
        {progress && <span className="import__progress">{progressText(progress)}</span>}
        {notice && <span className="import__notice">{notice}</span>}
      </div>

      {managing && <TagManager tags={tags} onChanged={refreshAll} />}

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
          />
        ) : (
          <BookList
            books={visible}
            tags={tags}
            onOpen={onOpen}
            onRemove={(id) => void window.api.library.remove(id).then(refreshAll)}
            onTagsChanged={refreshAll}
          />
        )}
      </div>

      {dropping && <div className="library__dropmask">松手即导入</div>}
    </div>
  )
}