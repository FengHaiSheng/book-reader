import { Fragment, type ReactNode } from 'react'
import type { AiDegrade, AiUsage, Citation } from '@shared/types'
import { parseBlocks, type Block, type Inline } from './text'

/**
 * 面板里的一条消息。
 *
 * 用户消息与助手消息共用一个类型：历史从 `ai_messages` 读回来时只有 role 与 content，
 * 分成两个类型会让「从库里读」这条路径要写两次映射。
 */
export type Turn = {
  /** 助手消息用 requestId，用户消息用 `${requestId}:u` —— 流式增量靠它命中 */
  id: string
  role: 'user' | 'assistant'
  text: string
  /** 用户消息里附带的选段原文 */
  excerpt?: string
  state: 'queued' | 'streaming' | 'done' | 'failed'
  usage: AiUsage | null
  citations: Citation[]
  degraded: AiDegrade[]
  /** state 为 failed 时的中文说明，与 text 并存（已经流出来的半截回答不删） */
  error?: string
}

export function AiMessage({
  turn,
  onCitation
}: {
  turn: Turn
  /** 不传就不给引用加跳转——历史记录没有引用映射，只能当普通文字 */
  onCitation?: (citation: Citation) => void
}) {
  if (turn.role === 'user') {
    return (
      <div className="ai-msg ai-msg--user">
        {turn.excerpt && <blockquote className="ai-msg__quote">{turn.excerpt}</blockquote>}
        {turn.text !== '' && <p className="ai-msg__say">{turn.text}</p>}
      </div>
    )
  }

  if (turn.state === 'queued') {
    return (
      <div className="ai-msg ai-msg--assistant">
        <p className="ai-msg__status">排队中：前面还有一段在生成，轮到它就会开始。</p>
      </div>
    )
  }

  return (
    <div className={`ai-msg ai-msg--assistant${turn.state === 'failed' ? ' ai-msg--failed' : ''}`}>
      {turn.degraded.map((item) => (
        <p key={item.kind} className="ai-degrade" role="status">
          {item.message}
        </p>
      ))}

      <div className="ai-msg__body">
        {parseBlocks(turn.text).map((block, index) => (
          <BlockView key={index} block={block} citations={turn.citations} onCitation={onCitation} />
        ))}
        {turn.state === 'streaming' && <span className="ai-msg__caret" aria-hidden="true" />}
      </div>

      {turn.error && (
        <p className="ai-msg__status ai-msg__status--error" role="status">
          {turn.error}
        </p>
      )}

      {turn.state === 'done' && (
        <p className="ai-msg__meta">
          {turn.usage
            ? `本次用量：输入 ${turn.usage.inputTokens} / 输出 ${turn.usage.outputTokens} token`
            : '本次用量未返回'}
        </p>
      )}
    </div>
  )
}

function BlockView({
  block,
  citations,
  onCitation
}: {
  block: Block
  citations: readonly Citation[]
  onCitation?: (citation: Citation) => void
}) {
  if (block.kind === 'paragraph') {
    return (
      <p className="ai-msg__p">
        <InlineRun inline={block.inline} citations={citations} onCitation={onCitation} />
      </p>
    )
  }
  const items: ReactNode[] = block.items.map((inline, index) => (
    <li key={index}>
      <InlineRun inline={inline} citations={citations} onCitation={onCitation} />
    </li>
  ))
  return block.kind === 'bullet' ? (
    <ul className="ai-msg__list">{items}</ul>
  ) : (
    <ol className="ai-msg__list">{items}</ol>
  )
}

function InlineRun({
  inline,
  citations,
  onCitation
}: {
  inline: readonly Inline[]
  citations: readonly Citation[]
  onCitation?: (citation: Citation) => void
}) {
  return (
    <>
      {inline.map((item, index) => {
        if (item.kind === 'text') return <Fragment key={index}>{item.value}</Fragment>
        if (item.kind === 'strong') return <strong key={index}>{item.value}</strong>

        const citation = citations.find((entry) => entry.index === item.index)
        // 模型编了个不存在的编号时按普通文字显示：宁可看起来没链接，也不要给一个点了没反应的上标
        if (!citation || !onCitation) return <Fragment key={index}>[{item.index}]</Fragment>

        return (
          <button
            key={index}
            type="button"
            className="ai-cite"
            title={`回到原文：${citation.chapterTitle ?? '本章'} · ${citation.excerpt}`}
            onClick={() => onCitation(citation)}
          >
            {item.index}
          </button>
        )
      })}
    </>
  )
}