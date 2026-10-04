import type { AiTask } from '@shared/ai'
import type { ChatMessage } from './params'

export const CITATION_RULE =
  '引用原文时必须在句末用 [1] [2] 这样的方括号数字标注依据，数字对应下面「参考资料」里的编号。' +
  '没有依据的话不要标。不要编造参考资料里没有的内容。'

export const SUMMARY_SCHEMA =
  '{"overview":"一段话概括本章","keyPoints":["要点1","要点2"],"terms":[{"term":"术语","gloss":"一句话释义"}]}'

export const DIGEST_SCHEMA =
  '{"threads":["主题脉络1","主题脉络2"],"arguments":["核心论点1","核心论点2"],"conclusion":"全书结论"}'

export const TERMS_SCHEMA = '{"terms":[{"term":"概念","gloss":"一句话释义","where":"出现在哪一章"}]}'

export type Passage = { index: number; headingPath: string; text: string }

export type PromptContext = {
  bookTitle: string
  chapterTitle: string | null
  /** 划词任务里的选中原文 */
  excerpt?: string
  question?: string
  passages?: readonly Passage[]
  chapterText?: string
  summaries?: readonly { chapterTitle: string; overview: string; keyPoints: readonly string[] }[]
}

const NO_MARKDOWN_RULE =
  '直接给结果，不要开场白，不要「好的」「以下是」，不要用代码块包裹整段回答。'

/**
 * 每个任务的提示词都在这里，改一个字就要升 PROMPT_VERSION。
 *
 * 提示词与输出结构写在一起，是为了让「加了字段但忘了改 prompt」这类错误在
 * 类型检查与单测阶段就暴露。
 */
export function buildMessages(task: AiTask, context: PromptContext): ChatMessage[] {
  const where = [
    `书名：《${context.bookTitle}》`,
    context.chapterTitle ? `当前章节：${context.chapterTitle}` : null
  ]
    .filter((line): line is string => line !== null)
    .join('\n')

  switch (task) {
    case 'ask': {
      return [
        {
          role: 'system',
          content: `你是这本书的阅读助手，只根据提供的原文回答，不确定就说不确定。${CITATION_RULE}\n${NO_MARKDOWN_RULE}`
        },
        {
          role: 'user',
          content: [
            where,
            context.excerpt ? `\n我选中的原文：\n"""\n${context.excerpt}\n"""` : '',
            `\n我的问题：${context.question ?? ''}`,
            renderPassages(context.passages ?? [])
          ].join('\n')
        }
      ]
    }

    case 'explain': {
      return [
        {
          role: 'system',
          content: `你是中文阅读助手。用平实的中文解释这段原文在说什么，必要时补充背景。${NO_MARKDOWN_RULE}`
        },
        {
          role: 'user',
          content: [
            where,
            `\n请解释这段原文：\n"""\n${context.excerpt ?? ''}\n"""`,
            renderPassages(context.passages ?? [])
          ].join('\n')
        }
      ]
    }

    case 'translate': {
      return [
        {
          role: 'system',
          content: `你是翻译。若原文是外文就译成简体中文，若已是中文就译成英文。只输出译文。${NO_MARKDOWN_RULE}`
        },
        {
          role: 'user',
          content: [where, `\n原文：\n"""\n${context.excerpt ?? ''}\n"""`].join('\n')
        }
      ]
    }

    case 'chapterSummary': {
      // 长章节会被切成几段先各自小结（map），再在这里合成一份（reduce）。
      // 没有这条路的话，超长章节只能整体截断，小结会丢掉后半章。
      if (context.summaries && context.summaries.length > 0) {
        return [
          {
            role: 'system',
            content:
              '下面是一章被分段读完后得到的几份小结。请合并成一份完整的小结，去掉重复，不要逐条罗列。' +
              `只输出 JSON，结构必须是：\n${SUMMARY_SCHEMA}`
          },
          { role: 'user', content: `${where}\n\n${renderSummaries(context.summaries)}` }
        ]
      }

      return [
        {
          role: 'system',
          content:
            '你是读书笔记助手。读完这一章后给出结构化小结，只依据正文，不要引入外部知识。' +
            `只输出 JSON，结构必须是：\n${SUMMARY_SCHEMA}`
        },
        {
          role: 'user',
          content: [where, `\n本章正文：\n"""\n${context.chapterText ?? ''}\n"""`].join('\n')
        }
      ]
    }

    case 'bookDigest': {
      if (context.summaries && context.summaries.length > 0) {
        return [
          {
            role: 'system',
            content:
              '你在为整本书做要点汇总。下面是逐章小结，请归纳出贯穿全书的主题脉络、核心论点与结论。' +
              `只输出 JSON，结构必须是：\n${DIGEST_SCHEMA}`
          },
          { role: 'user', content: `${where}\n\n${renderSummaries(context.summaries)}` }
        ]
      }

      return [
        {
          role: 'system',
          content:
            '你在为整本书做要点汇总。先为这一章提炼它承担的内容，只依据正文。' +
            `只输出 JSON，结构必须是：\n${SUMMARY_SCHEMA}`
        },
        {
          role: 'user',
          content: [`${where}（这是本章）`, `\n本章正文：\n"""\n${context.chapterText ?? ''}\n"""`].join('\n')
        }
      ]
    }

    case 'terms': {
      const rendered =
        context.summaries
          ?.map((summary) => `${summary.chapterTitle}：${summary.overview}`)
          .join('\n') ?? ''
      return [
        {
          role: 'system',
          content:
            '你在整理这本书里的关键词与概念。`where` 字段只能写下面资料里出现过的章节名，**不要编造**。' +
            `只输出 JSON，结构必须是：\n${TERMS_SCHEMA}`
        },
        { role: 'user', content: [where, `\n资料：\n${rendered}`].join('\n') }
      ]
    }
  }
}

/** 小结渲染成文本。reduce 的输入就是这个形状，两处任务共用一份，避免格式漂移。 */
function renderSummaries(
  summaries: readonly { chapterTitle: string; overview: string; keyPoints: readonly string[] }[]
): string {
  return summaries
    .map((summary) => `${summary.chapterTitle}：${summary.overview}\n  - ${summary.keyPoints.join('\n  - ')}`)
    .join('\n\n')
}

/** 编号必须与 Citation.index 一致，界面上的 [n] 才能跳对地方 */
function renderPassages(passages: readonly Passage[]): string {
  if (passages.length === 0) return ''
  const body = passages.map((passage) => `[${passage.index}] ${passage.text}`).join('\n\n')
  return `\n参考资料（每段前的数字就是引用编号）：\n${body}`
}