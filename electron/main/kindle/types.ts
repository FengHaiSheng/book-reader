import type { EpubMetadata } from '../epub/types'

/** Kindle 容器：mobi/azw 走 PalmDOC 解析器，azw3 走 KF8 解析器。 */
export type KindleKind = 'mobi' | 'kf8'

/** 解析线程只负责解包；纯文本与标题在主进程里算，线程不依赖 htmlparser2。 */
export type KindleRawChapter = { id: string; html: string }

export type KindleRawTocItem = { label: string; id: string | null; children: KindleRawTocItem[] }

export type KindleExtract = {
  metadata: Omit<EpubMetadata, 'isbn'> & { isbn: null }
  chapters: KindleRawChapter[]
  toc: KindleRawTocItem[]
  /** 解析器把封面写到 media 目录后的绝对路径；没有封面为 null */
  coverPath: string | null
}

export type KindleWorkerReply =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; result: KindleExtract }
  | { type: 'error'; message: string; detail?: string }
