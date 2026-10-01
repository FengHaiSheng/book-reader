import { useState } from 'react'
import type { ImportProgress } from '@shared/types'

const PHASE_LABEL: Record<ImportProgress['phase'], string> = {
  hash: '校验文件',
  extract: '解析正文',
  store: '写入书库'
}

export function ImportButton({ onImported }: { onImported: () => void }) {
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function start(): Promise<void> {
    setError(null)
    const unsubscribe = window.api.library.onImportProgress(setProgress)
    try {
      const outcomes = await window.api.library.pickAndImport()
      if (outcomes && outcomes.length > 0) {
        const duplicated = outcomes.filter((item) => item.status === 'duplicate')
        if (duplicated.length > 0) {
          setError(`《${duplicated[0]!.title}》已在书库中，未重复导入`)
        }
        onImported()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '导入失败')
    } finally {
      unsubscribe()
      setProgress(null)
    }
  }

  return (
    <div className="import">
      <button type="button" className="btn btn--primary" onClick={() => void start()}>
        导入 EPUB
      </button>
      {progress && (
        <span className="import__progress">
          {PHASE_LABEL[progress.phase]}
          {progress.total > 1 ? ` ${progress.done}/${progress.total}` : '…'}
        </span>
      )}
      {error && <span className="import__error">{error}</span>}
    </div>
  )
}
