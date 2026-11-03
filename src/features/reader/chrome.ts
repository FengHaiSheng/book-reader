/** 与文字阅读器共用同一条标题栏的左侧让位规则（macOS 上要给红绿灯腾地方） */
export const IS_MAC = navigator.userAgent.includes('Mac')
export const BAR_PAD_LEFT = IS_MAC ? 78 : 12
/** 阅读时无 TitleBar，壳层侧栏顶部要给红绿灯留出垂直空间（约等于标题栏高） */
export const SIDEBAR_PAD_TOP = IS_MAC ? 44 : 12

/**
 * 阅读顶栏左侧内边距。
 * 壳层侧栏已占掉窗口左缘一部分；若仍窄于红绿灯让位，差额补在顶栏上，避免书名压住按钮。
 */
export function readerBarPadLeft(shellSidebarWidth: number): number {
  return Math.max(IS_MAC ? 0 : 12, BAR_PAD_LEFT - shellSidebarWidth)
}
