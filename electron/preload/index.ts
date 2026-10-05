import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { CH } from '@shared/ipc'
import type { ChatModel } from '@shared/ai'
import type {
  AiChatResult,
  AiDegradeEvent,
  AiEstimate,
  AiEstimateRequest,
  AiMessage,
  AiProgressEvent,
  AiResultView,
  AiStatus,
  BookDigestPayload,
  BookSummary,
  ChapterRowView,
  ChapterSummaryPayload,
  Highlight,
  HighlightContext,
  HighlightInput,
  HighlightPatch,
  HighlightWithBook,
  ImportOutcome,
  ImportProgressEvent,
  IndexState,
  IpcResult,
  LibraryStats,
  MindmapNode,
  NotesExportOptions,
  NotesExportPreview,
  NotesExportResult,
  ProgressInput,
  ProviderId,
  ReaderBook,
  ReadingPrefs,
  SearchHit,
  Tag,
  TermsPayload
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
    pickFolder: async (): Promise<ImportOutcome[] | null> =>
      unwrap(await ipcRenderer.invoke(CH.libraryPickFolder)),
    importPath: async (filePath: string): Promise<ImportOutcome> =>
      unwrap(await ipcRenderer.invoke(CH.libraryImportPath, filePath)),
    importPaths: async (paths: string[]): Promise<ImportOutcome[]> =>
      unwrap(await ipcRenderer.invoke(CH.libraryImportPaths, paths)),
    /**
     * 拖进来的 File 对象里没有路径，只有 Electron 的 webUtils 能拿。
     * 它必须跑在 preload，所以这里开一个小口子——只做这一件事，
     * 不把 webUtils 整个暴露出去。
     */
    pathForFile: (file: File): string => webUtils.getPathForFile(file),
    list: (tagId?: number | null): Promise<BookSummary[]> =>
      ipcRenderer.invoke(CH.libraryList, tagId ?? null),
    stats: (): Promise<LibraryStats> => ipcRenderer.invoke(CH.libraryStats),
    chapters: (bookId: string): Promise<ChapterRowView[]> =>
      ipcRenderer.invoke(CH.libraryChapters, bookId),
    search: (bookId: string, query: string, limit?: number): Promise<SearchHit[]> =>
      ipcRenderer.invoke(CH.librarySearch, bookId, query, limit),
    remove: (bookId: string): Promise<void> => ipcRenderer.invoke(CH.libraryRemove, bookId),
    tagsList: (): Promise<Tag[]> => ipcRenderer.invoke(CH.libraryTagsList),
    tagCreate: (name: string): Promise<Tag> => ipcRenderer.invoke(CH.libraryTagCreate, name),
    tagRename: (id: number, name: string): Promise<Tag> =>
      ipcRenderer.invoke(CH.libraryTagRename, id, name),
    tagDelete: (id: number): Promise<void> => ipcRenderer.invoke(CH.libraryTagDelete, id),
    tagAssign: (bookId: string, tagId: number, on: boolean): Promise<void> =>
      ipcRenderer.invoke(CH.libraryTagAssign, bookId, tagId, on),
    /** 返回取消订阅函数，供 React 的 useEffect 清理 */
    onImportProgress: (listener: (progress: ImportProgressEvent) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: ImportProgressEvent): void =>
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
  notes: {
    listChapter: (bookId: string, chapterId: number): Promise<Highlight[]> =>
      ipcRenderer.invoke(CH.notesListChapter, bookId, chapterId),
    listAll: (): Promise<HighlightWithBook[]> => ipcRenderer.invoke(CH.notesListAll),
    create: (input: HighlightInput): Promise<Highlight> =>
      ipcRenderer.invoke(CH.notesCreate, input),
    update: (id: number, patch: HighlightPatch): Promise<Highlight | null> =>
      ipcRenderer.invoke(CH.notesUpdate, id, patch),
    remove: (id: number): Promise<void> => ipcRenderer.invoke(CH.notesRemove, id),
    context: (id: number): Promise<HighlightContext> => ipcRenderer.invoke(CH.notesContext, id),
    previewExport: (
      ids: number[] | null,
      options: NotesExportOptions
    ): Promise<NotesExportPreview> => ipcRenderer.invoke(CH.notesPreviewExport, ids, options),
    exportMarkdown: (
      ids: number[] | null,
      options: NotesExportOptions
    ): Promise<NotesExportResult> => ipcRenderer.invoke(CH.notesExportMarkdown, ids, options)
  },
  ai: {
    status: (bookId: string | null): Promise<AiStatus> => ipcRenderer.invoke(CH.aiStatus, bookId),
    models: (providerId: ProviderId): Promise<ChatModel[]> =>
      ipcRenderer.invoke(CH.aiModels, providerId),
    test: (providerId: ProviderId, model: string): Promise<{ ok: true; model: string }> =>
      ipcRenderer.invoke(CH.aiTest, providerId, model),
    chat: (request: {
      requestId: string
      bookId: string
      chapterId: number | null
      task: 'ask' | 'explain' | 'translate'
      excerpt?: string
      question?: string
    }): Promise<AiChatResult> => ipcRenderer.invoke(CH.aiChat, request),
    cancel: (requestId: string): Promise<void> => ipcRenderer.invoke(CH.aiCancel, requestId),
    /** 花钱之前的 token 预估。不调模型，也不消耗 token */
    estimate: (request: AiEstimateRequest): Promise<AiEstimate> =>
      ipcRenderer.invoke(CH.aiEstimate, request),
    history: (bookId: string, scopeKey: string): Promise<AiMessage[]> =>
      ipcRenderer.invoke(CH.aiHistory, bookId, scopeKey),
    clear: (bookId: string, scopeKey: string): Promise<void> =>
      ipcRenderer.invoke(CH.aiClear, bookId, scopeKey),
    indexState: (bookId: string): Promise<IndexState> =>
      ipcRenderer.invoke(CH.aiIndexState, bookId),
    buildIndex: (bookId: string): Promise<IndexState> =>
      ipcRenderer.invoke(CH.aiBuildIndex, bookId),
    cancelIndex: (bookId: string): Promise<void> => ipcRenderer.invoke(CH.aiCancelIndex, bookId),
    /** 返回退订函数。contextBridge 支持跨边界传递函数，退订时直接调它。 */
    onDelta: (listener: (event: AiDegradeEvent) => void): (() => void) => {
      const handler = (_event: unknown, payload: AiDegradeEvent): void => listener(payload)
      ipcRenderer.on(CH.aiDelta, handler)
      return () => ipcRenderer.removeListener(CH.aiDelta, handler)
    },
    onProgress: (listener: (event: AiProgressEvent) => void): (() => void) => {
      const handler = (_event: unknown, payload: AiProgressEvent): void => listener(payload)
      ipcRenderer.on(CH.aiProgress, handler)
      return () => ipcRenderer.removeListener(CH.aiProgress, handler)
    },
    summary: (bookId: string, chapterId: number): Promise<AiResultView<ChapterSummaryPayload>> =>
      ipcRenderer.invoke(CH.aiSummary, bookId, chapterId),
    digest: (bookId: string): Promise<AiResultView<BookDigestPayload>> =>
      ipcRenderer.invoke(CH.aiDigest, bookId),
    terms: (bookId: string): Promise<AiResultView<TermsPayload>> =>
      ipcRenderer.invoke(CH.aiTerms, bookId),
    mindmap: (bookId: string): Promise<AiResultView<MindmapNode>> =>
      ipcRenderer.invoke(CH.aiMindmap, bookId),
    cancelDigest: (bookId: string): Promise<void> =>
      ipcRenderer.invoke(CH.aiCancelDigest, bookId)
  },
  shell: {
    openExternal: (url: string): Promise<void> =>
      ipcRenderer.invoke(CH.shellOpenExternal, url)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
