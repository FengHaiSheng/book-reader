import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react'
import type { BookStatus, LibraryStats, Tag } from '@shared/types'
import { formatBytes } from '../features/library/shelf'
import { TocPanel } from '../features/reader/TocPanel'
import { IS_MAC, SIDEBAR_PAD_TOP } from '../features/reader/chrome'
import {
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_EXPANDED_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
  clampSidebarWidth
} from './sidebarWidth'
import { useReadingChrome } from './ReadingChromeContext'

export type PageId = 'library' | 'notes' | 'settings'

const NAV: { id: PageId; label: string; icon: 'library' | 'notes' | 'settings' }[] = [
  { id: 'library', label: '书架', icon: 'library' },
  { id: 'notes', label: '笔记', icon: 'notes' },
  { id: 'settings', label: '设置', icon: 'settings' }
]

/** 书库状态筛选。null 是「全部」，与 tagFilter 的 null 语义一致 */
const STATUSES: { id: BookStatus | null; label: string }[] = [
  { id: null, label: '全部' },
  { id: 'reading', label: '在读' },
  { id: 'finished', label: '已完成' },
  { id: 'unread', label: '未开始' }
]

/** 线框小图标：阅读收起态用；笔画克制，不抢正文 */
function NavIcon({ name }: { name: 'library' | 'notes' | 'settings' | 'expand' | 'collapse' }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const
  }
  if (name === 'library') {
    return (
      <svg {...common}>
        <path d="M3 2.5h7.5A1.5 1.5 0 0 1 12 4v9.5H4.5A1.5 1.5 0 0 1 3 12V2.5Z" />
        <path d="M3 12a1.5 1.5 0 0 1 1.5-1.5H12" />
      </svg>
    )
  }
  if (name === 'notes') {
    return (
      <svg {...common}>
        <path d="M3.5 2.5h9v11h-9z" />
        <path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3" />
      </svg>
    )
  }
  if (name === 'settings') {
    return (
      <svg {...common}>
        <path d="M6.5 1.75h3l.35 1.55c.5.15.95.4 1.35.7l1.5-.5 1.5 1.5-.5 1.5c.3.4.55.85.7 1.35l1.55.35v3l-1.55.35c-.15.5-.4.95-.7 1.35l.5 1.5-1.5 1.5-1.5-.5a4.6 4.6 0 0 1-1.35.7L9.5 14.25h-3l-.35-1.55a4.6 4.6 0 0 1-1.35-.7l-1.5.5-1.5-1.5.5-1.5a4.6 4.6 0 0 1-.7-1.35L1.75 9.5v-3l1.55-.35c.15-.5.4-.95.7-1.35l-.5-1.5 1.5-1.5 1.5.5c.4-.3.85-.55 1.35-.7L6.5 1.75Z" />
        <circle cx="8" cy="8" r="2.15" />
      </svg>
    )
  }
  if (name === 'expand') {
    return (
      <svg {...common}>
        <path d="M6 3.5 10.5 8 6 12.5" />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <path d="M10 3.5 5.5 8 10 12.5" />
    </svg>
  )
}

export function Sidebar({
  current,
  onSelect,
  reading,
  width,
  onWidthChange,
  onToggleCollapsed,
  tags,
  tagFilter,
  onPickTag,
  statusFilter,
  onPickStatus,
  stats
}: {
  current: PageId
  onSelect: (id: PageId) => void
  /** 正在阅读：隐藏书库筛选，可折叠，可挂目录 */
  reading: boolean
  /** 当前侧栏宽度；非阅读固定为 SIDEBAR_WIDTH */
  width: number
  /** 阅读态拖宽；非阅读不传 */
  onWidthChange?: (width: number) => void
  onToggleCollapsed?: () => void
  /** null 表示当前页面没有上下文列表；空数组是「还没建过标签」 */
  tags?: Tag[] | null
  tagFilter?: number | null
  onPickTag?: (tagId: number | null) => void
  statusFilter?: BookStatus | null
  onPickStatus?: (status: BookStatus | null) => void
  stats?: LibraryStats | null
}) {
  const chrome = useReadingChrome()
  const collapsed = reading && width <= SIDEBAR_COLLAPSED_WIDTH
  const showLibraryExtras = !reading && tags != null
  const showToc = reading && !collapsed && chrome?.showToc === true

  const countOf = (status: BookStatus | null): number | null => {
    if (!stats) return null
    if (status === 'reading') return stats.reading
    if (status === 'finished') return stats.finished
    if (status === 'unread') return stats.unread
    return stats.total
  }

  const className = [
    'sidebar',
    reading ? 'sidebar--reading' : '',
    collapsed ? 'sidebar--collapsed' : ''
  ]
    .filter(Boolean)
    .join(' ')

  const style: CSSProperties = {
    flex: `0 0 ${width}px`,
    width
  }
  if (reading && IS_MAC) style.paddingTop = SIDEBAR_PAD_TOP

  const startResize = (event: ReactMouseEvent): void => {
    if (!onWidthChange) return
    event.preventDefault()
    const startX = event.clientX
    const startWidth = width
    const fromCollapsed = startWidth <= SIDEBAR_COLLAPSED_WIDTH
    const onMove = (move: MouseEvent): void => {
      onWidthChange(
        clampSidebarWidth(startWidth + (move.clientX - startX), fromCollapsed)
      )
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.classList.remove('is-resizing-sidebar')
    }
    document.body.classList.add('is-resizing-sidebar')
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <nav className={className} style={style} aria-label="主导航">
      <div className="sidebar__nav">
        {NAV.map((item) => {
          const active = !reading && current === item.id
          return (
            <button
              key={item.id}
              type="button"
              className={`nav-item${active ? ' nav-item--active' : ''}${
                reading ? ' nav-item--icon' : ''
              }`}
              aria-current={active ? 'page' : undefined}
              aria-label={item.label}
              title={item.label}
              onClick={() => onSelect(item.id)}
            >
              {reading ? (
                <>
                  <span className="nav-item__icon">
                    <NavIcon name={item.icon} />
                  </span>
                  <span className="nav-item__label">{item.label}</span>
                </>
              ) : (
                item.label
              )}
            </button>
          )
        })}
      </div>

      {showLibraryExtras ? (
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

      {showToc && chrome ? (
        <div className="sidebar__toc">
          <TocPanel
            chapters={chrome.chapters}
            currentId={chrome.currentChapterId}
            onSelect={chrome.onSelectChapter}
            marks={chrome.marks}
            currentMark={chrome.currentMark}
            onAddMark={chrome.onAddMark}
            onRemoveMark={chrome.onRemoveMark}
            onSelectMark={chrome.onSelectMark}
          />
        </div>
      ) : null}

      {showLibraryExtras ? (
        <div className="sidebar__foot">
          <b>本地书库</b>
          <br />
          {stats ? `${stats.total} 本 · ${formatBytes(stats.bytes)}` : '读取中…'}
          <br />
          书籍与笔记只存在这台电脑上
        </div>
      ) : null}

      {/* 展开/收起始终贴底，收起轨与展开态位置一致 */}
      {reading && onToggleCollapsed ? (
        <button
          type="button"
          className="sidebar__toggle"
          aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
          title={collapsed ? '展开侧栏' : '收起侧栏'}
          onClick={onToggleCollapsed}
        >
          <NavIcon name={collapsed ? 'expand' : 'collapse'} />
          <span className="sidebar__toggle-label">{collapsed ? '展开' : '收起'}</span>
        </button>
      ) : null}

      {reading && onWidthChange ? (
        <div
          className="sidebar__resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="拖动调整侧栏宽度"
          aria-valuemin={collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_EXPANDED_MIN_WIDTH}
          aria-valuemax={SIDEBAR_MAX_WIDTH}
          aria-valuenow={width}
          onMouseDown={startResize}
        />
      ) : null}
    </nav>
  )
}
