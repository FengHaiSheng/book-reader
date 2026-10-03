import { KIND_LABELS, type BookOption, type NoteCounts, type NotesKind } from './group'

const KINDS: NotesKind[] = ['all', 'marked', 'annotated']

export function NotesFilters({
  counts,
  books,
  kind,
  bookId,
  onKind,
  onBook
}: {
  counts: NoteCounts
  books: BookOption[]
  kind: NotesKind
  bookId: string | null
  onKind: (kind: NotesKind) => void
  onBook: (bookId: string | null) => void
}) {
  return (
    <nav className="notes-side" aria-label="笔记筛选">
      <div className="notes-side__section">类型</div>
      <ul className="notes-side__list">
        {KINDS.map((item) => (
          <li key={item}>
            <button
              type="button"
              className={`notes-side__item${kind === item ? ' is-on' : ''}`}
              aria-pressed={kind === item}
              onClick={() => onKind(item)}
            >
              <span className="notes-side__label">{KIND_LABELS[item]}</span>
              <span className="notes-side__count">{counts[item]}</span>
            </button>
          </li>
        ))}
      </ul>

      <div className="notes-side__section">按书</div>
      <ul className="notes-side__list">
        <li>
          <button
            type="button"
            className={`notes-side__item${bookId === null ? ' is-on' : ''}`}
            aria-pressed={bookId === null}
            onClick={() => onBook(null)}
          >
            <span className="notes-side__label">全部书籍</span>
            <span className="notes-side__count">{books.reduce((sum, b) => sum + b.count, 0)}</span>
          </button>
        </li>
        {books.map((book) => (
          <li key={book.bookId}>
            <button
              type="button"
              className={`notes-side__item${bookId === book.bookId ? ' is-on' : ''}`}
              aria-pressed={bookId === book.bookId}
              title={book.bookTitle}
              onClick={() => onBook(book.bookId)}
            >
              <span className="notes-side__label">{book.bookTitle}</span>
              <span className="notes-side__count">{book.count}</span>
            </button>
          </li>
        ))}
      </ul>

      <div className="notes-side__foot">
        笔记存在本地 SQLite 数据库里，随书一起备份，不联网同步。
      </div>
    </nav>
  )
}
