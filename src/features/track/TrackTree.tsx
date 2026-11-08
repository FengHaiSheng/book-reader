import { useEffect, useRef, useState } from 'react'
import type { BookSummary } from '@shared/types'
import {
  STRENGTH_LABEL,
  STRENGTH_TITLE,
  treeRoots,
  type SignalStrength,
  type TreeItem
} from './state'
import type { TrackNode } from './types'

export function TrackTree({
  nodes,
  strengthById,
  selectedId,
  books,
  uncategorizedIds,
  locked,
  onSelect,
  onOpenBook,
  onChangeLinks,
  onRename
}: {
  nodes: readonly TrackNode[]
  strengthById: ReadonlyMap<string, SignalStrength>
  selectedId: string | null
  books: readonly BookSummary[]
  uncategorizedIds: readonly string[]
  locked: boolean
  onSelect: (id: string) => void
  onOpenBook: (bookId: string) => void
  onChangeLinks: (nodeId: string, bookIds: string[]) => void
  onRename: (nodeId: string, title: string, summary: string) => Promise<boolean>
}) {
  const roots = treeRoots(nodes)
  const selected = nodes.find((node) => node.id === selectedId) ?? null

  return (
    <aside className="track-side" aria-label="能力树">
      <div className="track-side__scroll">
        {roots.length === 0 ? (
          <p className="track-hint">这棵脉络还没有节点。</p>
        ) : (
          <NodeList
            items={roots}
            strengthById={strengthById}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        )}
        <NodeBooks
          node={selected}
          books={books}
          locked={locked}
          onOpenBook={onOpenBook}
          onChangeLinks={onChangeLinks}
          onRename={onRename}
        />
      </div>
      <Uncategorized
        ids={uncategorizedIds}
        books={books}
        canAttach={selected !== null && !locked}
        onOpenBook={onOpenBook}
        onAttach={(bookId) => {
          if (!selected) return
          const ids = selected.books.map((book) => book.bookId)
          if (ids.includes(bookId)) return
          onChangeLinks(selected.id, [...ids, bookId])
        }}
      />
    </aside>
  )
}

function NodeList({
  items,
  strengthById,
  selectedId,
  onSelect
}: {
  items: TreeItem<TrackNode>[]
  strengthById: ReadonlyMap<string, SignalStrength>
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <ul className="track-tree">
      {items.map((node) => {
        const strength = strengthById.get(node.id) ?? (node.books.length === 0 ? 'empty' : null)
        const on = node.id === selectedId
        return (
          <li key={node.id}>
            <button
              type="button"
              className={`track-node${on ? ' is-on' : ''}`}
              style={{ paddingLeft: 8 + Math.max(0, node.depth - 1) * 14 }}
              aria-pressed={on}
              onClick={() => onSelect(node.id)}
            >
              <span className="track-node__title">{node.title}</span>
              {strength && (
                <span className={`track-badge track-badge--${strength}`} title={STRENGTH_TITLE[strength]}>
                  {STRENGTH_LABEL[strength]}
                </span>
              )}
            </button>
            {node.children.length > 0 && (
              <NodeList
                items={node.children}
                strengthById={strengthById}
                selectedId={selectedId}
                onSelect={onSelect}
              />
            )}
          </li>
        )
      })}
    </ul>
  )
}

function NodeBooks({
  node,
  books,
  locked,
  onOpenBook,
  onChangeLinks,
  onRename
}: {
  node: TrackNode | null
  books: readonly BookSummary[]
  locked: boolean
  onOpenBook: (bookId: string) => void
  onChangeLinks: (nodeId: string, bookIds: string[]) => void
  onRename: (nodeId: string, title: string, summary: string) => Promise<boolean>
}) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [pick, setPick] = useState('')
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    setEditing(false)
    setPick('')
  }, [node?.id])

  if (!node) {
    return <p className="track-hint">点一个节点，查看或修改挂上的书。</p>
  }

  const linked = new Set(node.books.map((book) => book.bookId))
  const choices = books
    .filter((book) => !linked.has(book.id))
    .sort((a, b) => a.title.localeCompare(b.title, 'zh'))

  const startEdit = (): void => {
    setTitle(node.title)
    setSummary(node.summary)
    setEditing(true)
  }

  const save = (): void => {
    if (title.trim() === '') return
    void onRename(node.id, title.trim(), summary).then((ok) => {
      if (ok && mounted.current) setEditing(false)
    })
  }

  return (
    <section aria-label={`${node.title}的挂书`}>
      <div className="track-section">{node.title}</div>
      {node.summary.trim() !== '' && !editing && <p className="track-summary">{node.summary}</p>}
      {editing ? (
        <form
          className="track-rename"
          onSubmit={(event) => {
            event.preventDefault()
            save()
          }}
        >
          <input
            aria-label="节点名称"
            value={title}
            disabled={locked}
            onChange={(event) => setTitle(event.target.value)}
          />
          <textarea
            aria-label="节点说明"
            value={summary}
            disabled={locked}
            onChange={(event) => setSummary(event.target.value)}
          />
          <div className="track-rename__acts">
            <button type="submit" className="btn" disabled={locked || title.trim() === ''}>
              保存
            </button>
            <button type="button" className="btn btn--quiet" onClick={() => setEditing(false)}>
              取消
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="track-textbtn" disabled={locked} onClick={startEdit}>
          改名称
        </button>
      )}
      {node.books.length === 0 ? (
        <p className="track-hint">这个节点还没有书。</p>
      ) : (
        <ul className="track-books">
          {node.books.map((book) => (
            <BookRow
              key={book.bookId}
              bookId={book.bookId}
              title={book.title}
              author={book.author}
              meta={book.source === 'user' ? '手改' : '建议'}
              action="移出"
              disabled={locked}
              onOpen={onOpenBook}
              onAction={() =>
                onChangeLinks(
                  node.id,
                  node.books.map((item) => item.bookId).filter((id) => id !== book.bookId)
                )
              }
            />
          ))}
        </ul>
      )}
      <div className="track-add">
        <select
          aria-label="选择要挂上的书"
          value={pick}
          disabled={locked || choices.length === 0}
          onChange={(event) => setPick(event.target.value)}
        >
          <option value="">{choices.length === 0 ? '没有其他可挂的书' : '选择要挂上的书'}</option>
          {choices.map((book) => (
            <option key={book.id} value={book.id}>
              {book.title}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn"
          disabled={locked || pick === ''}
          onClick={() => {
            if (pick === '' || linked.has(pick)) return
            onChangeLinks(node.id, [...node.books.map((book) => book.bookId), pick])
            setPick('')
          }}
        >
          挂上
        </button>
      </div>
    </section>
  )
}

function Uncategorized({
  ids,
  books,
  canAttach,
  onOpenBook,
  onAttach
}: {
  ids: readonly string[]
  books: readonly BookSummary[]
  canAttach: boolean
  onOpenBook: (bookId: string) => void
  onAttach: (bookId: string) => void
}) {
  const byId = new Map(books.map((book) => [book.id, book]))
  return (
    <div className="track-uncat">
      <div className="track-section">未归类</div>
      {ids.length === 0 ? (
        <p className="track-hint">没有未归类的书。</p>
      ) : (
        <ul className="track-books">
          {ids.map((id) => {
            const book = byId.get(id)
            return (
              <BookRow
                key={id}
                bookId={id}
                title={book?.title ?? '已不在书架'}
                author={book?.author ?? null}
                action={canAttach && book ? '挂到此节点' : undefined}
                onOpen={book ? onOpenBook : undefined}
                onAction={canAttach && book ? () => onAttach(id) : undefined}
              />
            )
          })}
        </ul>
      )}
    </div>
  )
}

function BookRow({
  bookId,
  title,
  author,
  meta,
  action,
  disabled,
  onOpen,
  onAction
}: {
  bookId: string
  title: string
  author: string | null
  meta?: string
  action?: string
  disabled?: boolean
  onOpen?: (bookId: string) => void
  onAction?: () => void
}) {
  const label = title || '未命名'
  return (
    <li className="track-book">
      {onOpen ? (
        <button
          type="button"
          className="track-book__open"
          title={author ?? undefined}
          onClick={() => onOpen(bookId)}
        >
          {label}
        </button>
      ) : (
        <span className="track-book__name" title={author ?? undefined}>
          {label}
        </span>
      )}
      {meta && <span className="track-book__meta">{meta}</span>}
      {action && onAction && (
        <button type="button" className="track-textbtn" disabled={disabled} onClick={onAction}>
          {action}
        </button>
      )}
    </li>
  )
}
