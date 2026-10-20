import { describe, expect, it } from 'vitest'
import {
  buildAnkiCsv,
  buildExport,
  buildHtmlCards,
  buildMarkdown,
  exportFileName,
  type ExportEntry
} from '../electron/main/notes/export'

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

const ALL_ON = { includeNotes: true, includeLocation: true, includeContext: true }

function csvLines(content: string): string[] {
  return content.replace(/^\uFEFF/, '').split('\r\n').filter((line) => line !== '')
}

describe('buildAnkiCsv', () => {
  it('带 BOM 与 Anki 元数据两行，表头与数据列数一致', () => {
    const csv = buildAnkiCsv(ENTRIES, { includeNotes: true, includeLocation: true, includeContext: false })
    expect(csv.startsWith('\uFEFF')).toBe(true)

    const lines = csvLines(csv)
    expect(lines[0]).toBe('#separator:Comma')
    expect(lines[1]).toBe('#columns:Front,Back,Tags,Book,Chapter,Location')
    expect(lines[2]).toBe('Front,Back,Tags,Book,Chapter,Location')

    const rows = lines.slice(2)
    expect(rows).toHaveLength(3) // 表头 + 2 条
    for (const row of rows) expect(row.split(',')).toHaveLength(6)
  })

  it('附上下文时多一列 Context，表头与数据仍同列数', () => {
    const csv = buildAnkiCsv(ENTRIES, ALL_ON)
    const lines = csvLines(csv)
    expect(lines[1]).toBe('#columns:Front,Back,Tags,Book,Chapter,Location,Context')
    for (const row of lines.slice(2)) expect(row.split(',')).toHaveLength(7)
  })

  it('关掉批注与位置时对应格子留空，不编内容', () => {
    const csv = buildAnkiCsv(ENTRIES, { includeNotes: false, includeLocation: false, includeContext: false })
    const lines = csvLines(csv)
    // 第 1 条：Front=原文，Back 空（没开批注），Tags=读书笔记，Book=深度工作，Chapter 有，Location 空
    expect(lines[3]).toBe('不是有什么必须处理的事情，只是那个动作本身已经长进了肌肉里。,,读书笔记,深度工作,第二章 注意力的形状,')
  })

  it('按 RFC 4180 转义逗号、引号与换行', () => {
    const tricky: ExportEntry = {
      bookTitle: '书',
      chapterTitle: null,
      percent: 0.1,
      text: 'a,b "c"\nd',
      note: null,
      context: null
    }
    const csv = buildAnkiCsv([tricky], { includeNotes: false, includeLocation: false, includeContext: false })
    expect(csv).toContain('"a,b ""c""\nd"')
  })

  it('空列表只有元数据与表头', () => {
    const csv = buildAnkiCsv([], { includeNotes: true, includeLocation: true, includeContext: false })
    expect(csvLines(csv)).toHaveLength(3)
  })
})

describe('buildHtmlCards', () => {
  it('自包含且零外部引用', () => {
    const html = buildHtmlCards(ENTRIES, ALL_ON, AT)
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(html).toContain('<meta charset="utf-8">')
    expect(html).not.toContain('http://')
    expect(html).not.toContain('https://')
    expect(html).not.toContain('<link')
    expect(html).toContain('共 2 条 · 跨 2 本书')
    expect(html.match(/<article class="card">/g)).toHaveLength(2)
  })

  it('所有文本来源都转义，不破版', () => {
    const tricky: ExportEntry = {
      bookTitle: '<script>x</script>',
      chapterTitle: '章 "名"',
      percent: 0.5,
      text: '<img src=x onerror=1>',
      note: '批注 <b>加粗</b>',
      context: {
        located: true,
        chapterTitle: '章',
        before: '<前>',
        matched: '命中&',
        after: '<后>'
      }
    }
    const html = buildHtmlCards([tricky], ALL_ON, AT)
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<b>加粗</b>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&lt;前&gt;')
    expect(html).toContain('命中&amp;')
    expect(html).toContain('&quot;名&quot;')
  })

  it('没定位到的上下文不生成上下文段', () => {
    const html = buildHtmlCards(ENTRIES, ALL_ON, AT)
    expect(html).not.toContain('undefined')
    // 第 2 条 context 是 null，不该有第二段 .context
    expect(html.match(/class="context"/g)).toHaveLength(1)
  })
})

describe('buildExport / exportFileName', () => {
  it('按格式分派', () => {
    expect(buildExport(ENTRIES, ALL_ON, 'anki', AT).startsWith('\uFEFF#separator:Comma')).toBe(true)
    expect(buildExport(ENTRIES, ALL_ON, 'html', AT).startsWith('<!DOCTYPE html>')).toBe(true)
    expect(buildExport(ENTRIES, ALL_ON, 'markdown', AT)).toContain('# 读书笔记')
  })

  it('默认文件名带格式扩展名', () => {
    expect(exportFileName('markdown', AT)).toBe('读书笔记-2026-09-29-2140.md')
    expect(exportFileName('anki', AT)).toBe('读书笔记-2026-09-29-2140.csv')
    expect(exportFileName('html', AT)).toBe('读书笔记-2026-09-29-2140.html')
  })
})
