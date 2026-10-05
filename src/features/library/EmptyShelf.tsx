/**
 * 空书库的引导。只在「真的一本书都没有、也没有任何筛选」时出现，
 * 筛选 / 搜索导致的空结果由 LibraryPage 用一句话提示。
 */
export function EmptyShelf({
  onPick,
  onPickFolder
}: {
  onPick: () => void
  onPickFolder: () => void
}) {
  return (
    <div className="empty">
      <div className="empty__inner">
        <div className="empty__art" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </div>
        <h2 className="empty__t">书架还是空的</h2>
        <p className="empty__p">
          把 .epub 文件拖到窗口任意位置即可导入。
          <br />
          支持一次多本，重复的书会自动跳过。
        </p>
        <div className="empty__acts">
          <button type="button" className="btn btn--accent" onClick={onPick}>
            选择文件…
          </button>
          <button type="button" className="btn" onClick={onPickFolder}>
            从文件夹导入
          </button>
        </div>
        <div className="empty__note">
          书籍与笔记只保存在这台电脑上，不会上传到任何服务器。
          <br />
          目前只支持 epub 格式。
        </div>
      </div>
    </div>
  )
}