import { describe, expect, it } from 'vitest'
import { buildMarkdown, type ExportEntry } from '../electron/main/notes/export'

const AT = new Date('2026-09-29T21:40:00+08:00')

const ENTRIES: ExportEntry[] = [
  {
    bookTitle: '深度工作',
    chapterTitle: '第二章 注意力的形状',
    percent: 0.38,
    text: '不是有什么必须处理的事情，只是那个动作本身已经长进了肌肉里。',
    note: '和《习惯的力量》的回路是一回事。',
    context: {
      located: true,
      chapterTitle: '第二章 注意力的形状',
      before: '那种安静，他后来很少遇到了。',
      matched: '不是有什么必须处理的事情，只是那个动作本身已经长进了肌肉里。',
      after: '要把它拔出来，得费些力气。'
    }
  },
  {
    bookTitle: '思考，快与慢',
    chapterTitle: '第五章 你的直觉可能只是错觉',
    percent: 0.82,
    text: '我们对自己的无知视而不见。',
    note: null,
    context: null
  }
]

describe('buildMarkdown', () => {
  it('带书名分节、引文用引用块、批注单独一段', () => {
    const md = buildMarkdown(ENTRIES, { includeNotes: true, includeLocation: true, includeContext: false }, AT)
    expect(md).toContain('# 读书笔记')
    expect(md).toContain('## 深度工作')
    expect(md).toContain('## 思考，快与慢')
    expect(md).toContain('### 第二章 注意力的形状 · 全书 38%')
    expect(md).toContain('> 不是有什么必须处理的事情，只是那个动作本身已经长进了肌肉里。')
    expect(md).toContain('**我的批注**：和《习惯的力量》的回路是一回事。')
    // 没写批注的那条不该凭空长出一行批注
    expect(md.match(/\*\*我的批注\*\*/g)).toHaveLength(1)
  })

  it('关掉批注与位置后，只有书名与引文', () => {
    const md = buildMarkdown(ENTRIES, { includeNotes: false, includeLocation: false, includeContext: false }, AT)
    expect(md).not.toContain('我的批注')
    expect(md).not.toContain('全书 38%')
    expect(md).toContain('> 我们对自己的无知视而不见。')
  })

  it('附上下文时把命中那一段加粗，前后文各一段', () => {
    const md = buildMarkdown(ENTRIES, { includeNotes: false, includeLocation: false, includeContext: true }, AT)
    expect(md).toContain('> 那种安静，他后来很少遇到了。')
    expect(md).toContain('> **不是有什么必须处理的事情，只是那个动作本身已经长进了肌肉里。**')
    expect(md).toContain('> 要把它拔出来，得费些力气。')
  })

  it('没定位到上下文的条目不生成空引用块，也不留「undefined」', () => {
    const md = buildMarkdown(ENTRIES, { includeNotes: false, includeLocation: false, includeContext: true }, AT)
    expect(md).not.toContain('undefined')
    expect(md).not.toContain('> \n')
  })

  it('表头写明条数与书名数', () => {
    const md = buildMarkdown(ENTRIES, { includeNotes: true, includeLocation: true, includeContext: false }, AT)
    expect(md).toContain('共 2 条 · 跨 2 本书')
  })

  it('空列表只出表头，不抛错', () => {
    const md = buildMarkdown([], { includeNotes: true, includeLocation: true, includeContext: false }, AT)
    expect(md).toContain('共 0 条 · 跨 0 本书')
    expect(md).not.toContain('## ')
  })
})
