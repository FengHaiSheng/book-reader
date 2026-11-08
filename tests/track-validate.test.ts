import { describe, expect, it } from 'vitest'
import { TRACK_MAX_DEPTH, normalizeTrackTree } from '../shared/track'

const validTree = [
  {
    id: 'lead',
    parent_id: null,
    title: '领导力',
    summary: '带团队',
    depth: 1,
    sort_order: 0
  },
  {
    id: 'strategy',
    parent_id: 'lead',
    title: '战略',
    summary: '',
    depth: 2,
    sort_order: 0
  },
  {
    id: 'decision',
    parent_id: 'strategy',
    title: '决策',
    summary: '取舍',
    depth: 3,
    sort_order: 1
  }
]

describe('normalizeTrackTree', () => {
  it('合法树', () => {
    expect(normalizeTrackTree(validTree)).toEqual({
      nodes: [
        {
          id: 'lead',
          parentId: null,
          title: '领导力',
          summary: '带团队',
          depth: 1,
          sortOrder: 0
        },
        {
          id: 'strategy',
          parentId: 'lead',
          title: '战略',
          summary: '',
          depth: 2,
          sortOrder: 0
        },
        {
          id: 'decision',
          parentId: 'strategy',
          title: '决策',
          summary: '取舍',
          depth: 3,
          sortOrder: 1
        }
      ]
    })
  })

  it('接受 { nodes } 包装与 camelCase 字段', () => {
    expect(
      normalizeTrackTree({
        nodes: [
          {
            id: 'root',
            parentId: null,
            title: '根',
            summary: '说明',
            depth: 1,
            sortOrder: 2
          }
        ]
      })
    ).toEqual({
      nodes: [
        {
          id: 'root',
          parentId: null,
          title: '根',
          summary: '说明',
          depth: 1,
          sortOrder: 2
        }
      ]
    })
  })

  it('超深', () => {
    expect(
      normalizeTrackTree([
        ...validTree,
        {
          id: 'too-deep',
          parent_id: 'decision',
          title: '再下一层',
          summary: '',
          depth: TRACK_MAX_DEPTH + 1,
          sort_order: 0
        }
      ])
    ).toEqual({ error: '节点深度超出上限' })
  })

  it('环', () => {
    expect(
      normalizeTrackTree([
        { id: 'a', parent_id: 'b', title: '甲', summary: '', depth: 1, sort_order: 0 },
        { id: 'b', parent_id: 'a', title: '乙', summary: '', depth: 1, sort_order: 1 }
      ])
    ).toEqual({ error: '脉络树存在环' })
  })

  it('缺父', () => {
    expect(
      normalizeTrackTree([
        {
          id: 'child',
          parent_id: 'missing',
          title: '子节点',
          summary: '',
          depth: 2,
          sort_order: 0
        }
      ])
    ).toEqual({ error: '找不到父节点' })
  })

  it('重复 id', () => {
    expect(
      normalizeTrackTree([
        { id: 'dup', parent_id: null, title: '甲', summary: '', depth: 1, sort_order: 0 },
        { id: 'dup', parent_id: null, title: '乙', summary: '', depth: 1, sort_order: 1 }
      ])
    ).toEqual({ error: '节点 id 重复' })
  })

  it('深度与父子不一致', () => {
    expect(
      normalizeTrackTree([
        { id: 'root', parent_id: null, title: '根', summary: '', depth: 1, sort_order: 0 },
        { id: 'skip', parent_id: 'root', title: '跳层', summary: '', depth: 3, sort_order: 0 }
      ])
    ).toEqual({ error: '节点深度与父子关系不一致' })
  })

  it('id 为空', () => {
    expect(
      normalizeTrackTree([{ id: '  ', parent_id: null, title: '甲', summary: '', depth: 1, sort_order: 0 }])
    ).toEqual({ error: '节点 id 不能为空' })
  })

  it('标题为空', () => {
    expect(
      normalizeTrackTree([{ id: 'x', parent_id: null, title: '  ', summary: '', depth: 1, sort_order: 0 }])
    ).toEqual({ error: '节点标题不能为空' })
  })

  it('不是数组', () => {
    expect(normalizeTrackTree(null)).toEqual({ error: '脉络树必须是节点数组' })
    expect(normalizeTrackTree({ foo: 1 })).toEqual({ error: '脉络树必须是节点数组' })
  })
})
