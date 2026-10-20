import { describe, expect, it } from 'vitest'
import { formatDuration, heatmapCells, warmLevel } from '../src/features/reading/stats'

describe('formatDuration', () => {
  it('不到一分钟写秒', () => {
    expect(formatDuration(0)).toBe('0 秒')
    expect(formatDuration(59)).toBe('59 秒')
  })

  it('不到一小时写分钟', () => {
    expect(formatDuration(60)).toBe('1 分钟')
    expect(formatDuration(59 * 60 + 59)).toBe('59 分钟')
  })

  it('整小时不拖一个 0 分', () => {
    expect(formatDuration(3600)).toBe('1 小时')
    expect(formatDuration(3600 + 23 * 60)).toBe('1 小时 23 分')
  })

  it('负数当作 0', () => {
    expect(formatDuration(-5)).toBe('0 秒')
  })
})

describe('warmLevel', () => {
  it('五档的边界', () => {
    expect(warmLevel(0)).toBe(0)
    expect(warmLevel(-1)).toBe(0)
    expect(warmLevel(1)).toBe(1)
    expect(warmLevel(600 - 1)).toBe(1)
    expect(warmLevel(600)).toBe(2)
    expect(warmLevel(1800)).toBe(3)
    expect(warmLevel(3600)).toBe(4)
    expect(warmLevel(3600 * 9)).toBe(4)
  })
})

describe('heatmapCells', () => {
  it('平年 365 个实格，补白后是整周', () => {
    const cells = heatmapCells(2026, [], '2026-03-15')
    expect(cells.length % 7).toBe(0)
    expect(cells.filter((cell) => cell.day !== null)).toHaveLength(365)
  })

  it('闰年 366 天', () => {
    const cells = heatmapCells(2024, [], '2024-02-29')
    expect(cells.filter((cell) => cell.day !== null)).toHaveLength(366)
    expect(cells.some((cell) => cell.day === '2024-02-29')).toBe(true)
  })

  it('1 月 1 日落在「周一起头」的正确行上', () => {
    // 2026-01-01 是周四，前面要补 3 个空位（周一 / 周二 / 周三）
    const cells = heatmapCells(2026, [], '2026-01-01')
    expect(cells.slice(0, 3).every((cell) => cell.day === null)).toBe(true)
    expect(cells[3]?.day).toBe('2026-01-01')
  })

  it('只有今天那格带 today 标记', () => {
    const cells = heatmapCells(2026, [], '2026-03-15')
    const flagged = cells.filter((cell) => cell.isToday)
    expect(flagged).toHaveLength(1)
    expect(flagged[0]?.day).toBe('2026-03-15')
  })

  it('按天数上色，没记录的日子是 0 档', () => {
    const cells = heatmapCells(
      2026,
      [
        { day: '2026-01-02', seconds: 120 },
        { day: '2026-01-03', seconds: 3600 }
      ],
      '2026-01-02'
    )
    const byDay = new Map(cells.map((cell) => [cell.day, cell.level]))
    expect(byDay.get('2026-01-01')).toBe(0)
    expect(byDay.get('2026-01-02')).toBe(1)
    expect(byDay.get('2026-01-03')).toBe(4)
  })
})
