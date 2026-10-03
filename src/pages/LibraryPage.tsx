import { useCallback, useEffect, useState } from 'react'
import type { BookSummary } from '@shared/types'
import { BookList } from '../features/library/BookList'
import { ImportButton } from '../features/library/ImportButton'

export function LibraryPage({ onOpen }: { onOpen: (id: string) => void }) {
  const [books, setBooks] = useState<BookSummary[] | null>(null)

  const refresh = useCallback(async () => {
    setBooks(await window.api.library.list())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (!books) return <div className="page-placeholder">加载中…</div>

  return (
    <div className="library">
      <div className="library__head">
        <h1 className="library__title">书架</h1>
        <ImportButton onImported={() => void refresh()} />
      </div>
      <BookList
        books={books}
        onOpen={onOpen}
        onRemove={(id) => {
          void window.api.library.remove(id).then(refresh)
        }}
      />
    </div>
  )
}
