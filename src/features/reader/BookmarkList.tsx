import type { Bookmark } from '@shared/types'

/**
 * 左栏「书签」页签里的列表。
 *
 * 与目录页签同一层（宽度还是 `TOC_WIDTH`），所以这里不引入任何新的宽度概念。
 * 顶部那一行是唯一的写入口：当前这一页已经有书签时，同一个按钮变成「取消本页书签」——
 * 同一页再点一次不会新增（主进程有唯一键挡着），所以必须让按钮如实反映这个状态，
 * 否则用户会以为「点了没反应」。
 */
export function BookmarkList({
  bookmarks,
  current,
  onAdd,
  onRemove,
  onSelect
}: {
  bookmarks: readonly Bookmark[]
  /** 当前这一页已有的书签；没有就传 null */
  current: Bookmark | null
  onAdd: () => void
  onRemove: (id: number) => void
  onSelect: (bookmark: Bookmark) => void
}) {
  return (
    <div className="marks">
      <div className="marks__bar">
        <button
          type="button"
          className={`btn${current ? ' btn--on' : ''}`}
          aria-pressed={current !== null}
          onClick={() => (current ? onRemove(current.id) : onAdd())}
        >
          {current ? '取消本页书签' : '加书签'}
        </button>
      </div>

      {bookmarks.length === 0 ? (
        <p className="marks__empty">
          还没有书签。读到要紧处点上面的「加书签」，或按 ⌘D；再点一次就能取消。
        </p>
      ) : (
        <ul className="marks__list">
          {bookmarks.map((bookmark) => {
            const here = current?.id === bookmark.id
            return (
              <li key={bookmark.id}>
                <button
                  type="button"
                  className={`marks__item${here ? ' marks__item--here' : ''}`}
                  aria-current={here ? 'location' : undefined}
                  title={bookmark.excerpt || '这一页没有可读的原文'}
                  onClick={() => onSelect(bookmark)}
                >
                  <span className="marks__excerpt">
                    {bookmark.excerpt || '（这一页没有可读的原文）'}
                  </span>
                  <span className="marks__meta">全书 {Math.round(bookmark.percent * 100)}%</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
