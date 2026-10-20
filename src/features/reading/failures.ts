/**
 * 「有多少阅读时长没能记入库」的进程内账本。
 *
 * 为什么需要它：结算发生在阅读器里，而提示要出现在设置页的统计组 —— 两者不是同时挂载的
 * （阅读器是沉浸式全屏，退出后设置页才渲染）。阅读器卸载后定时器与 ref 都没了，
 * 所以这个数只能放在模块作用域上。
 *
 * 不落库、不联网：它描述的是「这次运行里还没写进去的部分」。结算成功时清零；
 * 失败时保留残差，下一次结算会连同它一起重投 —— 所以它是个会自己消失的临时数。
 */
let unrecordedMs = 0

export function setUnrecordedMs(ms: number): void {
  unrecordedMs = Math.max(0, ms)
}

export function getUnrecordedMs(): number {
  return unrecordedMs
}
