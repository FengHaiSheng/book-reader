import { toRange } from 'foliate-js/epubcfi.js'
import type { ReaderLayout } from './layout'
import { localParts, pointCfi } from './cfi'

/** 取页首位置时探的坐标：正文区左上角往里缩一点，保证落在第一行文字里 */
const PROBE_X = 2
const PROBE_Y = 2

/**
 * 一章的分页与定位。
 *
 * 排版交给 CSS 多栏：章节文档是一个固定页高、`column-fill: auto` 的多栏容器，
 * 内容横向溢出到看不见的地方。翻页就是给 body 加一个负的 translateX ——
 * 不逐字测量，也不去加宽 iframe（加宽了浏览器会自己多开一栏，页数就全错了）。
 *
 * 位置的真身是 `offset`（当前位移，像素），页码由它除以步长换算出来。
 * 这样重排时只要把 offset 按新步长缩放一次、再用 CFI 纠正一次，
 * 就不会出现「读到第 8 页，改个字号跳回第 1 页」。
 *
 * 用 translate 而不是 scrollLeft，是因为 XHTML 章节可能被解析成 XML 文档，
 * 而 XML 文档没有 `document.scrollingElement`，滚动语义不可靠。
 */
export class ChapterPaginator {
  private pagination: ReaderLayout
  private offset = 0

  constructor(
    private readonly doc: Document,
    pagination: ReaderLayout,
    /** 本章在 spine 中的下标，用来拼 CFI 的第一段 */
    private readonly spineIndex: number
  ) {
    this.pagination = pagination
    this.apply()
  }

  private get step(): number {
    return this.pagination.step
  }

  private apply(): void {
    const body = this.doc.body
    if (!body) return
    body.style.transform = this.offset === 0 ? '' : `translateX(${-this.offset}px)`
  }

  /** 位移落位并夹在 [0, 最后一页]，防止翻过头出现空白页 */
  private settle(offset: number): void {
    const max = Math.max(0, (this.pages - 1) * this.step)
    this.offset = Math.min(Math.max(0, offset), max)
    this.apply()
  }

  /**
   * 内容的真实总宽。
   *
   * `scrollWidth` 在 Chromium 上是否把多栏溢出的列算进来并不稳定，
   * 所以同时看最后一个元素的右边界，取大者。两个量都是「客户端坐标之差」，
   * 与当前 translate 无关。
   */
  private contentWidth(): number {
    const body = this.doc.body
    if (!body) return this.pagination.frameWidth
    const last = body.lastElementChild
    const fromLast = last
      ? last.getBoundingClientRect().right - body.getBoundingClientRect().left
      : 0
    return Math.max(this.pagination.frameWidth, body.scrollWidth, fromLast)
  }

  get pages(): number {
    return Math.max(1, Math.ceil(this.contentWidth() / this.step))
  }

  get page(): number {
    return Math.round(this.offset / this.step)
  }

  goToPage(page: number): void {
    this.settle(page * this.step)
  }

  /** 返回是否真的翻了页；到边界返回 false，由调用方决定要不要换章 */
  next(): boolean {
    if (this.page >= this.pages - 1) return false
    this.goToPage(this.page + 1)
    return true
  }

  prev(): boolean {
    if (this.page <= 0) return false
    this.goToPage(this.page - 1)
    return true
  }

  /** 本章内的阅读比例（0–1）：翻到本章最后一页即为 1 */
  chapterFraction(): number {
    return (this.page + 1) / this.pages
  }

  /**
   * 当前页左上角那个字的位置。
   *
   * 用 `caretRangeFromPoint` 而不是数元素：分栏之后一个元素可能被拆到两页，
   * 只有「屏幕左上角是什么字」才是与页面对应的真实锚点。
   */
  currentCfi(): string {
    const range = this.pageStartRange()
    return pointCfi(this.doc, range.startContainer, range.startOffset, this.spineIndex)
  }

  private pageStartRange(): Range {
    const hit = this.doc.caretRangeFromPoint(PROBE_X, PROBE_Y)
    if (hit) return hit
    const fallback = this.doc.createRange()
    const body = this.doc.body
    if (body) fallback.selectNodeContents(body)
    fallback.collapse(true)
    return fallback
  }

  /** 把 rect 从「视口坐标」换算成「内容坐标」 */
  private contentLeftOf(rect: DOMRect): number {
    return rect.left + this.offset
  }

  private settleAt(contentX: number): void {
    this.settle(Math.floor(contentX / this.step) * this.step)
  }

  /** 把定位点移到 CFI 所在页；CFI 坏掉或找不到节点时返回 false，由调用方兜底 */
  goToCfi(cfi: string): boolean {
    const parts = localParts(cfi)
    if (!parts) return false
    let range: Range
    try {
      range = toRange(this.doc, parts)
    } catch {
      return false
    }
    this.settleAt(this.contentLeftOf(range.getBoundingClientRect()))
    return true
  }

  /** 跳到某个元素（书内锚点链接用）；找不到返回 false */
  goToElement(id: string): boolean {
    const element = this.doc.getElementById(id)
    if (!element) return false
    const range = this.doc.createRange()
    range.selectNode(element)
    this.settleAt(this.contentLeftOf(range.getBoundingClientRect()))
    return true
  }

  /**
   * 重排：字号、行距、每行字数、窗口大小变了都走这里。
   *
   * 顺序不能反 —— 调用方必须先把 iframe 尺寸与文档内样式改好，再调它，
   * 否则量到的是旧版式的坐标。
   */
  relayout(pagination: ReaderLayout): void {
    const anchor = this.currentCfi()
    const carried = this.offset * (this.step > 0 ? pagination.step / this.step : 1)
    this.pagination = pagination
    // 锚点定位失败时退化成按比例换算的位置，绝不无声地回到第一页
    if (!this.goToCfi(anchor)) this.settle(carried)
  }
}
