import { describe, expect, it } from 'vitest'
import {
  HIGHLIGHT_COLORS,
  MAX_NOTE_CHARS,
  highlightRegistryName,
  isHighlightColor,
  normalizeColor,
  normalizeNote,
  normalizeSpan
} from '../shared/highlights'

describe('highlightRegistryName', () => {
  it('四种颜色各有一个稳定名字，且不与 UI 的 CSS 类重名', () => {
    expect(HIGHLIGHT_COLORS.map(highlightRegistryName)).toEqual([
      'hl-yellow',
      'hl-green',
      'hl-blue',
      'hl-pink'
    ])
  })
})

describe('normalizeColor', () => {
  it('合法颜色原样返回', () => {
    expect(normalizeColor('pink')).toBe('pink')
  })

  it('非法值与缺失都落回默认色，不抛错', () => {
    expect(normalizeColor('red')).toBe('yellow')
    expect(normalizeColor(undefined)).toBe('yellow')
    expect(normalizeColor(7)).toBe('yellow')
  })

  it('isHighlightColor 只认这四种', () => {
    expect(isHighlightColor('green')).toBe(true)
    expect(isHighlightColor('Green')).toBe(false)
  })
})

describe('normalizeSpan', () => {
  it('换行与全角空格压成单个半角空格', () => {
    expect(normalizeSpan('  月色沉入\n河底\u3000量子纠缠  ')).toBe('月色沉入 河底 量子纠缠')
  })
})

describe('normalizeNote', () => {
  it('空白批注等同没有批注', () => {
    expect(normalizeNote('   \n  ')).toBeNull()
    expect(normalizeNote(null)).toBeNull()
    expect(normalizeNote(undefined)).toBeNull()
  })

  it('保留换行，去掉首尾空白，超长截断', () => {
    expect(normalizeNote('  第一行\n第二行  ')).toBe('第一行\n第二行')
    expect(normalizeNote('字'.repeat(MAX_NOTE_CHARS + 50))).toHaveLength(MAX_NOTE_CHARS)
  })
})
