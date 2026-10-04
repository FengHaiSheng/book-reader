/**
 * 高亮底色只有这四种，与 .uicraft.md 的 `--hl-*` 一一对应。
 * 顺序即界面上色点的顺序。
 */
export const HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink'] as const

export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number]

export const DEFAULT_HIGHLIGHT_COLOR: HighlightColor = 'yellow'

/** 色点的无障碍标签与 tooltip */
export const HIGHLIGHT_COLOR_LABELS: Record<HighlightColor, string> = {
  yellow: '黄',
  green: '绿',
  blue: '蓝',
  pink: '粉'
}

/**
 * 一次标注最多 2000 字。
 * 「全选整章」是真实会发生的手势，若不管，highlights 表里会躺进一条真的没有意义的数据。
 */
export const MAX_HIGHLIGHT_CHARS = 2000

/** 批注上限。一万字足够写读书笔记，再长就该去写文档了 */
export const MAX_NOTE_CHARS = 10000

/**
 * 注册进 `CSS.highlights` 的名字。
 *
 * 它和注入样式里的 `::highlight(名字)` 是一对契约，两处必须同时改，
 * 所以放在这里由双方 import，而不是各自写一遍字符串。
 */
export function highlightRegistryName(color: HighlightColor): string {
  return `hl-${color}`
}

/**
 * 引用回跳时临时标出原文用的注册名。
 *
 * 刻意不放进 `HIGHLIGHT_COLORS`：那个数组是「本章标注」的四色，
 * `clearHighlights` 会整组清掉再重画；把闪烁混进去，每次重画标注都会顺手抹掉它。
 * 两者的生命周期不同，名字就分开。
 */
export const CITATION_FLASH_NAME = 'cite-flash'

export function isHighlightColor(value: unknown): value is HighlightColor {
  return typeof value === 'string' && (HIGHLIGHT_COLORS as readonly string[]).includes(value)
}

/** 渲染进程与主进程都挡一次：非法颜色落回默认色，不抛错也不写脏数据 */
export function normalizeColor(value: unknown): HighlightColor {
  return isHighlightColor(value) ? value : DEFAULT_HIGHLIGHT_COLOR
}

/** 选中文本入库前压掉空白：跨段的选区里全是换行与缩进，留着只会拖累检索与匹配 */
export function normalizeSpan(text: string): string {
  return text.replace(/[\s\u3000]+/g, ' ').trim()
}

/** 批注：空串与纯空白都算「没有批注」，统一成 null，筛选才有一个明确的口径 */
export function normalizeNote(text: string | null | undefined): string | null {
  if (text == null) return null
  const trimmed = text.replace(/\r\n/g, '\n').trim()
  return trimmed === '' ? null : trimmed.slice(0, MAX_NOTE_CHARS)
}
