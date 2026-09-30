/** 迁移只需要数据库的最小子集，这样调度逻辑本身不依赖原生模块，能在 vitest 里测 */
export type MigrationDb = {
  pragma: (source: string, options?: { simple: boolean }) => unknown
  exec: (sql: string) => unknown
  transaction: (fn: () => void) => () => void
}

export type Migration = {
  version: number
  up: (db: MigrationDb) => void
}

/** 按 version 升序执行未应用过的迁移。每个迁移连同 user_version 的更新一起包在事务里。 */
export function migrate(db: MigrationDb, migrations: Migration[]): number {
  const current = Number(db.pragma('user_version', { simple: true }))
  const pending = migrations
    .filter((m) => m.version > current)
    .sort((a, b) => a.version - b.version)

  for (const m of pending) {
    const run = db.transaction(() => {
      m.up(db)
      db.pragma(`user_version = ${m.version}`)
    })
    run()
  }

  return Number(db.pragma('user_version', { simple: true }))
}
