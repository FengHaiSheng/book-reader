export type PageId = 'library' | 'notes' | 'settings'

const NAV: { id: PageId; label: string }[] = [
  { id: 'library', label: '书架' },
  { id: 'notes', label: '笔记' },
  { id: 'settings', label: '设置' }
]

export function Sidebar({
  current,
  onSelect
}: {
  current: PageId
  onSelect: (id: PageId) => void
}) {
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
    </nav>
  )
}
