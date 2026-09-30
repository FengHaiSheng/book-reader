export function DataSection() {
  return (
    <section className="settings__group">
      <h2 className="settings__title">数据</h2>
      <p className="settings__hint">
        书库、笔记与阅读进度全部保存在本机。导出数据不包含 API Key，换机器后需要重新填写。
      </p>
      <div className="settings__row">
        <span className="settings__label">书库</span>
        <span className="settings__hint">导入书籍后这里会显示位置与占用</span>
      </div>
    </section>
  )
}
