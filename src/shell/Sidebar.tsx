import type { BookStatus, LibraryStats, Tag } from '@shared/types'
import { formatBytes } from '../features/library/shelf'

export type PageId = 'library' | 'notes' | 'settings'

const NAV: { id: PageId; label: string }[] = [
  { id: 'library', label: '书架' },
  { id: 'notes', label: '笔记' },
  { id: 'settings', label: '设置' }
]

/** 书库状态筛选。null 是「全部」，与 tagFilter 的 null 语义一致 */
const STATUSES: { id: BookStatus | null; label: string }[] = [
  { id: null, label: '全部' },
  { id: 'reading', label: '在读' },
  { id: 'finished', label: '已完成' },
  { id: 'unread', label: '未开始' }
]

export function Sidebar({
  current,
  onSelect,
  tags,
  tagFilter,
  onPickTag,
  statusFilter,
  onPickStatus,
  stats
}: {
  current: PageId
  onSelect: (id: PageId) => void
  /** null 表示当前页面没有上下文列表；空数组是「还没建过标签」 */
  tags?: Tag[] | null
  tagFilter?: number | null
  onPickTag?: (tagId: number | null) => void
  statusFilter?: BookStatus | null
  onPickStatus?: (status: BookStatus | null) => void
  stats?: LibraryStats | null
}) {
  const countOf = (status: BookStatus | null): number | null => {
    if (!stats) return null
    if (status === 'reading') return stats.reading
    if (status === 'finished') return stats.finished
    if (status === 'unread') return stats.unread
    return stats.total
  }

  return (
    <nav className="sidebar">
      {NAV.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`nav-item${current === item.id ? ' nav-item--active' : ''}`}
          aria-current={current === item.id ? 'page' : undefined}
          onClick={() => onSelect(item.id)}
        >
          {item.label}
        </button>
      ))}

      {tags ? (
        <div className="sidebar__body">
          <div className="sidebar__section">书库</div>
          <ul className="side-list">
            {STATUSES.map((item) => {
              const count = countOf(item.id)
              return (
                <li key={item.label}>
                  <button
                    type="button"
                    className={`side-item${statusFilter === item.id ? ' is-on' : ''}`}
                    onClick={() => onPickStatus?.(item.id)}
                  >
                    <span className="side-item__name">{item.label}</span>
                    {count !== null && <span className="side-item__count">{count}</span>}
                  </button>
                </li>
              )
            })}
          </ul>

          <div className="sidebar__section">标签</div>
          <ul className="side-list">
            <li>
              <button
                type="button"
                className={`tag-item${tagFilter === null ? ' tag-item--active' : ''}`}
                onClick={() => onPickTag?.(null)}
              >
                <span className="tag-item__name">全部</span>
              </button>
            </li>
            {tags.map((tag) => (
              <li key={tag.id}>
                <button
                  type="button"
                  className={`tag-item${tagFilter === tag.id ? ' tag-item--active' : ''}`}
                  onClick={() => onPickTag?.(tag.id)}
                >
                  <span className={`tag-dot tag-dot--${tag.color}`} />
                  <span className="tag-item__name">{tag.name}</span>
                  <span className="tag-item__count">{tag.bookCount}</span>
                </button>
              </li>
            ))}
          </ul>

          {tags.length === 0 && <p className="sidebar__hint">还没有标签</p>}
        </div>
      ) : null}

      {tags ? (
        <div className="sidebar__foot">
          <b>本地书库</b>
          <br />
          {stats ? `${stats.total} 本 · ${formatBytes(stats.bytes)}` : '读取中…'}
          <br />
          书籍与笔记只存在这台电脑上
        </div>
      ) : null}
    </nav>
  )
}