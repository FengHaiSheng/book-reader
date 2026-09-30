export type EpubMetadata = {
  title: string
  author: string | null
  publisher: string | null
  language: string | null
  isbn: string | null
}

export type ManifestItem = {
  id: string
  /** 已按 OPF 所在目录解析好的 zip entry 名 */
  entry: string
  mediaType: string
  properties: string
}

export type ParsedOpf = {
  metadata: EpubMetadata
  manifest: ManifestItem[]
  /** 按 spine 顺序，linear 为 false 的也保留，由调用方决定怎么用 */
  spine: { entry: string; linear: boolean }[]
  /** manifest 里 media-type 为 ncx 的 item id，没有则为 null */
  ncxId: string | null
  /** 封面图的 zip entry 名，找不到则为 null */
  coverEntry: string | null
}

/** 目录树节点。href 已经解析成 zip entry 名。 */
export type TocNode = {
  title: string
  entry: string
  children: TocNode[]
}

/** 单个 spine 文档的抽取结果 */
export type SpineText = {
  entry: string
  text: string
  /** 文档里的第一个 h1–h6 或 <title>，用于给没有目录项的章节起名 */
  heading: string | null
}

/** 落库前的章节行。parentIndex 指向同一数组里的下标，NULL 表示无父。 */
export type ChapterRow = {
  title: string
  entry: string
  depth: number
  parentIndex: number | null
  orderIndex: number | null
  charStart: number | null
  charEnd: number | null
}

export type ChunkDraft = {
  orderIndex: number
  text: string
  tokenCount: number
}
