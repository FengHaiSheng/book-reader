import type { BookSummary } from '@shared/types'
import { BookCover } from './BookCover'
import { confirmRemove, ctaLabel, progressLabel } from './shelf'

/**
 * 网格用 auto-fill 自适应列数（spec §4.5），列宽由 CSS 定，这里只负责结构。
 * 末尾永远留一个拖放终点：它让「拖到书架上」这件事有个明确的目标，
 * 空白区域的虚线框比整页任意位置都能放更好理解。
 */
export function BookGrid({
  books,
  onOpen,
  onRemove
}: {
  books: BookSummary[]
  onOpen: (id: string) => void
  onRemove: (id: string) => void
}) {
  return (
    <ul className="book-grid">
      {books.map((book) => (
        <li key={book.id} className="book-grid__cell">
          <button type="button" className="book-card" onClick={() => onOpen(book.id)}>
            <span className="book-card__frame">
              <BookCover book={book} width={132} fill />
              <span className="book-card__cta" aria-hidden="true">
                {ctaLabel(book)}
              </span>
            </span>
            <span className="book-card__title">{book.title}</span>
            <span className="book-card__meta">{book.author ?? '未知作者'}</span>
            {(book.percent > 0 || book.status === 'finished') && (
              <span className="book-card__prog">
                <span className="track">
                  <i
                    className={book.status === 'finished' ? 'is-done' : undefined}
                    style={{ width: `${book.status === 'finished' ? 100 : Math.round(book.percent * 100)}%` }}
                  />
                </span>
                <span className="book-card__prog-text">{progressLabel(book)}</span>
              </span>
            )}
          </button>
          <button
            type="button"
            className="book-card__remove"
            onClick={() => {
              if (confirmRemove(book)) onRemove(book.id)
            }}
          >
            删除
          </button>
        </li>
      ))}
      <li className="book-grid__cell book-grid__drop">拖 epub 到这里</li>
    </ul>
  )
}