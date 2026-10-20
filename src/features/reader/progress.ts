/**
 * 全书进度的唯一算法。
 *
 * 阅读进度（saveProgress）与书签列表的「全书 37%」必须是同一口径 ——
 * 两处各写一遍同一个公式，早晚会算出两个不同百分比。
 *
 * 按「可读章节数」折算，不按字数：正文没有全量分页统计，
 * 拿字数当分母只会造出一个看着精确、实际是猜的百分比。
 */
export function bookPercent(
  chapterIndex: number,
  chapterFraction: number,
  chapterCount: number
): number {
  const share = 1 / Math.max(1, chapterCount)
  return Math.min(1, Math.max(0, chapterIndex * share + chapterFraction * share))
}
