import { describe, expect, it } from 'vitest'
import { blobToVector, cosine, topKByVector, vectorToBlob } from '../electron/main/ai/vector'

describe('cosine', () => {
  it('同向为 1，正交为 0', () => {
    expect(cosine([1, 0], [2, 0])).toBeCloseTo(1)
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0)
  })

  it('零向量返回 0 而不是 NaN —— 否则排序会全乱', () => {
    expect(cosine([0, 0], [1, 1])).toBe(0)
  })

  it('长度不一致时返回 0', () => {
    expect(cosine([1, 2], [1, 2, 3])).toBe(0)
  })
})

describe('topKByVector', () => {
  const items = [
    { id: 1, vector: [1, 0] },
    { id: 2, vector: [0.5, 0.5] },
    { id: 3, vector: [0, 1] }
  ]

  it('按相似度降序取前 K', () => {
    expect(topKByVector(items, [1, 0], 2).map((x) => x.id)).toEqual([1, 2])
  })

  it('K 大于总数时全返回', () => {
    expect(topKByVector(items, [1, 0], 99)).toHaveLength(3)
  })

  it('空输入返回空数组，不抛错', () => {
    expect(topKByVector([], [1, 0], 3)).toEqual([])
  })
})

describe('BLOB 往返', () => {
  it('写进去再读出来，数值一致', () => {
    const source = [0.1, -0.25, 3.5]
    const restored = blobToVector(vectorToBlob(source))
    expect(restored).toHaveLength(3)
    expect(restored[0]).toBeCloseTo(0.1, 5)
    expect(restored[2]).toBeCloseTo(3.5, 5)
  })
})