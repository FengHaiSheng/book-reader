import { useCallback, useEffect, useState } from 'react'
import type { ReadingPrefs, ReadingTarget } from '@shared/types'
import { TitleBar } from './shell/TitleBar'
import { Sidebar, type PageId } from './shell/Sidebar'
import { LibraryPage } from './pages/LibraryPage'
import { NotesPage } from './pages/NotesPage'
import { SettingsPage } from './pages/SettingsPage'
import { ReaderPage } from './features/reader/ReaderPage'
import './styles/base.css'

const TITLES: Record<PageId, string> = {
  library: '书架',
  notes: '笔记',
  settings: '设置'
}

export default function App() {
  const [page, setPage] = useState<PageId>('library')
  const [reading, setReading] = useState<ReadingTarget | null>(null)

  // 稳定引用是必须的：target 进了 ReaderPage 开书 effect 的依赖，
  // 每次渲染给一个新对象会让开书 effect 反复重跑，读一次书要重开好几次
  const openBook = useCallback((bookId: string) => {
    setReading({ bookId, chapterId: null, cfi: null })
  }, [])

  // 启动时应用已持久化的主题。index.html 里只写了默认亮色，
  // 不做这一步的话「切暗色后重启」会回到亮色。
  useEffect(() => {
    void window.api.settings.getAll().then((all) => {
      const raw = all.prefs
      if (!raw) return
      try {
        const theme = (JSON.parse(raw) as Partial<ReadingPrefs>).theme
        if (theme === 'light' || theme === 'dark') {
          document.documentElement.dataset.theme = theme
        }
      } catch {
        // 偏好损坏时保持 index.html 的默认亮色
      }
    })
  }, [])

  // 阅读器是沉浸式全屏（spec §4.1），它自带标题栏与返回入口，不叠在外壳里
  if (reading) {
    return (
      <ReaderPage bookId={reading.bookId} target={reading} onExit={() => setReading(null)} />
    )
  }

  return (
    <div className="app">
      <TitleBar title={TITLES[page]} />
      <div className="body">
        <Sidebar current={page} onSelect={setPage} />
        <main className="content">
          {page === 'library' && <LibraryPage onOpen={openBook} />}
          {page === 'notes' && <NotesPage onOpenAt={setReading} />}
          {page === 'settings' && <SettingsPage />}
        </main>
      </div>
    </div>
  )
}
