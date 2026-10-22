import { useCallback, useEffect, useState } from 'react'
import { readableError } from '@shared/errors'
import type { BackupInfo, DataStats } from '@shared/types'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString('zh-CN', { hour12: false })
}

export function DataSection() {
  const [stats, setStats] = useState<DataStats | null>(null)
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setStats(await window.api.data.stats())
      setBackups(await window.api.data.backups())
    } catch (error) {
      // 读不到统计要明说，不能拿一排 0 冒充「没有数据」
      setNotice(readableError(error, '没能读到数据统计'))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function openFolder(kind: 'library' | 'backup' | 'userData', name?: string): Promise<void> {
    const failure = await window.api.data.openFolder(kind, name)
    if (failure) setNotice(`没能打开目录：${failure}`)
  }

  async function exporting(): Promise<void> {
    setBusy(true)
    setNotice(null)
    try {
      const result = await window.api.data.exportAll()
      if (result.canceled) return
      setNotice(`已导出 ${result.entries} 项、${formatBytes(result.bytes)}，不含密钥`)
    } catch (error) {
      setNotice(readableError(error, '导出没有成功'))
    } finally {
      setBusy(false)
    }
  }

  async function importing(): Promise<void> {
    if (
      !window.confirm(
        '导入会用压缩包里的数据替换本机现有的书库、笔记与阅读进度。覆盖前会自动备份当前数据库，但旧书籍文件不会保留。继续吗？'
      )
    ) {
      return
    }
    setBusy(true)
    setNotice(null)
    try {
      const result = await window.api.data.importAll()
      if (result.canceled) return
      setNotice(
        `已恢复 ${result.bookCount} 本书、${result.entries} 个文件。正在刷新…（API Key 不在包内，新设备需重新填写）`
      )
      // 数据库已在主进程里换掉；刷新一次让侧栏、书架都按新数据重取
      window.setTimeout(() => window.location.reload(), 1000)
    } catch (error) {
      setNotice(readableError(error, '导入没有成功'))
    } finally {
      setBusy(false)
    }
  }

  async function cleaning(): Promise<void> {
    if (!window.confirm('清理会删除运行日志，并整理数据库文件。书籍、笔记与阅读进度都不会动。')) {
      return
    }
    setBusy(true)
    setNotice(null)
    try {
      const result = await window.api.data.cleanup()
      setNotice(
        `清理完成：删除 ${result.removedLogs} 个日志文件，释放 ${formatBytes(result.freedBytes)}`
      )
      await load()
    } catch (error) {
      setNotice(readableError(error, '清理没有成功'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="settings__group">
      <h2 className="settings__title">数据</h2>
      <p className="settings__hint">
        书库、笔记与阅读进度全部保存在本机。导出数据不包含 API Key，换机器后需要重新填写。
      </p>

      <div className="settings__row">
        <span className="settings__label">数据位置</span>
        <code className="data__path" title={stats?.userDataDir ?? ''}>
          {stats?.userDataDir ?? '加载中…'}
        </code>
        <button type="button" className="btn" onClick={() => void openFolder('userData')}>
          打开
        </button>
      </div>

      <div className="settings__row">
        <span className="settings__label">书库</span>
        <span className="settings__hint data__usage">
          {stats ? `共 ${stats.bookCount} 本` : '统计中…'}
        </span>
        <button
          type="button"
          className="btn"
          onClick={() => void openFolder('library')}
          disabled={!stats}
        >
          显示
        </button>
      </div>

      <div className="settings__row">
        <span className="settings__label">占用</span>
        <span className="settings__hint data__usage">
          {stats
            ? `书籍 ${formatBytes(stats.libraryBytes)} · 数据库 ${formatBytes(stats.dbBytes)} · 备份 ${formatBytes(stats.backupBytes)} · 日志 ${formatBytes(stats.logBytes)}`
            : '统计中…'}
        </span>
      </div>

      <div className="settings__row">
        <span className="settings__label">导出</span>
        <button type="button" className="btn" disabled={busy} onClick={() => void exporting()}>
          {busy ? '处理中…' : '导出全部数据'}
        </button>
        <span className="settings__hint">打包数据库与书籍文件，不含密钥、备份与日志</span>
      </div>

      <div className="settings__row">
        <span className="settings__label">导入</span>
        <button type="button" className="btn" disabled={busy} onClick={() => void importing()}>
          导入全部数据
        </button>
        <span className="settings__hint">从导出的 zip 恢复；会覆盖本机数据，覆盖前自动备份数据库</span>
      </div>

      <div className="settings__row">
        <span className="settings__label">清理缓存</span>
        <button type="button" className="btn" disabled={busy} onClick={() => void cleaning()}>
          清理
        </button>
        <span className="settings__hint">删日志并整理数据库；书籍、笔记与向量索引都不动</span>
      </div>

      <p className="settings__label data__backups-title">数据库备份</p>
      {backups.length === 0 ? (
        <p className="settings__hint">还没有备份。数据库结构升级前会自动留一份，保留最近 3 份。</p>
      ) : (
        <ul className="data__backups">
          {backups.map((backup) => (
            <li key={backup.name} className="data__backup">
              <span className="data__backup-name">{formatTime(backup.createdAt)}</span>
              <span className="settings__hint">{formatBytes(backup.bytes)}</span>
              <button
                type="button"
                className="btn"
                onClick={() => void openFolder('backup', backup.name)}
              >
                显示
              </button>
            </li>
          ))}
        </ul>
      )}

      {notice && (
        <p className="settings__hint data__notice" role="status">
          {notice}
        </p>
      )}
    </section>
  )
}
