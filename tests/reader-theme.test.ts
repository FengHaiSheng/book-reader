import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFS } from '../shared/types'
import { computeLayout } from '../src/features/reader/layout'
import { buildReaderCss } from '../src/features/reader/theme'

const layout = computeLayout({
  windowWidth: 1400,
  containerWidth: 1000,
  containerHeight: 800,
  prefs: { ...DEFAULT_PREFS, fontSize: 28 }
})

describe('buildReaderCss', () => {
  it('字号与行距带 !important，压过书内写死的 body / 段落字号', () => {
    const css = buildReaderCss(layout, { ...DEFAULT_PREFS, fontSize: 28 })
    expect(css).toContain('font-size: 28px !important')
    expect(css).toContain(`line-height: ${DEFAULT_PREFS.lineHeight} !important`)
    // 段落等正文节点继承 body，避免书里的 12px/pt 写死盖掉用户字号
    expect(css).toContain('font-size: inherit !important')
    expect(css).toContain('p, li, blockquote, dd, dt, td, th, pre, code, div, span, a, em, i, b, strong')
  })
})

