export function TitleBar({ title }: { title: string }) {
  const isMac = navigator.userAgent.includes('Mac')
  return (
    <header className="titlebar" style={{ paddingLeft: isMac ? 78 : 12 }}>
      <span className="titlebar__title">{title}</span>
      <span className="titlebar__spacer" />
      {/* 页面自己往这里渲染标题栏动作，见 ExportPopover */}
      <div className="titlebar__tools" id="titlebar-tools" />
    </header>
  )
}
