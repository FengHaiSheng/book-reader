import { useCallback, useState } from 'react'
import type { ImportOutcome, ImportProgressEvent } from '@shared/types'
import { readableError } from '@shared/errors'
import { summarizeImport } from './shelf'

/**
 * 选择文件与拖放共用的一条导入路径。
 *
 * 两条入口的差别只有「怎么拿到路径」，进度、提示、忙状态必须完全一样——
 * 分别写一遍的结果通常是拖放那条忘了退订进度事件。
 */
export function useImport(onDone: () => Promise<void> | void) {
  const [progress, setProgress] = useState<ImportProgressEvent | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const run = useCallback(
    async (task: () => Promise<ImportOutcome[] | null>): Promise<void> => {
      setBusy(true)
      setNotice(null)
      const unsubscribe = window.api.library.onImportProgress(setProgress)
      try {
        const outcomes = await task()
        await onDone()
        setNotice(summarizeImport(outcomes ?? []))
      } catch (error) {
        setNotice(readableError(error, '导入没有成功'))
      } finally {
        unsubscribe()
        setProgress(null)
        setBusy(false)
      }
    },
    [onDone]
  )

  return { progress, busy, notice, setNotice, run }
}