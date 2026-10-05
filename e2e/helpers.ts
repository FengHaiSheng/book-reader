import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication } from 'playwright'

/**
 * 每次启动都用一个全新的临时 userData 目录，保证测试之间互不污染，
 * 也保证不会碰到开发者本机的真实书库。
 */
export async function launchApp(): Promise<ElectronApplication> {
  return launchAppWithUserData(mkdtempSync(join(tmpdir(), 'book-read-e2e-')))
}

/** 指定目录启动，用于验证「重启后仍然存在」这类需要跨进程持久化的行为 */
export async function launchAppWithUserData(userDataDir: string): Promise<ElectronApplication> {
  return electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    env: { ...process.env, NODE_ENV: 'test' }
  })
}

export type AiStubOptions = {
  /** /embeddings 回 404：模拟「声明里有、这个账号没开通」 */
  noEmbed?: boolean
  /** 带 response_format 的请求回 400：模拟「声明说支持、实际不支持」 */
  rejectJsonMode?: boolean
  /** 流式回答的分片，默认带一个 [1] 引用 */
  deltas?: string[]
  /** 非流式（结构化）回答的正文，会被塞进 choices[0].message.content */
  payload?: Record<string, unknown>
}

/**
 * 把主进程的 `fetch` 换成一个确定性桩。
 *
 * 为什么不改 baseURL：`PROVIDER_AI` 的 baseURL 是随版本写死的常量，渲染进程也没有改它的接口。
 * 而 `chat` / `embed` 都是裸调 `fetch` —— 换掉主进程的 `globalThis.fetch` 是最小侵入的做法：
 * 被测的编排、串行队列、SSE 解析、结果落库全都照常跑，只有最外面那一层网络被换掉了。
 */
export async function installAiStub(
  app: ElectronApplication,
  options: AiStubOptions = {}
): Promise<void> {
  await app.evaluate((_electron, opts: AiStubOptions) => {
    const state = { chat: 0, embed: 0, prompts: [] as string[] }
    const scope = globalThis as unknown as {
      __aiStub: typeof state
      fetch: typeof fetch
    }
    scope.__aiStub = state
    const original = globalThis.fetch

    const reply = (body: unknown, status = 200): Response =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' }
      })

    // 8 维假向量：够让余弦有点区分度，又不必和真实维度对齐
    const vectorOf = (text: string): number[] =>
      Array.from({ length: 8 }, (_, index) => ((text.charCodeAt(index % text.length) || 1) % 97) / 97)

    scope.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}

      if (url.endsWith('/embeddings')) {
        state.embed += 1
        if (opts.noEmbed) return reply({ error: { message: 'embeddings is not supported' } }, 404)
        const texts = (body.input ?? []) as string[]
        return reply({
          data: texts.map((text) => ({ embedding: vectorOf(text) })),
          usage: { total_tokens: texts.reduce((sum, text) => sum + text.length, 0) }
        })
      }

      if (url.endsWith('/chat/completions')) {
        state.chat += 1
        // 记下实际发出去的提示词：有些 bug 不看请求体是发现不了的
        // （比如「正文被截断逻辑挤成空串」——请求次数、返回结果都照常）
        state.prompts.push(
          ((body.messages ?? []) as { content?: string }[])
            .map((message) => message.content ?? '')
            .join('\n')
        )
        if (opts.rejectJsonMode && body.response_format) {
          return reply({ error: { message: 'response_format is not supported' } }, 400)
        }
        if (body.stream) {
          const chunks = opts.deltas ?? ['这句话的意思是', '它在写河边的月色[1]。']
          const frames = chunks
            .map(
              (text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`
            )
            .join('')
          const usage = `data: ${JSON.stringify({
            choices: [{ delta: {} }],
            usage: { prompt_tokens: 120, completion_tokens: 18 }
          })}\n\n`
          return new Response(`${frames}${usage}data: [DONE]\n\n`, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' }
          })
        }
        return reply({
          choices: [{ message: { content: JSON.stringify(opts.payload ?? {}) } }],
          usage: { prompt_tokens: 300, completion_tokens: 40 }
        })
      }

      return original(input, init)
    }) as typeof fetch
  }, options)
}

/** 已经花出去的请求次数：用来断言「重新生成没有再调模型」 */
export async function aiCallCount(
  app: ElectronApplication
): Promise<{ chat: number; embed: number }> {
  return app.evaluate(
    () =>
      (globalThis as unknown as { __aiStub?: { chat: number; embed: number } }).__aiStub ?? {
        chat: 0,
        embed: 0
      }
  )
}

/**
 * 每次对话请求实际发出去的提示词全文（按发生顺序）。
 *
 * 用来断言「正文真的被送进模型了」这类只有看请求体才能发现的问题：
 * 请求次数与返回内容都可能完全正常，只有提示词里是空的。
 */
export async function aiPrompts(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(
    () => (globalThis as unknown as { __aiStub?: { prompts?: string[] } }).__aiStub?.prompts ?? []
  )
}
