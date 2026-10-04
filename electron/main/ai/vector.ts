/**
 * 余弦相似度。
 *
 * 长度为 0 或长度不等时返回 0：这两种情况都意味着数据有问题，
 * 返回 NaN 会让整个排序函数的行为不可预测，返回 0 至少是稳定的「不相关」。
 */
export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]!
    const y = b[i]!
    dot += x * y
    normA += x * x
    normB += y * y
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

/** 内存暴力检索。几千个 chunk 是毫秒级，引向量库是过度设计（spec §2.3）。 */
export function topKByVector<T extends { vector: readonly number[] }>(
  items: readonly T[],
  query: readonly number[],
  k: number
): T[] {
  if (items.length === 0 || k <= 0) return []
  return items
    .map((item) => ({ item, score: cosine(item.vector, query) }))
    .sort((left, right) => right.score - left.score)
    .slice(0, k)
    .map((entry) => entry.item)
}

/** Float32 小端存储。SQLite 的 BLOB 就是一段字节，不需要额外的元数据列。 */
export function vectorToBlob(vector: readonly number[]): Buffer {
  return Buffer.from(new Float32Array(vector).buffer)
}

export function blobToVector(blob: Buffer): number[] {
  const copy = new Float32Array(
    blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength)
  )
  return Array.from(copy)
}