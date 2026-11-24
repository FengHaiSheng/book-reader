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
  libraryStats: 'library:stats',
  libraryPickFolder: 'library:pickFolder',
  libraryChapters: 'library:chapters',
  librarySearch: 'library:search',
  /** 全库跨书搜索：去掉 book_id 过滤，复用同一套 chunks_fts 索引 */
  librarySearchAll: 'library:searchAll',
  libraryRemove: 'library:remove',
  /** 书架置顶 / 取消置顶。超过上限时回传可读中文错误，由界面提示 */
  librarySetPinned: 'library:setPinned',
  readerOpen: 'reader:open',
  readerSaveProgress: 'reader:saveProgress',
  bookmarksList: 'bookmarks:list',
  bookmarksAdd: 'bookmarks:add',
  bookmarksRemove: 'bookmarks:remove',
  readingStats: 'reading:stats',
  readingAddSeconds: 'reading:addSeconds',
  notesListChapter: 'notes:listChapter',
  notesListAll: 'notes:listAll',
  notesCreate: 'notes:create',
  notesUpdate: 'notes:update',
  notesRemove: 'notes:remove',
  notesContext: 'notes:context',
  notesPreviewExport: 'notes:previewExport',
  notesExportMarkdown: 'notes:exportMarkdown',
  /** 新导出通道：三格式共用，预览与落盘同一份内容 */
  notesPreviewFile: 'notes:previewFile',
  notesExportFile: 'notes:exportFile',
  notesPinAi: 'notes:pinAi',
  notesListAiNotes: 'notes:listAiNotes',
  notesRemoveAiNote: 'notes:removeAiNote',
  shellOpenExternal: 'shell:openExternal',
  dataStats: 'data:stats',
  dataBackups: 'data:backups',
  dataOpenFolder: 'data:openFolder',
  dataExportAll: 'data:exportAll',
  dataImportAll: 'data:importAll',
  dataCleanup: 'data:cleanup',
  /** 主 → 渲染 的单向事件，不是 invoke */
  libraryImportProgress: 'library:importProgress',
  libraryImportPaths: 'library:importPaths',
  libraryTagsList: 'library:tagsList',
  libraryTagCreate: 'library:tagCreate',
  libraryTagRename: 'library:tagRename',
  libraryTagDelete: 'library:tagDelete',
  libraryTagAssign: 'library:tagAssign',
  aiStatus: 'ai:status',
  aiModels: 'ai:models',
  aiTest: 'ai:test',
  aiChat: 'ai:chat',
  aiCancel: 'ai:cancel',
  /** 停掉一个结构化任务（小结/关键词）。key 由主进程生成，前端只回传 */
  aiCancelTask: 'ai:cancelTask',
  aiHistory: 'ai:history',
  aiClear: 'ai:clear',
  /** 花钱之前的 token 预估。只读库、只做检索与截断，不发起任何模型调用 */
  aiEstimate: 'ai:estimate',
  aiIndexState: 'ai:indexState',
  aiBuildIndex: 'ai:buildIndex',
  aiCancelIndex: 'ai:cancelIndex',
  /** 主 → 渲染 的单向事件，不是 invoke */
  aiDelta: 'ai:delta',
  aiProgress: 'ai:progress',
  // 结构化任务。思维导图不调模型，但同样走 ai:mindmap —— 复用同一套缓存与结果视图
  aiSummary: 'ai:summary',
  aiDigest: 'ai:digest',
  aiTerms: 'ai:terms',
  aiMindmap: 'ai:mindmap',
  aiCancelDigest: 'ai:cancelDigest',
  /** 打开面板时回填已有结果。只读 ai_results，不发起任何模型调用 */
  aiCachedResults: 'ai:cachedResults',
  /** 自建朗读服务探活：返回音色列表，也用来告诉界面「服务起没起」 */
  ttsHealth: 'tts:health',
  /** 合成一句并写磁盘缓存。音频以 WAV 字节回传，失败走结果里的 error */
  ttsSynthesize: 'tts:synthesize',
  /**
   * 学习脉络。阶段进度复用 aiProgress：kind 为 track，label 前缀 track:build / track:gap。
   * 不另开 track:onProgress，避免和索引、全书要点各听一条通道。
   */
  trackGetActive: 'track:getActive',
  trackListNodes: 'track:listNodes',
  trackSetBookLinks: 'track:setBookLinks',
  trackRenameNode: 'track:renameNode',
  trackComputeSignals: 'track:computeSignals',
  trackGetLatestGap: 'track:getLatestGap',
  trackBuild: 'track:build',
  trackGap: 'track:gap',
  trackCancel: 'track:cancel',
  trackMatchBooks: 'track:matchBooks',
  trackConfirmMatch: 'track:confirmMatch'
} as const

export type Channel = (typeof CH)[keyof typeof CH]

/** preload 暴露给渲染进程的白名单方法名，冒烟测试会断言它完全一致 */
export const API_SHAPE = {
  settings: ['getAll', 'set', 'getPrefs', 'setPrefs'],
  secrets: ['status', 'set', 'clear'],
  library: [
    'pickAndImport',
    'pickFolder',
    'importPath',
    'importPaths',
    'pathForFile',
    'list',
    'stats',
    'chapters',
    'search',
    'searchAll',
    'remove',
    'setPinned',
    'tagsList',
    'tagCreate',
    'tagRename',
    'tagDelete',
    'tagAssign',
    'onImportProgress'
  ],
  reader: ['open', 'saveProgress'],
  bookmarks: ['list', 'add', 'remove'],
  reading: ['stats', 'addSeconds'],
  notes: [
    'listChapter',
    'listAll',
    'create',
    'update',
    'remove',
    'context',
    'previewExport',
    'exportMarkdown',
    'previewFile',
    'exportFile',
    'pinAi',
    'listAiNotes',
    'removeAiNote'
  ],
  shell: ['openExternal'],
  data: ['stats', 'backups', 'openFolder', 'exportAll', 'importAll', 'cleanup'],
  ai: [
    'status',
    'models',
    'test',
    'chat',
    'cancel',
    'cancelTask',
    'history',
    'clear',
    'estimate',
    'indexState',
    'buildIndex',
    'cancelIndex',
    'onDelta',
    'onProgress',
    'summary',
    'digest',
    'terms',
    'mindmap',
    'cancelDigest',
    'cachedResults'
  ],
  /**
   * 没有 onProgress：界面订 ai.onProgress，用 kind === 'track' 或 label 前缀区分。
   */
  track: [
    'getActive',
    'listNodes',
    'setBookLinks',
    'renameNode',
    'computeSignals',
    'getLatestGap',
    'build',
    'gap',
    'cancel',
    'matchBooks',
    'confirmMatch'
  ],
  tts: ['health', 'synthesize']
} as const
