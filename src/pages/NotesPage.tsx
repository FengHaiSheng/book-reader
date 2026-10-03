import { useCallback, useEffect, useMemo, useState } from 'react'
import type { HighlightWithBook, ReadingTarget } from '@shared/types'
import { ExportPopover } from '../features/notes/ExportPopover'
import { NoteCard } from '../features/notes/NoteCard'
import { NoteContextPanel } from '../features/notes/NoteContextPanel'
import { NotesFilters } from '../features/notes/NotesFilters'
import {
  applyFilter,
  bookOptions,
  countsByKind,
  groupByBook,
  resolveSelection,
  type NotesKind
} from '../features/notes/group'

export function NotesPage({ onOpenAt }: { onOpenAt: (target: ReadingTarget) => void }) {
  const [notes, setNotes] = useState<HighlightWithBook[]>([])
  const [error, setError] = useState<string | null>(null)
  const [kind, setKind] = useState<NotesKind>('all')
  const [bookId, setBookId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [collapsed, setCollapsed] = useState<readonly string[]>([])

  const load = useCallback(async () => {
    try {
      setNotes(await window.api.notes.listAll())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '笔记没读出来')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => applyFilter(notes, { kind, bookId }), [notes, kind, bookId])
  const groups = useMemo(() => groupByBook(filtered), [filtered])
  const books = useMemo(() => bookOptions(notes), [notes])
  const counts = useMemo(() => countsByKind(notes, bookId), [notes, bookId])
  const selected = useMemo(
    () => filtered.find((note) => note.id === resolveSelection(filtered, selectedId)) ?? null,
    [filtered, selectedId]
  )

  const changeKind = useCallback((next: NotesKind) => setKind(next), [])
  const changeBook = useCallback((next: string | null) => setBookId(next), [])

  const allIds = useMemo(() => notes.map((note) => note.id), [notes])
  const filteredIds = useMemo(() => filtered.map((note) => note.id), [filtered])

  const saveNote = useCallback(async (id: number, note: string | null) => {
    // update 只回 Highlight，不带书名与章节位置这些汇总字段，所以是并到原条目上
    const updated = await window.api.notes.update(id, { note })
    if (updated) setNotes((list) => list.map((item) => (item.id === id ? { ...item, ...updated } : item)))
  }, [])

  const removeNote = useCallback(async (id: number) => {
    await window.api.notes.remove(id)
    setNotes((list) => list.filter((item) => item.id !== id))
  }, [])

  const openNote = useCallback(
    (note: HighlightWithBook) => {
      onOpenAt({ bookId: note.bookId, chapterId: note.chapterId, cfi: note.startCfi })
    },
    [onOpenAt]
  )

  const toggleGroup = useCallback((key: string) => {
    setCollapsed((list) => (list.includes(key) ? list.filter((item) => item !== key) : [...list, key]))
  }, [])

  return (
    <div className="notes-page">
      <ExportPopover allIds={allIds} filteredIds={filteredIds} />
      <NotesFilters
        counts={counts}
        books={books}
        kind={kind}
        bookId={bookId}
        onKind={changeKind}
        onBook={changeBook}
      />

      <main className="notes-main">
        <div className="notes-bar">
          <span className="notes-bar__title">{bookId ? bookTitleOf(books, bookId) : '全部笔记'}</span>
          <span className="notes-bar__count">
            {filtered.length} 条 · 跨 {groups.length} 本书
          </span>
        </div>

        {error && <p className="notes-bar__error">{error}</p>}

        <div className="notes-scroll">
          {filtered.length === 0 && (
            <div className="notes-empty">
              这里还没有笔记。在阅读器里选中一段文字，浮条上点一个颜色就能划出第一条。
            </div>
          )}

          {groups.map((group) => {
            const folded = collapsed.includes(group.bookId)
            return (
              <section key={group.bookId} className="notes-group">
                <div className="notes-group__head">
                  <span className="notes-group__name">{group.bookTitle}</span>
                  <span className="notes-group__n">{group.count} 条</span>
                  <span className="notes-group__spacer" />
                  <button
                    type="button"
                    className="act"
                    onClick={() => toggleGroup(group.bookId)}
                    aria-expanded={!folded}
                  >
                    {folded ? '展开' : '折起'}
                  </button>
                </div>

                {!folded &&
                  group.notes.map((note) => (
                    <NoteCard
                      key={note.id}
                      note={note}
                      selected={selected?.id === note.id}
                      onSelect={() => setSelectedId(note.id)}
                      onOpen={() => openNote(note)}
                      onSaveNote={(text) => void saveNote(note.id, text)}
                      onRemove={() => void removeNote(note.id)}
                    />
                  ))}
              </section>
            )
          })}
        </div>
      </main>

      <NoteContextPanel note={selected} onOpen={() => selected && openNote(selected)} />
    </div>
  )
}

function bookTitleOf(books: { bookId: string; bookTitle: string }[], bookId: string): string {
  return books.find((book) => book.bookId === bookId)?.bookTitle ?? '全部笔记'
}
