import { useEffect, useState } from 'react'
import { localDay } from '@shared/reading'
import type { ReadingStats } from '@shared/types'
import { getUnrecordedMs } from '../reading/failures'
import { formatDuration, heatmapCells } from '../reading/stats'

/** 热力档位（0–4）混进面板底色的比例。不新增色值，靠 color-mix 在亮暗两套 token 下自适应 */
const LEVEL_MIX = [0, 25, 45, 65, 90]

export function ReadingStatsSection() {
  const [stats, setStats] = useState<ReadingStats | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // 拉失败要明说：只显示 0 会把「读不到」说成「没读过」
    void window.api.reading.stats().then(
      (next) => setStats(next),
      (e: unknown) => setError(e instanceof Error ? e.message : '原因未知')
    )
  }, [])

  if (error) {
    return (
      <section className="settings__group">
        <h2 className="settings__title">阅读统计</h2>
        <p className="settings__notice">没能读到阅读统计：{error}。</p>
      </section>
    )
  }

  if (!stats) {
    return (
      <section className="settings__group">
        <h2 className="settings__title">阅读统计</h2>
        <p className="settings__hint">加载中…</p>
      </section>
    )
  }

  const cells = heatmapCells(stats.year, stats.days, localDay(new Date()))
  const unrecordedMs = getUnrecordedMs()
  const numbers = [
    { key: 'today', label: '今日', seconds: stats.today },
    { key: 'last7', label: '近 7 天', seconds: stats.last7 },
    { key: 'total', label: '累计', seconds: stats.total }
  ]

  return (
    <section className="settings__group">
      <h2 className="settings__title">阅读统计</h2>

      {/* 结算连续失败时残差留在渲染进程里，一笔没写进去就要说话 */}
      {unrecordedMs > 0 && (
        <p className="settings__notice">
          有约 {Math.max(1, Math.floor(unrecordedMs / 60000))}{' '}
          分钟没能记入数据库，下一次结算会连同它一起重试。
        </p>
      )}

      {/* 没有任何一天有记录时，三个格子摆一排 0 分钟看起来像坏了，换成一句话 */}
      {stats.days.length === 0 ? (
        <p className="settings__hint">还没有数据。在阅读器里读上一会儿就会出现在这里。</p>
      ) : (
        <div className="stats__grid">
          {numbers.map((item) => (
            <div className="stats__card" key={item.key}>
              <span className="stats__label">{item.label}</span>
              <span className="stats__num">{formatDuration(item.seconds)}</span>
            </div>
          ))}
        </div>
      )}

      <p className="stats__year">{stats.year} 年</p>

      {/* 一列一周、周一起头。格子由 heatmapCells 铺好（含首尾补白），这里只负责画 */}
      <div className="stats__heat">
        {cells.map((cell) =>
          cell.day === null ? (
            <span key={cell.key} className="stats__cell stats__cell--pad" aria-hidden="true" />
          ) : (
            <span
              key={cell.key}
              className={`stats__cell${cell.isToday ? ' stats__cell--today' : ''}`}
              style={{
                background: `color-mix(in srgb, var(--accent-mark) ${LEVEL_MIX[cell.level]}%, var(--panel))`
              }}
              title={`${cell.day} · ${formatDuration(cell.seconds)}`}
            />
          )
        )}
      </div>

      <p className="settings__hint">
        只记「窗口可见 + 有焦点 + 连续 5 分钟内有操作」的时间，人离开就停表。
      </p>
    </section>
  )
}
