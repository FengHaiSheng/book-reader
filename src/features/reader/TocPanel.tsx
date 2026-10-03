import type { ReaderChapter } from '@shared/types'

/**
 * 本书目录（阅读器左栏）。
 *
 * 缩进用 `depth` 而不是树形递归：计划 02 的 `buildChapters` 已经把层级压平并带上了 depth，
 * 这里再建一次树等于把同一件事做两遍。
 *
 * 分组节点（`href` 为空，代表「部/卷」）不可点：它们没有正文可去，
 * 做成可点会让用户点了没反应，比置灰更糟。
 */
export function TocPanel({
  chapters,
  currentId,
  onSelect
}: {
  chapters: ReaderChapter[]
  currentId: number | null
  onSelect: (chapterId: number) => void
}) {
  return (
    <nav className="toc" aria-label="本书目录">
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
    </nav>
  )
}
