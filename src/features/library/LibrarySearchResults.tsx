import type { SearchHitWithBook } from '@shared/types'
import { snippetOf } from '../reader/search'
import { groupHitsByBook } from './hits'

/** 与主进程 searchAllChunks 的默认 LIMIT 一致：命中数到了这里就是被截断了，必须明说 */
const LIMIT = 60
/** 每本书最多摆几条，再多只给一行「另有 N 处」 */
const PER_BOOK = 5

/**
 * 书架下方展开的全库正文搜索结果。
 *
 * 结果数组的顺序由主进程的 bm25 定好，这里只做保序分组（groupHitsByBook），不重排 ——
 * 摘要一律走书内查找那套 `snippetOf`，不另写第二套截断逻辑，否则两处的「命中词」会漂移。
 *
 * 展不展开只影响命中列表：正在搜与出错时结果区必须露出来，
 * 否则那两条状态会被折叠开关一起藏掉。
 */
export function LibrarySearchResults({
  query,
  hits,
  busy,
  error,
  open,
  onToggle,
  onOpen
}: {
  /** 这一批命中用的关键词（不是书名筛选框里的实时值） */
  query: string
  hits: SearchHitWithBook[]
  busy: boolean
  error: string | null
  open: boolean
  onToggle: () => void
  onOpen: (hit: SearchHitWithBook) => void
}) {
  const keyword = query.trim()
  const groups = groupHitsByBook(hits)
  const expanded = open || busy || error !== null

  return (
    <section className="libsearch" aria-label="全库正文搜索">
      <div className="libsearch__head">
        <span className="libsearch__title">{headText({ hits, busy, error })}</span>
        <button type="button" className="act" aria-expanded={expanded} onClick={onToggle}>
          {expanded ? '收起' : '展开'}
        </button>
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
                    《{group.bookTitle}》 {group.count} 处
                  </p>
                  <ul className="libsearch__list">
                    {group.hits.slice(0, PER_BOOK).map((hit) => {
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
                  {group.count > PER_BOOK && (
                    <p className="libsearch__more">另有 {group.count - PER_BOOK} 处</p>
                  )}
                </div>
              ))}

              {hits.length >= LIMIT && (
                <p className="libsearch__note">
                  只显示相关度最高的 {LIMIT} 条，可以再补几个关键词缩小范围。
                </p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  )
}

/**
 * 标题行的口径。四件事分开说：正在搜 / 这次搜索没走通（失败或关键词切不出词）/ 找到几处。
 * 具体原因（错误原文、纯标点提示、一条都没找到）一律写在结果区里，不挤在这一行。
 */
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
