import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'

/** 流式算哈希：一本 100MB 的书不该被整个读进内存只为了比对去重。 */
export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject)
  })
}
