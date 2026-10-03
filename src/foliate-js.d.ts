/**
 * foliate-js 是纯 .js 无类型声明，这里只声明我们真正用到的五个导出。
 * 多声明等于给未来埋一个「以为有类型保护」的坑，所以不补它其余的部分。
 */
declare module 'foliate-js/epubcfi.js' {
  export type CfiPart = { index: number; id?: string; offset?: number }

  /** 折叠的 CFI 是「各层路径」的数组；区间 CFI 是带 start/end 的对象 */
  export type ParsedCfi =
    | CfiPart[][]
    | { parent: CfiPart[][]; start: CfiPart[][]; end: CfiPart[][] }

  export function parse(cfi: string): ParsedCfi
  export function joinIndir(...xs: string[]): string
  export function fromRange(range: Range): string
  export function toRange(doc: Document, parts: CfiPart[][]): Range
  export const fake: {
    fromIndex(index: number): string
    toIndex(parts: CfiPart[][]): number
  }
}
