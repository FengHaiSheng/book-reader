/** IPC 通道名。只增不改，改名等于破坏契约。 */
export const CH = {
  settingsGetAll: 'settings:getAll',
  settingsSet: 'settings:set',
  secretsStatus: 'secrets:status',
  secretsSet: 'secrets:set',
  secretsClear: 'secrets:clear'
} as const

export type Channel = (typeof CH)[keyof typeof CH]

/** preload 暴露给渲染进程的白名单方法名，冒烟测试会断言它完全一致 */
export const API_SHAPE = {
  settings: ['getAll', 'set'],
  secrets: ['status', 'set', 'clear']
} as const
