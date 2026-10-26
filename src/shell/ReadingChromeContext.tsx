import { createContext, useContext, type ReactNode } from 'react'
import type { Bookmark, ReaderChapter } from '@shared/types'

/** 阅读器上报给壳层侧栏的目录 / 书签数据 */
export type ReadingChromeValue = {
  chapters: ReaderChapter[]
  currentChapterId: number | null
  onSelectChapter: (chapterId: number) => void
  marks: readonly Bookmark[]
  currentMark: Bookmark | null
  onAddMark: () => void
  onRemoveMark: (id: number) => void
  onSelectMark: (bookmark: Bookmark) => void
  /** 漫画等无目录时为 false */
  showToc: boolean
}

const ReadingChromeContext = createContext<ReadingChromeValue | null>(null)

export function ReadingChromeProvider({
  value,
  children
}: {
  value: ReadingChromeValue | null
  children: ReactNode
}) {
  return (
    <ReadingChromeContext.Provider value={value}>{children}</ReadingChromeContext.Provider>
  )
}

export function useReadingChrome(): ReadingChromeValue | null {
  return useContext(ReadingChromeContext)
}
