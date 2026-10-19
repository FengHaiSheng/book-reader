import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * 模态框。
 *
 * 标签的两件事——管理标签、给某本书指派——都是「占住注意力做完再回来」的操作，
 * 所以用居中的模态框，不用贴在卡片上的浮层：浮层会随滚动跑偏，网格里也没有一块
 * 稳定属于某本书的位置。
 *
 * 外壳沿用三层表面里的浮层那一层（--paper-raised + 投影 + 1px 线），不另造一套视觉。
 * 挂到 body 上，免得被 `.library` 之类的容器裁掉。
 */
export function Modal({
  title,
  onClose,
  children
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const panelRef = useRef<HTMLDivElement | null>(null)

  // Esc 关掉：模态框盖住了整个窗口，键盘用户不该只剩鼠标一条路。
  // 内容里有正在编辑的东西（比如就地改名）时，由它先吃掉 Esc——那里 Esc 的
  // 意思是「放弃这次编辑」，不该顺手把整个模态框也一起关掉。
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // 打开就把焦点收进来：不然 Tab 会从页面背后开始走，Esc 也像是没生效
  useEffect(() => {
    panelRef.current?.focus()
  }, [])

  return createPortal(
    <div className="modal">
      <div className="modal__scrim" onClick={onClose} />
      <div
        className="modal__panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={panelRef}
      >
        <header className="modal__head">
          <span className="modal__title">{title}</span>
          <button type="button" className="modal__x" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="modal__body">{children}</div>
      </div>
    </div>,
    document.body
  )
}
