import type { ReadingPrefs } from '@shared/types'
import { HIGHLIGHT_COLORS, highlightRegistryName } from '@shared/highlights'
import { COLUMN_GAP, type ReaderLayout } from './layout'

/** 与 tokens.css 保持一致的两套字体栈。iframe 里拿不到父文档的 CSS 变量，所以这里写死字面量 */
const SERIF = "'Source Han Serif SC', 'Noto Serif SC', 'Songti SC', SimSun, serif"
const SANS = "'PingFang SC', 'Microsoft YaHei', system-ui, -apple-system, 'Segoe UI', sans-serif"

/** 明暗两套纸面配色，与 tokens.css 的 --paper / --ink 对应 */
const PAPER = {
  light: { bg: '#fcfaf6', ink: '#2b2723' },
  dark: { bg: '#211e1b', ink: '#e6e0d8' }
} as const

/**
 * 高亮底色。与 .uicraft.md 的 `--hl-*` 取同一组值，但必须是字面量：
 * 这段 CSS 注入的是章节文档，那里的 `:root` 上没有我们的 Design Tokens。
 */
const HIGHLIGHT_BG: Record<ReadingPrefs['theme'], Record<string, string>> = {
  light: { yellow: '#f2e3a8', green: '#c9dfc4', blue: '#c6d6e8', pink: '#edcfd4' },
  dark: { yellow: '#4a4023', green: '#2f3e2c', blue: '#2a3644', pink: '#452f33' }
}

/** `::highlight()` 是按注册名上色的，所以四种颜色必须是四条规则 */
function highlightRules(theme: ReadingPrefs['theme']): string {
  const palette = HIGHLIGHT_BG[theme]
  return HIGHLIGHT_COLORS.map(
    (color) => `::highlight(${highlightRegistryName(color)}) {
  background-color: ${palette[color]};
  color: inherit;
}`
  ).join('\n')
}

export function readerFontStack(font: ReadingPrefs['font']): string {
  return font === 'serif' ? SERIF : SANS
}

/**
 * 注入章节文档的样式。
 *
 * 只覆盖「阅读相关」的东西：字号、行距、颜色、字体、分栏。
 * 书的排版（段落缩进、居中、标题层级、图片尺寸）一律不动 —— spec §3.4 要求书自己的样式优先。
 */
export function buildReaderCss(layout: ReaderLayout, prefs: ReadingPrefs): string {
  const { bg, ink } = PAPER[prefs.theme]
  return `html {
  height: ${layout.pageHeight}px;
  /* 翻页靠 body 的 translateX 驱动，滚动条本身不该出现 */
  overflow: hidden;
  background: ${bg};
  color: ${ink};
}
body {
  margin: 0;
  padding: 0;
  height: ${layout.pageHeight}px;
  box-sizing: border-box;
  column-width: ${layout.columnWidth}px;
  column-gap: ${COLUMN_GAP}px;
  /* auto 而不是默认的 balance：按页高往下排，排满自动开下一栏 */
  column-fill: auto;
  font-family: ${readerFontStack(prefs.font)};
  font-size: ${layout.fontSize}px;
  line-height: ${prefs.lineHeight};
  color: ${ink};
  background: ${bg};
  text-align: justify;
  overflow-wrap: break-word;
}
img, svg, video {
  max-width: 100%;
  height: auto;
}
a {
  color: inherit;
  text-decoration: underline;
}
::selection {
  background: color-mix(in srgb, ${ink} 18%, transparent);
}
${highlightRules(prefs.theme)}`
}
