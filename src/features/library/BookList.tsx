import type { BookSummary } from '@shared/types'
import { BookCover } from './BookCover'
import { confirmRemove, progressLabel } from './shelf'

export function BookList({
  books,
  onOpen,
  onRemove,
  onTag,
  onTogglePin
}: {
  books: BookSummary[]
  onOpen: (id: string) => void
  onRemove: (id: string) => void
  /** 打标签的入口交给页面：指派是一个模态框，两套视图共用同它 */
  onTag: (book: BookSummary) => void
  /** 置顶上限的校验在主进程，界面只负责发起与展示失败原因 */
  onTogglePin: (book: BookSummary) => void
}) {
  return (
    <ul className="book-list">
      {books.map((book) => (
        <li key={book.id} className="book-list__item">
          <BookCover book={book} width={40} />
          <button type="button" className="book-list__open" onClick={() => onOpen(book.id)}>
            <span className="book-list__title">
              {book.title}
              {book.pinnedAt !== null && <span className="book-list__pin">置顶</span>}
            </span>
            <span className="book-list__meta">
              {book.author ?? '未知作者'} · {book.chapterCount} 章 ·{' '}
              {Math.round(book.totalChars / 1000)}k 字
            </span>
            {(book.percent > 0 || book.status === 'finished') && (
              <span className="book-list__prog">
                <span className="track">
                  <i
                    className={book.status === 'finished' ? 'is-done' : undefined}
                    style={{ width: `${book.status === 'finished' ? 100 : Math.round(book.percent * 100)}%` }}
                  />
                </span>
                <span>{progressLabel(book)}</span>
              </span>
            )}
          </button>
          <span className="book-list__tags">
            {book.tags.map((tag) => (
              <span key={tag.id} className={`tag-chip tag-chip--${tag.color}`}>
                {tag.name}
              </span>
            ))}
          </span>
          <button
            type="button"
            className="book-list__pin-toggle"
            onClick={() => onTogglePin(book)}
          >
            {book.pinnedAt !== null ? '取消置顶' : '置顶'}
          </button>
          <button type="button" className="book-list__tag-add" onClick={() => onTag(book)}>
            ＋标签
          </button>
          <button type="button" className="btn" onClick={() => onOpen(book.id)}>
            打开
          </button>
          <button
            type="button"
            className="book-list__remove"
            onClick={() => {
              if (confirmRemove(book)) onRemove(book.id)
            }}
          >
            删除
          </button>
        </li>
      ))}
    </ul>
  )
}
