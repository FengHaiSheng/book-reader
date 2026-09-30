import yauzl from 'yauzl'
import { appError, toAppError } from '@shared/errors'

export type ZipEntry = { name: string; size: number }

/** 打开一个 zip。打不开就当 epub 损坏处理，错误码统一成 EPUB_PARSE_FAILED。 */
function open(zipPath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (err, zip) => {
      if (err || !zip) {
        reject(
          appError('EPUB_PARSE_FAILED', '这个文件不是合法的 epub（无法作为 zip 打开）', {
            detail: err?.message
          })
        )
        return
      }
      resolve(zip)
    })
  })
}

export async function listEntries(zipPath: string): Promise<ZipEntry[]> {
  const zip = await open(zipPath)
  return new Promise((resolve, reject) => {
    const entries: ZipEntry[] = []
    // settled 保证 resolve/reject 只发生一次，且两条路径都必定 close()；
    // zip 在我们的生命周期里始终挂着 fd（autoClose: false），漏关就是 fd 泄漏。
    let settled = false
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      zip.close()
      fn()
    }

    zip.on('entry', (entry: yauzl.Entry) => {
      if (!entry.fileName.endsWith('/')) {
        entries.push({ name: entry.fileName, size: entry.uncompressedSize })
      }
      zip.readEntry()
    })
    zip.on('end', () => finish(() => resolve(entries)))
    zip.on('error', (err) => finish(() => reject(err)))
    zip.readEntry()
  })
}

/**
 * 按名读取若干 entry 的内容。名字不存在的直接跳过——
 * 真实 epub 里 manifest 声明了却不在 zip 里的条目并不罕见，不该当致命错误。
 */
export async function readEntries(
  zipPath: string,
  names: string[]
): Promise<Map<string, Buffer>> {
  const wanted = new Set(names)
  const zip = await open(zipPath)

  return new Promise((resolve, reject) => {
    const result = new Map<string, Buffer>()
    let inflight = 0
    let ended = false
    // settled 是唯一闸门：resolve 与 reject 互斥，且两者都必定 close()。
    // 这里刻意不把 autoClose 设成 true —— lazyEntries 模式下 yauzl 会在 emit 'end'
    // 的同一 tick 就 close，而此刻最后的 openReadStream 可能仍在读同一 fd，会读失败。
    let settled = false

    const fail = (err: unknown): void => {
      if (settled) return
      settled = true
      zip.close()
      reject(err)
    }

    const settle = (): void => {
      if (settled || !ended || inflight !== 0) return
      settled = true
      zip.close()
      resolve(result)
    }

    zip.on('entry', (entry: yauzl.Entry) => {
      if (entry.fileName.endsWith('/') || !wanted.has(entry.fileName)) {
        zip.readEntry()
        return
      }
      inflight += 1
      zip.openReadStream(entry, (err, stream) => {
        if (err || !stream) {
          // 计数回退在此纯属语义清晰：fail 一旦置 settled，settle 就再也不会 resolve，
          // 计数是否归零都不影响结果。
          inflight -= 1
          fail(toAppError(err, `无法读取 epub 内的 ${entry.fileName}`))
          return
        }
        const chunks: Buffer[] = []
        stream.on('data', (chunk: Buffer) => chunks.push(chunk))
        stream.on('end', () => {
          result.set(entry.fileName, Buffer.concat(chunks))
          inflight -= 1
          settle()
        })
        stream.on('error', (streamErr) => fail(toAppError(streamErr, '读取 epub 内容失败')))
      })
      zip.readEntry()
    })

    zip.on('end', () => {
      ended = true
      settle()
    })
    zip.on('error', fail)
    zip.readEntry()
  })
}
