import { useState } from 'react'
import type { Bookmark, ReaderChapter } from '@shared/types'
import { BookmarkList } from './BookmarkList'

type TocTab = 'toc' | 'marks'

/**
 * 本书目录（阅读器左栏）。
 *
 * 缩进用 `depth` 而不是树形递归：计划 02 的 `buildChapters` 已经把层级压平并带上了 depth，
 * 这里再建一次树等于把同一件事做两遍。
 *
 * 分组节点（`href` 为空，代表「部/卷」）不可点：它们没有正文可去，
 * 做成可点会让用户点了没反应，比置灰更糟。
 *
 * 页签只切内容，不改宽度 —— 所以 `computeLayout` 那一套一个字都不用动。
 */
export function TocPanel({
  chapters,
  currentId,
  onSelect,
  marks,
  currentMark,
  onAddMark,
  onRemoveMark,
  onSelectMark
}: {
  chapters: ReaderChapter[]
  currentId: number | null
  onSelect: (chapterId: number) => void
  marks: readonly Bookmark[]
  /** 当前这一页已有的书签；没有就传 null */
  currentMark: Bookmark | null
  onAddMark: () => void
  onRemoveMark: (id: number) => void
  onSelectMark: (bookmark: Bookmark) => void
}) {
  const [tab, setTab] = useState<TocTab>('toc')

  return (
    <nav className="toc" aria-label="本书目录与书签">
      <div className="toc__tabs">
        <button
          type="button"
          className={`toc__tab${tab === 'toc' ? ' toc__tab--on' : ''}`}
          aria-pressed={tab === 'toc'}
          onClick={() => setTab('toc')}
        >
          目录
        </button>
        <button
          type="button"
          className={`toc__tab${tab === 'marks' ? ' toc__tab--on' : ''}`}
          aria-pressed={tab === 'marks'}
          onClick={() => setTab('marks')}
        >
          书签{marks.length > 0 && <span className="toc__tab-n">{marks.length}</span>}
        </button>
      </div>

      <div className="toc__pane">
        {tab === 'toc' ? (
          <ul className="toc__list">
            {chapters.map((chapter) => {
              const grouped = chapter.href === ''
              const reading = chapter.id === currentId
              return (
                <li key={chapter.id}>
                  <button
                    type="button"
                    className={`toc__item${reading ? ' toc__item--active' : ''}${
                      grouped ? ' toc__item--group' : ''
                    }`}
                    style={{ paddingLeft: 12 + chapter.depth * 12 }}
                    aria-current={reading ? 'location' : undefined}
                    disabled={grouped}
                    onClick={() => onSelect(chapter.id)}
                  >
                    {chapter.title}
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <BookmarkList
            bookmarks={marks}
            current={currentMark}
            onAdd={onAddMark}
            onRemove={onRemoveMark}
            onSelect={onSelectMark}
          />
        )}
      </div>
    </nav>
  )
}
