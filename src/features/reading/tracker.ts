/**
 * 阅读时长采集的核心计算（纯函数，可直接单测）。
 *
 * 口径（已在设置页用一句话写明，避免被当成 bug）：
 * **窗口可见 + 有焦点 + 连续 5 分钟内有操作**。人离开即停表。
 */

/** 五分钟没有任何操作就停表，之后的时间不再累加 */
export const IDLE_MS = 5 * 60 * 1000

export type TrackerCreditInput = {
  /** 现在 */
  now: number
  /** 上一次结算的时刻（上一次 tick，或最后一次 flush） */
  lastTickAt: number
  /** 最后一次用户操作的时刻（按键 / 滚轮 / 点击 / 翻页） */
  lastActivityAt: number
  /** 此刻是否「可计时」：窗口可见 + 有焦点 + 文档就位 */
  active: boolean
  /** 空闲阈值 */
  idleMs: number
}

/**
 * 算这一段该记多少毫秒。
 *
 * - 一直有操作 → 整段都算
 * - 中途超时 → 只算到「最后一次操作 + 阈值」为止，之后的时间不算
 * - 不可见 / 失焦 → 0（这一段本来就不该记）
 * - 零间隔 / 时钟回拨 → 0（绝不让负数把累计吃掉）
 */
export function creditMs({
  now,
  lastTickAt,
  lastActivityAt,
  active,
  idleMs
}: TrackerCreditInput): number {
  if (!active) return 0
  const span = now - lastTickAt
  if (span <= 0) return 0
  const idleSince = lastActivityAt + idleMs
  if (now <= idleSince) return span
  return Math.max(0, idleSince - lastTickAt)
}
