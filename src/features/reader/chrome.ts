/** 与文字阅读器共用同一条标题栏的左侧让位规则（macOS 上要给红绿灯腾地方） */
export const IS_MAC = navigator.userAgent.includes('Mac')
export const BAR_PAD_LEFT = IS_MAC ? 78 : 12
