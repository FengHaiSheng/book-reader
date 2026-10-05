import { useState } from 'react'
import type { BookSummary, Tag } from '@shared/types'
import { BookCover } from './BookCover'
import { TagPicker } from './TagPicker'
import { confirmRemove, progressLabel } from './shelf'

export function BookList({
  books,
  tags,
  onOpen,
  onRemove,
  onTagsChanged
}: {
  books: BookSummary[]
  tags: Tag[]
  onOpen: (id: string) => void
  onRemove: (id: string) => void
  onTagsChanged: () => Promise<void>
}) {
  const [picking, setPicking] = useState<string | null>(null)
  return (
    <ul className="book-list">
      {books.map((book) => (
        <li key={book.id} className="book-list__item">
          <BookCover book={book} width={40} />
          <button type="button" className="book-list__open" onClick={() => onOpen(book.id)}>
            <span className="book-list__title">{book.title}</span>
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
            className="book-list__tag-add"
            aria-expanded={picking === book.id}
            onClick={() => setPicking(book.id)}
          >
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
          {picking === book.id && (
            <>
              <span className="tag-picker__scrim" onClick={() => setPicking(null)} />
              <TagPicker
                book={book}
                tags={tags}
                onChanged={onTagsChanged}
                onClose={() => setPicking(null)}
              />
            </>
          )}
        </li>
      ))}
    </ul>
  )
}
