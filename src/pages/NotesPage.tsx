import type { ReadingTarget } from '@shared/types'

export function NotesPage({ onOpenAt }: { onOpenAt: (target: ReadingTarget) => void }) {
  void onOpenAt
  return <div className="page-placeholder">笔记页将在本计划 Task 6 实现</div>
}
