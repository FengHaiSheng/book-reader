import { contextBridge, ipcRenderer } from 'electron'
import { CH } from '@shared/ipc'
import type {
  BookSummary,
  ChapterRowView,
  ImportOutcome,
  ImportProgress,
  IpcResult,
  ProgressInput,
  ReaderBook,
  ReadingPrefs,
  SearchHit
} from '@shared/types'

/** 把导入类调用回传的结果信封还原成「返回值或干净的中文 Error」。 */
function unwrap<T>(result: IpcResult<T>): T {
  if (result.ok) return result.value
  throw Object.assign(new Error(result.error.message), result.error)
}

const api = {
  settings: {
    getAll: (): Promise<Record<string, string>> => ipcRenderer.invoke(CH.settingsGetAll),
    set: (key: string, value: string): Promise<void> =>
      ipcRenderer.invoke(CH.settingsSet, key, value),
    getPrefs: (): Promise<ReadingPrefs> => ipcRenderer.invoke(CH.settingsGetPrefs),
    setPrefs: (prefs: Partial<ReadingPrefs>): Promise<ReadingPrefs> =>
      ipcRenderer.invoke(CH.settingsSetPrefs, prefs)
  },
  secrets: {
    status: (): Promise<{ available: boolean; providers: Record<string, string> }> =>
      ipcRenderer.invoke(CH.secretsStatus),
    set: (provider: string, key: string): Promise<void> =>
      ipcRenderer.invoke(CH.secretsSet, provider, key),
    clear: (provider: string): Promise<void> => ipcRenderer.invoke(CH.secretsClear, provider)
  },
  library: {
    pickAndImport: async (): Promise<ImportOutcome[] | null> =>
      unwrap(await ipcRenderer.invoke(CH.libraryPickAndImport)),
    importPath: async (filePath: string): Promise<ImportOutcome> =>
      unwrap(await ipcRenderer.invoke(CH.libraryImportPath, filePath)),
    list: (): Promise<BookSummary[]> => ipcRenderer.invoke(CH.libraryList),
    chapters: (bookId: string): Promise<ChapterRowView[]> =>
      ipcRenderer.invoke(CH.libraryChapters, bookId),
    search: (bookId: string, query: string, limit?: number): Promise<SearchHit[]> =>
      ipcRenderer.invoke(CH.librarySearch, bookId, query, limit),
    remove: (bookId: string): Promise<void> => ipcRenderer.invoke(CH.libraryRemove, bookId),
    /** 返回取消订阅函数，供 React 的 useEffect 清理 */
    onImportProgress: (listener: (progress: ImportProgress) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: ImportProgress): void =>
        listener(progress)
      ipcRenderer.on(CH.libraryImportProgress, handler)
      return () => ipcRenderer.removeListener(CH.libraryImportProgress, handler)
    }
  },
  reader: {
    open: (bookId: string): Promise<ReaderBook | null> => ipcRenderer.invoke(CH.readerOpen, bookId),
    saveProgress: (input: ProgressInput): Promise<void> =>
      ipcRenderer.invoke(CH.readerSaveProgress, input)
  },
  shell: {
    openExternal: (url: string): Promise<void> =>
      ipcRenderer.invoke(CH.shellOpenExternal, url)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
