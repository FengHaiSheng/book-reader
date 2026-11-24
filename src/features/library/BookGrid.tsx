import type { BookSummary } from '@shared/types'
import { BookCover } from './BookCover'
import {
  BOOK_CARD_RING_C,
  BOOK_CARD_RING_R,
  bookCardProgress,
  bookCardRingOffset,
  confirmRemove,
  ctaLabel
} from './shelf'

/**
 * 网格用 auto-fill 自适应列数（spec §4.5），列宽由 CSS 定，这里只负责结构。
 * 末尾永远留一个拖放终点：它让「拖到书架上」这件事有个明确的目标，
 * 空白区域的虚线框比整页任意位置都能放更好理解。
 *
 * 进度在封面右下角；「继续阅读 / ＋标签 / 删除」收在封面正中一层，悬停才显。
 * 封面打开与动作按钮拆开，避免 button 套 button。
 */
export function BookGrid({
  books,
  onOpen,
  onRemove,
  onTag,
  onTogglePin,
  showDrop = true
}: {
  books: BookSummary[]
  onOpen: (id: string) => void
  onRemove: (id: string) => void
  /** 打标签的入口交给页面：指派是一个模态框，两套视图共用同它 */
  onTag: (book: BookSummary) => void
  /** 置顶上限的校验在主进程，界面只负责发起与展示失败原因 */
  onTogglePin: (book: BookSummary) => void
  /** 按脉络分节时每节都渲染网格，只在平铺书架保留一个拖放终点 */
  showDrop?: boolean
}) {
  return (
    <ul className="book-grid">
      {books.map((book) => {
        const progress = bookCardProgress(book)
        return (
          <li key={book.id} className="book-grid__cell">
            <div className="book-card">
              <div className="book-card__frame">
                <button
                  type="button"
                  className="book-card__open"
                  onClick={() => onOpen(book.id)}
                  aria-label={`打开《${book.title}》`}
                >
                  <span className="book-card__cover-wrap">
                    <BookCover book={book} width={132} fill />
                    {book.pinnedAt !== null && (
                      <span className="book-card__pin" aria-label="已置顶">
                        置顶
                      </span>
                    )}
                    {progress.visible && (
                      <span
                        className={`book-card__ring${progress.done ? ' is-done' : ''}`}
                        aria-label={`已读 ${progress.pct}%`}
                      >
                        <svg viewBox="0 0 30 30" width="30" height="30" aria-hidden="true">
                          <circle className="book-card__ring-track" cx="15" cy="15" r={BOOK_CARD_RING_R} />
                          <circle
                            className="book-card__ring-value"
                            cx="15"
                            cy="15"
                            r={BOOK_CARD_RING_R}
                            strokeDasharray={BOOK_CARD_RING_C}
                            strokeDashoffset={bookCardRingOffset(progress.pct)}
                          />
                        </svg>
                        <span className="book-card__ring-num">{progress.pct}</span>
                      </span>
                    )}
                  </span>
                </button>
                <div className="book-card__hover">
                  <button
                    type="button"
                    className="book-card__cta"
                    onClick={() => onOpen(book.id)}
                  >
                    {ctaLabel(book)}
                  </button>
                  <span className="book-card__acts">
                    <button
                      type="button"
                      className="book-card__pin-toggle"
                      onClick={(event) => {
                        // 置顶后卡片会跳到最前面。按钮若留着焦点，:focus-within 会让
                        // 悬停菜单跟着卡片一直亮着，所以点完先失焦。
                        event.currentTarget.blur()
                        onTogglePin(book)
                      }}
                    >
                      {book.pinnedAt !== null ? '取消置顶' : '置顶'}
                    </button>
                    <button type="button" className="book-card__tag-add" onClick={() => onTag(book)}>
                      ＋标签
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
                  </span>
                </div>
              </div>
              <button type="button" className="book-card__info" onClick={() => onOpen(book.id)}>
                <span className="book-card__title">{book.title}</span>
                <span className="book-card__meta">{book.author ?? '未知作者'}</span>
                <span className="book-card__tags">
                  {book.tags.map((tag) => (
                    <span key={tag.id} className={`tag-chip tag-chip--${tag.color}`}>
                      {tag.name}
                    </span>
                  ))}
                </span>
              </button>
            </div>
          </li>
        )
      })}
      {showDrop && <li className="book-grid__cell book-grid__drop" aria-label="拖电子书到这里" />}
    </ul>
  )
}
