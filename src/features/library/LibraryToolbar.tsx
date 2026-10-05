import type { LibrarySort } from '@shared/types'
import type { LibraryView } from './shelf'

const SORTS: { id: LibrarySort; label: string }[] = [
  { id: 'recent', label: '最近阅读' },
  { id: 'title', label: '书名' },
  { id: 'added', label: '加入时间' }
]

/** 书架舞台栏：左侧当前上下文与计数，右侧排序与视图切换 */
export function LibraryToolbar({
  title,
  count,
  sort,
  onSort,
  view,
  onView
}: {
  title: string
  count: number
  sort: LibrarySort
  onSort: (sort: LibrarySort) => void
  view: LibraryView
  onView: (view: LibraryView) => void
}) {
  return (
    <div className="stage__bar">
      <span className="stage__title">{title}</span>
      <span className="stage__count">{count} 本</span>
      <span className="stage__spacer" />

      <label className="sort">
        <span className="sort__label">排序</span>
        <select
          className="sort__select"
          aria-label="排序"
          value={sort}
          onChange={(event) => onSort(event.target.value as LibrarySort)}
        >
          {SORTS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </label>

      <div className="seg" role="group" aria-label="视图">
        {(['grid', 'list'] as const).map((item) => (
          <button
            key={item}
            type="button"
            className={`seg__b${view === item ? ' is-on' : ''}`}
            aria-pressed={view === item}
            onClick={() => onView(item)}
          >
            {item === 'grid' ? '网格' : '列表'}
          </button>
        ))}
      </div>
    </div>
  )
}