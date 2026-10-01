import type { BookSummary } from '@shared/types'

export function BookList({ books, onRemove }: { books: BookSummary[]; onRemove: (id: string) => void }) {
  if (books.length === 0) {
    return <p className="library__empty">书架还是空的。导入的 epub 只保存在这台电脑上，不会上传。</p>
  }

  return (
    <ul className="book-list">
      {books.map((book) => (
        <li key={book.id} className="book-list__item">
          <div className="book-list__main">
            <span className="book-list__title">{book.title}</span>
            <span className="book-list__meta">
              {book.author ?? '未知作者'} · {book.chapterCount} 章 ·{' '}
              {Math.round(book.totalChars / 1000)}k 字
            </span>
          </div>
          <button
            type="button"
            className="book-list__remove"
            onClick={() => {
              // 笔记与高亮会一起删除，这里必须说清楚
              if (window.confirm(`删除《${book.title}》？笔记与高亮会一起删除，不可恢复。`)) {
                onRemove(book.id)
              }
            }}
          >
            删除
          </button>
        </li>
      ))}
    </ul>
  )
}
