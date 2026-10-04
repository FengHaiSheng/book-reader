/** IPC 通道名。只增不改，改名等于破坏契约。 */
export const CH = {
  settingsGetAll: 'settings:getAll',
  settingsSet: 'settings:set',
  settingsGetPrefs: 'settings:getPrefs',
  settingsSetPrefs: 'settings:setPrefs',
  secretsStatus: 'secrets:status',
  secretsSet: 'secrets:set',
  secretsClear: 'secrets:clear',
  libraryPickAndImport: 'library:pickAndImport',
  libraryImportPath: 'library:importPath',
  libraryList: 'library:list',
  libraryChapters: 'library:chapters',
  librarySearch: 'library:search',
  libraryRemove: 'library:remove',
  readerOpen: 'reader:open',
  readerSaveProgress: 'reader:saveProgress',
  notesListChapter: 'notes:listChapter',
  notesListAll: 'notes:listAll',
  notesCreate: 'notes:create',
  notesUpdate: 'notes:update',
  notesRemove: 'notes:remove',
  notesContext: 'notes:context',
  notesPreviewExport: 'notes:previewExport',
  notesExportMarkdown: 'notes:exportMarkdown',
  shellOpenExternal: 'shell:openExternal',
  /** 主 → 渲染 的单向事件，不是 invoke */
  libraryImportProgress: 'library:importProgress',
  aiStatus: 'ai:status',
  aiModels: 'ai:models',
  aiTest: 'ai:test',
  aiChat: 'ai:chat',
  aiCancel: 'ai:cancel',
  aiIndexState: 'ai:indexState',
  aiBuildIndex: 'ai:buildIndex',
  aiCancelIndex: 'ai:cancelIndex',
  /** 主 → 渲染 的单向事件，不是 invoke */
  aiDelta: 'ai:delta',
  aiProgress: 'ai:progress'
} as const

export type Channel = (typeof CH)[keyof typeof CH]

/** preload 暴露给渲染进程的白名单方法名，冒烟测试会断言它完全一致 */
export const API_SHAPE = {
  settings: ['getAll', 'set', 'getPrefs', 'setPrefs'],
  secrets: ['status', 'set', 'clear'],
  library: ['pickAndImport', 'importPath', 'list', 'chapters', 'search', 'remove', 'onImportProgress'],
  reader: ['open', 'saveProgress'],
  notes: ['listChapter', 'listAll', 'create', 'update', 'remove', 'context', 'previewExport', 'exportMarkdown'],
  shell: ['openExternal'],
  ai: [
    'status',
    'models',
    'test',
    'chat',
    'cancel',
    'indexState',
    'buildIndex',
    'cancelIndex',
    'onDelta',
    'onProgress'
  ]
} as const
