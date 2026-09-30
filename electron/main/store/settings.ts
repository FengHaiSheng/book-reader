import type Database from 'better-sqlite3'
import { DEFAULT_PREFS, type ReadingPrefs } from '@shared/types'

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

  return {
    font: parsed.font === 'sans' ? 'sans' : DEFAULT_PREFS.font,
    fontSize: clampNumber(parsed.fontSize, 15, 24, DEFAULT_PREFS.fontSize),
    charsPerLine: clampNumber(parsed.charsPerLine, 24, 48, DEFAULT_PREFS.charsPerLine),
    lineHeight: clampNumber(parsed.lineHeight, 1.5, 2.2, DEFAULT_PREFS.lineHeight),
    theme: parsed.theme === 'dark' ? 'dark' : DEFAULT_PREFS.theme
  }
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}
