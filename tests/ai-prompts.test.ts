import { describe, expect, it } from 'vitest'
import { CITATION_RULE, DIGEST_SCHEMA, SUMMARY_SCHEMA, buildMessages } from '../electron/main/ai/prompts'

const context = {
  bookTitle: '深度工作',
  chapterTitle: '第二章 注意力的形状',
  excerpt: '不是有什么必须处理的事情，只是那个动作本身已经长进了肌肉里。',
  passages: [
    { index: 1, headingPath: '深度工作 > 第二章', text: '手机会持续占用注意力。' },
    { index: 2, headingPath: '深度工作 > 第二章', text: '把手机放到另一个房间。' }
  ]
}

/**
 * 提示词分两条消息：规则与 schema 在 system，资料在 user。
 * 所以「某某规则有没有进 prompt」要合起来看，不能只断 user 那条。
 */
const promptOf = (messages: readonly { content: string }[]): string =>
  messages.map((message) => message.content).join('\n')

describe('buildMessages', () => {
  it('划词问答：system 里有引用规则，user 里有选中的原文与编号片段', () => {
    const messages = buildMessages('ask', { ...context, question: '作者到底在说什么？' })
    expect(messages[0]!.role).toBe('system')
    expect(messages[0]!.content).toContain(CITATION_RULE)
    const user = messages[1]!.content
    expect(user).toContain('作者到底在说什么？')
    expect(user).toContain('不是有什么必须处理的事情')
    expect(user).toContain('[1]')
    expect(user).toContain('把手机放到另一个房间。')
  })

  it('解释与翻译不要引用规则，要的是干净输出', () => {
    const explain = buildMessages('explain', context)
    expect(explain[0]!.content).not.toContain(CITATION_RULE)
    expect(promptOf(explain)).toContain('解释')
    expect(explain[1]!.content).toContain('不是有什么必须处理的事情')
    const translate = buildMessages('translate', context)
    expect(translate[0]!.content).not.toContain(CITATION_RULE)
    expect(promptOf(translate)).toContain('翻译')
  })

  it('本章小结要求 JSON，并把 schema 写进 prompt', () => {
    const messages = buildMessages('chapterSummary', { ...context, chapterText: '全文……' })
    expect(promptOf(messages)).toContain(SUMMARY_SCHEMA)
    expect(promptOf(messages)).toContain('只输出 JSON')
  })

  it('长章节：给了分段小结就走 reduce，不再读一遍正文', () => {
    const reduce = buildMessages('chapterSummary', {
      ...context,
      summaries: [{ chapterTitle: '第二章', overview: '前半段讲了什么', keyPoints: ['A', 'B'] }]
    })
    expect(promptOf(reduce)).toContain('第二章：前半段讲了什么')
    expect(promptOf(reduce)).toContain('  - A')
    expect(promptOf(reduce)).toContain(SUMMARY_SCHEMA)
    expect(reduce[1]!.content).not.toContain('本章正文')
  })

  it('全书要点：给了各章小结就做 reduce，没给就做 map', () => {
    const map = buildMessages('bookDigest', { ...context, chapterText: '本章全文' })
    expect(promptOf(map)).toContain('本章')
    const reduce = buildMessages('bookDigest', {
      ...context,
      summaries: [
        { chapterTitle: '第一章', overview: '开篇', keyPoints: ['A'] },
        { chapterTitle: '第二章', overview: '推进', keyPoints: ['B'] }
      ]
    })
    expect(promptOf(reduce)).toContain('第一章：开篇')
    expect(promptOf(reduce)).toContain('第二章：推进')
    expect(promptOf(reduce)).toContain(DIGEST_SCHEMA)
  })

  it('关键词任务显式禁止编造 —— 位置只能来自给它的片段', () => {
    const messages = buildMessages('terms', {
      ...context,
      summaries: [{ chapterTitle: '第二章', overview: 'x', keyPoints: ['y'] }]
    })
    expect(promptOf(messages)).toContain('不要编造')
    expect(messages[1]!.content).toContain('第二章：x')
  })
})