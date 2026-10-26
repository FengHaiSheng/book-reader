import { Modal } from './Modal'
import type { PageId } from './Sidebar'

const PAGE_LABEL: Record<PageId, string> = {
  library: '书架',
  notes: '笔记',
  settings: '设置'
}

export function ExitReadingModal({
  to,
  onCancel,
  onConfirm
}: {
  to: PageId | null
  onCancel: () => void
  onConfirm: () => void
}) {
  const body =
    to === null
      ? '进度会自动保存。确定离开阅读吗？'
      : `进度会自动保存。确定离开并前往「${PAGE_LABEL[to]}」吗？`

  return (
    <Modal title="离开阅读？" onClose={onCancel}>
      <p className="exit-reading__text">{body}</p>
      <div className="exit-reading__acts">
        <button type="button" className="btn" autoFocus onClick={onCancel}>
          取消
        </button>
        <button type="button" className="btn btn--accent" onClick={onConfirm}>
          离开
        </button>
      </div>
    </Modal>
  )
}
