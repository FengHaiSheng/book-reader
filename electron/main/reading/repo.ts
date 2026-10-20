import type Database from 'better-sqlite3'
import { localDay } from '@shared/reading'
import type { ReadingDay, ReadingStats } from '@shared/types'

/**
 * 累加写，不是覆盖写 —— 这是本表与 reading_progress 最大的不同。
 *
 * 渲染层会分批上报增量，所以必须按天相加；日期串由主进程生成（它是主键，只能有一处来源）。
 * 同一时刻的重复投递会真的把秒数记两遍，所以调用方要 `await` 成功后才清本地增量（见 tracker）。
 */
export function addReadingSeconds(db: Database.Database, seconds: number, now: number): void {
  const amount = Math.floor(seconds)
  if (!Number.isFinite(amount) || amount <= 0) return
  db.prepare(
    `INSERT INTO reading_time (day, seconds, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(day) DO UPDATE SET seconds = seconds + excluded.seconds, updated_at = excluded.updated_at`
  ).run(localDay(new Date(now)), amount, now)
}

/**
 * 年历 + 三个汇总。
 *
 * 聚合放在 SQL 里：`days` 只取当年（年历按它染色），`today / last7 / total` 一次算完。
 * 近 7 天含今天，起点用本地日期回推 6 天得到 —— 东八区晚上用 UTC 算会整体错一天，
 * 所以日期串一律走 `localDay`，不用 SQLite 的 `date('now')`。
 */
export function readingStats(db: Database.Database, now: number): ReadingStats {
  const date = new Date(now)
  const year = date.getFullYear()
  const today = localDay(date)
  const weekStart = localDay(new Date(date.getFullYear(), date.getMonth(), date.getDate() - 6))

  const days = db
    .prepare('SELECT day, seconds FROM reading_time WHERE day LIKE ? ORDER BY day')
    .all(`${year}-%`) as ReadingDay[]

  const sums = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN day = ? THEN seconds ELSE 0 END), 0) AS today,
              COALESCE(SUM(CASE WHEN day >= ? THEN seconds ELSE 0 END), 0) AS last7,
              COALESCE(SUM(seconds), 0) AS total
       FROM reading_time`
    )
    .get(today, weekStart) as { today: number; last7: number; total: number }

  return { year, days, today: sums.today, last7: sums.last7, total: sums.total }
}
