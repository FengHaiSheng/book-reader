import { useState } from 'react'
import { coverUrl } from '@shared/epub'
import type { BookSummary } from '@shared/types'

/**
 * 真实装帧：封面图 + 书脊 + 投影（spec §4.5）。
 *
 * 封面缺失、或者文件坏了（`coverPath` 有值但图读不出来）都退化成一本书名的
 * 素面——不画一个假的封面图，那只会让人以为书库里有张图坏了。
 * `loading="lazy"` 是关键：书库上限按 500 本算，不懒加载会把几百张封面一起拉起来。
 */
export function BookCover({
  book,
  width,
  fill = false
}: {
  book: BookSummary
  width: number
  /** 网格卡片里封面撑满列宽，保持 2:3 比例 */
  fill?: boolean
}) {
  const [broken, setBroken] = useState(false)
  const size = fill
    ? { width: '100%', aspectRatio: '2 / 3' }
    : { width, height: Math.round(width * 1.45) }

  return (
    <span className="book-cover" style={size} aria-hidden="true">
      {book.coverPath !== null && !broken ? (
        <img
          className="book-cover__img"
          src={coverUrl(book.id)}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
        />
      ) : (
        <span className="book-cover__blank">
          <span className="book-cover__blank-title">{book.title}</span>
        </span>
      )}
      <span className="book-cover__spine" />
    </span>
  )
}