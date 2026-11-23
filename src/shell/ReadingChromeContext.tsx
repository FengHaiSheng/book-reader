import { createContext, useContext, type ReactNode } from 'react'
import type { Bookmark, ReaderChapter } from '@shared/types'

/** 阅读器上报给壳层侧栏的目录 / 书签数据 */
type TocChrome = {
  chapters: ReaderChapter[]
  currentChapterId: number | null
  onSelectChapter: (chapterId: number) => void
  marks: readonly Bookmark[]
  currentMark: Bookmark | null
  onAddMark: () => void
  onRemoveMark: (id: number) => void
  onSelectMark: (bookmark: Bookmark) => void
}

/**
 * 文字书有目录（showToc: true），漫画只有「这本书已经打开、没有目录」这一条信息。
 * 壳层据此决定侧栏展开还是收成图标轨，不为一本漫画白占正文宽度。
 */
export type ReadingChromeValue = { showToc: false } | (TocChrome & { showToc: true })

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
