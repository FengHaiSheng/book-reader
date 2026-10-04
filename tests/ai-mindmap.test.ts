import { describe, expect, it } from 'vitest'
import { buildMindmap } from '../electron/main/ai/mindmap'

const terms = [
  { term: '深度工作', gloss: '一种专注状态', where: '第一章' },
  { term: '注意力残留', gloss: '切换任务后的残留', where: '第二章' },
  { term: '深度工作', gloss: '在第二章又出现一次', where: '第二章' },
  { term: '浮浅工作', gloss: '不需要认知努力的事务', where: '第一章' }
]

describe('buildMindmap', () => {
  it('根节点是书名', () => {
    expect(buildMindmap('深度工作', terms)?.label).toBe('深度工作')
  })

  it('按 where 分组，章节顺序是首次出现的顺序', () => {
    expect(buildMindmap('深度工作', terms)!.children.map((node) => node.label)).toEqual([
      '第一章',
      '第二章'
    ])
  })

  it('章节节点下挂术语，重复出现就重复挂', () => {
    const tree = buildMindmap('深度工作', terms)!
    expect(tree.children[0]!.children.map((node) => node.label)).toEqual(['深度工作', '浮浅工作'])
    expect(tree.children[1]!.children.map((node) => node.label)).toEqual(['注意力残留', '深度工作'])
  })

  it('where 为空串时归到「未归类」，不把术语丢掉', () => {
    const tree = buildMindmap('书', [{ term: 'X', gloss: 'y', where: '' }])!
    expect(tree.children[0]!.label).toBe('未归类')
  })

  it('没有术语时返回 null —— 界面据此提示「先生成关键词」，而不是画一棵空树', () => {
    expect(buildMindmap('书', [])).toBeNull()
  })
})