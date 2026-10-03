import type Database from 'better-sqlite3'
import { DEFAULT_PREFS, clampPrefs, type ReadingPrefs } from '@shared/types'

export function getAll(db: Database.Database): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM settings').all() as {
    key: string
    value: string
  }[]
  return Object.fromEntries(rows.map((r) => [r.key, r.value]))
}

export function set(db: Database.Database, key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value)
}

/** 读到脏数据或缺失字段时回落到默认值，不让一个坏值把阅读器界面搞崩 */
export function readPrefs(db: Database.Database): ReadingPrefs {
  const raw = getAll(db).prefs
  if (!raw) return { ...DEFAULT_PREFS }

  let parsed: Partial<ReadingPrefs>
  try {
    parsed = JSON.parse(raw) as Partial<ReadingPrefs>
  } catch {
    return { ...DEFAULT_PREFS }
  }
  return clampPrefs(parsed)
}

/** 写偏好统一过一遍 clampPrefs：界面传来的值不可信，越界值不该落库。 */
export function writePrefs(db: Database.Database, input: Partial<ReadingPrefs>): ReadingPrefs {
  const prefs = clampPrefs(input)
  set(db, 'prefs', JSON.stringify(prefs))
  return prefs
}
