import { parentPort, workerData } from 'node:worker_threads'
import { initKf8File, initMobiFile } from '@lingo-reader/mobi-parser'
import { initFb2File } from '@lingo-reader/fb2-parser'
import type {
  KindleExtract,
  KindleKind,
  KindleRawTocItem,
  KindleWorkerReply
} from './types'

type Payload = { kind: KindleKind | 'fb2'; sourcePath: string; mediaDir: string }

type TocSource = { label: string; href: string; children?: TocSource[] }

/**
 * 两个解析包的 class 都带私有字段，TypeScript 里不能互相赋值，
 * 这里只声明我们真正用到的公共方法。
 */
type BookParser = {
  getMetadata(): {
    title?: string
    author?: string | string[] | { name?: string; firstName?: string; lastName?: string }
    publisher?: string
    language?: string
  }
  getSpine(): { id: string }[]
  loadChapter(id: string): { html: string } | undefined
  getToc(): TocSource[] | undefined
  resolveHref(href: string): { id: string } | undefined
  getCoverImage(): string
}

const { kind, sourcePath, mediaDir } = workerData as Payload

const post = (reply: KindleWorkerReply): void => {
  parentPort?.postMessage(reply)
}

/** 解析器把资源写成绝对路径；章节里统一改成相对 media/，协议层才认得。 */
function rewriteResources(html: string, dir: string): string {
  const bases = [dir, dir.replace(/\\/g, '/')]
  let out = html
  for (const base of bases) {
    const prefix = base.endsWith('/') ? base : `${base}/`
    for (const value of [prefix, `file://${prefix}`, encodeURI(prefix)]) {
      out = out.split(value).join('../media/')
    }
  }
  return out
}

async function loadParser(): Promise<BookParser> {
  if (kind === 'fb2') return (await initFb2File(sourcePath, mediaDir)) as unknown as BookParser
  if (kind === 'kf8') return (await initKf8File(sourcePath, mediaDir)) as unknown as BookParser
  return (await initMobiFile(sourcePath, mediaDir)) as unknown as BookParser
}

function mapToc(items: TocSource[] | undefined, parser: BookParser): KindleRawTocItem[] {
  if (!items) return []
  return items.map((item) => ({
    label: item.label,
    id: parser.resolveHref(item.href)?.id ?? null,
    children: mapToc(item.children, parser)
  }))
}

/** Kindle 的 author 是字符串数组，FB2 的是一个 Author 对象，统一成一行。 */
function authorName(author: ReturnType<BookParser['getMetadata']>['author']): string | null {
  if (!author) return null
  if (typeof author === 'string') return author || null
  if (Array.isArray(author)) return author.filter(Boolean).join(', ') || null
  const name =
    author.name ??
    [author.firstName, author.lastName].filter((part) => part && part.trim()).join(' ')
  return name || null
}

async function run(): Promise<void> {
  const parser = await loadParser()
  const metadata = parser.getMetadata()
  const spine = parser.getSpine()
  const chapters: KindleExtract['chapters'] = []

  for (const [index, item] of spine.entries()) {
    const chapter = parser.loadChapter(item.id)
    chapters.push({ id: item.id, html: rewriteResources(chapter?.html ?? '', mediaDir) })
    post({ type: 'progress', done: index + 1, total: spine.length })
  }

  post({
    type: 'done',
    result: {
      metadata: {
        title: metadata.title || '',
        author: authorName(metadata.author),
        publisher: metadata.publisher || null,
        language: metadata.language || null,
        isbn: null
      },
      chapters,
      toc: mapToc(parser.getToc(), parser),
      coverPath: parser.getCoverImage() || null
    }
  })

  // 不能调 parser.destroy()：解析器会异步删掉刚刚写进 media/ 的所有资源，
  // 而 worker 紧接着就被 terminate，哪些文件被删取决于竞态。worker 退出后内存自然回收。
}

void run().catch((error: unknown) => {
  post({
    type: 'error',
    message: '解析这本 Kindle 书籍失败了',
    detail: error instanceof Error ? error.message : String(error)
  })
})
