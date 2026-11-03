import type { SearchHitWithBook } from '@shared/types'
import { snippetOf } from '../reader/search'
import { groupHitsByBook, hitPageCount, sliceHitsPage } from './hits'

/**
 * 壳层顶部的全库正文搜索浮层。
 * 状态在 App；进阅读后仍挂着。展开看列表，收起成细条，关闭才丢掉结果。
 */
export function LibraryBodySearchOverlay({
  query,
  hits,
  busy,
  error,
  open,
  page,
  reading,
  onToggle,
  onClose,
  onPage,
  onOpen
}: {
  query: string
  hits: SearchHitWithBook[]
  busy: boolean
  error: string | null
  open: boolean
  page: number
  /** 阅读中贴在阅读顶栏下；样式微调用 */
  reading: boolean
  onToggle: () => void
  onClose: () => void
  onPage: (page: number) => void
  onOpen: (hit: SearchHitWithBook) => void
}) {
  const keyword = query.trim()
  const pages = hitPageCount(hits.length)
  const pageHits = sliceHitsPage(hits, page)
  const groups = groupHitsByBook(pageHits)
  // 正在搜 / 出错时必须展开，否则状态被细条藏掉
  const expanded = open || busy || error !== null

  return (
    <section
      className={`libsearch${reading ? ' libsearch--reading' : ''}${
        expanded ? '' : ' libsearch--collapsed'
      }`}
      aria-label="全库正文搜索"
    >
      <div className="libsearch__head">
        <span className="libsearch__title">{headText({ hits, busy, error })}</span>
        <div className="libsearch__acts">
          <button type="button" className="act" aria-expanded={expanded} onClick={onToggle}>
            {expanded ? '收起' : '展开'}
          </button>
          <button type="button" className="act" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>

      {expanded && (
        <div className="libsearch__body">
          {error !== null ? (
            <p className="libsearch__empty libsearch__empty--error">{error}</p>
          ) : busy ? (
            <p className="libsearch__note">正在搜…</p>
          ) : hits.length === 0 ? (
            <p className="libsearch__empty">正文里没有找到「{keyword}」。</p>
          ) : (
            <>
              {groups.map((group) => (
                <div className="libsearch__group" key={group.bookId}>
                  <p className="libsearch__ghead">
                    《{group.bookTitle}》本页 {group.count} 处
                  </p>
                  <ul className="libsearch__list">
                    {group.hits.map((hit) => {
                      const snippet = snippetOf(hit.text, keyword)
                      return (
                        <li key={hit.chunkId}>
                          <button
                            type="button"
                            className="libsearch__item"
                            title={hit.headingPath || undefined}
                            onClick={() => onOpen(hit)}
                          >
                            <span className="libsearch__chapter">
                              {hit.headingPath || '未命名章节'}
                            </span>
                            <span className="libsearch__snippet">
                              {snippet.before}
                              {snippet.hit !== '' && (
                                <mark className="libsearch__mark">{snippet.hit}</mark>
                              )}
                              {snippet.after}
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}

              {pages > 1 && (
                <div className="libsearch__pager">
                  <button
                    type="button"
                    className="act"
                    disabled={page <= 0}
                    onClick={() => onPage(page - 1)}
                  >
                    上一页
                  </button>
                  <span className="libsearch__page">
                    第 {page + 1} / {pages} 页
                  </span>
                  <button
                    type="button"
                    className="act"
                    disabled={page + 1 >= pages}
                    onClick={() => onPage(page + 1)}
                  >
                    下一页
                  </button>
                </div>
              )}

              {hits.length >= 60 && (
                <p className="libsearch__note">
                  只显示相关度最高的 60 条，可以再补几个关键词缩小范围。
                </p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  )
}

function headText({
  hits,
  busy,
  error
}: {
  hits: SearchHitWithBook[]
  busy: boolean
  error: string | null
}): string {
  if (busy) return '正在搜正文…'
  if (error !== null) return '正文搜索未完成'
  return `正文里找到 ${hits.length} 处`
}
