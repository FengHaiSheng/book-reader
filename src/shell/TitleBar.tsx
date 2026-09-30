export function TitleBar({ title }: { title: string }) {
  const isMac = navigator.userAgent.includes('Mac')
  return (
    <header className="titlebar" style={{ paddingLeft: isMac ? 78 : 12 }}>
      <span className="titlebar__title">{title}</span>
    </header>
  )
}
