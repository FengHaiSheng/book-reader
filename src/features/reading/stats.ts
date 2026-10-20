import type { ReadingDay } from '@shared/types'
import { localDay } from '@shared/reading'

/** 时长的中文写法：秒 / 分钟 / 小时+分 */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  if (total < 60) return `${total} 秒`
  const minutes = Math.floor(total / 60)
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分`
}

/** 热力档位，共五档（0–4）。阈值按「这天读了多久」定，不按相对排名。 */
export function warmLevel(seconds: number): number {
  if (seconds <= 0) return 0
  if (seconds < 10 * 60) return 1
  if (seconds < 30 * 60) return 2
  if (seconds < 60 * 60) return 3
  return 4
}

export type HeatCell = {
  /** React key。补白格没有日期，用位置序号 */
  key: string
  /** YYYY-MM-DD；补白格为 null */
  day: string | null
  seconds: number
  level: number
  isToday: boolean
}

function daysInYear(year: number): number {
  const start = new Date(year, 0, 1).getTime()
  const end = new Date(year + 1, 0, 1).getTime()
  return Math.round((end - start) / 86_400_000)
}

/**
 * 年历格子。
 *
 * 布局是 `grid-template-rows: repeat(7, …)` + `grid-auto-flow: column`，
 * 所以格子必须按「一列一周、周一起头」的顺序铺出来：
 * 先补上 1 月 1 日之前那几个空位，再补末尾凑满最后一周的空位。
 */
export function heatmapCells(
  year: number,
  days: readonly ReadingDay[],
  today: string
): HeatCell[] {
  const secondsByDay = new Map(days.map((item) => [item.day, item.seconds]))
  const total = daysInYear(year)
  // getDay() 的 0 是周日，想让周一落在第 0 行就得挪一格
  const lead = (new Date(year, 0, 1).getDay() + 6) % 7
  const cellCount = Math.ceil((lead + total) / 7) * 7

  const cells: HeatCell[] = []
  for (let i = 0; i < cellCount; i += 1) {
    const offset = i - lead
    if (offset < 0 || offset >= total) {
      cells.push({ key: `pad-${i}`, day: null, seconds: 0, level: 0, isToday: false })
      continue
    }
    const day = localDay(new Date(year, 0, 1 + offset))
    const seconds = secondsByDay.get(day) ?? 0
    cells.push({ key: day, day, seconds, level: warmLevel(seconds), isToday: day === today })
  }
  return cells
}
