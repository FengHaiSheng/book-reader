/** 迁移里除了改结构，也可能要就地重算已有数据（比如重建 FTS 索引），所以留一条最窄的读写通道 */
export type MigrationStatement = {
  all: (...params: unknown[]) => unknown[]
  run: (...params: unknown[]) => unknown
}

/**
 * 迁移只需要数据库的最小子集，这样调度逻辑本身不依赖原生模块，能在 vitest 里测。
 *
 * better-sqlite3 的 `prepare` 是一组重载，返回的 Statement 类型随绑定参数形状变化，
 * 与这里的最小签名对不上，所以由 `db.ts` 包一层适配再传进来（而不是放宽这里的类型）。
 */
export type MigrationDb = {
  pragma: (source: string, options?: { simple: boolean }) => unknown
  exec: (sql: string) => unknown
  transaction: (fn: () => void) => () => void
  prepare: (sql: string) => MigrationStatement
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
