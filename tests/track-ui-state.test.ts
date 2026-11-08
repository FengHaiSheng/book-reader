import { describe, expect, it } from 'vitest'
import {
  errorNeedsSettings,
  gapReportIsStale,
  gapScopeFingerprint,
  isQuietStop,
  trackPhaseLabel,
  trackProgressTask,
  treeRoots,
  unlinkedBookIds
} from '../src/features/track/state'

describe('track ui state', () => {
  it('问缺指纹只取 scopeKey 第一行', () => {
    const fingerprint = 'a'.repeat(64)
    expect(gapScopeFingerprint(fingerprint)).toBe(fingerprint)
    expect(gapScopeFingerprint(`${fingerprint}\n先补哪一块`)).toBe(fingerprint)
    expect(gapScopeFingerprint(`${fingerprint}\n先补哪一块\n${Date.now()}`)).toBe(fingerprint)
  })

  it('信号变了才提示重问，没有报告或指纹时不提示', () => {
    const current = 'b'.repeat(64)
    const previous = 'a'.repeat(64)
    expect(gapReportIsStale(null, previous)).toBe(false)
    expect(gapReportIsStale(current, null)).toBe(false)
    expect(gapReportIsStale(current, current)).toBe(false)
    expect(gapReportIsStale(current, `${current}\n追问`)).toBe(false)
    expect(gapReportIsStale(current, previous)).toBe(true)
    expect(gapReportIsStale(current, `${previous}\n追问`)).toBe(true)
  })

  it('手改之后未归类是书架里还没挂上的书', () => {
    const books = [{ id: 'a' }, { id: 'b' }, { id: '' }, { id: 'a' }, { id: 'c' }]
    const nodes = [{ books: [{ bookId: 'b' }, { bookId: 'b' }] }, { books: [{ bookId: '' }] }]
    expect(unlinkedBookIds(books, nodes)).toEqual(['a', 'c'])
    expect(unlinkedBookIds(books, [])).toEqual(['a', 'b', 'c'])
  })

  it('树按父子和排序展开，找不到父节点的摊到根上', () => {
    const roots = treeRoots([
      { id: 'child', parentId: 'root', title: '子', sortOrder: 0 },
      { id: 'root', parentId: null, title: '根', sortOrder: 1 },
      { id: 'late', parentId: 'root', title: '后', sortOrder: 2 },
      { id: 'orphan', parentId: 'missing', title: '孤', sortOrder: 0 }
    ])
    expect(roots.map((node) => node.id)).toEqual(['orphan', 'root'])
    expect(roots[1]?.children.map((node) => node.id)).toEqual(['child', 'late'])
  })

  it('成环的节点不会被走丢', () => {
    const roots = treeRoots([
      { id: 'a', parentId: 'b', title: '甲', sortOrder: 1 },
      { id: 'b', parentId: 'a', title: '乙', sortOrder: 0 }
    ])
    expect(roots.map((node) => node.id).sort()).toEqual(['a', 'b'])
  })

  it('进度只认脉络通道上的 build / gap', () => {
    expect(trackProgressTask({ kind: 'digest', label: 'track:build 正在生成', task: 'track:build' })).toBe(
      null
    )
    expect(trackProgressTask({ kind: 'track', label: 'track:build 正在生成能力骨架', task: 'track:build' })).toBe(
      'build'
    )
    expect(trackProgressTask({ kind: 'track', label: 'track:gap 正在分析缺口' })).toBe('gap')
    expect(trackPhaseLabel('track:build 正在建议挂书')).toBe('正在建议挂书')
  })

  it('取消不算失败，密钥类错误要去设置', () => {
    expect(isQuietStop('已取消')).toBe(true)
    expect(isQuietStop('已中断')).toBe(true)
    expect(isQuietStop('脉络没有生成成功')).toBe(false)
    expect(errorNeedsSettings('请先在设置里配置模型密钥')).toBe(true)
    expect(errorNeedsSettings('API 密钥无效或没有权限，请到设置里重新填写')).toBe(true)
    expect(errorNeedsSettings('没能连上模型服务，请检查网络或代理设置')).toBe(false)
    expect(errorNeedsSettings('账户余额或用量额度不足，请到服务商后台充值后重试')).toBe(false)
    expect(errorNeedsSettings('这次请求模型没能处理，换一个模型或缩短提问试试')).toBe(false)
  })
})
