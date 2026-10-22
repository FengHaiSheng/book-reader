import { createWriteStream, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { appError } from '@shared/errors'
import { open, type Entry } from 'yauzl'
import { isSafeEntry } from './entry-path'

/**
 * 把导出包解到临时目录。
 *
 * 先完整解开、校验通过之后再动用户的数据——中途失败时本机书库一点没碰过。
 * 未知文件照收（README 之类），只有不安全的路径会让整包失败。
 */
export function extractArchive(
  zipPath: string,
  dest: string
): Promise<{ entries: number; bytes: number }> {
  return new Promise((resolve, reject) => {
    open(zipPath, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) {
        reject(appError('FILE_MISSING', '打不开这个压缩包，可能已损坏或不是 zip'))
        return
      }

      let entries = 0
      let bytes = 0
      let settled = false

      const fail = (cause: unknown): void => {
        if (settled) return
        settled = true
        zip.close()
        reject(cause)
      }

      zip.on('error', (cause) => {
        // yauzl 在打开阶段就会拦下 `../`：这种错要翻译成人话，
        // 别把「压缩包已损坏」这种误导性结论丢给用户
        const detail = cause instanceof Error ? cause.message : ''
        fail(
          /invalid relative path|absolute path/i.test(detail)
            ? appError('DB_ERROR', '压缩包里有不安全的路径，已停止导入')
            : appError('FILE_MISSING', '压缩包已损坏，无法读取')
        )
      })
      zip.on('end', () => {
        if (settled) return
        settled = true
        resolve({ entries, bytes })
      })

      zip.on('entry', (entry: Entry) => {
        const name = entry.fileName
        if (!isSafeEntry(name)) {
          fail(appError('DB_ERROR', `压缩包里有不安全的路径（${name}），已停止导入`))
          return
        }

        if (name.endsWith('/')) {
          mkdirSync(join(dest, name), { recursive: true })
          zip.readEntry()
          return
        }

        const target = join(dest, name)
        mkdirSync(dirname(target), { recursive: true })
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) {
            fail(streamError ?? new Error(`读不到压缩包里的 ${name}`))
            return
          }
          const output = createWriteStream(target)
          output.on('error', fail)
          output.on('close', () => {
            if (settled) return
            entries += 1
            bytes += entry.uncompressedSize
            zip.readEntry()
          })
          stream.on('error', fail)
          stream.pipe(output)
        })
      })

      zip.readEntry()
    })
  })
}
