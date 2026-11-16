import type { BookSummary } from '@shared/types'
import { BookGrid } from './BookGrid'
import { BookList } from './BookList'
import type { LibraryView } from './shelf'
import type { TrackShelfSection } from './track-groups'

/**
 * 按脉络分节的书架。每节复用网格 / 列表卡片，空节点也保留一行标题，
 * 让「这里还没挂书」这件事可见。未归类节只在有书时由纯函数追加。
 */
export function TrackShelf({
  sections,
  books,
  view,
  onOpen,
  onRemove,
  onTag
}: {
  sections: readonly TrackShelfSection[]
  books: readonly BookSummary[]
  view: LibraryView
  onOpen: (id: string) => void
  onRemove: (id: string) => void
  onTag: (book: BookSummary) => void
}) {
  const byId = new Map(books.map((book) => [book.id, book]))
  return (
    <div className="track-shelf">
      {sections.map((section) => {
        const list = section.bookIds
          .map((id) => byId.get(id))
          .filter((book): book is BookSummary => book !== undefined)
        return (
          <section
            key={section.nodeId ?? 'untracked'}
            className={`track-shelf__section${section.nodeId === null ? ' is-untracked' : ''}`}
            aria-label={section.title}
          >
            <h3
              className="track-shelf__title"
              style={
                section.nodeId === null
                  ? undefined
                  : { paddingLeft: `${Math.max(0, section.depth - 1) * 12}px` }
              }
            >
              {section.title}
            </h3>
            {list.length === 0 ? (
              <p className="track-shelf__empty">暂无挂书</p>
            ) : view === 'grid' ? (
              <BookGrid
                books={list}
                showDrop={false}
                onOpen={onOpen}
                onRemove={onRemove}
                onTag={onTag}
              />
            ) : (
              <BookList books={list} onOpen={onOpen} onRemove={onRemove} onTag={onTag} />
            )}
          </section>
        )
      })}
    </div>
  )
}
