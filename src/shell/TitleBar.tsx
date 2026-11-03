export function TitleBar() {
  const isMac = navigator.userAgent.includes('Mac')
  return (
    <header className="titlebar" style={{ paddingLeft: isMac ? 78 : 12 }}>
      {/* 左侧不放页面名：侧栏已有导航，这里只留拖拽区与右侧工具槽 */}
      <span className="titlebar__spacer" />
      {/* 页面自己往这里渲染标题栏动作，见 ExportPopover */}
      <div className="titlebar__tools" id="titlebar-tools" />
    </header>
  )
}
