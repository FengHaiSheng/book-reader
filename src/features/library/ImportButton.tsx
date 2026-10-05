export function ImportButton({ busy, onPick }: { busy: boolean; onPick: () => void }) {
  return (
    <button type="button" className="btn btn--primary" disabled={busy} onClick={onPick}>
      {busy ? '导入中…' : '导入 EPUB'}
    </button>
  )
}