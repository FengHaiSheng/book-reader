import { describe, expect, it } from 'vitest'
import { migrate, type Migration, type MigrationDb } from '../electron/main/store/migrate'

/** 记录调用的假数据库，替代真实 better-sqlite3（原生模块在 vitest 里加载不了） */
function fakeDb(initialVersion = 0) {
  const applied: string[] = []
  let version = initialVersion
  const db: MigrationDb = {
    pragma(source, options) {
      const set = /^user_version\s*=\s*(\d+)$/.exec(source)
      if (set) {
        version = Number(set[1])
        applied.push(`pragma:${version}`)
        return undefined
      }
      return options?.simple ? version : [{ user_version: version }]
    },
    exec(sql) {
      applied.push(`exec:${sql}`)
      return undefined
    },
    // 真实 better-sqlite3 的 transaction 返回一个可直接调用的函数，假实现保持同样形状
    transaction: ((fn: () => void) => fn) as MigrationDb['transaction']
  }
  return { db, applied, version: () => version }
}

describe('migrate', () => {
  it('从 0 升到最新版本并按序执行', () => {
    const { db, applied, version } = fakeDb(0)
    expect(
      migrate(db, [
        { version: 1, up: (d) => d.exec('settings') },
        { version: 2, up: (d) => d.exec('books') }
      ])
    ).toBe(2)
    expect(version()).toBe(2)
    expect(applied).toEqual(['exec:settings', 'pragma:1', 'exec:books', 'pragma:2'])
  })

  it('已是最新版时不重复执行', () => {
    const { db, applied } = fakeDb(2)
    expect(
      migrate(db, [
        { version: 1, up: (d) => d.exec('settings') },
        { version: 2, up: (d) => d.exec('books') }
      ])
    ).toBe(2)
    expect(applied).toEqual([])
  })

  it('从中间版本升级时只执行更高的迁移', () => {
    const { db, applied } = fakeDb(1)
    migrate(db, [
      { version: 1, up: (d) => d.exec('one') },
      { version: 2, up: (d) => d.exec('two') },
      { version: 3, up: (d) => d.exec('three') }
    ])
    expect(applied).toEqual(['exec:two', 'pragma:2', 'exec:three', 'pragma:3'])
  })

  it('清单乱序传入也能按 version 升序执行', () => {
    const { db, applied } = fakeDb(0)
    migrate(db, [
      { version: 2, up: (d) => d.exec('two') },
      { version: 1, up: (d) => d.exec('one') }
    ])
    expect(applied).toEqual(['exec:one', 'pragma:1', 'exec:two', 'pragma:2'])
  })
})
