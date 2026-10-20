/**
 * 本地日期串（YYYY-MM-DD），reading_time.day 的主键形态。
 *
 * 用本地时间而不是 UTC：东八区用户晚上 8 点后写成 UTC 会记到「明天」，
 * 年历上今天那格也就不对了。主进程生成主键、渲染层判断「哪格是今天」共用这一个函数。
 */
export function localDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
