import { useEffect, useState } from 'react'
import type { ReadingPrefs } from '@shared/types'
import { TitleBar } from './shell/TitleBar'
import { Sidebar, type PageId } from './shell/Sidebar'
import { LibraryPage } from './pages/LibraryPage'
import { NotesPage } from './pages/NotesPage'
import { SettingsPage } from './pages/SettingsPage'
import './styles/base.css'

const TITLES: Record<PageId, string> = {
  library: '书架',
  notes: '笔记',
  settings: '设置'
}

export default function App() {
  const [page, setPage] = useState<PageId>('library')

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

  return (
    <div className="app">
      <TitleBar title={TITLES[page]} />
      <div className="body">
        <Sidebar current={page} onSelect={setPage} />
        <main className="content">
          {page === 'library' && <LibraryPage />}
          {page === 'notes' && <NotesPage />}
          {page === 'settings' && <SettingsPage />}
        </main>
      </div>
    </div>
  )
}
