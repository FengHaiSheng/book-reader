# AI 能力层 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** BYOK 接入 DeepSeek / 通义 / 智谱 / Kimi，做到：AI 永不后台自动调用、能力缺失时在 UI 上明说、检索在无向量能力时可用且有据可查、结构化任务可中断可续、每个结论都能跳回原文。

**Architecture:** 网络请求与密钥全在主进程。四家都用 OpenAI 兼容的 `/chat/completions`，所以只有**一个** `OpenAICompatProvider`，差异收敛到 `shared/ai.ts` 里的四份**内置能力声明**与参数映射表——运行时不做任何探测（每次探测都是花用户的钱）。SSE 分片经 IPC 单通道流给渲染进程，同一时刻只允许一个请求在跑。检索走计划 02 已建好的中文 bigram FTS；向量索引是显式动作、可断点续。结果一律写 `ai_results`，命中唯一键即复用。

**Tech Stack:** Electron / TypeScript / better-sqlite3 / Node `fetch` + `AbortController` / vitest / Playwright

**Spec:** [2026-09-29-book-reader-design.md](../specs/2026-09-29-book-reader-design.md)（§5 全节、§3.5 引用回跳、§2.2 `ai_results` / `ai_messages`、§4.6 设置页）

**依赖：** 计划 01（shell、SQLite、设置、密钥）、02（chunks、chunks_fts、bigram、books 目录）、04（划词浮条、笔记页）。计划 04 的 Task 4 建了划词浮条，本计划的「问 AI / 解释 / 翻译」是往那个浮条上**加按钮**。

---

## Prerequisites

- 计划 01–04 已全部落地，`npm test` 与 `npm run e2e` 全绿。
- `git config user.name` / `user.email` 已配置（否则每个 Task 的 commit 步骤会失败）。
- 手头至少要有一家的可测试 key，否则 Task 2 的「真发一次请求」那一步只能跳过——但**不要把 key 写进任何文件**，Task 2 的 e2e 用的是本地打桩的 HTTP 服务。

---

## 计划拆分说明

| 计划 | 内容 | 交付物 |
|---|---|---|
| 01–03 | 骨架与数据层 / 导入管线 / 阅读器渲染 | 能读书 |
| 04 | 标注、批注、笔记页、导出 Markdown | 能划词、写笔记、导出 |
| **05（本文）** | Provider、降级、检索、任务、引用回跳 | 能问 AI |
| 06 | 书架完善与打包 | 能装给别人用 |

### 三条硬规则在本计划里的落点

| 规则 | 落点 |
|---|---|
| **AI 永不后台自动调用** | 全计划没有任何 `useEffect` 会自己发请求；`ai_results` 命中即复用（Task 3）；向量索引只有「建立向量索引」按钮能触发（Task 5）；`ai:chat` 是 `invoke`，由用户动作直接引起（Task 6） |
| **能力降级要明说** | 能力表常驻设置页（Task 10）；无 embedding 时候选面板顶部常驻提示条（Task 7）；JSON mode 缺失导致解析失败时按纯文本展示并说明（Task 3 + Task 8）；上下文不够时明说送入了 N 段（Task 4 + Task 8） |
| **正文每行约 34 字** | 本计划不碰正文排版；AI 面板内的正文引用片段用 `--body-size` 派生字号，不引入新的字号体系 |

### 有意不做的四件事

1. **不做多 key 轮换、不做代理池**（spec §5.7 明确排除）。
2. **不做运行时能力探测**——只在真实调用返回「不支持」时才把该项写进 `settings` 记为不可用（`ai.caps.<providerId>`），下次直接按不可用走降级。
3. **不做对话历史编辑与重新生成**。历史只读，重问就是新发一条（`ai_messages` 追加）。
4. **思维导图不调模型**（spec §5.4 明确）：它是「关键词与概念」结果的纯函数派生。

---

## File Structure

新增文件与各自职责：

```
shared/
  ai.ts                              # 任务枚举、提示词版本、能力声明、模型清单、参数映射（纯数据 + 纯函数）
electron/main/ai/
  params.ts                          # 请求体构造与参数夹取（纯函数）
  sse.ts                             # SSE 分片解析（纯函数）
  loose-json.ts                      # 模型乱格式 JSON 的容错解析（纯函数）
  retry.ts                           # HTTP 错误分类与重试判定（纯函数）
  provider.ts                        # OpenAICompatProvider：chat / embed / test
  queue.ts                           # 单通道串行队列（同一时刻一个请求）
  prompts.ts                         # 每个任务的提示词模板（纯函数）
  repo.ts                            # ai_results / ai_messages 读写、能力表持久化
  retrieve.ts                        # 检索与 token 预算截断（纯函数 + 读写分离）
  citations.ts                       # 引用编号 ↔ chunk 映射（纯函数）
  index-builder.ts                   # 向量索引：计算、断点续、余弦检索
  vector.ts                          # 余弦、Top-K、BLOB 往返（纯函数）
  mindmap.ts                         # 关键词结果 → 思维导图树（纯函数，**不调模型**）
  tasks.ts                           # 结构化任务编排：本章小结、全书要点 map-reduce、关键词、思维导图
electron/main/ipc/
  ai.ts                              # ai:* 全部 handler（含流式与进度事件）
src/features/ai/
  AiPanel.tsx                        # 右侧 AI 面板：会话流 + 输入区 + 顶部状态条
  AiMessage.tsx                      # 单条消息（流式文本 + 引用上标 + 用量 + 降级条）
  AiTasks.tsx                        # 本章小结 / 全书要点 / 关键词 / 思维导图四个按钮与结果
  text.ts                            # 模型输出的极简解析：块 / 行内标记 / [n] 引用（纯函数）
  AiIndexBar.tsx                     # 「建立向量索引」确认、进度与停止
src/features/reader/
  locate.ts                          # 引用摘录 → 章节正文里的 Range（纯函数 + 一个 DOM 包装）
tests/
  ai-caps.test.ts                    # 能力声明完整性、参数夹取
  ai-params.test.ts                  # 请求体构造与参数夹取
  ai-sse.test.ts                     # SSE 分片解析（含跨分片切断的半个 data 行）
  ai-json.test.ts                    # 乱格式 JSON 容错
  ai-retry.test.ts                   # 错误分类与重试判定
  ai-queue.test.ts                   # 单通道串行队列
  ai-prompts.test.ts                 # 提示词模板
  ai-citations.test.ts               # 引用编号映射
  ai-retrieve.test.ts                # token 估算、章节窗口、预算截断
  ai-vector.test.ts                  # 余弦、Top-K、BLOB 往返
  ai-text.test.ts                    # 极简 markdown 与引用切分
  ai-mindmap.test.ts                 # 关键词结果 → 思维导图树
  ai-locate.test.ts                  # 引用摘录的空白归一化与分区定位
e2e/
  ai.spec.ts                         # 打桩 fetch：流式回答 + 引用上标 + 回跳 + 历史落库 + 结果复用
  ai-degrade.spec.ts                 # 无 embedding / 无 JSON mode / 上下文超预算三条降级提示
```

需要修改的既有文件：

```
shared/ipc.ts                        # 追加 ai 通道与 API_SHAPE.ai
shared/types.ts                      # 追加 ai_messages 视图类型、AiSettings 与 AiResultView
shared/highlights.ts                 # 追加 CITATION_FLASH_NAME（回跳闪烁的注册名）
electron/main/ai/tasks.ts            # askJson 在真报不支持时降级重试并记入能力表；超预算被丢的段落要在结果里明说
electron/main/ai/index-builder.ts    # embeddings 真报不支持时记入能力表
electron/main/ai/prompts.ts          # 追加「分段小结 → 本章小结」的 reduce 分支
electron/main/ai/retrieve.ts         # 追加 slicesOf（长文本按预算切片）
electron/main/ipc/index.ts           # 注册 ai handler
electron/preload/index.ts            # 追加 ai 白名单（含两个事件订阅）
src/features/reader/SelectionToolbar.tsx # 浮条上加「问 AI / 解释 / 翻译」
src/features/reader/paginator.ts     # 追加 goToExcerpt（引用回跳落点）
src/features/reader/highlights.ts    # 追加 flashRange（回跳后的短暂高亮）
src/features/reader/theme.ts         # 追加 ::highlight(cite-flash) 配色
src/features/reader/ReaderPage.tsx   # 面板挂载、划词入口、引用回跳
src/features/settings/ModelSection.tsx   # 模型选择、测试连接、常驻能力表
src/styles/base.css                  # 面板、消息、引用上标、能力表样式
fixtures/make-epub.ts                # 追加 aiBookFiles（多章、可指定段落长度）
e2e/helpers.ts                       # 追加 installAiStub / aiCallCount
```

**面板开合状态放在 `ReaderPage` 而不是 `App`。** 阅读器本身就是 `App` 在 `reading !== null` 时渲染的全屏视图，面板随它一起挂载、退出时一起卸载；提到 `App` 只会多一个需要同步清理的状态。计划 04 已经让 `App` 持有 `ReadingTarget`，这里不再往它身上加东西。

---

### Task 1: 能力声明与模型清单

这一 Task 是整个 AI 层的地基：**所有差异都以数据形式集中在这里**，运行时代码只读它、不改它。

**Files:**
- Create: `shared/ai.ts`
- Test: `tests/ai-caps.test.ts`

- [ ] **Step 1: 写失败的测试**

`tests/ai-caps.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import {
  AI_TASKS,
  CAPABILITY_LABELS,
  PROMPT_VERSION,
  PROVIDER_AI,
  clampTemperature,
  hasCapability,
  modelsFor
} from '../shared/ai'
import { PROVIDERS } from '../shared/types'

describe('能力声明', () => {
  it('四家 provider 都有声明，且 baseURL 与 shared/types.ts 里的 PROVIDERS 一致', () => {
    for (const provider of PROVIDERS) {
      const declared = PROVIDER_AI[provider.id]
      expect(declared, provider.id).toBeTruthy()
      expect(declared.baseURL).toBe(provider.baseURL)
    }
  })

  it('每家都至少有一个模型，且 id 不重复', () => {
    for (const provider of PROVIDERS) {
      const models = modelsFor(provider.id)
      expect(models.length, provider.id).toBeGreaterThan(0)
      expect(new Set(models.map((m) => m.id)).size).toBe(models.length)
    }
  })

  it('能力表的每一行都能在四家声明上读出「支持 / 不支持」', () => {
    for (const row of CAPABILITY_LABELS) {
      for (const provider of PROVIDERS) {
        expect(typeof hasCapability(provider.id, row.key)).toBe('boolean')
      }
    }
  })

  it('声明了 embed 的就必须有 embedModel 与 embedDim', () => {
    for (const provider of PROVIDERS) {
      const caps = PROVIDER_AI[provider.id]
      if (caps.embed) {
        expect(caps.embedModel, provider.id).toBeTruthy()
        expect(caps.embedDim, provider.id).toBeGreaterThan(0)
      }
    }
  })

  it('DeepSeek 与 Kimi 不提供 embedding —— 这是降级路径要覆盖的真实情况', () => {
    expect(PROVIDER_AI.deepseek.embed).toBe(false)
    expect(PROVIDER_AI.kimi.embed).toBe(false)
  })

  it('温度夹取到各家允许的区间', () => {
    expect(clampTemperature('zhipu', 1.8)).toBe(1)
    expect(clampTemperature('deepseek', 1.8)).toBe(1.8)
    expect(clampTemperature('kimi', -1)).toBe(0)
  })

  it('任务枚举与提示词版本是稳定字符串', () => {
    expect(AI_TASKS).toContain('chapterSummary')
    expect(AI_TASKS).toContain('bookDigest')
    expect(PROMPT_VERSION).toMatch(/^v\d+$/)
  })
})
```

- [ ] **Step 2: 跑它，确认失败**

Run: `npx vitest run tests/ai-caps.test.ts`

Expected: FAIL —— 无法解析 `../shared/ai`。

- [ ] **Step 3: 写能力声明**

`shared/ai.ts`：

```ts
import { PROVIDERS, type ProviderId } from './types'

/** 每个任务的 prompt 都要带版本号：改提示词等于让缓存自动失效，用户不需要理解这件事 */
export const PROMPT_VERSION = 'v1'

export const AI_TASKS = [
  'ask',
  'explain',
  'translate',
  'chapterSummary',
  'bookDigest',
  'terms'
] as const

export type AiTask = (typeof AI_TASKS)[number]

export type ChatModel = {
  id: string
  label: string
  /** 该模型是否接受 response_format: { type: 'json_object' } */
  jsonMode: boolean
  /** 输入侧的上下文窗口（token），用于预算截断 */
  maxContext: number
}

/** 能力表的行。key 必须在 AiCaps 上有同名布尔字段。 */
export const CAPABILITY_LABELS = [
  { key: 'stream', label: '流式输出', fallback: '将改为一次性返回，等待期间面板显示「生成中」' },
  { key: 'embed', label: '向量检索', fallback: '将改为关键词检索 + 当前章节窗口，跨章节召回会变弱' },
  { key: 'jsonMode', label: '结构化输出', fallback: '将改为提示词约束 + 解析容错，仍失败则按纯文本展示' },
  { key: 'vision', label: '图片理解', fallback: '本产品暂不使用图片，无影响' }
] as const

export type CapabilityKey = (typeof CAPABILITY_LABELS)[number]['key']

export type AiCaps = Record<CapabilityKey, boolean> & {
  /** 输出侧上限，参数映射要夹取 max_tokens */
  maxOutputTokens: number
  /** 单次请求允许送出的最大 token；小于模型窗口，留出输出空间 */
  maxInputTokens: number
  embedModel?: string
  embedDim?: number
  /** 一次 embeddings 请求最多带几条；超了要分批，否则 400 */
  embedBatch?: number
}

export type ProviderAi = AiCaps & {
  baseURL: string
  models: readonly ChatModel[]
  /** 温度允许区间，参数映射要夹取 */
  temperatureRange: readonly [number, number]
}

/**
 * 内置能力声明，随版本更新。
 *
 * 运行时**不做探测**：探测请求本身就是花钱的调用，而且探测结果在限流时并不可信。
 * 只有真实调用返回「不支持」时，才把该项写进 settings 的 `ai.caps.<providerId>` 记为不可用。
 */
export const PROVIDER_AI: Record<ProviderId, ProviderAi> = {
  deepseek: {
    baseURL: PROVIDERS.find((p) => p.id === 'deepseek')!.baseURL,
    stream: true,
    embed: false,
    jsonMode: true,
    vision: false,
    maxOutputTokens: 8192,
    maxInputTokens: 64_000,
    temperatureRange: [0, 2],
    models: [
      { id: 'deepseek-chat', label: 'deepseek-chat', jsonMode: true, maxContext: 64_000 },
      { id: 'deepseek-reasoner', label: 'deepseek-reasoner', jsonMode: false, maxContext: 64_000 }
    ]
  },
  qwen: {
    baseURL: PROVIDERS.find((p) => p.id === 'qwen')!.baseURL,
    stream: true,
    embed: true,
    jsonMode: true,
    vision: false,
    maxOutputTokens: 8192,
    maxInputTokens: 120_000,
    embedModel: 'text-embedding-v3',
    embedDim: 1024,
    embedBatch: 10,
    temperatureRange: [0, 2],
    models: [
      { id: 'qwen-plus', label: 'qwen-plus', jsonMode: true, maxContext: 128_000 },
      { id: 'qwen-turbo', label: 'qwen-turbo', jsonMode: true, maxContext: 128_000 },
      { id: 'qwen-max', label: 'qwen-max', jsonMode: true, maxContext: 32_000 }
    ]
  },
  zhipu: {
    baseURL: PROVIDERS.find((p) => p.id === 'zhipu')!.baseURL,
    stream: true,
    embed: true,
    jsonMode: true,
    vision: false,
    maxOutputTokens: 4095,
    maxInputTokens: 120_000,
    embedModel: 'embedding-3',
    embedDim: 2048,
    embedBatch: 64,
    temperatureRange: [0, 1],
    models: [
      { id: 'glm-4-plus', label: 'glm-4-plus', jsonMode: true, maxContext: 128_000 },
      { id: 'glm-4-air', label: 'glm-4-air', jsonMode: true, maxContext: 128_000 }
    ]
  },
  kimi: {
    baseURL: PROVIDERS.find((p) => p.id === 'kimi')!.baseURL,
    stream: true,
    embed: false,
    jsonMode: true,
    vision: false,
    maxOutputTokens: 8192,
    maxInputTokens: 120_000,
    temperatureRange: [0, 1],
    models: [
      { id: 'moonshot-v1-8k', label: 'moonshot-v1-8k', jsonMode: true, maxContext: 8_000 },
      { id: 'moonshot-v1-32k', label: 'moonshot-v1-32k', jsonMode: true, maxContext: 32_000 },
      { id: 'moonshot-v1-128k', label: 'moonshot-v1-128k', jsonMode: true, maxContext: 128_000 }
    ]
  }
}

export function modelsFor(providerId: ProviderId): readonly ChatModel[] {
  return PROVIDER_AI[providerId].models
}

export function modelOf(providerId: ProviderId, modelId: string): ChatModel | null {
  return modelsFor(providerId).find((m) => m.id === modelId) ?? null
}

export function hasCapability(providerId: ProviderId, key: CapabilityKey): boolean {
  return PROVIDER_AI[providerId][key]
}

export function clampTemperature(providerId: ProviderId, value: number): number {
  const [min, max] = PROVIDER_AI[providerId].temperatureRange
  if (Number.isNaN(value)) return min
  return Math.min(max, Math.max(min, value))
}
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `npx vitest run tests/ai-caps.test.ts`

Expected: PASS，7 passed。

- [ ] **Step 5: Commit**

```bash
git add shared/ai.ts tests/ai-caps.test.ts
git commit -m "feat: AI 能力声明与模型清单（四家内置、运行时零探测）"
```

---

### Task 2: 纯逻辑层——参数映射、SSE 解析、宽松 JSON

这三件事都必须能被单测穷举，所以先做纯函数，Task 3 再包上网络。

**Files:**
- Create: `electron/main/ai/params.ts`, `electron/main/ai/sse.ts`, `electron/main/ai/loose-json.ts`
- Test: `tests/ai-params.test.ts`, `tests/ai-sse.test.ts`, `tests/ai-json.test.ts`

- [ ] **Step 1: 写三个失败的测试**

`tests/ai-params.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { buildChatBody, buildEmbedBody } from '../electron/main/ai/params'

describe('buildChatBody', () => {
  it('夹取 max_tokens 与 temperature', () => {
    const body = buildChatBody('zhipu', 'glm-4-plus', {
      messages: [{ role: 'user', content: '你好' }],
      maxTokens: 99999,
      temperature: 5
    })
    expect(body.max_tokens).toBe(4095)
    expect(body.temperature).toBe(1)
  })

  it('jsonMode 为 true 时带 response_format，为 false 时彻底不带这个字段', () => {
    const withJson = buildChatBody('deepseek', 'deepseek-chat', {
      messages: [],
      json: true,
      maxTokens: 100
    })
    expect(withJson.response_format).toEqual({ type: 'json_object' })

    const noJson = buildChatBody('deepseek', 'deepseek-reasoner', {
      messages: [],
      json: true,
      maxTokens: 100
    })
    expect('response_format' in noJson).toBe(false)
  })

  it('不传 temperature 时不写这个字段，交给服务商默认值', () => {
    const body = buildChatBody('kimi', 'moonshot-v1-8k', { messages: [], maxTokens: 64 })
    expect('temperature' in body).toBe(false)
  })

  it('stream 为 true 时带上 stream_options，让服务商回传用量', () => {
    const body = buildChatBody('qwen', 'qwen-plus', { messages: [], maxTokens: 64, stream: true })
    expect(body.stream).toBe(true)
    expect(body.stream_options).toEqual({ include_usage: true })
  })

  it('模型不存在时抛错，而不是悄悄用别的模型', () => {
    expect(() => buildChatBody('kimi', 'gpt-4', { messages: [], maxTokens: 64 })).toThrow(/模型/)
  })
})

describe('buildEmbedBody', () => {
  it('按 embedBatch 分批', () => {
    const batches = buildEmbedBody('zhipu', Array.from({ length: 130 }, (_, i) => `第 ${i} 段`))
    expect(batches).toHaveLength(3)
    expect(batches[0]!.input).toHaveLength(64)
    expect(batches[2]!.input).toHaveLength(2)
  })

  it('不支持 embedding 的 provider 抛错', () => {
    expect(() => buildEmbedBody('deepseek', ['x'])).toThrow(/向量/)
  })
})
```

`tests/ai-sse.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { SseDecoder } from '../electron/main/ai/sse'

describe('SseDecoder', () => {
  it('一个分片里有多条 data 行', () => {
    const decoder = new SseDecoder()
    const events = decoder.push('data: {"a":1}\n\ndata: {"a":2}\n\n')
    expect(events.map((e) => e.raw)).toEqual(['{"a":1}', '{"a":2}'])
  })

  it('半个 data 行跨分片时先攒着，不吐半截 JSON', () => {
    const decoder = new SseDecoder()
    expect(decoder.push('data: {"choi')).toEqual([])
    const events = decoder.push('ce":"月亮"}\n\n')
    expect(events).toHaveLength(1)
    expect(events[0]!.raw).toBe('{"choice":"月亮"}')
  })

  it('识别 [DONE] 标记', () => {
    const decoder = new SseDecoder()
    const events = decoder.push('data: [DONE]\n\n')
    expect(events[0]!.done).toBe(true)
  })

  it('忽略注释行与空行，容忍 CRLF', () => {
    const decoder = new SseDecoder()
    const events = decoder.push(': keep-alive\r\n\r\ndata: {"x":1}\r\n\r\n')
    expect(events).toHaveLength(1)
    expect(events[0]!.raw).toBe('{"x":1}')
  })
})
```

`tests/ai-json.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { parseLooseJson } from '../electron/main/ai/loose-json'

describe('parseLooseJson', () => {
  it('直接是 JSON', () => {
    expect(parseLooseJson('{"a":1}')).toEqual({ a: 1 })
  })

  it('被 ``` 包裹', () => {
    expect(parseLooseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
  })

  it('前后有解释性废话', () => {
    expect(parseLooseJson('好的，这是结果：\n{"a":1}\n希望有帮助！')).toEqual({ a: 1 })
  })

  it('尾部多一个逗号', () => {
    expect(parseLooseJson('{"a":1,}')).toEqual({ a: 1 })
  })

  it('单引号与中文引号', () => {
    expect(parseLooseJson("{'a':'月亮'}")).toEqual({ a: '月亮' })
  })

  it('彻底解析不出来时返回 null，不抛错', () => {
    expect(parseLooseJson('这不是 JSON')).toBeNull()
    expect(parseLooseJson('')).toBeNull()
  })

  it('数组也能解析', () => {
    expect(parseLooseJson('[1,2,3]')).toEqual([1, 2, 3])
  })
})
```

- [ ] **Step 2: 跑它们，确认失败**

Run: `npx vitest run tests/ai-params.test.ts tests/ai-sse.test.ts tests/ai-json.test.ts`

Expected: FAIL —— 三个模块都不存在。

- [ ] **Step 3: 写参数映射**

`electron/main/ai/params.ts`：

```ts
import { PROVIDER_AI, clampTemperature, modelOf } from '@shared/ai'
import type { ProviderId } from '@shared/types'

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export type ChatBodyInput = {
  messages: readonly ChatMessage[]
  maxTokens: number
  temperature?: number
  json?: boolean
  stream?: boolean
}

export type ChatBody = {
  model: string
  messages: ChatMessage[]
  max_tokens: number
  temperature?: number
  response_format?: { type: 'json_object' }
  stream?: boolean
  stream_options?: { include_usage: boolean }
}

/**
 * 唯一的参数映射点。
 *
 * 四家都接受 `max_tokens`，差异在**取值上限**与**温度区间**，以及不支持的模型
 * 必须把 `response_format` 整字段去掉（不是设成 null——有的网关会因此报 400）。
 */
export function buildChatBody(
  providerId: ProviderId,
  modelId: string,
  input: ChatBodyInput
): ChatBody {
  const caps = PROVIDER_AI[providerId]
  const model = modelOf(providerId, modelId)
  if (!model) throw new Error(`这个服务商没有模型「${modelId}」，请到设置里重新选择`)

  const body: ChatBody = {
    model: model.id,
    messages: [...input.messages],
    max_tokens: Math.max(1, Math.min(input.maxTokens, caps.maxOutputTokens))
  }

  if (input.temperature !== undefined) {
    body.temperature = clampTemperature(providerId, input.temperature)
  }

  // 模型自己声明不支持 jsonMode 时也要去掉，不能只看 provider 级
  if (input.json && caps.jsonMode && model.jsonMode) {
    body.response_format = { type: 'json_object' }
  }

  if (input.stream) {
    body.stream = true
    // 带用量是「每条回答下方显示 token 用量」的前提；不支持这个字段的服务商
    // 会忽略它，返回值里 usage 为 null，面板显示「用量未返回」，不编数字。
    body.stream_options = { include_usage: true }
  }

  return body
}

export type EmbedBatch = { model: string; input: string[] }

export function buildEmbedBody(providerId: ProviderId, texts: readonly string[]): EmbedBatch[] {
  const caps = PROVIDER_AI[providerId]
  if (!caps.embed || !caps.embedModel) {
    throw new Error('当前服务商不提供向量能力，不能建立向量索引')
  }
  const size = caps.embedBatch ?? 16
  const batches: EmbedBatch[] = []
  for (let i = 0; i < texts.length; i += size) {
    batches.push({ model: caps.embedModel, input: texts.slice(i, i + size) })
  }
  return batches
}
```

- [ ] **Step 4: 写 SSE 解析**

`electron/main/ai/sse.ts`：

```ts
export type SseEvent = { raw: string; done: boolean }

/**
 * SSE 分片解码器。
 *
 * `fetch` 的 body 分片边界与 SSE 的事件边界毫无关系：一个 `data:` 行完全可能
 * 被切成两半。所以必须自己攒缓冲，只在见到空行（事件分隔符）时才吐事件。
 */
export class SseDecoder {
  private buffer = ''

  push(chunk: string): SseEvent[] {
    this.buffer += chunk
    const events: SseEvent[] = []

    // 事件之间以空行分隔；CRLF 与 LF 都要认
    let index = this.buffer.search(/\r?\n\r?\n/)
    while (index !== -1) {
      const block = this.buffer.slice(0, index)
      const rest = this.buffer.slice(index)
      const match = rest.match(/^\r?\n\r?\n/)
      this.buffer = this.buffer.slice(index + (match ? match[0].length : 2))

      const dataLines = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())

      if (dataLines.length > 0) {
        const raw = dataLines.join('\n')
        events.push({ raw, done: raw.trim() === '[DONE]' })
      }

      index = this.buffer.search(/\r?\n\r?\n/)
    }

    return events
  }

  /** 流结束时把残留缓冲吐出来，避免最后一个事件刚好没有尾随空行时被丢掉 */
  flush(): SseEvent[] {
    if (this.buffer.trim() === '') {
      this.buffer = ''
      return []
    }
    const block = this.buffer
    this.buffer = ''
    const dataLines = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
    if (dataLines.length === 0) return []
    const raw = dataLines.join('\n')
    return [{ raw, done: raw.trim() === '[DONE]' }]
  }
}

/** 从一条 SSE 事件里取正文增量。取不到（心跳、用量帧）就返回空串。 */
export function deltaOf(raw: string): { text: string; usage: Usage | null } {
  const usage: Usage | null = null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { text: '', usage }
  }
  if (typeof parsed !== 'object' || parsed === null) return { text: '', usage }

  const frame = parsed as {
    choices?: { delta?: { content?: string }; finish_reason?: string | null }[]
    usage?: { prompt_tokens?: number; completion_tokens?: number } | null
  }

  const text = frame.choices?.[0]?.delta?.content ?? ''
  if (frame.usage) {
    return {
      text,
      usage: {
        inputTokens: frame.usage.prompt_tokens ?? 0,
        outputTokens: frame.usage.completion_tokens ?? 0
      }
    }
  }
  return { text, usage }
}

export type Usage = { inputTokens: number; outputTokens: number }
```

- [ ] **Step 5: 写宽松 JSON 解析**

`electron/main/ai/loose-json.ts`：

```ts
/**
 * 解析模型给的 JSON。
 *
 * 强模型也不保证每次都吐合法 JSON：可能包在 ``` 里、可能前后加一句「好的，这是结果：」、
 * 可能多一个尾逗号、可能用中文引号。为这些情况各写一次提示词重试是浪费用户的钱，
 * 能本地修的就本地修。
 *
 * 全都修不好就返回 null —— 由调用方决定是「按纯文本展示」还是报错，本函数不抛。
 */
export function parseLooseJson(text: string): unknown {
  const trimmed = text.trim()
  if (trimmed === '') return null

  const direct = tryParse(trimmed)
  if (direct !== undefined) return direct

  const stripped = stripFence(trimmed)
  if (stripped !== trimmed) {
    const fromFence = tryParse(stripped)
    if (fromFence !== undefined) return fromFence
  }

  const sliced = sliceOutermost(trimmed)
  if (sliced !== null) {
    const fromSlice = tryParse(sliced)
    if (fromSlice !== undefined) return fromSlice

    const repaired = repair(sliced)
    if (repaired !== sliced) {
      const fromRepair = tryParse(repaired)
      if (fromRepair !== undefined) return fromRepair
    }

    const balanced = balance(repaired)
    if (balanced !== null) {
      const fromBalance = tryParse(balanced)
      if (fromBalance !== undefined) return fromBalance
    }
  }

  return null
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

/** 去 ```json ... ``` 包裹 */
function stripFence(text: string): string {
  const match = text.match(/^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```$/)
  return match ? match[1]!.trim() : text
}

/** 截出最外层的 { ... } 或 [ ... ]，去掉前后的解释性文字 */
function sliceOutermost(text: string): string | null {
  const firstBrace = text.indexOf('{')
  const firstBracket = text.indexOf('[')
  const candidates = [firstBrace, firstBracket].filter((i) => i !== -1)
  if (candidates.length === 0) return null
  const start = Math.min(...candidates)
  const open = text[start]
  const close = open === '{' ? '}' : ']'
  const end = text.lastIndexOf(close)
  if (end <= start) return null
  return text.slice(start, end + 1)
}

/** 尾逗号、单引号、中文引号 */
function repair(text: string): string {
  return text
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/([{,]\s*)'([^']*)'(\s*:)/g, '$1"$2"$3')
    .replace(/:\s*'([^']*)'/g, ': "$1"')
}

/** 括号没闭合（模型被 max_tokens 截断）时补全，尽力救回已生成的部分 */
function balance(text: string): string | null {
  const stack: string[] = []
  let inString = false
  let escape = false

  for (const ch of text) {
    if (escape) {
      escape = false
      continue
    }
    if (ch === '\\') {
      escape = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === '{' || ch === '[') stack.push(ch)
    else if (ch === '}' || ch === ']') stack.pop()
  }

  if (inString) return null
  if (stack.length === 0) return text

  // 被截断在最值钱的字段上时，直接补闭括号会得到非法 JSON；先把尾部残缺的
  // 键值对切掉，再补。
  let body = text.replace(/,\s*"[^"]*"?\s*:?\s*[^,}\]]*$/, '').replace(/,\s*$/, '')
  const closers = stack
    .slice()
    .reverse()
    .map((open) => (open === '{' ? '}' : ']'))
    .join('')
  return body + closers
}
```

- [ ] **Step 6: 跑测试，确认通过**

Run: `npx vitest run tests/ai-params.test.ts tests/ai-sse.test.ts tests/ai-json.test.ts`

Expected: PASS，5 + 4 + 7 = 16 passed。

若 `ai-json.test.ts` 的「单引号与中文引号」失败，看 `repair` 的两条 replace 顺序：必须先统一成 `"` 再修 `'key': value` 这种形式，反过来会把刚换好的引号再换一次。

- [ ] **Step 7: Commit**

```bash
git add electron/main/ai/params.ts electron/main/ai/sse.ts electron/main/ai/loose-json.ts \
  tests/ai-params.test.ts tests/ai-sse.test.ts tests/ai-json.test.ts
git commit -m "feat: AI 纯逻辑层（参数映射、SSE 分片解码、乱格式 JSON 容错）"
```

---

### Task 3: 错误分类与重试策略

**Files:**
- Create: `electron/main/ai/retry.ts`
- Test: `tests/ai-retry.test.ts`

- [ ] **Step 1: 写失败的测试**

`tests/ai-retry.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { RETRY_DELAY_MS, classifyError, shouldRetry } from '../electron/main/ai/retry'

describe('classifyError', () => {
  it('401 → 配置问题，指向设置页', () => {
    const e = classifyError(401, '{"error":{"message":"Invalid API key"}}')
    expect(e.code).toBe('AI_AUTH')
    expect(e.action).toBe('openSettings')
    expect(e.message).toContain('密钥')
  })

  it('402 / 余额不足 → 配额问题', () => {
    expect(classifyError(402, '').code).toBe('AI_QUOTA')
    expect(classifyError(400, '{"error":{"message":"Insufficient Balance"}}').code).toBe('AI_QUOTA')
  })

  it('429 → 限流，可重试', () => {
    const e = classifyError(429, '')
    expect(e.code).toBe('AI_RATE_LIMIT')
    expect(e.action).toBe('retry')
  })

  it('5xx → 服务端问题，可重试', () => {
    expect(classifyError(503, '').action).toBe('retry')
  })

  it('400 → 参数问题，不可重试，不指向设置页', () => {
    const e = classifyError(400, '{"error":{"message":"model not found"}}')
    expect(e.code).toBe('AI_UNSUPPORTED')
    expect(e.action).toBe('none')
    expect(e.detail).toContain('model not found')
  })

  it('网络层错误 → OFFLINE，可重试', () => {
    const e = classifyError(null, '')
    expect(e.code).toBe('OFFLINE')
    expect(e.action).toBe('retry')
  })

  it('detail 里绝不出现 key', () => {
    const e = classifyError(401, '{"error":{"message":"bad key sk-abcdefghijklmnop3f7a"}}')
    expect(e.detail ?? '').not.toContain('sk-abcdefghijklmnop3f7a')
  })
})

describe('shouldRetry', () => {
  it('只重试一次', () => {
    expect(shouldRetry(classifyError(429, ''), 0)).toBe(true)
    expect(shouldRetry(classifyError(429, ''), 1)).toBe(false)
  })

  it('401 与 400 一次都不重试', () => {
    expect(shouldRetry(classifyError(401, ''), 0)).toBe(false)
    expect(shouldRetry(classifyError(400, ''), 0)).toBe(false)
  })

  it('退避 800ms', () => {
    expect(RETRY_DELAY_MS).toBe(800)
  })
})
```

- [ ] **Step 2: 跑它，确认失败**

Run: `npx vitest run tests/ai-retry.test.ts`

Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 写错误分类**

`electron/main/ai/retry.ts`：

```ts
import { appError, type AppError } from '@shared/errors'

export const RETRY_DELAY_MS = 800

/** detail 会进「查看详情」，所以进这里之前必须先把 key 洗掉 */
const KEY_LIKE = /sk-[A-Za-z0-9_-]{6,}/g

function scrub(text: string): string {
  return text.replace(KEY_LIKE, 'sk-***')
}

/** 取服务商返回体里的 message，取不到就给空串——不要 upsert 整段 HTML 错误页 */
function messageOf(body: string): string {
  if (!body) return ''
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string }; message?: string }
    return scrub(parsed.error?.message ?? parsed.message ?? '')
  } catch {
    return scrub(body.slice(0, 200))
  }
}

/**
 * 把一次失败的 HTTP 响应（或网络层异常）变成四类错误之一。
 *
 * `status` 为 null 表示请求根本没拿到响应（DNS、连接被拒、超时被 abort）。
 */
export function classifyError(status: number | null, body: string): AppError {
  const detail = messageOf(body)

  if (status === null) {
    return appError('OFFLINE', '没能连上模型服务，请检查网络或代理设置', {
      detail,
      action: 'retry'
    })
  }

  if (status === 401 || status === 403) {
    return appError('AI_AUTH', 'API Key 无效或没有权限，请到设置里重新填写', {
      detail,
      action: 'openSettings'
    })
  }

  if (status === 402 || /insufficient|balance|quota|欠费|余额/i.test(detail)) {
    return appError('AI_QUOTA', '账户余额或用量额度不足，请到服务商后台充值后重试', {
      detail,
      action: 'none'
    })
  }

  if (status === 429) {
    return appError('AI_RATE_LIMIT', '请求太频繁，被服务商限流了，稍后会自动重试一次', {
      detail,
      action: 'retry'
    })
  }

  if (status >= 500) {
    return appError('UNKNOWN', '模型服务暂时不可用，稍后会自动重试一次', {
      detail,
      action: 'retry'
    })
  }

  return appError('AI_UNSUPPORTED', '这次请求模型没能处理，换一个模型或缩短提问试试', {
    detail,
    action: 'none'
  })
}

/**
 * 只重试一次。
 *
 * 401 / 400 这类问题重试一百次也是一样的结果，只会让用户看着转圈——直接抛出去，
 * 让界面给出「去设置」或「换模型」。
 */
export function shouldRetry(error: AppError, attempt: number): boolean {
  return error.action === 'retry' && attempt < 1
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `npx vitest run tests/ai-retry.test.ts`

Expected: PASS，10 passed。

- [ ] **Step 5: Commit**

```bash
git add electron/main/ai/retry.ts tests/ai-retry.test.ts
git commit -m "feat: AI 错误四分类与一次性重试（含 key 脱敏）"
```

---

### Task 4: Provider 客户端与单通道串行队列

**Files:**
- Create: `electron/main/ai/provider.ts`, `electron/main/ai/queue.ts`
- Create: `tests/ai-queue.test.ts`
- Test: `tests/ai-queue.test.ts`

- [ ] **Step 1: 写队列的失败测试**

`tests/ai-queue.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { AiQueue } from '../electron/main/ai/queue'

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('AiQueue', () => {
  it('同一时刻只有一个任务在跑，其余排队', async () => {
    const queue = new AiQueue()
    const running: string[] = []
    let concurrent = 0
    let peak = 0

    const job = (name: string) => async (): Promise<string> => {
      concurrent += 1
      peak = Math.max(peak, concurrent)
      running.push(name)
      await tick()
      await tick()
      concurrent -= 1
      return name
    }

    const all = Promise.all([
      queue.run(job('a')),
      queue.run(job('b')),
      queue.run(job('c'))
    ])
    expect(queue.pending).toBe(2)
    expect(await all).toEqual(['a', 'b', 'c'])
    expect(peak).toBe(1)
    expect(running).toEqual(['a', 'b', 'c'])
  })

  it('前一个抛错不会卡死队列', async () => {
    const queue = new AiQueue()
    const first = queue.run(async () => {
      throw new Error('boom')
    })
    const second = queue.run(async () => 'ok')
    await expect(first).rejects.toThrow('boom')
    await expect(second).resolves.toBe('ok')
    expect(queue.pending).toBe(0)
  })

  it('排队中的任务可以被取消，且不会真的执行', async () => {
    const queue = new AiQueue()
    let ran = false
    const first = queue.run(async () => {
      await tick()
      return 1
    })
    const second = queue.run(async () => {
      ran = true
      return 2
    })
    queue.cancel('second', second)
    await expect(first).resolves.toBe(1)
    await tick()
    expect(ran).toBe(false)
  })
})
```

`AiQueue.run` 需要一个稳定的 job key 才能取消。把签名定为 `run<T>(key: string, job: () => Promise<T>): Promise<T>`，上面测试里的 `job('a')` 是返回函数的工厂，包一层即可。为了让上一段测试能用，改成：

```ts
    const all = Promise.all([
      queue.run('a', job('a')),
      queue.run('b', job('b')),
      queue.run('c', job('c'))
    ])
    ...
    queue.cancel('second')
```

先把测试定成这个形态再写实现——下面 Step 2 的实现与之一致。

- [ ] **Step 2: 写队列**

`electron/main/ai/queue.ts`：

```ts
type Entry = {
  key: string
  job: () => Promise<unknown>
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
}

/**
 * 单通道串行队列。
 *
 * 存在的唯一理由：**手快连点、同时开两个面板都不该并发烧钱**。
 * BYOK 产品里一次误并发就是用户账上真实的钱，所以这里不做并发度配置。
 */
export class AiQueue {
  private readonly waiting: Entry[] = []
  private active = false

  get pending(): number {
    return this.waiting.length
  }

  run<T>(key: string, job: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.waiting.push({
        key,
        job: job as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject
      })
      void this.drain()
    })
  }

  /**
   * 取消。只对**还没开始**的任务有效——已经发出去的请求不该被队列取消，
   * 那是请求自己的 AbortController 的事（见 provider.ts 的 cancel）。
   */
  cancel(key: string): void {
    const index = this.waiting.findIndex((entry) => entry.key === key)
    if (index === -1) return
    const [entry] = this.waiting.splice(index, 1)
    entry?.reject(new Error('已取消'))
  }

  /** 队列里还剩哪些 key，界面用它显示「排队中」 */
  queued(): string[] {
    return this.waiting.map((entry) => entry.key)
  }

  private async drain(): Promise<void> {
    if (this.active) return
    this.active = true
    try {
      for (;;) {
        const entry = this.waiting.shift()
        if (!entry) break
        try {
          entry.resolve(await entry.job())
        } catch (error) {
          entry.reject(error)
        }
      }
    } finally {
      this.active = false
    }
  }
}
```

- [ ] **Step 3: 跑测试，确认通过**

Run: `npx vitest run tests/ai-queue.test.ts`

Expected: PASS，3 passed。

- [ ] **Step 4: 写 Provider**

`electron/main/ai/provider.ts`：

```ts
import { PROVIDER_AI } from '@shared/ai'
import { appError, type AppError } from '@shared/errors'
import type { ProviderId } from '@shared/types'
import { getKey } from '../secrets'
import { buildChatBody, buildEmbedBody, type ChatBodyInput, type ChatMessage } from './params'
import { RETRY_DELAY_MS, classifyError, shouldRetry, sleep } from './retry'
import { SseDecoder, deltaOf, type Usage } from './sse'

export type ChatDelta = { text: string }
export type ChatResult = { content: string; usage: Usage | null }

export type ChatOptions = {
  providerId: ProviderId
  model: string
  input: ChatBodyInput
  /** 每来一段正文就回调一次 */
  onDelta?: (delta: ChatDelta) => void
  signal?: AbortSignal
  /** 测试连接时用：拿到第一段就断开 */
  stopAfterFirstDelta?: boolean
}

/** 单次 chat 的原始请求体形状（只列用到的字段） */
type RawFrame = {
  choices?: { delta?: { content?: string }; message?: { content?: string } }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null
  error?: { message?: string }
}

export async function chat(options: ChatOptions): Promise<ChatResult> {
  const caps = PROVIDER_AI[options.providerId]
  const key = getKey(options.providerId)
  if (!key) {
    throw appError('AI_AUTH', '还没有为这个服务商填写 API Key，请到设置里填写', {
      action: 'openSettings'
    })
  }

  const body = buildChatBody(options.providerId, options.model, {
    ...options.input,
    stream: options.input.stream ?? caps.stream
  })

  if (!options.input.stream) {
    // 只有真正要走流式时才置 stream —— buildChatBody 里已经按 caps 处理过，
    // 这里再走一遍非流式路径是为了「provider 声明的 stream 为 false」的情况。
    delete body.stream
    delete body.stream_options
  }

  let attempt = 0
  for (;;) {
    try {
      const response = await fetch(`${caps.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`
        },
        body: JSON.stringify(body),
        signal: options.signal
      })

      if (!response.ok) {
        throw classifyError(response.status, await safeText(response))
      }

      if (body.stream) {
        return await readStream(response, options)
      }
      return await readOnce(response)
    } catch (error) {
      const normalized = normalize(error, options.signal)
      if (normalized.action === 'retry' && shouldRetry(normalized, attempt)) {
        attempt += 1
        await sleep(RETRY_DELAY_MS)
        continue
      }
      throw normalized
    }
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return ''
  }
}

function normalize(error: unknown, signal?: AbortSignal): AppError {
  if (signal?.aborted) {
    return appError('UNKNOWN', '已中断', { action: 'none' })
  }
  if (isAppError(error)) return error
  // fetch 的网络层失败与超时都走这里：拿不到 status
  return classifyError(null, error instanceof Error ? error.message : '')
}

function isAppError(error: unknown): error is AppError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'message' in error &&
    typeof (error as AppError).message === 'string'
  )
}

async function readStream(response: Response, options: ChatOptions): Promise<ChatResult> {
  const decoder = new SseDecoder()
  const reader = response.body?.getReader()
  if (!reader) throw appError('AI_UNSUPPORTED', '模型服务没有返回流式内容')

  const textDecoder = new TextDecoder()
  let content = ''
  let usage: Usage | null = null

  for (;;) {
    const { value, done } = await reader.read()
    if (done) break

    for (const event of decoder.push(textDecoder.decode(value, { stream: true }))) {
      if (event.done) continue
      const parsed = deltaOf(event.raw)
      if (parsed.usage) usage = parsed.usage
      if (!parsed.text) continue
      content += parsed.text
      options.onDelta?.({ text: parsed.text })
      if (options.stopAfterFirstDelta) {
        await reader.cancel().catch(() => undefined)
        return { content, usage }
      }
    }
  }

  for (const event of decoder.flush()) {
    if (event.done) continue
    const parsed = deltaOf(event.raw)
    if (parsed.usage) usage = parsed.usage
    if (parsed.text) {
      content += parsed.text
      options.onDelta?.({ text: parsed.text })
    }
  }

  return { content, usage }
}

async function readOnce(response: Response): Promise<ChatResult> {
  const raw = (await response.json()) as RawFrame
  const content = raw.choices?.[0]?.message?.content ?? ''
  return {
    content,
    usage: raw.usage
      ? {
          inputTokens: raw.usage.prompt_tokens ?? 0,
          outputTokens: raw.usage.completion_tokens ?? 0
        }
      : null
  }
}

/**
 * 填 key 时的验活：只发 1 个 token。
 *
 * 失败必须原样暴露：把一个 401 吞成「保存成功」是最坏的做法——用户会一直到
 * 提问时才发现问题。
 */
export async function testConnection(
  providerId: ProviderId,
  model: string
): Promise<{ ok: true; providerId: ProviderId; model: string }> {
  await chat({
    providerId,
    model,
    input: {
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 1,
      temperature: 0,
      stream: true
    },
    stopAfterFirstDelta: true
  })
  return { ok: true, providerId, model }
}

export type EmbedResult = { vectors: number[][]; inputTokens: number }

/**
 * 计算 embedding。分批请求，每批之间检查 signal，保证可中断。
 */
export async function embed(
  providerId: ProviderId,
  texts: readonly string[],
  signal?: AbortSignal
): Promise<EmbedResult> {
  const caps = PROVIDER_AI[providerId]
  const key = getKey(providerId)
  if (!key) {
    throw appError('AI_AUTH', '还没有为这个服务商填写 API Key，请到设置里填写', {
      action: 'openSettings'
    })
  }

  const batches = buildEmbedBody(providerId, texts)
  const vectors: number[][] = []
  let inputTokens = 0

  for (const batch of batches) {
    if (signal?.aborted) throw appError('UNKNOWN', '已中断', { action: 'none' })
    let attempt = 0
    for (;;) {
      try {
        const response = await fetch(`${caps.baseURL}/embeddings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify(batch),
          signal
        })
        if (!response.ok) throw classifyError(response.status, await safeText(response))

        const payload = (await response.json()) as {
          data?: { embedding: number[] }[]
          usage?: { total_tokens?: number }
        }
        for (const item of payload.data ?? []) vectors.push(item.embedding)
        inputTokens += payload.usage?.total_tokens ?? 0
        break
      } catch (error) {
        const normalized = normalize(error, signal)
        if (normalized.action === 'retry' && shouldRetry(normalized, attempt)) {
          attempt += 1
          await sleep(RETRY_DELAY_MS)
          continue
        }
        throw normalized
      }
    }
  }

  return { vectors, inputTokens }
}

export type { ChatMessage }
```

- [ ] **Step 5: 类型检查**

Run: `npx tsc --noEmit`

Expected: 无错误。若报 `getKey` 找不到，确认计划 01 的 `electron/main/secrets/index.ts` 导出的是 `getKey`（是的，它导出 `setKey` / `getKey` / `clearKey` / `status`）。

- [ ] **Step 6: Commit**

```bash
git add electron/main/ai/provider.ts electron/main/ai/queue.ts tests/ai-queue.test.ts
git commit -m "feat: OpenAICompatProvider（流式 chat、验活、embed）与单通道串行队列"
```

---

### Task 5: 提示词、共享类型与 ai_results 仓储

**Files:**
- Create: `electron/main/ai/prompts.ts`, `electron/main/ai/repo.ts`
- Modify: `shared/types.ts`
- Test: `tests/ai-prompts.test.ts`

- [ ] **Step 1: 追加共享类型**

`shared/types.ts` 追加（`AiCaps` / `CapabilityKey` / `ChatModel` 来自 `./ai`，用 `import type`）：

```ts
import type { AiCaps, CapabilityKey } from './ai'

export type AiSettings = { providerId: ProviderId; model: string }

export type AiMessageRole = 'user' | 'assistant'

export type AiMessage = {
  id: number
  bookId: string
  chapterId: number | null
  scopeKey: string
  role: AiMessageRole
  content: string
  tokens: number
  createdAt: number
}

/** 回答里 [n] 上标指向的那一段原文 */
export type Citation = {
  index: number
  chunkId: number
  chapterId: number | null
  chapterTitle: string | null
  headingPath: string
  /** 前 30 字，用于回跳时在章节正文里匹配 */
  excerpt: string
}

/**
 * 本次回答的降级说明。
 *
 * 存在的理由就是硬规则 2：能力不足必须在 UI 上明说，不能静默降级。
 * 文案在主进程生成，界面只负责渲染成提示条——避免同一句降级说明散落在多个组件里。
 *
 * 只有划词问答这条路会用到它，三条都对应 `runChat` 里的一次真实判断。
 * 结构化任务的降级走 `AiResultView.note`：那边一次返回一份结果，
 * 再配一个 `degraded` 数组就得让界面同时读两个地方，反而容易漏。
 */
export type AiDegrade = {
  kind: 'noEmbed' | 'contextTruncated' | 'blindIndex'
  message: string
}

export type AiUsage = { inputTokens: number; outputTokens: number }

export type AiChatResult = {
  requestId: string
  content: string
  /** 服务商没返回用量时为 null，界面显示「用量未返回」，不编数字 */
  usage: AiUsage | null
  citations: Citation[]
  degraded: AiDegrade[]
}

export type IndexState = { total: number; done: number; running: boolean }

export type AiStatus = {
  providerId: ProviderId
  model: string
  /** 是否已填 key */
  configured: boolean
  caps: AiCaps
  /** 运行中被真实调用标成不可用的能力 */
  unavailable: CapabilityKey[]
  index: IndexState
}

export type AiDegradeEvent = { requestId: string; delta: string }

export type AiProgressEvent = {
  /** 'index' 是建索引，'digest' 是全书要点逐章 map */
  kind: 'index' | 'digest'
  bookId: string
  done: number
  total: number
  label: string
  running: boolean
}

export type ChapterSummaryPayload = {
  overview: string
  keyPoints: string[]
  terms: { term: string; gloss: string }[]
}

export type BookDigestPayload = {
  threads: string[]
  arguments: string[]
  conclusion: string
}

export type TermsPayload = { terms: { term: string; gloss: string; where: string }[] }

export type MindmapNode = { label: string; children: MindmapNode[] }

/**
 * 结构化任务的结果视图。
 *
 * `payload` 为 null 表示模型没给出可用的 JSON——那时 `text` 放它的原文、`note` 说明原因，
 * 界面按纯文本展示。**不出现「什么都没有」的空结果**是硬规则 2 的底线。
 * `usage` 为 null 表示服务商没返回用量（或这次根本没调模型），界面显示「未返回」。
 * `cached` 为 true 表示命中 ai_results 唯一键，这一次没有花钱。
 */
export type AiResultView<T> = {
  payload: T | null
  text: string | null
  cached: boolean
  usage: AiUsage | null
  createdAt: number
  note: string | null
}
```

`shared/types.ts` 顶部已经有 `ProviderId` 与 `ReadingPrefs`，这里的 `import type { AiCaps, CapabilityKey } from './ai'` 加到文件已有的 import 区即可。`shared/ai.ts` 反过来 import `./types` 的 `PROVIDERS`/`ProviderId` —— 这是一个**类型层环**，两边都用 `import type` 取值型数据以外的部分。`shared/ai.ts` 里对 `PROVIDERS` 是运行时取值，`shared/types.ts` 对 `ai.ts` 全是类型，ESM 下不会形成运行时死循环。

- [ ] **Step 2: 写提示词模板的失败测试**

`tests/ai-prompts.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { CITATION_RULE, DIGEST_SCHEMA, SUMMARY_SCHEMA, buildMessages } from '../electron/main/ai/prompts'

const context = {
  bookTitle: '深度工作',
  chapterTitle: '第二章 注意力的形状',
  excerpt: '不是有什么必须处理的事情，只是那个动作本身已经长进了肌肉里。',
  passages: [
    { index: 1, headingPath: '深度工作 > 第二章', text: '手机会持续占用注意力。' },
    { index: 2, headingPath: '深度工作 > 第二章', text: '把手机放到另一个房间。' }
  ]
}

/**
 * 提示词分两条消息：规则与 schema 在 system，资料在 user。
 * 所以「某某规则有没有进 prompt」要合起来看，不能只断 user 那条。
 */
const promptOf = (messages: readonly { content: string }[]): string =>
  messages.map((message) => message.content).join('\n')

describe('buildMessages', () => {
  it('划词问答：system 里有引用规则，user 里有选中的原文与编号片段', () => {
    const messages = buildMessages('ask', { ...context, question: '作者到底在说什么？' })
    expect(messages[0]!.role).toBe('system')
    expect(messages[0]!.content).toContain(CITATION_RULE)
    const user = messages[1]!.content
    expect(user).toContain('作者到底在说什么？')
    expect(user).toContain('不是有什么必须处理的事情')
    expect(user).toContain('[1]')
    expect(user).toContain('把手机放到另一个房间。')
  })

  it('解释与翻译不要引用规则，要的是干净输出', () => {
    const explain = buildMessages('explain', context)
    expect(explain[0]!.content).not.toContain(CITATION_RULE)
    expect(promptOf(explain)).toContain('解释')
    expect(explain[1]!.content).toContain('不是有什么必须处理的事情')
    const translate = buildMessages('translate', context)
    expect(translate[0]!.content).not.toContain(CITATION_RULE)
    expect(promptOf(translate)).toContain('翻译')
  })

  it('本章小结要求 JSON，并把 schema 写进 prompt', () => {
    const messages = buildMessages('chapterSummary', { ...context, chapterText: '全文……' })
    expect(promptOf(messages)).toContain(SUMMARY_SCHEMA)
    expect(promptOf(messages)).toContain('只输出 JSON')
  })

  it('长章节：给了分段小结就走 reduce，不再读一遍正文', () => {
    const reduce = buildMessages('chapterSummary', {
      ...context,
      summaries: [{ chapterTitle: '第二章', overview: '前半段讲了什么', keyPoints: ['A', 'B'] }]
    })
    expect(promptOf(reduce)).toContain('第二章：前半段讲了什么')
    expect(promptOf(reduce)).toContain('  - A')
    expect(promptOf(reduce)).toContain(SUMMARY_SCHEMA)
    expect(reduce[1]!.content).not.toContain('本章正文')
  })

  it('全书要点：给了各章小结就做 reduce，没给就做 map', () => {
    const map = buildMessages('bookDigest', { ...context, chapterText: '本章全文' })
    expect(promptOf(map)).toContain('本章')
    const reduce = buildMessages('bookDigest', {
      ...context,
      summaries: [
        { chapterTitle: '第一章', overview: '开篇', keyPoints: ['A'] },
        { chapterTitle: '第二章', overview: '推进', keyPoints: ['B'] }
      ]
    })
    expect(promptOf(reduce)).toContain('第一章：开篇')
    expect(promptOf(reduce)).toContain('第二章：推进')
    expect(promptOf(reduce)).toContain(DIGEST_SCHEMA)
  })

  it('关键词任务显式禁止编造 —— 位置只能来自给它的片段', () => {
    const messages = buildMessages('terms', {
      ...context,
      summaries: [{ chapterTitle: '第二章', overview: 'x', keyPoints: ['y'] }]
    })
    expect(promptOf(messages)).toContain('不要编造')
    expect(messages[1]!.content).toContain('第二章：x')
  })
})
```

- [ ] **Step 3: 跑它，确认失败**

Run: `npx vitest run tests/ai-prompts.test.ts`

Expected: FAIL —— 模块不存在。

- [ ] **Step 4: 写提示词模板**

`electron/main/ai/prompts.ts`：

```ts
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
```

- [ ] **Step 5: 跑测试，确认通过**

Run: `npx vitest run tests/ai-prompts.test.ts`

Expected: PASS，6 passed。

- [ ] **Step 6: 写仓储**

`electron/main/ai/repo.ts`：

```ts
import type { Database } from 'better-sqlite3'
import { PROMPT_VERSION, type CapabilityKey } from '@shared/ai'
import type { AiMessage, AiMessageRole, AiUsage, ProviderId } from '@shared/types'

export type ResultKey = {
  bookId: string
  task: string
  scopeKey: string
  provider: ProviderId
  model: string
}

export type StoredResult<T> = {
  payload: T
  inputTokens: number
  outputTokens: number
  createdAt: number
}

/**
 * 命中唯一键即复用。
 *
 * 唯一键含 prompt_version 与 model：**改提示词或换模型都自动失效重算**，
 * 用户不需要理解缓存这回事，也不会拿到旧模型的结果。
 */
export function getResult<T>(db: Database.Database, key: ResultKey): StoredResult<T> | null {
  const row = db
    .prepare(
      `SELECT payload, input_tokens AS inputTokens, output_tokens AS outputTokens, created_at AS createdAt
       FROM ai_results
       WHERE book_id = ? AND task = ? AND scope_key = ? AND prompt_version = ? AND model = ?`
    )
    .get(key.bookId, key.task, key.scopeKey, PROMPT_VERSION, key.model) as
    | StoredResult<string>
    | undefined

  if (!row) return null
  try {
    return { ...row, payload: JSON.parse(row.payload) as T }
  } catch {
    // 库里的 payload 坏了就当没缓存：重算一次，比抛错卡住用户强
    return null
  }
}

export function saveResult<T>(
  db: Database.Database,
  key: ResultKey,
  payload: T,
  usage: AiUsage,
  now: number
): void {
  db.prepare(
    `INSERT INTO ai_results
       (book_id, task, scope_key, prompt_version, provider, model, payload, input_tokens, output_tokens, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (book_id, task, scope_key, prompt_version, model)
     DO UPDATE SET payload = excluded.payload,
                   input_tokens = excluded.input_tokens,
                   output_tokens = excluded.output_tokens,
                   created_at = excluded.created_at`
  ).run(
    key.bookId,
    key.task,
    key.scopeKey,
    PROMPT_VERSION,
    key.provider,
    key.model,
    JSON.stringify(payload),
    usage.inputTokens,
    usage.outputTokens,
    now
  )
}

export function listMessages(
  db: Database.Database,
  bookId: string,
  scopeKey: string
): AiMessage[] {
  return db
    .prepare(
      `SELECT id, book_id AS bookId, chapter_id AS chapterId, scope_key AS scopeKey,
              role, content, tokens, created_at AS createdAt
       FROM ai_messages WHERE book_id = ? AND scope_key = ?
       ORDER BY id`
    )
    .all(bookId, scopeKey) as AiMessage[]
}

export function appendMessage(
  db: Database.Database,
  message: {
    bookId: string
    chapterId: number | null
    scopeKey: string
    role: AiMessageRole
    content: string
    tokens: number
  },
  now: number
): AiMessage {
  const info = db
    .prepare(
      `INSERT INTO ai_messages (book_id, chapter_id, scope_key, role, content, tokens, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      message.bookId,
      message.chapterId,
      message.scopeKey,
      message.role,
      message.content,
      message.tokens,
      now
    )
  return {
    id: Number(info.lastInsertRowid),
    ...message,
    tokens: message.tokens,
    createdAt: now
  }
}

export function clearScope(db: Database.Database, bookId: string, scopeKey: string): void {
  db.prepare('DELETE FROM ai_messages WHERE book_id = ? AND scope_key = ?').run(bookId, scopeKey)
}

/**
 * 能力降级要持久化。
 *
 * 只在那里记「不可用」，不记「可用」——下次版本更新把内置声明改回可用时，
 * 用户不需要去清理一个陈旧的阳性记录。
 */
export function markUnavailable(
  db: Database.Database,
  providerId: ProviderId,
  key: CapabilityKey
): void {
  const settingKey = `ai.caps.${providerId}.${key}`
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, 'unavailable')
     ON CONFLICT (key) DO UPDATE SET value = 'unavailable'`
  ).run(settingKey)
}

export function unavailableCaps(db: Database.Database, providerId: ProviderId): CapabilityKey[] {
  const rows = db
    .prepare(`SELECT key FROM settings WHERE key LIKE ? AND value = 'unavailable'`)
    .all(`ai.caps.${providerId}.%`) as { key: string }[]
  return rows
    .map((row) => row.key.split('.').pop())
    .filter((key): key is CapabilityKey => typeof key === 'string')
}
```

`settings` 表在计划 01 里是 `key` 主键的键值表，`ON CONFLICT (key)` 直接可用。

- [ ] **Step 7: 类型检查与全量单测**

Run: `npx tsc --noEmit && npx vitest run tests/ai-prompts.test.ts`

Expected: 无类型错误，6 passed。

若 `shared/types.ts` 报 `AiCaps` 循环引用相关的错，确认 `shared/ai.ts` 里 `import { PROVIDERS, type ProviderId } from './types'` 用的是「运行时值 + 类型混合」形式，而 `shared/types.ts` 里对 `./ai` 只用 `import type`。

- [ ] **Step 8: Commit**

```bash
git add shared/types.ts electron/main/ai/prompts.ts electron/main/ai/repo.ts tests/ai-prompts.test.ts
git commit -m "feat: AI 提示词模板（含长章节 map-reduce）与 ai_results/ai_messages 仓储（唯一键复用、能力降级持久化）"
```

---

### Task 6: 检索、引用编号与 token 预算

检索结果要同时喂给提示词和界面的引用上标，所以**编号在这里就定死**，后面谁都不许再改顺序。

**Files:**
- Create: `electron/main/ai/retrieve.ts`, `electron/main/ai/citations.ts`
- Test: `tests/ai-citations.test.ts`, `tests/ai-retrieve.test.ts`

- [ ] **Step 1: 写失败的测试**

`tests/ai-citations.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { excerptOf, extractMarkers, usedCitations } from '../electron/main/ai/citations'

describe('extractMarkers', () => {
  it('取出所有 [n] 标记，去重并升序', () => {
    expect(extractMarkers('这句话很重要[2]，那句也是[1]，还有[2]。')).toEqual([1, 2])
  })

  it('忽略不是数字的方括号', () => {
    expect(extractMarkers('见 [附录] 与 [注]')).toEqual([])
  })
})

describe('usedCitations', () => {
  const all = [
    { index: 1, chunkId: 11, chapterId: 3, chapterTitle: '第一章', headingPath: '书 > 第一章', excerpt: 'aaa' },
    { index: 2, chunkId: 12, chapterId: 4, chapterTitle: '第二章', headingPath: '书 > 第二章', excerpt: 'bbb' },
    { index: 3, chunkId: 13, chapterId: 4, chapterTitle: '第二章', headingPath: '书 > 第二章', excerpt: 'ccc' }
  ]

  it('只留回答里真的引用到的那些', () => {
    expect(usedCitations('看这里[2]', all).map((c) => c.index)).toEqual([2])
  })

  it('模型引用了不存在的编号时整条丢掉，不生成跳不通的上标', () => {
    expect(usedCitations('看这里[9]', all)).toEqual([])
  })

  it('抽不到引用时返回空数组 —— 界面据此不显示引用区', () => {
    expect(usedCitations('没有任何标注', all)).toEqual([])
  })
})

describe('excerptOf', () => {
  it('去空白后取前 30 字', () => {
    const text = '  这是 一段\n带空白  的原文，长度超过三十个字符，用来验证截取行为是否正确。'
    expect(excerptOf(text)).toBe('这是一段带空白的原文，长度超过三十个字符，用来验证截取')
  })
})
```

`tests/ai-retrieve.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { estimateTokens, fitPassages, windowFromText } from '../electron/main/ai/retrieve'

describe('estimateTokens', () => {
  it('中文按 1 字 ≈ 1 token，拉丁按 4 字符 ≈ 1 token', () => {
    expect(estimateTokens('月亮')).toBe(2)
    expect(estimateTokens('abcdefgh')).toBe(2)
  })

  it('空串为 0', () => {
    expect(estimateTokens('')).toBe(0)
  })
})

describe('windowFromText', () => {
  const text = Array.from({ length: 20 }, (_, i) => `第${i}段内容。`).join('\n')

  it('以 needle 所在段为中心，前后各取 radius 段', () => {
    const window = windowFromText(text, '第10段内容。', 2)
    expect(window).toContain('第8段内容。')
    expect(window).toContain('第10段内容。')
    expect(window).toContain('第12段内容。')
    expect(window).not.toContain('第13段内容。')
  })

  it('needle 找不到时退回开头若干段，而不是空手而归', () => {
    const window = windowFromText(text, '不存在的话', 2)
    expect(window).toContain('第0段内容。')
  })
})

describe('fitPassages', () => {
  const passages = Array.from({ length: 6 }, (_, i) => ({
    index: i + 1,
    headingPath: `书 > 第${i}章`,
    text: 'x'.repeat(100)
  }))

  it('预算够就全留', () => {
    const result = fitPassages(passages, 10_000)
    expect(result.kept).toHaveLength(6)
    expect(result.dropped).toBe(0)
  })

  it('预算不够时从尾部丢，保留前面的高相关段', () => {
    const result = fitPassages(passages, 250)
    expect(result.kept.length).toBeLessThan(6)
    expect(result.kept[0]!.index).toBe(1)
    expect(result.dropped).toBe(6 - result.kept.length)
  })
})
```

- [ ] **Step 2: 跑它们，确认失败**

Run: `npx vitest run tests/ai-citations.test.ts tests/ai-retrieve.test.ts`

Expected: FAIL —— 两个模块都不存在。

- [ ] **Step 3: 写引用工具**

`electron/main/ai/citations.ts`：

```ts
import type { Citation } from '@shared/types'

const MARKER = /\[(\d{1,3})\]/g

/** 回答里出现的引用编号，去重升序。不是数字的方括号（[附录]）不算。 */
export function extractMarkers(answer: string): number[] {
  const found = new Set<number>()
  for (const match of answer.matchAll(MARKER)) {
    found.add(Number(match[1]))
  }
  return [...found].sort((a, b) => a - b)
}

/**
 * 把回答里的编号映射回真实片段。
 *
 * 模型引用了一个不存在的编号（幻觉）时**整条丢掉**：宁可少一个上标，
 * 也不要给用户一个点下去跳不到任何地方的上标。
 */
export function usedCitations(answer: string, all: readonly Citation[]): Citation[] {
  const byIndex = new Map(all.map((citation) => [citation.index, citation]))
  return extractMarkers(answer)
    .map((index) => byIndex.get(index))
    .filter((citation): citation is Citation => citation !== undefined)
}

/** 回跳时用它在章节正文里匹配定位（spec §3.5 的前 30 字） */
export function excerptOf(text: string, length = 30): string {
  return text.replace(/\s+/g, '').slice(0, length)
}
```

- [ ] **Step 4: 写检索与预算**

`electron/main/ai/retrieve.ts`：

```ts
import { toMatchQuery } from '../epub/bigram'
import type { SearchHit } from '@shared/types'

/**
 * token 估算。
 *
 * 不引 tiktoken：它是按 BPE 表算的，四家服务商的表都不一样，算得再准也不等于
 * 计费的 token 数。这里只要一个**保守不超**的估计来做预算截断。
 */
export function estimateTokens(text: string): number {
  let cjk = 0
  let latin = 0
  for (const ch of text) {
    if (/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(ch)) cjk += 1
    else latin += 1
  }
  return cjk + Math.ceil(latin / 4)
}

/**
 * 以 needle 所在段为中心开窗。
 *
 * 这是「就这段话问」场景的主力：bigram 关键词召回在中文短句上偶尔会空手而归，
 * 而用户选中的话一定就在当前章节里，直接从正文开窗最可靠。
 */
export function windowFromText(text: string, needle: string, radius: number): string {
  const paragraphs = text.split(/\n+/)
  const cleaned = needle.replace(/\s+/g, '')
  const hit = paragraphs.findIndex((paragraph) => {
    const flat = paragraph.replace(/\s+/g, '')
    return cleaned !== '' && flat.includes(cleaned.slice(0, Math.min(12, cleaned.length)))
  })

  const center = hit === -1 ? 0 : hit
  const from = Math.max(0, center - radius)
  const to = Math.min(paragraphs.length, center + radius + 1)
  return paragraphs.slice(from, to).join('\n')
}

export type Passage = { index: number; headingPath: string; text: string }

export type FitResult = {
  kept: Passage[]
  /** 因为预算被丢掉了几段 —— 界面要明说「本次只送入了 N 段」 */
  dropped: number
}

/**
 * 按预算截断，**从尾部丢**。
 *
 * 召回结果是按相关度排序的（`searchChunks` 的 `ORDER BY f.score`，bm25 越小越相关），
 * 所以尾部就是最不相关的。丢头部会丢掉最该给模型看的东西。
 */
export function fitPassages(passages: readonly Passage[], budget: number): FitResult {
  const kept: Passage[] = []
  let used = 0
  for (const passage of passages) {
    const cost = estimateTokens(passage.text) + 8
    if (used + cost > budget) break
    used += cost
    kept.push(passage)
  }
  return { kept, dropped: passages.length - kept.length }
}

/**
 * 把检索命中转成带编号的片段。
 *
 * **编号必须从 1 连续**，因为提示词里 `[n]` 直接对应它，模型也会照抄这个数字。
 * 被预算丢掉的段要从映射表里一起删掉，否则会出现「回答里是 [3]、映射表里 [3] 是空」。
 */
export function toPassages(hits: readonly SearchHit[], startIndex = 1): Passage[] {
  return hits.map((hit, offset) => ({
    index: startIndex + offset,
    headingPath: hit.headingPath,
    text: hit.text
  }))
}

export { toMatchQuery }
```

- [ ] **Step 5: 跑测试，确认通过**

Run: `npx vitest run tests/ai-citations.test.ts tests/ai-retrieve.test.ts`

Expected: PASS，3 + 6 = 9 passed。

`windowFromText` 的 needle 匹配只比对前 12 个字符：划词的原文常包含段内换行与空格，整句严格比对容易失手，而前 12 字已经足够定位到唯一一段。

- [ ] **Step 6: Commit**

```bash
git add electron/main/ai/citations.ts electron/main/ai/retrieve.ts \
  tests/ai-citations.test.ts tests/ai-retrieve.test.ts
git commit -m "feat: 检索窗口、token 预算截断与引用编号映射"
```

---

### Task 7: 向量索引——显式触发、可断点续

索引**只有用户点按钮才会建**（硬规则 1）。断点续的判定条件就是 `chunks.embedding IS NULL`，不需要额外的进度表。

**Files:**
- Create: `electron/main/ai/vector.ts`, `electron/main/ai/index-builder.ts`
- Test: `tests/ai-vector.test.ts`

- [ ] **Step 1: 写失败的测试**

`tests/ai-vector.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { blobToVector, cosine, topKByVector, vectorToBlob } from '../electron/main/ai/vector'

describe('cosine', () => {
  it('同向为 1，正交为 0', () => {
    expect(cosine([1, 0], [2, 0])).toBeCloseTo(1)
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0)
  })

  it('零向量返回 0 而不是 NaN —— 否则排序会全乱', () => {
    expect(cosine([0, 0], [1, 1])).toBe(0)
  })

  it('长度不一致时返回 0', () => {
    expect(cosine([1, 2], [1, 2, 3])).toBe(0)
  })
})

describe('topKByVector', () => {
  const items = [
    { id: 1, vector: [1, 0] },
    { id: 2, vector: [0.5, 0.5] },
    { id: 3, vector: [0, 1] }
  ]

  it('按相似度降序取前 K', () => {
    expect(topKByVector(items, [1, 0], 2).map((x) => x.id)).toEqual([1, 2])
  })

  it('K 大于总数时全返回', () => {
    expect(topKByVector(items, [1, 0], 99)).toHaveLength(3)
  })

  it('空输入返回空数组，不抛错', () => {
    expect(topKByVector([], [1, 0], 3)).toEqual([])
  })
})

describe('BLOB 往返', () => {
  it('写进去再读出来，数值一致', () => {
    const source = [0.1, -0.25, 3.5]
    const restored = blobToVector(vectorToBlob(source))
    expect(restored).toHaveLength(3)
    expect(restored[0]).toBeCloseTo(0.1, 5)
    expect(restored[2]).toBeCloseTo(3.5, 5)
  })
})

```

- [ ] **Step 2: 跑它，确认失败**

Run: `npx vitest run tests/ai-vector.test.ts`

Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 写向量工具**

`electron/main/ai/vector.ts`：

```ts
/**
 * 余弦相似度。
 *
 * 长度为 0 或长度不等时返回 0：这两种情况都意味着数据有问题，
 * 返回 NaN 会让整个排序函数的行为不可预测，返回 0 至少是稳定的「不相关」。
 */
export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]!
    const y = b[i]!
    dot += x * y
    normA += x * x
    normB += y * y
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

/** 内存暴力检索。几千个 chunk 是毫秒级，引向量库是过度设计（spec §2.3）。 */
export function topKByVector<T extends { vector: readonly number[] }>(
  items: readonly T[],
  query: readonly number[],
  k: number
): T[] {
  if (items.length === 0 || k <= 0) return []
  return items
    .map((item) => ({ item, score: cosine(item.vector, query) }))
    .sort((left, right) => right.score - left.score)
    .slice(0, k)
    .map((entry) => entry.item)
}

/** Float32 小端存储。SQLite 的 BLOB 就是一段字节，不需要额外的元数据列。 */
export function vectorToBlob(vector: readonly number[]): Buffer {
  return Buffer.from(new Float32Array(vector).buffer)
}

export function blobToVector(blob: Buffer): number[] {
  const copy = new Float32Array(
    blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength)
  )
  return Array.from(copy)
}
```

`blobToVector` 里必须**复制**（`slice` 而不是直接 `new Float32Array(blob.buffer, ...)`）：better-sqlite3 返回的 Buffer 底层内存可能被复用，直接包视图会读到别的行。

- [ ] **Step 4: 跑测试，确认通过**

Run: `npx vitest run tests/ai-vector.test.ts`

Expected: PASS，8 passed。

- [ ] **Step 5: 写索引构建**

`electron/main/ai/index-builder.ts`：

```ts
import type { Database } from 'better-sqlite3'
import type { ProviderId } from '@shared/types'
import { embed } from './provider'
import { vectorToBlob } from './vector'

export type IndexState = { total: number; done: number; running: boolean }
export type IndexProgress = {
  bookId: string
  done: number
  total: number
  label: string
  running: boolean
}

export function indexState(db: Database.Database, bookId: string): IndexState {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN embedding IS NOT NULL THEN 1 ELSE 0 END) AS done
       FROM chunks WHERE book_id = ?`
    )
    .get(bookId) as { total: number; done: number | null }
  return {
    total: row.total,
    done: row.done ?? 0,
    running: running.has(bookId)
  }
}

/** 正在建索引的 bookId → 停止信号。同一时刻只允许一本书在建。 */
const running = new Map<string, { stop: boolean }>()

export function isRunning(bookId: string): boolean {
  return running.has(bookId)
}

export function cancelIndex(bookId: string): void {
  const token = running.get(bookId)
  if (token) token.stop = true
}

/**
 * 建索引。**是显式动作，绝不自动触发。**
 *
 * 断点续靠 `embedding IS NULL` 判定，不另设进度表：中断后重进只算没算过的那些，
 * 已经花过钱的部分不会重算。
 *
 * 换过 embedding 模型时必须把旧向量清空 —— 不同模型的向量空间不同，
 * 混在一起算余弦是在算噪音。
 */
export async function buildIndex(
  db: Database.Database,
  bookId: string,
  providerId: ProviderId,
  onProgress: (progress: IndexProgress) => void
): Promise<IndexState> {
  const previous = db
    .prepare(`SELECT value FROM settings WHERE key = ?`)
    .get(`ai.embedModel.${bookId}`) as { value: string } | undefined
  const current = embedModelOf(providerId)
  if (previous && previous.value !== current) {
    db.prepare('UPDATE chunks SET embedding = NULL WHERE book_id = ?').run(bookId)
  }
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`
  ).run(`ai.embedModel.${bookId}`, current)

  const token = { stop: false }
  running.set(bookId, token)

  const before = indexState(db, bookId)
  onProgress({ bookId, done: before.done, total: before.total, label: '准备中', running: true })

  try {
    for (;;) {
      if (token.stop) break

      const pending = db
        .prepare(
          `SELECT id, text, heading_path AS headingPath FROM chunks
           WHERE book_id = ? AND embedding IS NULL ORDER BY id LIMIT 64`
        )
        .all(bookId) as { id: number; text: string; headingPath: string }[]
      if (pending.length === 0) break

      const result = await embed(providerId, pending.map((row) => row.text))
      if (result.vectors.length !== pending.length) {
        throw new Error('向量服务返回的条数与请求不一致，索引已中止，可以稍后继续')
      }

      // 一个事务写一批：中断发生在批边界，已写入的批次全部保留，可续
      const write = db.transaction(() => {
        const update = db.prepare('UPDATE chunks SET embedding = ? WHERE id = ?')
        pending.forEach((row, index) => {
          update.run(vectorToBlob(result.vectors[index]!), row.id)
        })
      })
      write()

      const now = indexState(db, bookId)
      onProgress({
        bookId,
        done: now.done,
        total: now.total,
        label: pending[pending.length - 1]!.headingPath,
        running: true
      })
    }
  } finally {
    running.delete(bookId)
  }

  const final = indexState(db, bookId)
  onProgress({ bookId, done: final.done, total: final.total, label: '', running: false })
  return final
}

/** 内存里的向量检索。没建索引的行就是没参与，调用方要据此提示降级。 */
export function searchByVector(
  db: Database.Database,
  bookId: string,
  query: readonly number[],
  limit: number
): { chunkId: number; score: number }[] {
  const rows = db
    .prepare('SELECT id, embedding FROM chunks WHERE book_id = ? AND embedding IS NOT NULL')
    .all(bookId) as { id: number; embedding: Buffer }[]

  return topK(
    rows.map((row) => ({ id: row.id, vector: blobToVector(row.embedding) })),
    query,
    limit
  )
}

function topK<T extends { vector: number[] }>(
  items: readonly T[],
  query: readonly number[],
  k: number
): { chunkId: number; score: number }[] {
  return topKByVector(items, query, k).map((item) => ({
    chunkId: (item as unknown as { id: number }).id,
    score: cosine(item.vector, query)
  }))
}

function embedModelOf(providerId: ProviderId): string {
  return PROVIDER_AI[providerId].embedModel ?? ''
}
```

`searchByVector` 里 `topK` 与 `topKByVector` 的重复是刻意的：`topKByVector` 是纯工具（要能被穷举测试），这里要额外带出 `chunkId` 与 `score` 给调用方。把两个拼在一起会让纯函数多一个它不需要的契约。

顶部的两个 import 补全：

```ts
import { PROVIDER_AI } from '@shared/ai'
import { blobToVector, cosine, topKByVector, vectorToBlob } from './vector'
```

- [ ] **Step 6: 类型检查**

Run: `npx tsc --noEmit`

Expected: 无错误。

- [ ] **Step 7: Commit**

```bash
git add electron/main/ai/vector.ts electron/main/ai/index-builder.ts tests/ai-vector.test.ts
git commit -m "feat: 向量索引（显式触发、按 embedding IS NULL 断点续、内存余弦检索）"
```

---

### Task 8: AI 服务编排与 IPC（流式、取消、进度）

**Files:**
- Create: `electron/main/ai/service.ts`, `electron/main/ipc/ai.ts`
- Modify: `shared/ipc.ts`, `electron/main/ipc/index.ts`, `electron/preload/index.ts`

- [ ] **Step 1: 追加通道与契约**

`shared/ipc.ts` 的 `CH` 追加：

```ts
  aiStatus: 'ai:status',
  aiModels: 'ai:models',
  aiTest: 'ai:test',
  aiChat: 'ai:chat',
  aiCancel: 'ai:cancel',
  aiIndexState: 'ai:indexState',
  aiBuildIndex: 'ai:buildIndex',
  aiCancelIndex: 'ai:cancelIndex',
  /** 主 → 渲染 的单向事件，不是 invoke */
  aiDelta: 'ai:delta',
  aiProgress: 'ai:progress'
```

`API_SHAPE` 追加：

```ts
  ai: [
    'status',
    'models',
    'test',
    'chat',
    'cancel',
    'indexState',
    'buildIndex',
    'cancelIndex',
    'onDelta',
    'onProgress'
  ]
```

结构化任务（`chapterSummary` / `bookDigest` / `terms` / `mindmap`）在 Task 10 一起追加，理由与做法都写在那一节：`boundary.spec.ts` 是整表比对的，中途只加一半会让测试红着过好几个 Task。

- [ ] **Step 2: 写服务编排**

`electron/main/ai/service.ts`：

```ts
import type { Database } from 'better-sqlite3'
import { PROVIDER_AI, modelOf } from '@shared/ai'
import { appError, toAppError } from '@shared/errors'
import type {
  AiChatResult,
  AiDegrade,
  AiStatus,
  AiUsage,
  Citation,
  IndexState,
  ProviderId
} from '@shared/types'
import { searchChunks } from '../library/repo'
import { getSetting } from '../store/settings'
import { excerptOf, usedCitations } from './citations'
import { isRunning, indexState } from './index-builder'
import { buildMessages } from './prompts'
import { chat } from './provider'
import { unavailableCaps } from './repo'
import { estimateTokens, fitPassages, toPassages, windowFromText, type Passage } from './retrieve'

export const DEFAULT_AI_MODEL: Record<ProviderId, string> = {
  deepseek: 'deepseek-chat',
  qwen: 'qwen-plus',
  zhipu: 'glm-4-plus',
  kimi: 'moonshot-v1-8k'
}

export function aiSettings(db: Database.Database): { providerId: ProviderId; model: string } {
  const providerId = (getSetting(db, 'ai.provider') ?? 'deepseek') as ProviderId
  const stored = getSetting(db, 'ai.model')
  const fallback = DEFAULT_AI_MODEL[providerId] ?? PROVIDER_AI[providerId].models[0]!.id
  const model = stored && modelOf(providerId, stored) ? stored : fallback
  return { providerId, model }
}

/** 全书级问题的判定词。命中且没有索引时，明说而不是偷偷降级（spec §5.3 方案 C）。 */
const BOOK_LEVEL_HINTS = [
  '全书',
  '整本',
  '整本书',
  '贯穿',
  '总的来说',
  '整体上',
  '作者想表达',
  '主旨',
  '中心思想'
]

export function looksBookLevel(text: string): boolean {
  return BOOK_LEVEL_HINTS.some((hint) => text.includes(hint))
}

type Source = {
  passage: Passage
  chunkId: number
  chapterId: number | null
  chapterTitle: string | null
  headingPath: string
}

export type ChatInput = {
  requestId: string
  bookId: string
  chapterId: number | null
  task: 'ask' | 'explain' | 'translate'
  /** 划词原文 */
  excerpt?: string
  question?: string
  /** 当前章节全文（主进程从 chunks 拼），用于「就这段话问」的窗口 */
  chapterText: string
  scopeKey: string
}

export type ChatHooks = {
  onDelta: (text: string) => void
  signal: AbortSignal
}

/**
 * 划词三件套（问答 / 解释 / 翻译）的完整链路。
 *
 * 顺序是刻意的：**先检索、再截断、最后才建 messages**。反过来做会让
 * 「参考资料」块在预算计算里被算两次，token 估算就对不上了。
 */
export async function runChat(
  db: Database.Database,
  input: ChatInput,
  hooks: ChatHooks
): Promise<AiChatResult> {
  const { providerId, model } = aiSettings(db)
  const caps = PROVIDER_AI[providerId]
  const modelInfo = modelOf(providerId, model)
  if (!modelInfo) throw appError('AI_UNSUPPORTED', '当前模型不在内置清单里，请到设置里重新选择')

  const unavailable = unavailableCaps(db, providerId)
  const degraded: AiDegrade[] = []
  const canEmbed = caps.embed && !unavailable.includes('embed')
  const state = indexState(db, input.bookId)

  if (!canEmbed) {
    degraded.push({
      kind: 'noEmbed',
      message: `${providerIdLabel(providerId)} 不提供向量检索，本次用的是关键词检索 + 当前章节窗口，跨章节召回会变弱。`
    })
  } else if (state.done === 0 && looksBookLevel(`${input.question ?? ''}${input.excerpt ?? ''}`)) {
    degraded.push({
      kind: 'blindIndex',
      message: '这个问题看起来需要跨全书检索，但当前还没有建立向量索引，只用了关键词检索，结果可能不全。'
    })
  }

  const query = (input.question ?? input.excerpt ?? '').trim()
  const hits = query === '' ? [] : searchChunks(db, input.bookId, query, 12)

  const sources: Source[] = toPassages(hits).map((passage, index) => {
    const hit = hits[index]!
    return {
      passage,
      chunkId: hit.chunkId,
      chapterId: hit.chapterId,
      chapterTitle: null,
      headingPath: hit.headingPath
    }
  })

  // 当前章节窗口排在最前：划词提问时它是相关性最高的一段
  const window = windowFromText(input.chapterText, input.excerpt ?? query, 2)
  if (window.trim() !== '') {
    sources.unshift({
      passage: { index: 1, headingPath: '当前章节窗口', text: window },
      chunkId: -1,
      chapterId: input.chapterId,
      chapterTitle: null,
      headingPath: '当前章节窗口'
    })
  }

  // 编号在截断之后才定：被丢掉的段不能占用编号，否则回答里的 [3] 会指向空
  const budget = Math.min(caps.maxInputTokens, modelInfo.maxContext) - 1200 - estimateTokens(query)
  const { kept, dropped } = fitPassages(
    sources.map((source) => source.passage),
    Math.max(200, budget)
  )
  const keptSources = sources.slice(0, kept.length)
  const numbered = keptSources.map((source, index) => ({
    ...source,
    passage: { ...source.passage, index: index + 1 },
    chunkId: source.chunkId
  }))

  if (dropped > 0) {
    degraded.push({
      kind: 'contextTruncated',
      message: `上下文窗口不够，本次只送入了本书 ${numbered.length} 段原文，回答范围受限。`
    })
  }

  const messages = buildMessages(input.task, {
    bookTitle: bookTitleOf(db, input.bookId),
    chapterTitle: chapterTitleOf(db, input.chapterId),
    excerpt: input.excerpt,
    question: input.question,
    passages: numbered.map((source) => source.passage)
  })

  const result = await chat({
    providerId,
    model,
    input: { messages, maxTokens: 2048, temperature: 0.3, stream: caps.stream },
    onDelta: (delta) => hooks.onDelta(delta.text),
    signal: hooks.signal
  })

  const citations: Citation[] = numbered.map((source) => ({
    index: source.passage.index,
    chunkId: source.chunkId,
    chapterId: source.chapterId,
    chapterTitle: chapterTitleOf(db, source.chapterId),
    headingPath: source.headingPath,
    excerpt: excerptOf(source.passage.text)
  }))

  return {
    requestId: input.requestId,
    content: result.content,
    usage: normalizeUsage(result.usage),
    // 只保留回答里真的引用到的：幻觉编号在这里被丢掉
    citations: usedCitations(result.content, citations),
    degraded
  }
}

export function statusOf(db: Database.Database, bookId: string): AiStatus {
  const { providerId, model } = aiSettings(db)
  return {
    providerId,
    model,
    configured: hasKey(providerId),
    caps: PROVIDER_AI[providerId],
    unavailable: unavailableCaps(db, providerId),
    index: indexState(db, bookId)
  }
}

export function normalizeUsage(usage: AiUsage | null): AiUsage | null {
  if (!usage) return null
  return {
    inputTokens: Math.max(0, Math.round(usage.inputTokens)),
    outputTokens: Math.max(0, Math.round(usage.outputTokens))
  }
}

export function toReadable(error: unknown, fallback: string): Error {
  // 渲染进程只能拿到 message，抛对象会变成 `[object Object]`
  return new Error(toAppError(error, fallback).message)
}

function providerIdLabel(providerId: ProviderId): string {
  return PROVIDER_AI[providerId].models[0]?.label ?? providerId
}

function hasKey(providerId: ProviderId): boolean {
  // 延迟 require：provider.ts 依赖 electron 的 safeStorage，服务层不该在
  // 纯单测环境里被它牵连
  return getKeySafe(providerId) !== null
}

function getKeySafe(providerId: ProviderId): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const secrets = require('../secrets') as { getKey: (id: string) => string | null }
    return secrets.getKey(providerId)
  } catch {
    return null
  }
}

export function bookTitleOf(db: Database.Database, bookId: string): string {
  const row = db.prepare('SELECT title FROM books WHERE id = ?').get(bookId) as
    | { title: string }
    | undefined
  return row?.title ?? '这本书'
}

export function chapterTitleOf(db: Database.Database, chapterId: number | null): string | null {
  if (chapterId === null) return null
  const row = db.prepare('SELECT title FROM chapters WHERE id = ?').get(chapterId) as
    | { title: string }
    | undefined
  return row?.title ?? null
}

/** 当前章节的全文，从 chunks 拼出来。AI 路径读的是纯文本，与渲染路径无关（spec §3.1）。 */
export function chapterTextOf(db: Database.Database, chapterId: number): string {
  const rows = db
    .prepare('SELECT text FROM chunks WHERE chapter_id = ? ORDER BY order_index')
    .all(chapterId) as { text: string }[]
  return rows.map((row) => row.text).join('\n\n')
}

export { isRunning }
export type { IndexState }
```

`hasKey` 走 `require` 而不是顶层 import：`service.ts` 会在单测里被间接引入，而 `provider.ts` → `secrets` → `electron` 在 vitest 的 node 环境里取不到。用 `require` 包一层 try，单测里自然降级为「没配 key」，运行时（主进程）走正常路径。

- [ ] **Step 3: 写 IPC handler**

`electron/main/ipc/ai.ts`：

```ts
import { ipcMain, type WebContents } from 'electron'
import { modelsFor } from '@shared/ai'
import { CH } from '@shared/ipc'
import { appError } from '@shared/errors'
import type { AiChatResult, AiDegradeEvent, AiProgressEvent, ProviderId } from '@shared/types'
import { AiQueue } from '../ai/queue'
import { buildIndex, cancelIndex, indexState } from '../ai/index-builder'
import { testConnection } from '../ai/provider'
import {
  aiSettings,
  chapterTextOf,
  runChat,
  statusOf,
  toReadable,
  type ChatInput
} from '../ai/service'
import { getDatabase } from '../store/db'

/** 单通道串行：手快连点也不会并发烧钱（spec §5.6） */
const queue = new AiQueue()

/** requestId → 中止信号。切章、关面板、关窗口都要能停流。 */
const inflight = new Map<string, AbortController>()

type ChatRequest = Omit<ChatInput, 'chapterText' | 'scopeKey'> & {
  /** 章节级会话；传 null 表示这本书的全局会话 */
  chapterId: number | null
}

export function registerAiIpc(): void {
  ipcMain.handle(CH.aiStatus, (_event, bookId: string) => statusOf(getDatabase(), bookId))

  ipcMain.handle(CH.aiModels, (_event, providerId: ProviderId) => modelsFor(providerId))

  ipcMain.handle(CH.aiTest, async (_event, providerId: ProviderId, model: string) =>
    queue.run(`test:${providerId}`, async () => {
      try {
        return await testConnection(providerId, model)
      } catch (error) {
        throw toReadable(error, '连接测试没有通过')
      }
    })
  )

  ipcMain.handle(CH.aiChat, async (event, request: ChatRequest): Promise<AiChatResult> => {
    if (inflight.has(request.requestId)) {
      throw new Error('这个请求已经在进行中了')
    }

    const controller = new AbortController()
    inflight.set(request.requestId, controller)
    const database = getDatabase()
    const sender = event.sender

    try {
      return await queue.run(request.requestId, () =>
        runChat(
          database,
          {
            ...request,
            chapterText:
              request.chapterId === null ? '' : chapterTextOf(database, request.chapterId),
            scopeKey: request.chapterId === null ? 'book' : `chapter:${request.chapterId}`
          },
          {
            signal: controller.signal,
            onDelta: (text) => emitDelta(sender, { requestId: request.requestId, delta: text })
          }
        )
      )
    } catch (error) {
      throw toReadable(error, 'AI 没有回答成功')
    } finally {
      inflight.delete(request.requestId)
    }
  })

  ipcMain.handle(CH.aiCancel, (_event, requestId: string) => {
    // 先撤排队中的（还没花钱），再中止在跑的（已经花出去的不追回，但必须停流）
    queue.cancel(requestId)
    inflight.get(requestId)?.abort()
    inflight.delete(requestId)
  })

  ipcMain.handle(CH.aiIndexState, (_event, bookId: string) => indexState(getDatabase(), bookId))

  ipcMain.handle(CH.aiBuildIndex, async (event, bookId: string) => {
    const database = getDatabase()
    const { providerId } = aiSettings(database)
    try {
      return await queue.run(`index:${bookId}`, () =>
        buildIndex(database, bookId, providerId, (progress) => emitProgress(event.sender, progress))
      )
    } catch (error) {
      throw toReadable(error, '建立索引没有成功')
    }
  })

  ipcMain.handle(CH.aiCancelIndex, (_event, bookId: string) => {
    cancelIndex(bookId)
  })
}

function emitDelta(sender: WebContents, payload: AiDegradeEvent): void {
  if (!sender.isDestroyed()) sender.send(CH.aiDelta, payload)
}

function emitProgress(sender: WebContents, payload: AiProgressEvent): void {
  if (!sender.isDestroyed()) {
    sender.send(CH.aiProgress, {
      ...payload,
      kind: 'index',
      bookId: payload.bookId
    })
  }
}

export { appError, queue as aiQueue }
```

最后一行只是为了 `appError` 的 import 有用处。**更干净的做法是不导入它**：写完 Step 5 跑 `npx tsc --noEmit`，报 `'appError' is declared but never read` 就从 import 里删掉它、并删掉那一行导出，只留 `queue`。

- [ ] **Step 4: 注册 handler 并补 preload**

`electron/main/ipc/index.ts` 追加一行：

```ts
import { registerAiIpc } from './ai'
```

```ts
export function registerIpc(): void {
  registerSettingsIpc()
  registerSecretsIpc()
  registerLibraryIpc()
  registerReaderIpc()
  registerNotesIpc()
  registerAiIpc()
}
```

`electron/preload/index.ts` 的 import 里补上：

```ts
import type {
  AiChatResult,
  AiDegradeEvent,
  AiProgressEvent,
  AiStatus,
  ChatModel,
  IndexState,
  ProviderId
} from '@shared/types'
```

`api` 里追加（放在 `notes` 之后）：

```ts
  ai: {
    status: (bookId: string): Promise<AiStatus> => ipcRenderer.invoke(CH.aiStatus, bookId),
    models: (providerId: ProviderId): Promise<ChatModel[]> =>
      ipcRenderer.invoke(CH.aiModels, providerId),
    test: (providerId: ProviderId, model: string): Promise<{ ok: true; model: string }> =>
      ipcRenderer.invoke(CH.aiTest, providerId, model),
    chat: (request: {
      requestId: string
      bookId: string
      chapterId: number | null
      task: 'ask' | 'explain' | 'translate'
      excerpt?: string
      question?: string
    }): Promise<AiChatResult> => ipcRenderer.invoke(CH.aiChat, request),
    cancel: (requestId: string): Promise<void> => ipcRenderer.invoke(CH.aiCancel, requestId),
    indexState: (bookId: string): Promise<IndexState> =>
      ipcRenderer.invoke(CH.aiIndexState, bookId),
    buildIndex: (bookId: string): Promise<IndexState> =>
      ipcRenderer.invoke(CH.aiBuildIndex, bookId),
    cancelIndex: (bookId: string): Promise<void> => ipcRenderer.invoke(CH.aiCancelIndex, bookId),
    /** 返回退订函数。contextBridge 支持跨边界传递函数，退订时直接调它。 */
    onDelta: (listener: (event: AiDegradeEvent) => void): (() => void) => {
      const handler = (_event: unknown, payload: AiDegradeEvent): void => listener(payload)
      ipcRenderer.on(CH.aiDelta, handler)
      return () => ipcRenderer.removeListener(CH.aiDelta, handler)
    },
    onProgress: (listener: (event: AiProgressEvent) => void): (() => void) => {
      const handler = (_event: unknown, payload: AiProgressEvent): void => listener(payload)
      ipcRenderer.on(CH.aiProgress, handler)
      return () => ipcRenderer.removeListener(CH.aiProgress, handler)
    }
  },
```

- [ ] **Step 5: 跑边界测试，确认契约没破**

Run: `npx tsc --noEmit && npm run e2e -- e2e/boundary.spec.ts`

Expected: PASS，1 passed。

这一条是整表比对：`API_SHAPE.ai` 里的 10 个方法与 preload 上真实挂的必须一字不差。`onDelta` / `onProgress` 虽然是事件订阅而不是 invoke，也要在白名单里——它们同样是暴露给渲染进程的能力，白名单的意义就是「暴露了什么都要在册」。

- [ ] **Step 6: Commit**

```bash
git add shared/ipc.ts electron/main/ai/service.ts electron/main/ai/index-builder.ts \
  electron/main/ipc/ai.ts electron/main/ipc/index.ts electron/preload/index.ts
git commit -m "feat: AI 服务编排与 IPC（检索编排、流式增量、取消、索引进度）"
```

---

### Task 9: AI 面板、消息渲染与划词入口

Task 8 里 `ai_results` 只被读、`ai_messages` 只被定义，两者都还没有写入方。这一 Task 补上写入（会话落库），并把面板做出来——面板是这些数据唯一的读者。

**Files:**
- Create: `src/features/ai/text.ts`, `src/features/ai/AiMessage.tsx`, `src/features/ai/AiIndexBar.tsx`, `src/features/ai/AiPanel.tsx`
- Modify: `shared/ipc.ts`, `electron/main/ipc/ai.ts`, `electron/preload/index.ts`, `src/features/reader/SelectionToolbar.tsx`, `src/features/reader/ReaderPage.tsx`, `src/styles/base.css`
- Test: `tests/ai-text.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/ai-text.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { parseBlocks, parseInline } from '../src/features/ai/text'

describe('parseInline', () => {
  it('把 [n] 切成引用标记，前后文本各成一段', () => {
    expect(parseInline('手机会占用注意力[2]，所以要隔离[1]。')).toEqual([
      { kind: 'text', value: '手机会占用注意力' },
      { kind: 'cite', index: 2 },
      { kind: 'text', value: '，所以要隔离' },
      { kind: 'cite', index: 1 },
      { kind: 'text', value: '。' }
    ])
  })

  it('**粗体** 变成 strong，不与引用标记混淆', () => {
    expect(parseInline('**结论**是[1]')).toEqual([
      { kind: 'strong', value: '结论' },
      { kind: 'text', value: '是' },
      { kind: 'cite', index: 1 }
    ])
  })

  it('没有标记时原样返回一段文本', () => {
    expect(parseInline('就是一段普通话')).toEqual([{ kind: 'text', value: '就是一段普通话' }])
  })

  it('空串返回空数组', () => {
    expect(parseInline('')).toEqual([])
  })

  it('四位数以上的方括号不当引用 —— [2024] 是年份', () => {
    expect(parseInline('见[2024]年的记录')).toEqual([{ kind: 'text', value: '见[2024]年的记录' }])
  })
})

describe('parseBlocks', () => {
  it('空行分段，列表单独成块', () => {
    const blocks = parseBlocks('第一段\n\n- 甲\n- 乙\n\n第二段')
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'bullet', 'paragraph'])
    const bullet = blocks[1]
    expect(bullet?.kind === 'bullet' && bullet.items).toHaveLength(2)
  })

  it('有序列表与无序列表不会混进同一块', () => {
    expect(parseBlocks('- 甲\n1. 乙').map((b) => b.kind)).toEqual(['bullet', 'ordered'])
  })

  it('单换行不切段，换行原样留在文本里（渲染端用 pre-wrap 呈现）', () => {
    const blocks = parseBlocks('上半句\n下半句')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toEqual({
      kind: 'paragraph',
      inline: [{ kind: 'text', value: '上半句\n下半句' }]
    })
  })

  it('连续空行不会产出空块', () => {
    expect(parseBlocks('\n\n甲\n\n\n\n乙\n\n')).toHaveLength(2)
  })
})
```

- [ ] **Step 2: 跑它，确认失败**

Run: `npx vitest run tests/ai-text.test.ts`

Expected: FAIL —— `../src/features/ai/text` 不存在。

- [ ] **Step 3: 写极简解析**

`src/features/ai/text.ts`：

```ts
/**
 * 模型输出的极简解析。
 *
 * 刻意不引 markdown 库：把模型给的字符串 parse 成 HTML 再插进 DOM，等于把界面的
 * 编辑权交给了一个我们无法约束的远端模型。CSP 能挡住脚本执行，但挡不住一段巨大的
 * `<table>` 把面板撑坏。
 *
 * 这里只认三种块（段落 / 无序列表 / 有序列表）与两种行内标记（**粗体** / [n] 引用），
 * 其余的 markdown 语法一律当普通文字显示。够用，且没有一个字节会变成 HTML。
 */
export type Inline =
  | { kind: 'text'; value: string }
  | { kind: 'strong'; value: string }
  | { kind: 'cite'; index: number }

export type Block =
  | { kind: 'paragraph'; inline: Inline[] }
  | { kind: 'bullet'; items: Inline[][] }
  | { kind: 'ordered'; items: Inline[][] }

/** 引用编号最多三位：`[2024]` 是年份，不是引用 */
const INLINE_TOKEN = /\*\*[^*\n]+\*\*|\[\d{1,3}\]/g
const BULLET = /^[-*•]\s+(.*)$/
const ORDERED = /^\d+[.)]\s+(.*)$/

export function parseInline(line: string): Inline[] {
  const result: Inline[] = []
  let cursor = 0

  for (const match of line.matchAll(INLINE_TOKEN)) {
    const at = match.index
    if (at > cursor) result.push({ kind: 'text', value: line.slice(cursor, at) })
    const token = match[0]
    if (token.startsWith('**')) result.push({ kind: 'strong', value: token.slice(2, -2) })
    else result.push({ kind: 'cite', index: Number(token.slice(1, -1)) })
    cursor = at + token.length
  }

  if (cursor < line.length) result.push({ kind: 'text', value: line.slice(cursor) })
  return result
}

export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = []
  let paragraph: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return
    // 用换行拼而不是空格：模型经常把一句话拆成两行，插空格会在中文里多出空格
    blocks.push({ kind: 'paragraph', inline: parseInline(paragraph.join('\n')) })
    paragraph = []
  }

  const flushList = (): void => {
    if (!list) return
    const items = list.items.map((item) => parseInline(item))
    blocks.push(list.ordered ? { kind: 'ordered', items } : { kind: 'bullet', items })
    list = null
  }

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()

    if (line === '') {
      flushParagraph()
      flushList()
      continue
    }

    const bullet = BULLET.exec(line)
    if (bullet) {
      flushParagraph()
      if (list?.ordered) flushList()
      list ??= { ordered: false, items: [] }
      list.items.push(bullet[1] ?? '')
      continue
    }

    const ordered = ORDERED.exec(line)
    if (ordered) {
      flushParagraph()
      if (list && !list.ordered) flushList()
      list ??= { ordered: true, items: [] }
      list.items.push(ordered[1] ?? '')
      continue
    }

    flushList()
    paragraph.push(line)
  }

  flushParagraph()
  flushList()
  return blocks
}
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `npx vitest run tests/ai-text.test.ts`

Expected: PASS，9 passed。

- [ ] **Step 5: 追加会话历史通道**

`shared/ipc.ts` 的 `CH` 追加两条：

```ts
  aiHistory: 'ai:history',
  aiClear: 'ai:clear',
```

`API_SHAPE.ai` 改成：

```ts
  ai: [
    'status',
    'models',
    'test',
    'chat',
    'cancel',
    'history',
    'clear',
    'indexState',
    'buildIndex',
    'cancelIndex',
    'onDelta',
    'onProgress'
  ]
```

`electron/main/ipc/ai.ts` 补齐 import 与两个 handler，并在 `ai:chat` 成功后落库：

```ts
import { appendMessage, clearScope, listMessages } from '../ai/repo'
import { estimateTokens } from '../ai/retrieve'
```

```ts
  ipcMain.handle(CH.aiHistory, (_event, bookId: string, scopeKey: string) =>
    listMessages(getDatabase(), bookId, scopeKey)
  )

  ipcMain.handle(CH.aiClear, (_event, bookId: string, scopeKey: string) => {
    clearScope(getDatabase(), bookId, scopeKey)
  })
```

`ai:chat` 的 `try` 块里，把 `return await queue.run(...)` 换成先接住结果再落库：

```ts
      const result = await queue.run(request.requestId, () =>
        runChat(
          database,
          {
            ...request,
            chapterText:
              request.chapterId === null ? '' : chapterTextOf(database, request.chapterId),
            scopeKey: request.chapterId === null ? 'book' : `chapter:${request.chapterId}`
          },
          {
            signal: controller.signal,
            onDelta: (text) => emitDelta(sender, { requestId: request.requestId, delta: text })
          }
        )
      )

      // 落库放在这里而不是服务层：服务层要能被单测单独调，不该顺手写表。
      // 用量按输出 token 记回答、按估算记提问（服务商不给我们算输入的那一份）。
      const scopeKey = request.chapterId === null ? 'book' : `chapter:${request.chapterId}`
      const now = Date.now()
      appendMessage(
        database,
        {
          bookId: request.bookId,
          chapterId: request.chapterId,
          scopeKey,
          role: 'user',
          content: (request.question ?? request.excerpt ?? '').trim(),
          tokens: estimateTokens(request.question ?? request.excerpt ?? '')
        },
        now
      )
      appendMessage(
        database,
        {
          bookId: request.bookId,
          chapterId: request.chapterId,
          scopeKey,
          role: 'assistant',
          content: result.content,
          tokens: result.usage?.outputTokens ?? 0
        },
        now + 1
      )

      return result
```

`now + 1` 是为了让两条消息的 `created_at` 有先后，历史按 `id` 排序其实已经够，这里只是不给自己留一个「同一毫秒谁先谁后」的疑问。

`electron/preload/index.ts` 的 `ai` 里追加（放在 `cancel` 之后）：

```ts
    history: (bookId: string, scopeKey: string): Promise<AiMessage[]> =>
      ipcRenderer.invoke(CH.aiHistory, bookId, scopeKey),
    clear: (bookId: string, scopeKey: string): Promise<void> =>
      ipcRenderer.invoke(CH.aiClear, bookId, scopeKey),
```

import 里补上 `AiMessage`（追加到已有的 `@shared/types` 类型列表）。

- [ ] **Step 6: 写消息渲染**

`src/features/ai/AiMessage.tsx`：

```tsx
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
```

- [ ] **Step 7: 写索引提示条**

`src/features/ai/AiIndexBar.tsx`：

```tsx
import { useEffect, useState } from 'react'
import { PROVIDERS } from '@shared/types'
import type { AiProgressEvent, AiStatus } from '@shared/types'

/**
 * 向量索引的提示条。三种状态互斥，任何一种都**不能静默**（硬规则 2）：
 * 不支持、已停用、还没建 / 正在建。
 *
 * 这里没有任何 effect 会自己去建索引——只有按钮能触发（硬规则 1）。
 */
export function AiIndexBar({
  bookId,
  status,
  onStatusChanged
}: {
  bookId: string
  status: AiStatus
  onStatusChanged: () => void
}) {
  const [progress, setProgress] = useState<AiProgressEvent | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(
    () =>
      window.api.ai.onProgress((event) => {
        if (event.kind === 'index' && event.bookId === bookId) setProgress(event)
      }),
    [bookId]
  )

  // 进度事件说「不跑了」，说明这一轮结束了，去主进程拿一次真实状态
  useEffect(() => {
    if (progress && !progress.running) onStatusChanged()
  }, [progress, onStatusChanged])

  const providerName = PROVIDERS.find((item) => item.id === status.providerId)?.name ?? status.providerId

  if (!status.caps.embed) {
    return (
      <p className="ai-notice" role="status">
        {providerName} 不提供向量检索，本面板用的是关键词检索 + 当前章节窗口，跨章节召回会变弱。
      </p>
    )
  }

  if (status.unavailable.includes('embed')) {
    return (
      <p className="ai-notice" role="status">
        {providerName} 这次拒绝了向量检索请求，已停用该能力，改用关键词检索 + 当前章节窗口。
      </p>
    )
  }

  const { total, done, running } = progress ?? status.index
  const remaining = Math.max(0, total - done)
  const batches = Math.ceil(remaining / (status.caps.embedBatch ?? 1))

  const start = async (): Promise<void> => {
    setConfirming(false)
    setError(null)
    try {
      await window.api.ai.buildIndex(bookId)
    } catch (e) {
      setError(e instanceof Error ? e.message : '建立索引没有成功')
    } finally {
      onStatusChanged()
    }
  }

  if (running) {
    return (
      <div className="ai-index-bar" role="status">
        <span>
          正在建立向量索引：{done} / {total}
          {progress?.label ? `（${progress.label}）` : ''}
        </span>
        <button type="button" className="btn btn--quiet" onClick={() => void window.api.ai.cancelIndex(bookId)}>
          停下
        </button>
      </div>
    )
  }

  if (confirming) {
    return (
      <div className="ai-index-bar ai-index-bar--confirm">
        <p>
          将为这本书剩下的 {remaining} 段文本建立向量索引，约发起 {batches} 次请求。
          这是要花钱的调用，中途可以停，已经算过的不会重算。
        </p>
        <div className="ai-index-bar__actions">
          <button type="button" className="btn btn--accent" onClick={() => void start()}>
            开始
          </button>
          <button type="button" className="btn" onClick={() => setConfirming(false)}>
            算了
          </button>
        </div>
        {error && <p className="ai-notice ai-notice--error">{error}</p>}
      </div>
    )
  }

  if (remaining === 0) {
    return (
      <p className="ai-notice" role="status">
        向量索引已建立（{total} 段），跨章节的问题召回更准。
      </p>
    )
  }

  return (
    <div className="ai-index-bar">
      <span>
        {done === 0
          ? '这本书还没有建立向量索引，跨章节的问题只能靠关键词召回。'
          : `向量索引建了一半（${done} / ${total}），可以接着建。`}
      </span>
      <button type="button" className="btn" onClick={() => setConfirming(true)}>
        {done === 0 ? '建立向量索引' : '继续建立'}
      </button>
      {error && <p className="ai-notice ai-notice--error">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 8: 写面板**

`src/features/ai/AiPanel.tsx`：

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AiStatus, Citation } from '@shared/types'
import { AiIndexBar } from './AiIndexBar'
import { AiMessage, type Turn } from './AiMessage'

/** 划词浮条递给面板的东西。prefill 只填引用，send 立刻发出去 */
export type AiSeed =
  | { kind: 'prefill'; task: 'ask'; text: string }
  | { kind: 'send'; task: 'explain' | 'translate'; text: string }

export function AiPanel({
  bookId,
  chapterId,
  seed,
  onSeedConsumed,
  onCitation,
  onClose
}: {
  bookId: string
  chapterId: number | null
  seed: AiSeed | null
  onSeedConsumed: () => void
  onCitation?: (citation: Citation) => void
  onClose: () => void
}) {
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [turns, setTurns] = useState<Turn[]>([])
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [question, setQuestion] = useState('')
  const [excerpt, setExcerpt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const streamRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  /** 已经发出去、还没结束的 requestId。换章与卸载时要逐个叫停 */
  const inflightRef = useRef<Set<string>>(new Set())

  const scopeKey = chapterId === null ? 'book' : `chapter:${chapterId}`

  const refreshStatus = useCallback(() => {
    void window.api.ai
      .status(bookId)
      .then(setStatus)
      .catch(() => setStatus(null))
  }, [bookId])

  // 换书、换章、卸载都要停流并清掉会话（spec §5.6「中断即停流」）
  useEffect(() => {
    let alive = true
    setTurns([])
    setHistoryLoaded(false)
    setError(null)
    refreshStatus()

    void window.api.ai
      .history(bookId, scopeKey)
      .then((stored) => {
        if (!alive) return
        setTurns(
          stored.map((message) => ({
            id: `m${message.id}`,
            role: message.role,
            text: message.content,
            state: 'done' as const,
            // 历史里没有引用映射与用量：上标退化为普通文字，用量显示「未返回」
            usage: null,
            citations: [],
            degraded: []
          }))
        )
        setHistoryLoaded(true)
      })
      .catch(() => {
        if (alive) setHistoryLoaded(true)
      })

    return () => {
      alive = false
      for (const id of inflightRef.current) void window.api.ai.cancel(id)
      inflightRef.current.clear()
    }
  }, [bookId, scopeKey, refreshStatus])

  useEffect(
    () =>
      window.api.ai.onDelta((event) => {
        setTurns((list) =>
          list.map((turn) =>
            turn.id === event.requestId
              ? { ...turn, state: 'streaming', text: turn.text + event.delta }
              : turn
          )
        )
      }),
    []
  )

  // 新内容进来就滚到底。用 turns 的长度与末条文本长度做依赖，避免每次渲染都滚
  const lastLength = turns.length === 0 ? 0 : turns[turns.length - 1]!.text.length
  useEffect(() => {
    const box = streamRef.current
    if (box) box.scrollTop = box.scrollHeight
  }, [turns.length, lastLength])

  const send = useCallback(
    async (task: 'ask' | 'explain' | 'translate', input: { question?: string; excerpt?: string }) => {
      const requestId = crypto.randomUUID()
      const say = task === 'ask' ? (input.question ?? '') : task === 'explain' ? '解释这段原文' : '翻译这段原文'

      inflightRef.current.add(requestId)
      setError(null)
      setTurns((list) => [
        ...list,
        {
          id: `${requestId}:u`,
          role: 'user',
          text: say,
          excerpt: input.excerpt,
          state: 'done',
          usage: null,
          citations: [],
          degraded: []
        },
        {
          id: requestId,
          role: 'assistant',
          text: '',
          state: 'queued',
          usage: null,
          citations: [],
          degraded: []
        }
      ])

      try {
        const result = await window.api.ai.chat({
          requestId,
          bookId,
          chapterId,
          task,
          ...(input.excerpt ? { excerpt: input.excerpt } : {}),
          ...(input.question ? { question: input.question } : {})
        })
        setTurns((list) =>
          list.map((turn) =>
            turn.id === requestId
              ? {
                  ...turn,
                  state: 'done',
                  text: result.content,
                  usage: result.usage,
                  citations: result.citations,
                  degraded: result.degraded
                }
              : turn
          )
        )
        refreshStatus()
      } catch (e) {
        const message = e instanceof Error ? e.message : 'AI 没有回答成功'
        setTurns((list) =>
          list.map((turn) =>
            turn.id === requestId ? { ...turn, state: 'failed', error: message } : turn
          )
        )
      } finally {
        inflightRef.current.delete(requestId)
      }
    },
    [bookId, chapterId, refreshStatus]
  )

  // 划词浮条递过来的动作
  useEffect(() => {
    if (!seed) return
    onSeedConsumed()
    if (seed.kind === 'prefill') {
      setExcerpt(seed.text)
      inputRef.current?.focus()
      return
    }
    setExcerpt(null)
    void send(seed.task, { excerpt: seed.text })
  }, [seed, send, onSeedConsumed])

  const busy = turns.some(
    (turn) => turn.role === 'assistant' && (turn.state === 'queued' || turn.state === 'streaming')
  )

  const canSend = (question.trim() !== '' || excerpt !== null) && status?.configured !== false

  const submit = (event: React.FormEvent): void => {
    event.preventDefault()
    if (!canSend) return
    const text = question.trim()
    void send(text === '' ? 'explain' : 'ask', {
      ...(text === '' ? {} : { question: text }),
      ...(excerpt ? { excerpt } : {})
    })
    setQuestion('')
    setExcerpt(null)
  }

  const stop = (): void => {
    for (const id of inflightRef.current) void window.api.ai.cancel(id)
  }

  const clear = (): void => {
    stop()
    void window.api.ai.clear(bookId, scopeKey).then(() => {
      setTurns([])
      setHistoryLoaded(false)
    })
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      submit(event)
    }
  }

  const providerLabel = useMemo(() => status?.providerId ?? '', [status])

  return (
    <aside className="ai-panel" aria-label="AI 面板">
      <div className="ai-panel__head">
        <span className="ai-panel__title">AI</span>
        {status && (
          <span className="ai-panel__model">
            {providerLabel} · {status.model}
          </span>
        )}
        <span className="ai-panel__spacer" />
        <button type="button" className="btn btn--quiet" onClick={clear} disabled={turns.length === 0}>
          清空
        </button>
        <button type="button" className="btn btn--quiet" onClick={onClose}>
          收起
        </button>
      </div>

      {status && <AiIndexBar bookId={bookId} status={status} onStatusChanged={refreshStatus} />}

      {status && !status.configured && (
        <p className="ai-notice ai-notice--strong" role="status">
          还没有填这家的 API Key。到「设置 → 模型」里填一个再回来。
        </p>
      )}

      <div className="ai-panel__stream" ref={streamRef}>
        {turns.length === 0 ? (
          <p className="ai-panel__empty">
            在正文里划一句话，选「问 AI」「解释」或「翻译」；也可以直接在这里提问。
          </p>
        ) : (
          <>
            {historyLoaded && (
              <p className="ai-panel__note">
                历史记录只保留文字：回答里的 [n] 不再可点，用量也只在本次会话里显示。
              </p>
            )}
            {turns.map((turn) => (
              <AiMessage key={turn.id} turn={turn} onCitation={onCitation} />
            ))}
          </>
        )}
      </div>

      {error && (
        <p className="ai-notice ai-notice--error" role="status">
          {error}
        </p>
      )}

      <form className="ai-panel__foot" onSubmit={submit}>
        {excerpt && (
          <div className="ai-panel__quote">
            <span>
              {excerpt.slice(0, 60)}
              {excerpt.length > 60 ? '…' : ''}
            </span>
            <button
              type="button"
              className="btn btn--quiet"
              aria-label="去掉引用的原文"
              onClick={() => setExcerpt(null)}
            >
              ×
            </button>
          </div>
        )}
        <textarea
          ref={inputRef}
          className="ai-panel__input"
          rows={2}
          value={question}
          placeholder="就这本书问点什么…（Enter 发送，Shift+Enter 换行）"
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="ai-panel__actions">
          {busy ? (
            <button type="button" className="btn" onClick={stop}>
              停下
            </button>
          ) : (
            <button type="submit" className="btn btn--accent" disabled={!canSend}>
              发送
            </button>
          )}
          {turns.length > 0 && !busy && <span className="ai-panel__hint">已中断的回答不会续跑</span>}
        </div>
      </form>
    </aside>
  )
}
```

**刻意不做「输入框为空时也允许发送」**：`ask` 任务在提示词里带一个空问题是纯粹的浪费，所以空输入时按 `explain` 走（把引用槽里的原文解释一遍）。引用槽为空、输入也为空时按钮直接禁用。

`error` 这个 state 目前只被 `clear` 的成功路径之外的东西写入——它留给 Task 10 的结构化任务复用，Step 8 先放着不影响编译。

- [ ] **Step 9: 浮条加「解释」**

`src/features/reader/SelectionToolbar.tsx` 的 props 里，`onTranslate` 上面加一行：

```tsx
  /** 计划 05 接上。与 onAsk / onTranslate 同样是可选：不传就不渲染 */
  onExplain?: () => void
```

JSX 里在「翻译」之前插入：

```tsx
          {onExplain && (
            <button type="button" className="sel-toolbar__btn" onClick={onExplain}>
              解释
            </button>
          )}
```

按钮顺序因此是：四个色点 · 笔记 · 复制 · 解释 · 翻译 · 问 AI。把「问 AI」留在最后，是因为它是唯一会**直接花钱**的动作，放在最右、与其它动作拉开距离。

- [ ] **Step 10: 接进阅读器**

`src/features/reader/ReaderPage.tsx` 四处改动。

① import 区追加：

```tsx
import { AiPanel, type AiSeed } from '../ai/AiPanel'
```

② state 区追加（放在计划 04 新增的那批 state 之后）：

```tsx
  const [aiOpen, setAiOpen] = useState(false)
  const [aiSeed, setAiSeed] = useState<AiSeed | null>(null)
```

③ 划词入口。放在计划 04 的 `copySelection` 之后：

```tsx
  /**
   * 浮条上的三个 AI 动作。
   *
   * 「问 AI」只把原文放进引用槽、把焦点给输入框，**不发请求**——点击它的时候
   * 用户还没说想问什么，替他猜一个问题就是在花他的钱（硬规则 1）。
   * 「解释」「翻译」按一下就发：那一下本身就是完整的显式指令。
   */
  const askFromSelection = useCallback(
    (task: 'ask' | 'explain' | 'translate') => {
      if (!selection) return
      setAiSeed(
        task === 'ask'
          ? { kind: 'prefill', task: 'ask', text: selection.text }
          : { kind: 'send', task, text: selection.text }
      )
      setAiOpen(true)
      setSelection(null)
      // 选区不清掉，下一次 selectionchange 会把浮条又唤醒
      iframeRef.current?.contentWindow?.getSelection()?.removeAllRanges()
    },
    [selection]
  )
```

④ 工具条加按钮。在「下一页」那个按钮之后插入：

```tsx
        <button
          type="button"
          className={`btn${aiOpen ? ' btn--on' : ''}`}
          aria-pressed={aiOpen}
          onClick={() => setAiOpen((open) => !open)}
        >
          AI
        </button>
```

⑤ `SelectionToolbar` 的 JSX 传上三个回调：

```tsx
          {selection && (
            <SelectionToolbar
              selection={selection}
              onMark={(color) => void markSelection(color, false)}
              onNote={() => void markSelection(DEFAULT_HIGHLIGHT_COLOR, true)}
              onCopy={copySelection}
              onExplain={() => askFromSelection('explain')}
              onTranslate={() => askFromSelection('translate')}
              onAsk={() => askFromSelection('ask')}
            />
          )}
```

⑥ `.reader__body` 里，`.reader__stage` 收掉之后挂面板：

```tsx
        </div>
        {aiOpen && (
          <AiPanel
            bookId={bookId}
            chapterId={chapter?.id ?? null}
            seed={aiSeed}
            onSeedConsumed={() => setAiSeed(null)}
            onClose={() => setAiOpen(false)}
          />
        )}
      </div>
```

`onCitation` 这一条 Task 11 再接。不传时 `AiMessage` 会把引用上标渲染成普通文字，不会出现点了没反应的按钮。

面板变宽必然挤窄正文列，`ResizeObserver` 会重新量 `.reader__stage`，计划 03 的 ④ 号 effect 随之重排、重新分页。这是 spec §4.3 认可的行为，不需要额外接线。

- [ ] **Step 11: 加样式**

追加到 `src/styles/base.css` 末尾：

```css
/* ---- AI 面板 ---- */
.ai-panel {
  flex: 0 0 360px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--panel);
  border-left: 1px solid var(--line);
}

.ai-panel__head {
  display: flex;
  align-items: center;
  gap: var(--s2);
  padding: var(--s2) var(--s3);
  border-bottom: 1px solid var(--line);
}

.ai-panel__title {
  font-size: 13px;
  font-weight: 600;
}

.ai-panel__model {
  font-size: 12px;
  color: var(--ink-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ai-panel__spacer {
  flex: 1;
}

.ai-panel__stream {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--s3);
  display: flex;
  flex-direction: column;
  gap: var(--s3);
}

.ai-panel__empty,
.ai-panel__note {
  margin: 0;
  font-size: 12px;
  color: var(--ink-muted);
  line-height: 1.6;
}

.ai-panel__foot {
  border-top: 1px solid var(--line);
  padding: var(--s3);
  display: flex;
  flex-direction: column;
  gap: var(--s2);
}

.ai-panel__quote {
  display: flex;
  align-items: flex-start;
  gap: var(--s2);
  padding: 6px 8px;
  background: var(--paper);
  border-left: 2px solid var(--accent-link);
  border-radius: var(--r-sm);
  font-size: 12px;
  color: var(--ink-muted);
  line-height: 1.5;
}

.ai-panel__input {
  width: 100%;
  resize: none;
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--paper-raised);
  color: var(--ink);
  font: inherit;
  font-size: 13px;
  line-height: 1.6;
}

.ai-panel__actions {
  display: flex;
  align-items: center;
  gap: var(--s2);
}

.ai-panel__hint {
  font-size: 12px;
  color: var(--ink-muted);
}

/* ---- 消息 ---- */
.ai-msg {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  line-height: 1.7;
}

.ai-msg--user {
  align-items: flex-end;
}

.ai-msg__quote {
  margin: 0;
  padding: 6px 8px;
  max-width: 100%;
  background: var(--paper);
  border-left: 2px solid var(--accent-link);
  border-radius: var(--r-sm);
  color: var(--ink-muted);
  font-size: 12px;
  line-height: 1.5;
}

.ai-msg__say {
  margin: 0;
  padding: 6px 10px;
  max-width: 90%;
  background: var(--active);
  border-radius: var(--r-md);
}

.ai-msg--assistant {
  align-items: stretch;
}

.ai-msg__body {
  white-space: pre-wrap;
}

.ai-msg__p {
  margin: 0 0 var(--s2);
}

.ai-msg__list {
  margin: 0 0 var(--s2);
  padding-left: 1.4em;
}

.ai-msg__caret {
  display: inline-block;
  width: 6px;
  height: 14px;
  margin-left: 2px;
  vertical-align: -2px;
  background: var(--accent-mark);
  animation: ai-blink 1s steps(2, start) infinite;
}

@keyframes ai-blink {
  to {
    visibility: hidden;
  }
}

.ai-msg__meta,
.ai-msg__status {
  margin: 0;
  font-size: 12px;
  color: var(--ink-muted);
}

.ai-msg--failed .ai-msg__body {
  color: var(--ink-muted);
}

.ai-msg__status--error {
  color: var(--accent-mark);
}

.ai-cite {
  min-width: 16px;
  height: 16px;
  padding: 0 3px;
  margin: 0 1px;
  border: 0;
  border-radius: var(--r-sm);
  background: var(--active);
  color: var(--accent-link);
  font-size: 11px;
  line-height: 16px;
  vertical-align: 2px;
  cursor: pointer;
}

.ai-cite:hover {
  background: var(--accent-link);
  color: var(--paper);
}

/* ---- 降级与提示 ---- */
.ai-degrade {
  margin: 0;
  padding: 6px 8px;
  background: color-mix(in srgb, var(--hl-yellow) 60%, transparent);
  border-radius: var(--r-sm);
  font-size: 12px;
  line-height: 1.6;
}

.ai-notice {
  margin: 0;
  padding: var(--s2) var(--s3);
  border-bottom: 1px solid var(--line);
  font-size: 12px;
  line-height: 1.6;
  color: var(--ink-muted);
}

.ai-notice--strong {
  color: var(--ink);
}

.ai-notice--error {
  color: var(--accent-mark);
}

.ai-index-bar {
  display: flex;
  align-items: center;
  gap: var(--s2);
  padding: var(--s2) var(--s3);
  border-bottom: 1px solid var(--line);
  font-size: 12px;
  line-height: 1.6;
  color: var(--ink-muted);
}

.ai-index-bar--confirm {
  flex-direction: column;
  align-items: stretch;
}

.ai-index-bar__actions {
  display: flex;
  gap: var(--s2);
}
```

- [ ] **Step 12: 类型检查与边界测试**

Run: `npx tsc --noEmit`

Expected: 无错误。

Run: `npx vitest run`

Expected: PASS。本 Task 只新增 `tests/ai-text.test.ts`。

Run: `npm run e2e -- e2e/boundary.spec.ts`

Expected: PASS，1 passed。`API_SHAPE.ai` 现在是 12 个方法，与 preload 上挂的必须一致。

- [ ] **Step 13: Commit**

```bash
git add shared/ipc.ts electron/main/ipc/ai.ts electron/preload/index.ts \
  src/features/ai src/features/reader/SelectionToolbar.tsx \
  src/features/reader/ReaderPage.tsx src/styles/base.css tests/ai-text.test.ts
git commit -m "feat: AI 面板（流式会话、引用上标、用量、历史落库、划词入口、索引提示条）"
```

---

### Task 10: 结构化任务（本章小结 / 全书要点 / 关键词 / 思维导图）

四个任务里只有三个会调模型：**思维导图是把「关键词」的结果按章节重排，属确定性变换，一次模型都不调**（硬规则 1）。全书要点与长章节小结走 map-reduce，每一章的小结都当场落进 `ai_results`，所以中断后再点一次是接着做，不会重复花钱。

**Files:**
- Create: `electron/main/ai/mindmap.ts`, `electron/main/ai/tasks.ts`, `src/features/ai/AiTasks.tsx`
- Modify: `shared/ipc.ts`, `electron/main/ai/retrieve.ts`, `electron/main/ai/service.ts`, `electron/main/ipc/ai.ts`, `electron/preload/index.ts`, `src/features/ai/AiPanel.tsx`, `src/styles/base.css`
- Test: `tests/ai-mindmap.test.ts`；追加 `tests/ai-retrieve.test.ts`

- [ ] **Step 1: 写思维导图的失败测试**

`tests/ai-mindmap.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { buildMindmap } from '../electron/main/ai/mindmap'

const terms = [
  { term: '深度工作', gloss: '一种专注状态', where: '第一章' },
  { term: '注意力残留', gloss: '切换任务后的残留', where: '第二章' },
  { term: '深度工作', gloss: '在第二章又出现一次', where: '第二章' },
  { term: '浮浅工作', gloss: '不需要认知努力的事务', where: '第一章' }
]

describe('buildMindmap', () => {
  it('根节点是书名', () => {
    expect(buildMindmap('深度工作', terms)?.label).toBe('深度工作')
  })

  it('按 where 分组，章节顺序是首次出现的顺序', () => {
    expect(buildMindmap('深度工作', terms)!.children.map((node) => node.label)).toEqual([
      '第一章',
      '第二章'
    ])
  })

  it('章节节点下挂术语，重复出现就重复挂', () => {
    const tree = buildMindmap('深度工作', terms)!
    expect(tree.children[0]!.children.map((node) => node.label)).toEqual(['深度工作', '浮浅工作'])
    expect(tree.children[1]!.children.map((node) => node.label)).toEqual(['注意力残留', '深度工作'])
  })

  it('where 为空串时归到「未归类」，不把术语丢掉', () => {
    const tree = buildMindmap('书', [{ term: 'X', gloss: 'y', where: '' }])!
    expect(tree.children[0]!.label).toBe('未归类')
  })

  it('没有术语时返回 null —— 界面据此提示「先生成关键词」，而不是画一棵空树', () => {
    expect(buildMindmap('书', [])).toBeNull()
  })
})
```

- [ ] **Step 2: 跑它，确认失败**

Run: `npx vitest run tests/ai-mindmap.test.ts`

Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 写思维导图派生**

`electron/main/ai/mindmap.ts`：

```ts
import type { MindmapNode, TermsPayload } from '@shared/types'

type Term = TermsPayload['terms'][number]

/**
 * 把「关键词」的结果组织成一棵树。
 *
 * 这里**不调用模型**：思维导图是同一批术语换个组织方式，是确定性变换。
 * 再花一次钱请模型把同样的话排成树，产品上毫无收益（硬规则 1）。
 * 因此这个函数是纯函数，可被穷举测试。
 */
export function buildMindmap(bookTitle: string, terms: readonly Term[]): MindmapNode | null {
  if (terms.length === 0) return null

  const groups = new Map<string, MindmapNode[]>()
  for (const item of terms) {
    const where = item.where.trim()
    const key = where === '' ? '未归类' : where
    const leaf: MindmapNode = { label: item.term, children: [] }
    const bucket = groups.get(key)
    if (bucket) bucket.push(leaf)
    else groups.set(key, [leaf])
  }

  // Map 保持插入顺序，所以章节顺序 == 术语首次出现的顺序，不需要额外排序
  return {
    label: bookTitle,
    children: [...groups.entries()].map(([label, children]) => ({ label, children }))
  }
}
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `npx vitest run tests/ai-mindmap.test.ts`

Expected: PASS，5 passed。

- [ ] **Step 5: 加分片函数（先测后写）**

在 `tests/ai-retrieve.test.ts` 的 import 里补 `slicesOf`，并追加：

```ts
describe('slicesOf', () => {
  const text = Array.from({ length: 10 }, (_, i) => `第${i}段${'字'.repeat(50)}`).join('\n')

  it('编号从 1 连续 —— 它不是引用编号，但沿用同一套契约省得两套心智', () => {
    const slices = slicesOf(text, 120)
    expect(slices.map((slice) => slice.index)).toEqual(slices.map((_, i) => i + 1))
  })

  it('切点落在段落边界上，不把一段劈成两半', () => {
    for (const slice of slicesOf(text, 120)) {
      expect(slice.text.startsWith('第')).toBe(true)
      expect(slice.text.endsWith('字')).toBe(true)
    }
  })

  it('单片不超过给定字符数', () => {
    for (const slice of slicesOf(text, 120)) {
      expect(slice.text.length).toBeLessThanOrEqual(120)
    }
  })

  it('单段本身就超长时硬切，而不是整段塞进去', () => {
    const slices = slicesOf('字'.repeat(250), 120)
    expect(slices.map((slice) => slice.text.length)).toEqual([120, 120, 10])
  })

  it('空文本返回空数组', () => {
    expect(slicesOf('', 120)).toEqual([])
  })
})
```

在 `electron/main/ai/retrieve.ts` 末尾（`toPassages` 之后）追加：

```ts
/**
 * 把一整章正文切成可以送进模型的片段。
 *
 * 切点落在段落边界：段落是作者给的语义单位，从中间劈开会让模型读到半句话。
 * 只有单段本身就超过上限时才硬切——那种情况硬切也比整段丢失强。
 */
export function slicesOf(text: string, size = 1200): Passage[] {
  if (size <= 0) throw new Error('分片大小必须是正数')
  const paragraphs = text
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== '')

  const slices: Passage[] = []
  let buffer = ''

  const push = (body: string): void => {
    slices.push({ index: slices.length + 1, headingPath: '本章', text: body })
  }

  for (const paragraph of paragraphs) {
    if (paragraph.length > size) {
      if (buffer !== '') {
        push(buffer)
        buffer = ''
      }
      for (let at = 0; at < paragraph.length; at += size) push(paragraph.slice(at, at + size))
      continue
    }

    const next = buffer === '' ? paragraph : `${buffer}\n${paragraph}`
    if (next.length > size) {
      push(buffer)
      buffer = paragraph
    } else {
      buffer = next
    }
  }

  if (buffer !== '') push(buffer)
  return slices
}
```

- [ ] **Step 6: 跑检索测试，确认通过**

Run: `npx vitest run tests/ai-retrieve.test.ts`

Expected: PASS，11 passed（原来 6 条 + 新增 5 条）。

- [ ] **Step 7: 写结构化任务编排**

`electron/main/ai/tasks.ts`：

```ts
import type { Database } from 'better-sqlite3'
import { PROVIDER_AI, modelOf } from '@shared/ai'
import { appError } from '@shared/errors'
import type {
  AiResultView,
  AiUsage,
  BookDigestPayload,
  ChapterSummaryPayload,
  MindmapNode,
  ProviderId,
  TermsPayload
} from '@shared/types'
import { parseLooseJson } from './loose-json'
import { buildMindmap } from './mindmap'
import type { ChatMessage } from './params'
import { buildMessages } from './prompts'
import { chat } from './provider'
import { getResult, saveResult, type ResultKey } from './repo'
import { estimateTokens, fitPassages, slicesOf } from './retrieve'
import { bookTitleOf, chapterTextOf, chapterTitleOf } from './service'

const ZERO: AiUsage = { inputTokens: 0, outputTokens: 0 }
const MAX_OUTPUT = 2048
const SLICE_SIZE = 1200

type Term = TermsPayload['terms'][number]
type SummaryTerm = ChapterSummaryPayload['terms'][number]
type PartialSummary = { chapterTitle: string; overview: string; keyPoints: string[] }

/** 每次真实发出去的调用 +1。界面上的「共发起 N 次请求」就是它，不能靠估算 */
type CallContext = { providerId: ProviderId; model: string; signal: AbortSignal }

type Structured<T> = {
  raw: string
  payload: T | null
  usage: AiUsage | null
  note: string | null
}

export type TaskProgress = { done: number; total: number; label: string; running: boolean }

/**
 * 跑一次要求 JSON 输出的结构化调用。
 *
 * 模型没吐合法 JSON 时不抛错：`payload` 为 null、`raw` 是原文，由界面按纯文本展示。
 * 抛错会让用户失去「它到底说了什么」这个信息（硬规则 2）。
 */
async function askJson<T>(
  call: CallContext,
  messages: ChatMessage[],
  validate: (value: unknown) => T | null
): Promise<Structured<T>> {
  const caps = PROVIDER_AI[call.providerId]
  const json = caps.jsonMode && modelOf(call.providerId, call.model)?.jsonMode === true
  const result = await chat({
    providerId: call.providerId,
    model: call.model,
    input: { messages, maxTokens: MAX_OUTPUT, temperature: 0.2, json, stream: false },
    signal: call.signal
  })
  const payload = validate(parseLooseJson(result.content))
  return {
    raw: result.content,
    payload,
    usage: result.usage,
    note: json
      ? null
      : '当前模型不支持结构化输出，已改为提示词约束 + 本地解析。若下面是模型原文，说明这次没能解析成结构。'
  }
}

function addUsage(left: AiUsage | null, right: AiUsage | null): AiUsage | null {
  if (!left) return right
  if (!right) return left
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens
  }
}

function composeNote(...parts: (string | null | undefined)[]): string | null {
  const kept = parts.filter((part): part is string => typeof part === 'string' && part.trim() !== '')
  return kept.length === 0 ? null : kept.join(' ')
}

/**
 * 统一出口。
 *
 * `payload` 为 null 时必然给一句 note —— 不允许出现「没结构、没说明、没原文」的空结果。
 */
function toView<T>(
  raw: string,
  payload: T | null,
  meta: { cached: boolean; usage: AiUsage | null; createdAt: number; note: string | null }
): AiResultView<T> {
  return {
    payload,
    text: payload ? null : raw.trim() === '' ? null : raw,
    cached: meta.cached,
    usage: meta.usage,
    createdAt: meta.createdAt,
    note: payload ? meta.note : (meta.note ?? '模型没有按要求返回 JSON，下面按纯文本展示。')
  }
}

function budgetFor(providerId: ProviderId, model: string, query: string): number {
  const caps = PROVIDER_AI[providerId]
  const window = Math.min(caps.maxInputTokens, modelOf(providerId, model)?.maxContext ?? caps.maxInputTokens)
  return Math.max(400, window - MAX_OUTPUT - 600 - estimateTokens(query))
}

/** 带正文的章节。目录里的分组节点 href 是空串，不能拿去当正文读 */
function bodyChapters(db: Database.Database, bookId: string): { id: number; title: string }[] {
  return db
    .prepare(
      `SELECT id, title FROM chapters WHERE book_id = ? AND href <> '' ORDER BY order_index, id`
    )
    .all(bookId) as { id: number; title: string }[]
}

function baseContext(db: Database.Database, bookId: string, chapterId: number | null) {
  return {
    bookTitle: bookTitleOf(db, bookId),
    chapterTitle: chapterId === null ? null : chapterTitleOf(db, chapterId)
  }
}

function summaryKey(bookId: string, chapterId: number, call: CallContext): ResultKey {
  return {
    bookId,
    task: 'chapterSummary',
    scopeKey: `chapter:${chapterId}`,
    provider: call.providerId,
    model: call.model
  }
}

/**
 * 读某一章已经存好的小结。
 *
 * 全书要点与关键词都靠它省钱：能复用的一律不重算，**用户不会为同一章付两次费**。
 */
function savedSummary(
  db: Database.Database,
  bookId: string,
  chapter: { id: number; title: string },
  call: CallContext
): { chapterTitle: string; overview: string; keyPoints: string[] } | null {
  const stored = getResult<ChapterSummaryPayload>(db, summaryKey(bookId, chapter.id, call))
  if (!stored) return null
  return { chapterTitle: chapter.title, overview: stored.payload.overview, keyPoints: stored.payload.keyPoints }
}

// ---------- 本章小结 ----------

export async function runChapterSummary(
  db: Database.Database,
  input: { bookId: string; chapterId: number; providerId: ProviderId; model: string; signal: AbortSignal }
): Promise<AiResultView<ChapterSummaryPayload>> {
  const call: CallContext = {
    providerId: input.providerId,
    model: input.model,
    signal: input.signal
  }
  const key = summaryKey(input.bookId, input.chapterId, call)
  const cached = getResult<ChapterSummaryPayload>(db, key)
  if (cached) {
    return toView('', cached.payload, {
      cached: true,
      usage: { inputTokens: cached.inputTokens, outputTokens: cached.outputTokens },
      createdAt: cached.createdAt,
      note: null
    })
  }

  const context = baseContext(db, input.bookId, input.chapterId)
  const chapterText = chapterTextOf(db, input.chapterId)
  if (chapterText.trim() === '') {
    throw appError('AI_UNSUPPORTED', '这一章没有可用的正文，做不了小结')
  }

  const { kept, dropped } = fitPassages(slicesOf(chapterText, SLICE_SIZE), budgetFor(input.providerId, input.model, ''))
  const notes: string[] = []
  let usage: AiUsage | null = null

  // 短章节：一次读完。只有真的超长时才走 map-reduce，别为一章 3 千字发好几次请求
  if (dropped === 0) {
    const only = await askJson<ChapterSummaryPayload>(
      call,
      buildMessages('chapterSummary', {
        ...context,
        chapterText: kept.map((slice) => slice.text).join('\n\n')
      }),
      asSummary
    )
    usage = only.usage
    notes.push(only.note ?? '')
    return finish(db, key, only.raw, only.payload, usage, composeNote(...notes))
  }

  const partials: PartialSummary[] = []
  let failedRaw = ''
  for (const slice of kept) {
    if (input.signal.aborted) break
    const part = await askJson<ChapterSummaryPayload>(
      call,
      buildMessages('chapterSummary', { ...context, chapterText: slice.text }),
      asSummary
    )
    usage = addUsage(usage, part.usage)
    notes.push(part.note ?? '')
    if (part.payload) {
      partials.push({
        chapterTitle: `${context.chapterTitle ?? '本章'}（第 ${slice.index} 段）`,
        overview: part.payload.overview,
        keyPoints: part.payload.keyPoints
      })
    } else {
      failedRaw = part.raw
    }
  }

  if (input.signal.aborted) {
    return toView('', null, {
      cached: false,
      usage,
      createdAt: Date.now(),
      note: '已停下。分段小结没有全部完成，没有写入缓存，下次点「本章小结」会重新开始。'
    })
  }

  if (partials.length === 0) {
    return toView(failedRaw, null, {
      cached: false,
      usage,
      createdAt: Date.now(),
      note: '这一章的分段小结都没能解析成结构，下面是模型最后一段输出。'
    })
  }

  const reduced = await askJson<ChapterSummaryPayload>(
    call,
    buildMessages('chapterSummary', { ...context, summaries: partials }),
    asSummary
  )
  usage = addUsage(usage, reduced.usage)
  return finish(
    db,
    key,
    reduced.raw,
    reduced.payload,
    usage,
    composeNote(
      `这一章较长，分 ${kept.length} 段读取后合成，共发起 ${kept.length + 1} 次请求。`,
      notes.join(' '),
      reduced.note
    )
  )
}

/** 有 payload 才落库：坏结果不该占住唯一键，否则用户再也拿不到好结果 */
function finish<T>(
  db: Database.Database,
  key: ResultKey,
  raw: string,
  payload: T | null,
  usage: AiUsage | null,
  note: string | null
): AiResultView<T> {
  const now = Date.now()
  if (payload) saveResult(db, key, payload, usage ?? ZERO, now)
  return toView(raw, payload, { cached: false, usage, createdAt: now, note })
}

// ---------- 全书要点 ----------

export async function runBookDigest(
  db: Database.Database,
  input: { bookId: string; providerId: ProviderId; model: string; signal: AbortSignal },
  onProgress: (progress: TaskProgress) => void
): Promise<AiResultView<BookDigestPayload>> {
  const call: CallContext = { providerId: input.providerId, model: input.model, signal: input.signal }
  const key: ResultKey = {
    bookId: input.bookId,
    task: 'bookDigest',
    scopeKey: 'book',
    provider: input.providerId,
    model: input.model
  }
  const cached = getResult<BookDigestPayload>(db, key)
  if (cached) {
    return toView('', cached.payload, {
      cached: true,
      usage: { inputTokens: cached.inputTokens, outputTokens: cached.outputTokens },
      createdAt: cached.createdAt,
      note: null
    })
  }

  const chapters = bodyChapters(db, input.bookId)
  if (chapters.length === 0) throw appError('AI_UNSUPPORTED', '这本书还没有可用的章节正文')

  const summaries: PartialSummary[] = []
  const notes: string[] = []
  let usage: AiUsage | null = null
  let calls = 0
  let reused = 0
  let done = 0
  onProgress({ done, total: chapters.length, label: '准备中', running: true })

  for (const chapter of chapters) {
    if (input.signal.aborted) break

    const saved = savedSummary(db, input.bookId, chapter, call)
    if (saved) {
      summaries.push(saved)
      reused += 1
    } else {
      const text = chapterTextOf(db, chapter.id)
      const { kept } = fitPassages(slicesOf(text, SLICE_SIZE), budgetFor(input.providerId, input.model, text))
      calls += 1
      const part = await askJson<ChapterSummaryPayload>(
        call,
        buildMessages('bookDigest', {
          ...baseContext(db, input.bookId, chapter.id),
          chapterText: kept.map((slice) => slice.text).join('\n\n')
        }),
        asSummary
      )
      usage = addUsage(usage, part.usage)
      notes.push(part.note ?? '')
      if (part.payload) {
        summaries.push({
          chapterTitle: chapter.title,
          overview: part.payload.overview,
          keyPoints: part.payload.keyPoints
        })
        // 顺手存成章小结：用户之后点「本章小结」就是缓存命中，不会再花一次钱
        saveResult(db, summaryKey(input.bookId, chapter.id, call), part.payload, part.usage ?? ZERO, Date.now())
      }
    }

    done += 1
    onProgress({ done, total: chapters.length, label: chapter.title, running: true })
  }

  onProgress({ done, total: chapters.length, label: '', running: false })

  if (input.signal.aborted) {
    return toView('', null, {
      cached: false,
      usage,
      createdAt: Date.now(),
      note: `已停下。已经做好的 ${summaries.length} 章小结都存着，下次点「全书要点」会跳过它们，不会重复花钱。`
    })
  }

  if (summaries.length === 0) {
    return toView('', null, {
      cached: false,
      usage,
      createdAt: Date.now(),
      note: '各章小结都没能生成，全书要点也就无从归纳。可以稍后再试。'
    })
  }

  calls += 1
  const reduced = await askJson<BookDigestPayload>(
    call,
    buildMessages('bookDigest', { ...baseContext(db, input.bookId, null), summaries }),
    asDigest
  )
  usage = addUsage(usage, reduced.usage)

  const now = Date.now()
  if (reduced.payload) saveResult(db, key, reduced.payload, usage ?? ZERO, now)
  return toView(
    reduced.raw,
    reduced.payload,
    {
      cached: false,
      usage,
      createdAt: now,
      note: composeNote(
        `逐章读取了 ${chapters.length} 章，本次共发起 ${calls} 次请求。`,
        reused > 0 ? `其中 ${reused} 章直接用了已有小结，没有重复调用。` : '',
        notes.join(' '),
        reduced.note
      )
    }
  )
}

// ---------- 关键词 ----------

export async function runTerms(
  db: Database.Database,
  input: { bookId: string; providerId: ProviderId; model: string; signal: AbortSignal }
): Promise<AiResultView<TermsPayload>> {
  const call: CallContext = { providerId: input.providerId, model: input.model, signal: input.signal }
  const key: ResultKey = {
    bookId: input.bookId,
    task: 'terms',
    scopeKey: 'book',
    provider: input.providerId,
    model: input.model
  }
  const cached = getResult<TermsPayload>(db, key)
  if (cached) {
    return toView('', cached.payload, {
      cached: true,
      usage: { inputTokens: cached.inputTokens, outputTokens: cached.outputTokens },
      createdAt: cached.createdAt,
      note: null
    })
  }

  const summaries: PartialSummary[] = []
  for (const chapter of bodyChapters(db, input.bookId)) {
    const saved = savedSummary(db, input.bookId, chapter, call)
    if (saved) summaries.push(saved)
  }

  // 没有小结就不偷偷替用户开跑全书要点（硬规则 1），直接告诉他先做什么
  if (summaries.length === 0) {
    throw appError(
      'AI_UNSUPPORTED',
      '还没有任何一章的小结。关键词要有依据，先做一次「全书要点」或至少一章的「本章小结」。'
    )
  }

  const outcome = await askJson<TermsPayload>(
    call,
    buildMessages('terms', { ...baseContext(db, input.bookId, null), summaries }),
    asTerms
  )
  return finish(db, key, outcome.raw, outcome.payload, outcome.usage, outcome.note)
}

// ---------- 思维导图（不调模型） ----------

export function runMindmap(
  db: Database.Database,
  input: { bookId: string; providerId: ProviderId; model: string }
): AiResultView<MindmapNode> {
  const call: CallContext = {
    providerId: input.providerId,
    model: input.model,
    signal: new AbortController().signal
  }
  const key: ResultKey = {
    bookId: input.bookId,
    task: 'mindmap',
    scopeKey: 'book',
    provider: input.providerId,
    model: input.model
  }
  const cached = getResult<MindmapNode>(db, key)
  if (cached) {
    return toView('', cached.payload, {
      cached: true,
      usage: { inputTokens: cached.inputTokens, outputTokens: cached.outputTokens },
      createdAt: cached.createdAt,
      note: null
    })
  }

  const terms = getResult<TermsPayload>(db, {
    bookId: input.bookId,
    task: 'terms',
    scopeKey: 'book',
    provider: input.providerId,
    model: input.model
  })
  if (!terms) {
    throw appError('AI_UNSUPPORTED', '思维导图是把「关键词」按章节重新组织的。先生成一次关键词。')
  }

  const tree = buildMindmap(bookTitleOf(db, input.bookId), terms.payload.terms)
  if (!tree) {
    throw appError('AI_UNSUPPORTED', '这本书没有可用的关键词，先生成一次关键词。')
  }

  const now = Date.now()
  saveResult(db, key, tree, ZERO, now)
  return toView('', tree, {
    cached: false,
    usage: null,
    createdAt: now,
    note: '思维导图由「关键词」的结果组织而成，这一次没有调用模型，也没有产生费用。'
  })
}

// ---------- 形状校验 ----------

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/** 只留非空字符串。缺字段是模型的问题，不该让整条结果作废 */
function asTextList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item !== '')
}

function asTerm(value: unknown): SummaryTerm | null {
  const row = asRecord(value)
  if (!row) return null
  const term = asText(row.term)
  const gloss = asText(row.gloss)
  return term && gloss ? { term, gloss } : null
}

export function asSummary(value: unknown): ChapterSummaryPayload | null {
  const row = asRecord(value)
  if (!row) return null
  const overview = asText(row.overview)
  const keyPoints = asTextList(row.keyPoints)
  if (!overview || !keyPoints || keyPoints.length === 0) return null
  const terms = Array.isArray(row.terms)
    ? row.terms.map(asTerm).filter((item): item is SummaryTerm => item !== null)
    : []
  return { overview, keyPoints, terms }
}

export function asDigest(value: unknown): BookDigestPayload | null {
  const row = asRecord(value)
  if (!row) return null
  const threads = asTextList(row.threads)
  const args = asTextList(row.arguments)
  const conclusion = asText(row.conclusion)
  if (!threads || !args || !conclusion) return null
  return { threads, arguments: args, conclusion }
}

export function asTerms(value: unknown): TermsPayload | null {
  const row = asRecord(value)
  if (!row || !Array.isArray(row.terms)) return null
  const terms: Term[] = []
  for (const item of row.terms) {
    const entry = asRecord(item)
    if (!entry) continue
    const term = asText(entry.term)
    const gloss = asText(entry.gloss)
    if (!term || !gloss) continue
    terms.push({ term, gloss, where: asText(entry.where) ?? '' })
  }
  return terms.length === 0 ? null : { terms }
}
```

- [ ] **Step 8: 追加五条通道、契约与 preload**

`shared/ipc.ts` 的 `CH` 追加（放在 `aiProgress` 之后）：

```ts
  // 结构化任务。思维导图不调模型，但同样走 ai:mindmap —— 复用同一套缓存与结果视图
  aiSummary: 'ai:summary',
  aiDigest: 'ai:digest',
  aiTerms: 'ai:terms',
  aiMindmap: 'ai:mindmap',
  aiCancelDigest: 'ai:cancelDigest'
```

`API_SHAPE.ai` 末尾补 5 项，变成 17 项：

```ts
    'cancelIndex',
    'onDelta',
    'onProgress',
    'summary',
    'digest',
    'terms',
    'mindmap',
    'cancelDigest'
```

`electron/main/ai/service.ts` 的 `statusOf` 改成接受可空 bookId（设置页没有「当前书」这个概念）：

```ts
export function statusOf(db: Database.Database, bookId: string | null): AiStatus {
  const { providerId, model } = aiSettings(db)
  return {
    providerId,
    model,
    configured: hasKey(providerId),
    caps: PROVIDER_AI[providerId],
    unavailable: unavailableCaps(db, providerId),
    // 设置页只关心「这家能不能用」，没有书就没有索引可言，不编一个假的 0/0
    index: bookId === null ? { total: 0, done: 0, running: false } : indexState(db, bookId)
  }
}
```

`electron/main/ipc/ai.ts`：

① import 区追加：

```ts
import {
  runBookDigest,
  runChapterSummary,
  runMindmap,
  runTerms,
  type TaskProgress
} from '../ai/tasks'
```

② 模块级加一个 Map（在 `inflight` 旁边）：

```ts
/** 全书要点是长任务：它按 bookId 停，而不是按 requestId */
const digestInflight = new Map<string, AbortController>()
```

③ `registerAiIpc` 末尾（`aiCancelIndex` 之后）追加：

```ts
  ipcMain.handle(CH.aiSummary, async (_event, bookId: string, chapterId: number) => {
    const database = getDatabase()
    const { providerId, model } = aiSettings(database)
    const controller = new AbortController()
    try {
      return await queue.run(`summary:${chapterId}`, () =>
        runChapterSummary(database, {
          bookId,
          chapterId,
          providerId,
          model,
          signal: controller.signal
        })
      )
    } catch (error) {
      throw toReadable(error, '本章小结没有生成成功')
    }
  })

  ipcMain.handle(CH.aiDigest, async (event, bookId: string) => {
    if (digestInflight.has(bookId)) throw new Error('这本书的全书要点正在生成中')
    const database = getDatabase()
    const { providerId, model } = aiSettings(database)
    const controller = new AbortController()
    digestInflight.set(bookId, controller)
    try {
      return await queue.run(`digest:${bookId}`, () =>
        runBookDigest(
          database,
          { bookId, providerId, model, signal: controller.signal },
          (progress) => emitDigestProgress(event.sender, bookId, progress)
        )
      )
    } catch (error) {
      throw toReadable(error, '全书要点没有生成成功')
    } finally {
      digestInflight.delete(bookId)
    }
  })

  ipcMain.handle(CH.aiTerms, async (_event, bookId: string) => {
    const database = getDatabase()
    const { providerId, model } = aiSettings(database)
    const controller = new AbortController()
    try {
      return await queue.run(`terms:${bookId}`, () =>
        runTerms(database, { bookId, providerId, model, signal: controller.signal })
      )
    } catch (error) {
      throw toReadable(error, '关键词没有生成成功')
    }
  })

  ipcMain.handle(CH.aiMindmap, (_event, bookId: string) => {
    const database = getDatabase()
    const { providerId, model } = aiSettings(database)
    try {
      return runMindmap(database, { bookId, providerId, model })
    } catch (error) {
      throw toReadable(error, '思维导图没有生成成功')
    }
  })

  ipcMain.handle(CH.aiCancelDigest, (_event, bookId: string) => {
    digestInflight.get(bookId)?.abort()
  })
```

④ `emitProgress` 下方加一个：

```ts
function emitDigestProgress(sender: WebContents, bookId: string, progress: TaskProgress): void {
  if (!sender.isDestroyed()) sender.send(CH.aiProgress, { kind: 'digest', bookId, ...progress })
}
```

`electron/preload/index.ts`：

① import 的 `@shared/types` 里补上 `AiResultView`、`BookDigestPayload`、`ChapterSummaryPayload`、`MindmapNode`、`TermsPayload`。

② `api.ai` 里追加：

```ts
    summary: (bookId: string, chapterId: number): Promise<AiResultView<ChapterSummaryPayload>> =>
      ipcRenderer.invoke(CH.aiSummary, bookId, chapterId),
    digest: (bookId: string): Promise<AiResultView<BookDigestPayload>> =>
      ipcRenderer.invoke(CH.aiDigest, bookId),
    terms: (bookId: string): Promise<AiResultView<TermsPayload>> =>
      ipcRenderer.invoke(CH.aiTerms, bookId),
    mindmap: (bookId: string): Promise<AiResultView<MindmapNode>> =>
      ipcRenderer.invoke(CH.aiMindmap, bookId),
    cancelDigest: (bookId: string): Promise<void> =>
      ipcRenderer.invoke(CH.aiCancelDigest, bookId),
```

`emitProgress` 已经在 Task 8 里固定发 `kind: 'index'`；`emitDigestProgress` 发 `kind: 'digest'`。两个都是同一个 `ai:progress` 通道，`AiIndexBar` 只认 `kind === 'index'`，所以不会互相干扰。

- [ ] **Step 9: 写结构化任务面板**

`src/features/ai/AiTasks.tsx`：

```tsx
import { useState } from 'react'
import type {
  AiResultView,
  BookDigestPayload,
  ChapterSummaryPayload,
  MindmapNode,
  TermsPayload
} from '@shared/types'

type TaskKey = 'summary' | 'digest' | 'terms' | 'mindmap'

const TASK_LABELS: Record<TaskKey, string> = {
  summary: '本章小结',
  digest: '全书要点',
  terms: '关键词',
  mindmap: '思维导图'
}

/**
 * 每个任务开跑前要说清「大概要发几次请求」。
 * 这是 BYOK 产品的底线：多步任务的成本必须在点击之前可见（硬规则 1）。
 */
const TASK_CONFIRM: Record<TaskKey, string> = {
  summary: '会把这一章的正文发给模型做一次结构化小结。',
  digest: '会逐章请求一次。已经做过小结的章会直接复用，不重复花钱。',
  terms: '会用已有的逐章小结请求一次。没有小结时先做「全书要点」。',
  mindmap: '不调用模型：它是把「关键词」的结果按章节重新组织的。'
}

export function AiTasks({
  bookId,
  chapterId,
  chapterCount,
  hasSummary,
  onError
}: {
  bookId: string
  /** null 表示还没有打开具体某一章，「本章小结」据此禁用 */
  chapterId: number | null
  /** 正文里有多少章。全书要点的成本提示要用它 */
  chapterCount: number
  /** 本章是否已有小结 —— 决定「本章小结」是不是「查看已有小结」 */
  hasSummary: boolean
  onError: (message: string | null) => void
}) {
  const [results, setResults] = useState<Partial<Record<TaskKey, AiResultView<unknown>>>>({})
  const [running, setRunning] = useState<TaskKey | null>(null)
  const [confirming, setConfirming] = useState<TaskKey | null>(null)

  const run = async (task: TaskKey): Promise<void> => {
    setConfirming(null)
    setRunning(task)
    onError(null)
    try {
      const value =
        task === 'summary'
          ? await window.api.ai.summary(bookId, chapterId ?? 0)
          : task === 'digest'
            ? await window.api.ai.digest(bookId)
            : task === 'terms'
              ? await window.api.ai.terms(bookId)
              : await window.api.ai.mindmap(bookId)
      setResults((list) => ({ ...list, [task]: value as AiResultView<unknown> }))
    } catch (e) {
      onError(e instanceof Error ? e.message : `${TASK_LABELS[task]}没有生成成功`)
    } finally {
      setRunning(null)
    }
  }

  return (
    <section className="ai-tasks" aria-label="本书分析">
      {(Object.keys(TASK_LABELS) as TaskKey[]).map((task) => {
        const result = results[task]
        const disabled =
          running !== null || (task === 'summary' && chapterId === null)
        return (
          <div className="ai-task" key={task}>
            <div className="ai-task__head">
              <span className="ai-task__name">{TASK_LABELS[task]}</span>
              {result?.cached && <span className="ai-task__badge">来自缓存</span>}
              <span className="ai-panel__spacer" />
              {task === 'digest' && running === 'digest' ? (
                <button
                  type="button"
                  className="btn btn--quiet"
                  onClick={() => void window.api.ai.cancelDigest(bookId)}
                >
                  停下
                </button>
              ) : (
                <button
                  type="button"
                  className="btn"
                  disabled={disabled}
                  onClick={() => (result ? void run(task) : setConfirming(task))}
                >
                  {running === task ? '生成中…' : result ? '重新生成' : '生成'}
                </button>
              )}
            </div>

            {task === 'summary' && chapterId === null && (
              <p className="ai-task__hint">先在正文里翻到具体某一章，才能做本章小结。</p>
            )}

            {confirming === task && (
              <div className="ai-task__confirm">
                <p>
                  {TASK_CONFIRM[task]}
                  {task === 'digest' && chapterCount > 0
                    ? `本书正文共 ${chapterCount} 章，最多发起 ${chapterCount + 1} 次请求。`
                    : ''}
                  {task === 'summary' && hasSummary
                    ? '这一章已有小结，重新生成会再发一次请求。'
                    : ''}
                </p>
                <div className="ai-index-bar__actions">
                  <button type="button" className="btn btn--accent" onClick={() => void run(task)}>
                    开始
                  </button>
                  <button type="button" className="btn" onClick={() => setConfirming(null)}>
                    算了
                  </button>
                </div>
              </div>
            )}

            {result && <TaskResult task={task} result={result} />}
          </div>
        )
      })}
    </section>
  )
}

function TaskResult({ task, result }: { task: TaskKey; result: AiResultView<unknown> }) {
  return (
    <div className="ai-task__result">
      {result.note && <p className="ai-degrade">{result.note}</p>}
      <TaskBody task={task} result={result} />
      <p className="ai-task__meta">{usageLine(result)}</p>
    </div>
  )
}

function TaskBody({ task, result }: { task: TaskKey; result: AiResultView<unknown> }) {
  // 没解析成结构就按纯文本展示。绝不显示一个空框（硬规则 2）
  if (!result.payload) {
    return <p className="ai-task__text">{result.text ?? '这次没有拿到内容。'}</p>
  }
  if (task === 'summary') return <SummaryBody payload={result.payload as ChapterSummaryPayload} />
  if (task === 'digest') return <DigestBody payload={result.payload as BookDigestPayload} />
  if (task === 'terms') return <TermsBody payload={result.payload as TermsPayload} />
  return <MindmapBody node={result.payload as MindmapNode} />
}

function SummaryBody({ payload }: { payload: ChapterSummaryPayload }) {
  return (
    <>
      <p className="ai-task__text">{payload.overview}</p>
      <ul className="ai-msg__list">
        {payload.keyPoints.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
      {payload.terms.length > 0 && (
        <ul className="ai-terms">
          {payload.terms.map((item) => (
            <li key={item.term}>
              <strong>{item.term}</strong>：{item.gloss}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function DigestBody({ payload }: { payload: BookDigestPayload }) {
  return (
    <>
      <Section title="主题脉络" items={payload.threads} />
      <Section title="核心论点" items={payload.arguments} />
      <p className="ai-task__text">{payload.conclusion}</p>
    </>
  )
}

function Section({ title, items }: { title: string; items: readonly string[] }) {
  if (items.length === 0) return null
  return (
    <>
      <p className="ai-task__label">{title}</p>
      <ul className="ai-msg__list">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </>
  )
}

function TermsBody({ payload }: { payload: TermsPayload }) {
  return (
    <ul className="ai-terms">
      {payload.terms.map((item) => (
        <li key={`${item.term}-${item.where}`}>
          <strong>{item.term}</strong>：{item.gloss}
          {item.where !== '' && <span className="ai-terms__where">（{item.where}）</span>}
        </li>
      ))}
    </ul>
  )
}

function MindmapBody({ node }: { node: MindmapNode }) {
  return (
    <ul className="ai-mindmap">
      <li>
        {node.label}
        {node.children.length > 0 && (
          <ul>
            {node.children.map((child) => (
              <li key={child.label}>
                {child.label}
                {child.children.length > 0 && (
                  <ul>
                    {child.children.map((leaf) => (
                      <li key={`${child.label}-${leaf.label}`}>{leaf.label}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </li>
    </ul>
  )
}

function usageLine(result: AiResultView<unknown>): string {
  if (!result.usage) return '这次没有产生用量'
  const spent = `输入 ${result.usage.inputTokens} / 输出 ${result.usage.outputTokens} token`
  return result.cached ? `来自缓存，没有花钱（上次用量 ${spent}）` : `用量：${spent}`
}
```

- [ ] **Step 10: 把任务面板接进 AI 面板**

`src/features/ai/AiPanel.tsx` 四处改动。

① 加两个 import：

```tsx
import { AiTasks } from './AiTasks'
```

② state 区追加（放在 `const [error, setError]` 之后）：

```tsx
  /** 正文里的章节数。全书要点的成本提示要用它，从只读接口拿，不产生费用 */
  const [chapterCount, setChapterCount] = useState(0)
  /** 本章是否已有小结，决定「重新生成」要不要提醒会再花一次钱 */
  const [hasSummary, setHasSummary] = useState(false)
```

③ 在「换书、换章」那个 effect 里补一段（`refreshStatus()` 之后、加载历史之前）。**这里只能走只读接口**：`window.api.ai.summary` 在缓存未命中时会真的发请求（`runChapterSummary` 查不到缓存就往下走会调模型），所以它绝不能进 effect，否则用户一翻章就偷偷花一次钱。

```tsx
    setHasSummary(false)
    void window.api.reader
      .open(bookId)
      .then((opened) => {
        if (!alive || !opened) return
        setChapterCount(opened.chapters.filter((chapter) => chapter.href !== '').length)
      })
      .catch(() => undefined)
```

`hasSummary` 改为**由用户动作产生**：`AiTasks` 跑完「本章小结」时回调出来。给 `AiTasks` 的 props 补一个可选回调：

```tsx
  /** 每次拿到结果后通知父组件。父组件用它记住「本章已有小结」这类跨任务状态 */
  onResult?: (task: TaskKey, result: AiResultView<unknown>) => void
```

并在 `run` 里 `setResults(...)` 之后调用 `onResult?.(task, value as AiResultView<unknown>)`。

④ JSX：在 `.ai-panel__stream` 之前插入任务区，把上面的回调接上：

```tsx
      <AiTasks
        bookId={bookId}
        chapterId={chapterId}
        chapterCount={chapterCount}
        hasSummary={hasSummary}
        onError={setError}
        onResult={(task) => {
          if (task === 'summary') setHasSummary(true)
        }}
      />
```

`hasSummary` 只影响确认文案里那句「这一章已有小结，重新生成会再发一次请求」——它是个提示，不承担正确性，所以允许保守（只要做过一次就提示）。

⑤ `TaskKey` 类型要能从 `AiTasks.tsx` 导出，供 `onResult` 用：

```tsx
export type TaskKey = 'summary' | 'digest' | 'terms' | 'mindmap'
```

`chapterId` 为 null 时「本章小结」按钮禁用并给出一句说明，用户不会以为坏了。

- [ ] **Step 11: 补样式**

`src/styles/base.css` 末尾追加（`.btn--on` / `.btn--quiet` 若在计划 03 未定义，一并补在下面）：

```css
.btn--quiet {
  background: transparent;
  border-color: transparent;
  color: var(--ink-muted);
}

.btn--quiet:hover:not(:disabled) {
  background: var(--active);
  color: var(--ink);
}

/* ---- 结构化任务 ---- */
.ai-tasks {
  display: flex;
  flex-direction: column;
  border-bottom: 1px solid var(--line);
}

.ai-task {
  padding: var(--s2) var(--s3);
  border-top: 1px solid var(--line);
}

.ai-task:first-child {
  border-top: 0;
}

.ai-task__head {
  display: flex;
  align-items: center;
  gap: var(--s2);
}

.ai-task__name {
  font-size: 13px;
}

.ai-task__badge {
  padding: 0 6px;
  border-radius: var(--r-sm);
  background: var(--active);
  font-size: 11px;
  color: var(--ink-muted);
}

.ai-task__hint,
.ai-task__meta {
  margin: var(--s1) 0 0;
  font-size: 12px;
  color: var(--ink-muted);
}

.ai-task__label {
  margin: var(--s2) 0 var(--s1);
  font-size: 12px;
  color: var(--ink-muted);
}

.ai-task__text {
  margin: 0 0 var(--s2);
  white-space: pre-wrap;
}

.ai-task__confirm {
  margin-top: var(--s2);
}

.ai-task__confirm p {
  margin: 0 0 var(--s2);
  font-size: 12px;
  line-height: 1.7;
  color: var(--ink-muted);
}

.ai-task__result {
  margin-top: var(--s2);
}

.ai-terms {
  margin: 0;
  padding-left: 1.2em;
}

.ai-terms__where {
  color: var(--ink-muted);
}

.ai-mindmap {
  margin: 0;
  padding-left: 1.2em;
}

.ai-mindmap ul {
  margin: 0;
  padding-left: 1.2em;
}
```

- [ ] **Step 12: 类型检查、单测与边界测试**

Run: `npx tsc --noEmit`

Expected: 无错误。若 `AiPanel.tsx` 报 `TaskKey` 未导出，确认它在 `AiTasks.tsx` 里是 `export type`。

Run: `npx vitest run`

Expected: PASS。本 Task 新增 `tests/ai-mindmap.test.ts`（5 条）并给 `tests/ai-retrieve.test.ts` 加了 5 条。

Run: `npm run e2e -- e2e/boundary.spec.ts`

Expected: PASS，1 passed。`API_SHAPE.ai` 现在是 17 个方法。

- [ ] **Step 13: Commit**

```bash
git add shared/ipc.ts electron/main/ai/mindmap.ts electron/main/ai/tasks.ts \
  electron/main/ai/retrieve.ts electron/main/ai/service.ts electron/main/ipc/ai.ts \
  electron/preload/index.ts src/features/ai src/styles/base.css \
  tests/ai-mindmap.test.ts tests/ai-retrieve.test.ts
git commit -m "feat: 结构化任务（本章小结、全书要点 map-reduce、关键词、思维导图不调模型）"
```

---

### Task 11: 引用回跳

**Files:**
- Create: `src/features/reader/locate.ts`, `tests/ai-locate.test.ts`
- Modify: `shared/highlights.ts`, `src/features/reader/highlights.ts`, `src/features/reader/theme.ts`, `src/features/reader/paginator.ts`, `src/features/reader/ReaderPage.tsx`

**为什么不能直接用 CFI 回跳。** 引用来自检索命中的 chunk，它的来源是抽取出来的纯文本（计划 02 的 `chunks.text`），与渲染用的 XHTML 之间隔着一次转换——同一个字在两份文本里的 DOM 位置没有任何对应关系。所以引用只能靠**文本匹配**定位（spec §3.5）。匹配失败时必须明说，把用户送到这一章的章首再骗他「已定位」是最坏的结果。

- [ ] **Step 1: 写失败的测试**

`tests/ai-locate.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { flatten, locateInFlat, squash } from '../src/features/reader/locate'

describe('squash', () => {
  it('去掉换行、缩进与全角空格', () => {
    expect(squash('他\n  说：「好　的」')).toBe('他说：「好的」')
  })
})

describe('flatten', () => {
  it('跳过空白并记住每个保留字符的出处', () => {
    const flat = flatten(['ab\n', ' c d'])
    expect(flat.text).toBe('abcd')
    expect(flat.map).toEqual([
      { nodeIndex: 0, offset: 0 },
      { nodeIndex: 0, offset: 1 },
      { nodeIndex: 1, offset: 1 },
      { nodeIndex: 1, offset: 3 }
    ])
  })

  it('全空白的输入得到空串与空映射', () => {
    const flat = flatten([' ', '\n\t'])
    expect(flat.text).toBe('')
    expect(flat.map).toEqual([])
  })
})

describe('locateInFlat', () => {
  it('命中时返回拍平串里的起止下标', () => {
    const flat = flatten(['他说：「好的。」'])
    expect(locateInFlat(flat.text, '：「好的。」')).toEqual({ start: 2, end: 8 })
  })

  it('正文里的换行与缩进不影响匹配', () => {
    const flat = flatten(['他却笑了，\n    说：「好的。」\n'])
    expect(locateInFlat(flat.text, '他却笑了，说：「好的。」')).toEqual({ start: 0, end: 12 })
  })

  it('摘录尾部与正文有出入时用短探针仍能命中同一段', () => {
    const flat = flatten(['他却在那一刻笑了很久'])
    const hit = locateInFlat(flat.text, '他却在那一刻笑了很久很久，直到天亮')
    expect(hit).not.toBeNull()
    // 只断言「落在同一段上」：探针长度是内部策略，不该被测试钉死
    expect(flat.text.slice(hit!.start, hit!.end)).toBe('他却在那一刻笑了')
  })

  it('完全找不到时返回 null，不做模糊猜测', () => {
    const flat = flatten(['这本书里没有这句话'])
    expect(locateInFlat(flat.text, '完全不同的一段文字内容')).toBeNull()
  })

  it('空摘录返回 null', () => {
    const flat = flatten(['有正文'])
    expect(locateInFlat(flat.text, '   \n ')).toBeNull()
  })

  it('正文为空返回 null', () => {
    expect(locateInFlat('', '任意一段')).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `npx vitest run tests/ai-locate.test.ts`

Expected: FAIL，报 `Failed to resolve import "../src/features/reader/locate"`。

- [ ] **Step 3: 写定位纯逻辑**

`src/features/reader/locate.ts`：

```ts
/**
 * 把「引用摘录」定位回章节正文。
 *
 * 为什么要文本匹配而不是 CFI：引用来自检索命中的 chunk，它的来源是抽取出来的纯文本
 * （计划 02 的 `chunks.text`），与渲染用的 XHTML 之间隔着一次转换，没有可用的 CFI
 * （spec §3.5 也是这么定的）。所以把正文按空白归一化，再用摘录去查。
 *
 * 这一层是纯函数，DOM 只出现在下面的 `rangeFromExcerpt` 里。
 */

/** 拍平后的字符位置：第几个文本节点、节点内第几个字符 */
export type Position = { nodeIndex: number; offset: number }

export type FlatText = { text: string; map: readonly Position[] }

/**
 * 摘录长度逐级缩短的探针。
 *
 * 正文与摘录之间常有标点、软连字符、脚注编号之类的出入，全串命中不了就退一步。
 * 退到 8 个字还命中不了就放弃：再短下去匹配到别的句子上，还不如不定位。
 */
const PROBE_LENGTHS = [60, 30, 16, 8]

const BLANK = /\s/u

/** 去掉所有空白字符（含换行、制表、全角空格） */
export function squash(text: string): string {
  return text.replace(/\s+/gu, '')
}

/**
 * 把若干个文本节点的内容拼成一条无空白的串，并记住每个保留字符的出处。
 *
 * 之所以要记出处：匹配到的是「拍平串」里的下标，而 `Range` 需要的是
 * 「第几个节点、节点内第几个字符」，这层映射是绕不过去的。
 */
export function flatten(texts: readonly string[]): FlatText {
  const map: Position[] = []
  let text = ''
  for (let nodeIndex = 0; nodeIndex < texts.length; nodeIndex += 1) {
    const source = texts[nodeIndex] ?? ''
    for (let offset = 0; offset < source.length; offset += 1) {
      const char = source[offset] ?? ''
      if (BLANK.test(char)) continue
      text += char
      map.push({ nodeIndex, offset })
    }
  }
  return { text, map }
}

/**
 * 在拍平后的正文里找摘录，返回它在拍平串里的 `[start, end)`。
 *
 * 找不到就返回 null —— 不猜、不模糊匹配到别的句子上：定位错了比不定位更糟。
 */
export function locateInFlat(flat: string, excerpt: string): { start: number; end: number } | null {
  const needle = squash(excerpt)
  if (needle.length === 0 || flat.length === 0) return null

  const probes: number[] = []
  for (const limit of PROBE_LENGTHS) {
    const size = Math.min(limit, needle.length)
    if (size > 0 && !probes.includes(size)) probes.push(size)
  }

  for (const size of probes) {
    const start = flat.indexOf(needle.slice(0, size))
    if (start >= 0) return { start, end: start + size }
  }
  return null
}

/** 脚本、样式这类节点里的文字不是正文，不参与匹配 */
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT'])

/** 收集文档里参与排版的文本节点，顺序即文档顺序 */
function textNodesOf(doc: Document): Text[] {
  const root = doc.body
  if (!root) return []
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  let current = walker.nextNode()
  while (current) {
    const node = current as Text
    const parent = node.parentElement
    if (node.data.trim() !== '' && !(parent && SKIP_TAGS.has(parent.tagName))) {
      nodes.push(node)
    }
    current = walker.nextNode()
  }
  return nodes
}

/**
 * 从章节文档里找出摘录对应的范围。
 *
 * 返回的 Range 属于 `doc` 这个文档 —— `CSS.highlights` 与 `Range` 都只在同一个 Window
 * 内有效，拿父窗口的 Range 去 iframe 的注册表里注册会静默失败。
 */
export function rangeFromExcerpt(doc: Document, excerpt: string): Range | null {
  const nodes = textNodesOf(doc)
  if (nodes.length === 0) return null

  const flat = flatten(nodes.map((node) => node.data))
  const hit = locateInFlat(flat.text, excerpt)
  if (!hit) return null

  const from = flat.map[hit.start]
  const last = flat.map[hit.end - 1]
  if (!from || !last) return null

  const startNode = nodes[from.nodeIndex]
  const endNode = nodes[last.nodeIndex]
  if (!startNode || !endNode) return null
  // 摘录会跨节点：起点落在第一个节点的一个字上，终点落在最后一个节点的下一个字之前
  if (from.offset >= startNode.data.length) return null
  if (last.offset + 1 > endNode.data.length) return null

  const range = doc.createRange()
  range.setStart(startNode, from.offset)
  range.setEnd(endNode, last.offset + 1)
  return range
}
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `npx vitest run tests/ai-locate.test.ts`

Expected: PASS，8 passed。

- [ ] **Step 5: 加闪烁用的注册名**

`shared/highlights.ts` 里 `highlightRegistryName` 下方追加：

```ts
/**
 * 引用回跳时临时标出原文用的注册名。
 *
 * 刻意不放进 `HIGHLIGHT_COLORS`：那个数组是「本章标注」的四色，
 * `clearHighlights` 会整组清掉再重画；把闪烁混进去，每次重画标注都会顺手抹掉它。
 * 两者的生命周期不同，名字就分开。
 */
export const CITATION_FLASH_NAME = 'cite-flash'
```

- [ ] **Step 6: 写闪烁绘制**

`src/features/reader/highlights.ts`：

① import 行改成（加上新常量）：

```ts
import {
  CITATION_FLASH_NAME,
  HIGHLIGHT_COLORS,
  highlightRegistryName,
  type HighlightColor
} from '@shared/highlights'
```

② 文件末尾追加：

```ts
/** 闪烁持续时长。够看清位置，又不至于赖着不走 */
export const CITATION_FLASH_MS = 2000

/**
 * 把一段范围临时标出来，过一会儿自动消失。
 *
 * 同样不碰 DOM，理由与 `paintHighlights` 一致（spec §3.4）。
 * 返回一个「立刻取消」的函数：换位置时要先取消上一次，否则上一处会一直闪到超时。
 */
export function flashRange(win: Window, range: Range, ms = CITATION_FLASH_MS): () => void {
  const api = apiOf(win)
  if (!api) return () => undefined
  api.registry.set(CITATION_FLASH_NAME, new api.Ctor(range))
  const timer = win.setTimeout(() => api.registry.delete(CITATION_FLASH_NAME), ms)
  return () => {
    win.clearTimeout(timer)
    api.registry.delete(CITATION_FLASH_NAME)
  }
}
```

- [ ] **Step 7: 给闪烁配色**

`src/features/reader/theme.ts`：

① import 行改成：

```ts
import { CITATION_FLASH_NAME, HIGHLIGHT_COLORS, highlightRegistryName } from '@shared/highlights'
```

② `HIGHLIGHT_BG` 下方追加：

```ts
/**
 * 引用回跳的闪烁底色。与 `--accent` 同色系，但注入的章节文档里没有 Design Tokens，
 * 只能写字面量。
 */
const CITATION_FLASH_BG: Record<ReadingPrefs['theme'], string> = {
  light: '#e8c979',
  dark: '#6a5527'
}

/** 闪烁只有一种底色，与四色标注分开写，免得有人以为它也在 `HIGHLIGHT_COLORS` 里 */
function citationFlashRule(theme: ReadingPrefs['theme']): string {
  return `::highlight(${CITATION_FLASH_NAME}) {
  background-color: ${CITATION_FLASH_BG[theme]};
  color: inherit;
}`
}
```

③ `buildReaderCss` 的模板字符串里，`${highlightRules(prefs.theme)}` 之后追加一行：

```ts
${citationFlashRule(prefs.theme)}
```

- [ ] **Step 8: 给分页器加按摘录定位**

`src/features/reader/paginator.ts`：

① import 区追加：

```ts
import { flashRange } from './highlights'
import { rangeFromExcerpt } from './locate'
```

② 私有字段区（`private offset = 0` 旁）追加：

```ts
  /** 上一次闪烁的取消函数。同一章里连点两条引用时，先把上一条收掉 */
  private cancelFlash: (() => void) | null = null
```

③ `goToElement` 之后追加：

```ts
  /**
   * 按一段原文定位，并把那段原文闪一下。
   *
   * 找不到返回 false，由调用方决定怎么告知用户 —— 这里不抛错、也不退化成章首：
   * 「以为定位成功了」比「知道没定位到」糟得多。
   */
  goToExcerpt(excerpt: string): boolean {
    const range = rangeFromExcerpt(this.doc, excerpt)
    if (!range) return false
    const win = this.doc.defaultView
    if (!win) return false

    this.settleAt(this.contentLeftOf(range.getBoundingClientRect()))
    this.cancelFlash?.()
    this.cancelFlash = flashRange(win, range)
    return true
  }
```

- [ ] **Step 9: 在阅读器里接线**

`src/features/reader/ReaderPage.tsx` 九处改动。

① import 区：`@shared/types` 那一行加上 `Citation`：

```tsx
import type { Citation, ReadingTarget } from '@shared/types'
```

② 文件顶部（组件外，常量区）追加：

```tsx
/** 引用回跳失败时的口径：说清「没定位到」，不假装成功 */
const CITATION_MISS = '没能在这章正文里定位到这段原文（正文与检索用的文本对不上）。'

/** 引用指向的章节没了。书被重新导入过就会这样 */
const CITATION_NO_CHAPTER = '这条引用对应的章节现在不在书里了，书可能被重新导入过。'
```

③ state 区追加：

```tsx
  const [citationNote, setCitationNote] = useState<string | null>(null)
```

④ `pendingRef` 的类型加上 `excerpt`：

```tsx
  /** 新文档载入后要跳到的位置：进度用 cfi、书内锚点用 fragment、往回翻章用 edge、引用回跳用 excerpt */
  const pendingRef = useRef<{ cfi?: string; fragment?: string; edge?: 'end'; excerpt?: string } | null>(
    null
  )
```

用一个 ref 承载全部落点而不是再加一个 `pendingExcerptRef`：effect ⑤ 是唯一决定「新文档就位后停哪」的地方，落点来源多了以后，分成两个 ref 迟早会出现「两个都设了、谁赢没写清楚」的糊涂账。

⑤ effect ⑤ 的分支改成：

```tsx
    if (pending.cfi) {
      paginator.goToCfi(pending.cfi)
    } else if (pending.edge === 'end') {
      paginator.goToPage(paginator.pages - 1)
    } else if (pending.fragment) {
      // 锚点找不到就停在章首：链接至少把用户带到了对的那一章
      paginator.goToElement(pending.fragment)
    } else if (pending.excerpt) {
      // 引用回跳：跨章时摘录要等新文档就位才能匹配，失败也必须明说
      setCitationNote(paginator.goToExcerpt(pending.excerpt) ? null : CITATION_MISS)
    }
```

⑥ `goToChapterById` 之后追加：

```tsx
  /**
   * 点引用上标：跳到那一章的原文处，并把那段原文闪一下。
   *
   * 三种结果都要如实呈现：定位成功（闪烁）、跳到章了但没匹配上（提示条）、
   * 章节都不在了（提示条）。没有第四种「什么都不发生」。
   */
  const goToCitation = useCallback(
    (citation: Citation) => {
      setCitationNote(null)
      const index =
        citation.chapterId === null
          ? -1
          : readable.findIndex((item) => item.id === citation.chapterId)

      if (index >= 0 && index !== chapterIndex) {
        // 跨章：摘录挂上，等新文档就位后由 ⑤ 号 effect 去定位
        pendingRef.current = { excerpt: citation.excerpt }
        setChapterIndex(index)
        return
      }
      if (index < 0 && citation.chapterId !== null) {
        setCitationNote(CITATION_NO_CHAPTER)
        return
      }
      // 就在本章，或引用没带章节号：只在本章里找，不动文档
      const found = paginatorRef.current?.goToExcerpt(citation.excerpt) ?? false
      if (!found) setCitationNote(CITATION_MISS)
    },
    [readable, chapterIndex]
  )
```

⑦ 定位提示是过渡信息，不能变成一条永远挂着的横幅：

```tsx
  useEffect(() => {
    if (!citationNote) return
    const timer = window.setTimeout(() => setCitationNote(null), 6000)
    return () => window.clearTimeout(timer)
  }, [citationNote])
```

⑧ JSX：在「窗口太窄」那条 `reader__degrade` 之后插入：

```tsx
      {citationNote && (
        <p className="reader__degrade" role="status">
          {citationNote}
        </p>
      )}
```

⑨ 传给面板：

```tsx
          <AiPanel
            bookId={bookId}
            chapterId={chapter?.id ?? null}
            seed={aiSeed}
            onSeedConsumed={() => setAiSeed(null)}
            onCitation={goToCitation}
            onClose={() => setAiOpen(false)}
          />
```

Task 9 里那句「不传时引用上标渲染成普通文字」到这里就不再是常态了——正常路径一定传。

- [ ] **Step 10: 类型检查与测试**

Run: `npx tsc --noEmit`

Expected: 无错误。若 `paginator.ts` 报 `NodeFilter` 未定义，说明 `tsconfig.json` 的 `lib` 少了 `DOM`——计划 01 里是 `["ES2023", "DOM", "DOM.Iterable"]`，回那里核一遍。

Run: `npx vitest run`

Expected: PASS。本 Task 新增 `tests/ai-locate.test.ts`（8 条）。

Run: `npm run e2e -- e2e/reader.spec.ts`

Expected: PASS，3 passed。若「往回翻回到第一章最后一页」失败，检查 effect ⑤ 的分支顺序有没有被写乱——`edge: 'end'` 必须仍在 `excerpt` 之前。

- [ ] **Step 11: Commit**

```bash
git add shared/highlights.ts src/features/reader/locate.ts src/features/reader/highlights.ts \
  src/features/reader/theme.ts src/features/reader/paginator.ts src/features/reader/ReaderPage.tsx \
  tests/ai-locate.test.ts
git commit -m "feat: 引用回跳（文本定位、跨章落点、失败明说，闪烁不写 DOM）"
```

---

### Task 12: 运行时能力降级

Task 5 定义好的 `markUnavailable` 到目前为止没有任何调用方——`PROVIDER_AI` 是**随版本写死的声明**，而服务商的真实行为会变：今天还接受 `response_format` 的模型明天可能回 400；声明里说能做的 embeddings，这个账号可能根本没开通。声明与真实不一致时，必须落库记住，否则用户每次点任务都要先白撞一次。

这一 Task 做三件事：

1. 把「这次 400 算不算『不支持结构化输出』」抽成纯函数，让 vitest 能覆盖；
2. `askJson` 在真被拒时去掉参数重跑一次、记入能力表；
3. 顺手补上一个还没接线的地方：`fitPassages` 丢掉的段落目前是**静默丢弃**的。

**Files:**
- Modify: `electron/main/ai/retry.ts`, `electron/main/ai/tasks.ts`, `electron/main/ai/index-builder.ts`
- Test: `tests/ai-retry.test.ts`

- [ ] **Step 1: 先写失败的测试**

`tests/ai-retry.test.ts` 的 import 行改成：

```ts
import {
  RETRY_DELAY_MS,
  classifyError,
  isJsonModeRejection,
  shouldRetry
} from '../electron/main/ai/retry'
```

文件末尾追加：

```ts
describe('isJsonModeRejection', () => {
  it('这次要求了 JSON、服务商回 400 —— 是真的不接受结构化输出', () => {
    expect(isJsonModeRejection(classifyError(400, ''), true)).toBe(true)
  })

  it('这次本来就没要求 JSON —— 400 与结构化输出无关，不能记账', () => {
    expect(isJsonModeRejection(classifyError(400, ''), false)).toBe(false)
  })

  it('网络 / 限流 / 鉴权都不是「不支持」', () => {
    expect(isJsonModeRejection(classifyError(null, ''), true)).toBe(false)
    expect(isJsonModeRejection(classifyError(429, ''), true)).toBe(false)
    expect(isJsonModeRejection(classifyError(401, ''), true)).toBe(false)
  })
})
```

- [ ] **Step 2: 跑它，确认失败**

Run: `npx vitest run tests/ai-retry.test.ts`

Expected: FAIL —— `isJsonModeRejection is not a function`。前面 10 条老用例仍然是绿的。

- [ ] **Step 3: 加判定函数**

`electron/main/ai/retry.ts` 的 `shouldRetry` 之后追加：

```ts
/**
 * 这次 400 是不是「服务商不接受结构化输出参数」造成的？
 *
 * 两个条件都要满足：① 这次请求里真的带了 `response_format`；② 错误被归进了「不支持」。
 * 少一个都会误伤：模型名写错也是 400 / `AI_UNSUPPORTED`，把它记成「不支持结构化输出」
 * 会让这家模型从此再也不带参数请求 —— 一次输入失误换来永久降级。
 */
export function isJsonModeRejection(error: AppError, requestedJson: boolean): boolean {
  return requestedJson && error.code === 'AI_UNSUPPORTED'
}
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `npx vitest run tests/ai-retry.test.ts`

Expected: PASS，13 passed（10 + 3）。

- [ ] **Step 5: 让 `askJson` 降级重试并记账**

`electron/main/ai/tasks.ts` 的 import 区四处改动：

```ts
import { appError, toAppError } from '@shared/errors'
```

```ts
import { chat, type ChatResult } from './provider'
```

```ts
import { getResult, markUnavailable, saveResult, unavailableCaps, type ResultKey } from './repo'
```

```ts
import { isJsonModeRejection } from './retry'
```

`SLICE_SIZE` 下面补三条文案常量：

```ts
const JSON_NOT_DECLARED = '当前模型不支持结构化输出，已改为提示词约束 + 本地解析。'
const JSON_REJECTED =
  '服务商不接受结构化输出参数（已记下，这家之后不再带该参数），本次改为提示词约束 + 本地解析。'
const JSON_PARSE_HINT = '若下面是模型原文，说明这次没能解析成结构。'
```

整个 `askJson` 换成：

```ts
/**
 * 跑一次要求 JSON 输出的结构化调用。
 *
 * 模型没吐合法 JSON 时不抛错：`payload` 为 null、`raw` 是原文，由界面按纯文本展示。
 * 抛错会让用户失去「它到底说了什么」这个信息（硬规则 2）。
 *
 * 声明说支持、服务商却回 400 时，把「不支持」记进能力表并去掉参数重跑一次。
 * **只重跑一次**：第二次再失败说明问题不在 `response_format` 上，继续试是白花钱。
 */
async function askJson<T>(
  db: Database.Database,
  call: CallContext,
  messages: ChatMessage[],
  validate: (value: unknown) => T | null
): Promise<Structured<T>> {
  const declared =
    PROVIDER_AI[call.providerId].jsonMode &&
    modelOf(call.providerId, call.model)?.jsonMode === true
  const wantedJson = declared && !unavailableCaps(db, call.providerId).includes('jsonMode')

  const ask = (json: boolean): Promise<ChatResult> =>
    chat({
      providerId: call.providerId,
      model: call.model,
      input: { messages, maxTokens: MAX_OUTPUT, temperature: 0.2, json, stream: false },
      signal: call.signal
    })

  let usedJson = wantedJson
  let result: ChatResult
  if (!wantedJson) {
    result = await ask(false)
  } else {
    try {
      result = await ask(true)
    } catch (error) {
      const normalized = toAppError(error, '结构化调用失败')
      if (!isJsonModeRejection(normalized, wantedJson)) throw normalized
      markUnavailable(db, call.providerId, 'jsonMode')
      usedJson = false
      result = await ask(false)
    }
  }

  const payload = validate(parseLooseJson(result.content))
  return {
    raw: result.content,
    payload,
    usage: result.usage,
    note: usedJson
      ? null
      : composeNote(declared ? JSON_REJECTED : JSON_NOT_DECLARED, JSON_PARSE_HINT)
  }
}
```

`note` 用的是 `declared` 而不是 `wantedJson`：被记过不可用的模型仍然属于「服务商不接受」，说成 `JSON_NOT_DECLARED` 会让用户以为模型天生不支持，与事实不符。

- [ ] **Step 6: 六处调用点补 `db`**

`askJson` 多了第一个参数，调用点全部要跟着改。用这条命令定位：

```bash
grep -n "askJson<" electron/main/ai/tasks.ts
```

Expected: 7 行 —— 1 行函数定义 + 6 处调用，分布是 `runChapterSummary` 3 处（短章节一次读、分段、reduce）、`runBookDigest` 2 处（逐章、reduce）、`runTerms` 1 处。

每一处的改法都一样：在紧跟着的 `call,` 上面插一行 `db,`。改完后依次是：

```ts
    const only = await askJson<ChapterSummaryPayload>(
      db,
      call,
      buildMessages('chapterSummary', {
```

```ts
    const part = await askJson<ChapterSummaryPayload>(
      db,
      call,
      buildMessages('chapterSummary', { ...context, chapterText: slice.text }),
      asSummary
    )
```

```ts
  const reduced = await askJson<ChapterSummaryPayload>(
    db,
    call,
    buildMessages('chapterSummary', { ...context, summaries: partials }),
    asSummary
  )
```

```ts
      const part = await askJson<ChapterSummaryPayload>(
        db,
        call,
        buildMessages('bookDigest', {
```

```ts
  const reduced = await askJson<BookDigestPayload>(
    db,
    call,
    buildMessages('bookDigest', { ...baseContext(db, input.bookId, null), summaries }),
    asDigest
  )
```

```ts
  const outcome = await askJson<TermsPayload>(
    db,
    call,
    buildMessages('terms', { ...baseContext(db, input.bookId, null), summaries }),
    asTerms
  )
```

注意第二处与第四处的参数名都叫 `part`，缩进不同（一个在函数体、一个在 for 循环里）——按 `grep` 的行号逐个核对，别只看名字。

- [ ] **Step 7: 索引被拒时记账**

`electron/main/ai/index-builder.ts` 的 import 区追加：

```ts
import { toAppError } from '@shared/errors'
```

```ts
import { markUnavailable } from './repo'
```

`embed` 那一行的 import 补上返回类型：

```ts
import { embed, type EmbedResult } from './provider'
```

把 `buildIndex` 里的这一行：

```ts
      const result = await embed(providerId, pending.map((row) => row.text))
```

换成：

```ts
      let result: EmbedResult
      try {
        result = await embed(providerId, pending.map((row) => row.text))
      } catch (error) {
        const normalized = toAppError(error, '向量服务请求失败')
        // 声明说能做、这个账号其实没开通 —— 记下来，下次打开面板就能看到降级说明
        if (normalized.code === 'AI_UNSUPPORTED') markUnavailable(db, providerId, 'embed')
        throw error
      }
```

`throw error` 而不是 `throw normalized`：IPC 层的 `toReadable` 本来就会归一化，这里只多做一个记账动作，不改错误本身。

- [ ] **Step 8: 截断要明说**

`fitPassages` 超出预算时会丢掉尾部的段。`runChat` 那条路已经把它变成了 `AiDegrade`，但**结构化任务的丢法是静默的**：一章 20 段只送了 4 段进去，结果里却写着「分 4 段读取后合成」，用户没有任何办法知道剩下 16 段被扔了。这违反硬规则 2，补上。

① `runChapterSummary` 的 map-reduce 分支（`const reduced = await askJson...` 之后那个 `finish` 调用），把 `composeNote` 改成：

```ts
    composeNote(
      `这一章较长，分 ${kept.length} 段读取后合成，共发起 ${kept.length + 1} 次请求。`,
      dropped > 0 ? `这一章超出当前模型的上下文上限，最后 ${dropped} 段没有送进去。` : '',
      notes.join(' '),
      reduced.note
    )
```

`dropped` 在上面解构时已经有了（`if (dropped === 0)` 用的就是它），这里只是别把它浪费掉。

② `runBookDigest` 两处改动。先加一个计数（在 `let reused = 0` 下面）：

```ts
  /** 有几章因为超出上下文上限只读了前半部分。这个数字必须出现在结果里 */
  let clipped = 0
```

再把循环里的：

```ts
      const text = chapterTextOf(db, chapter.id)
      const { kept } = fitPassages(slicesOf(text, SLICE_SIZE), budgetFor(input.providerId, input.model, text))
```

改成：

```ts
      const text = chapterTextOf(db, chapter.id)
      const { kept, dropped } = fitPassages(
        slicesOf(text, SLICE_SIZE),
        budgetFor(input.providerId, input.model, text)
      )
      if (dropped > 0) clipped += 1
```

最后在出口的 `composeNote` 里补一句（放在 `reused > 0 ? ...` 那行下面）：

```ts
        clipped > 0 ? `有 ${clipped} 章因超出上下文上限只读了前半部分。` : '',
```

- [ ] **Step 9: 类型检查与全量测试**

Run: `npx tsc --noEmit`

Expected: 无错误。若报「应有 4 个参数，但获得 3 个」，说明 Step 6 漏了一处 `askJson` 调用点，用 `grep -n "askJson<" electron/main/ai/tasks.ts` 找出来。

Run: `npx vitest run`

Expected: PASS。`tests/ai-retry.test.ts` 13 passed。

Run: `npm run e2e -- e2e/reader.spec.ts e2e/highlight.spec.ts`

Expected: PASS。这一 Task 没有改渲染路径，这两条是用来看「顺手补的截断说明有没有伤到既有链路」的。

- [ ] **Step 10: Commit**

```bash
git add electron/main/ai/retry.ts electron/main/ai/tasks.ts electron/main/ai/index-builder.ts \
  tests/ai-retry.test.ts
git commit -m "feat: 能力降级落库与上下文截断明说（结构化输出、embedding、超预算段落）"
```

---

### Task 13: 设置页模型组与 AI 端到端

前面 12 个 Task 里，AI 只有 Task 8 的 `boundary.spec.ts` 在验证「方法名表对得上」，**没有一条真实跑通的 AI 链路测试**。这一 Task 补齐：把设置页的模型组做成能选模型、能测连接、能看见能力表的样子，再用打桩的 `fetch` 把划词问答与结构化任务端到端跑一遍。

**Files:**
- Modify: `electron/main/ipc/ai.ts`, `electron/preload/index.ts`, `src/features/settings/ModelSection.tsx`, `src/styles/base.css`, `fixtures/make-epub.ts`, `e2e/helpers.ts`
- Create: `e2e/ai.spec.ts`, `e2e/ai-degrade.spec.ts`

- [ ] **Step 1: 让 `ai.status` 接受可空 bookId**

设置页没有「当前书」这个概念，`statusOf` 在 Task 10 已经允许 `bookId: string | null`，但 IPC 与 preload 的类型还卡在 `string`。

`electron/main/ipc/ai.ts`：

```ts
  ipcMain.handle(CH.aiStatus, (_event, bookId: string | null) => statusOf(getDatabase(), bookId))
```

`electron/preload/index.ts`：

```ts
    status: (bookId: string | null): Promise<AiStatus> => ipcRenderer.invoke(CH.aiStatus, bookId),
```

`AiPanel` 那边照旧传 `bookId`，不受影响。

- [ ] **Step 2: 扩展设置页模型组**

`src/features/settings/ModelSection.tsx` 整份替换成：

```tsx
import { useEffect, useState } from 'react'
import { CAPABILITY_LABELS, modelsFor } from '@shared/ai'
import { PROVIDERS, type AiStatus, type ProviderId } from '@shared/types'

export function ModelSection() {
  const [provider, setProvider] = useState<ProviderId>('deepseek')
  const [model, setModel] = useState('')
  const [masked, setMasked] = useState<string | null>(null)
  const [available, setAvailable] = useState(true)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [testing, setTesting] = useState(false)
  const [verdict, setVerdict] = useState<string | null>(null)

  useEffect(() => {
    void window.api.secrets.status().then((s) => {
      setAvailable(s.available)
      setMasked(s.providers[provider] ?? null)
    })
  }, [provider])

  /**
   * 首屏只问主进程要一次。
   *
   * 「哪家的默认模型是哪个」「存的模型还在这家的清单里吗」这两件事的答案在
   * `aiSettings` 里，渲染进程不重写一遍 —— 重写就会出现两处规则各自演化。
   */
  useEffect(() => {
    void window.api.ai.status(null).then((next) => {
      setProvider(next.providerId)
      setModel(next.model)
      setStatus(next)
    })
  }, [])

  async function pickProvider(next: ProviderId) {
    setProvider(next)
    setVerdict(null)
    await window.api.settings.set('ai.provider', next)
    // 清掉旧模型：留着会变成「别家的模型配在这家」，aiSettings 下次按新家回落到默认值
    await window.api.settings.set('ai.model', '')
    const fresh = await window.api.ai.status(null)
    setModel(fresh.model)
    setStatus(fresh)
  }

  async function pickModel(next: string) {
    setModel(next)
    await window.api.settings.set('ai.model', next)
    setStatus(await window.api.ai.status(null))
  }

  async function save() {
    const key = draft.trim()
    if (!key) return
    setSaving(true)
    try {
      await window.api.secrets.set(provider, key)
      setDraft('')
      setMasked((await window.api.secrets.status()).providers[provider] ?? null)
      setStatus(await window.api.ai.status(null))
    } finally {
      setSaving(false)
    }
  }

  async function clear() {
    await window.api.secrets.clear(provider)
    setMasked(null)
    setStatus(await window.api.ai.status(null))
  }

  /** 真的发一次最短的请求。成功失败都要说话，不能只转个圈 */
  async function test() {
    setTesting(true)
    setVerdict(null)
    try {
      const outcome = await window.api.ai.test(provider, model)
      setVerdict(`连接成功：${outcome.model} 回话了。`)
    } catch (e) {
      setVerdict(`没能连上：${e instanceof Error ? e.message : '原因未知'}。`)
    } finally {
      setTesting(false)
    }
  }

  return (
    <section className="settings__group">
      <h2 className="settings__title">模型</h2>

      {!available && (
        <p className="settings__notice">
          当前系统无法提供安全的密钥存储，API Key 无法保存。你仍然可以阅读和记笔记。
        </p>
      )}

      <div className="settings__row">
        <label className="settings__label" htmlFor="provider">
          服务商
        </label>
        <select
          id="provider"
          value={provider}
          onChange={(e) => void pickProvider(e.target.value as ProviderId)}
        >
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div className="settings__row">
        <label className="settings__label" htmlFor="model">
          模型
        </label>
        <select id="model" value={model} onChange={(e) => void pickModel(e.target.value)}>
          {modelsFor(provider).map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn"
          disabled={testing || model === ''}
          onClick={() => void test()}
        >
          {testing ? '测试中…' : '测试连接'}
        </button>
      </div>

      <div className="settings__row">
        <label className="settings__label" htmlFor="api-key">
          API Key
        </label>
        {masked ? (
          <>
            <code className="settings__masked">{masked}</code>
            <button type="button" className="btn" onClick={() => void clear()}>
              清除
            </button>
          </>
        ) : (
          <>
            <input
              id="api-key"
              type="password"
              value={draft}
              placeholder="sk-…"
              disabled={!available}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => setDraft('')}
            />
            <button
              type="button"
              className="btn"
              disabled={!available || saving || !draft.trim()}
              onClick={() => void save()}
            >
              保存
            </button>
          </>
        )}
      </div>

      <p className="settings__hint">
        密钥用系统钥匙串加密后只存在这台电脑上，不会上传，也不会随「导出全部数据」一起导出。
      </p>

      {verdict && (
        <p className="settings__hint" role="status">
          {verdict}
        </p>
      )}

      <div className="settings__caps">
        <p className="settings__hint">
          这家的能力。写的是内置声明；哪一项被服务商真的拒绝过，这里会标出来并说明替代方案。
        </p>
        <ul className="caps">
          {CAPABILITY_LABELS.map((row) => {
            const declared = status ? status.caps[row.key] : false
            const rejected = status?.unavailable.includes(row.key) ?? false
            const usable = declared && !rejected
            return (
              <li className="caps__row" key={row.key}>
                <span className="caps__name">{row.label}</span>
                <span className={`caps__state${usable ? ' caps__state--on' : ''}`}>
                  {usable ? '可用' : rejected ? '被服务商拒绝，已记下' : '不提供'}
                </span>
                {!usable && <span className="caps__fallback">{row.fallback}</span>}
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
```

`CAPABILITY_LABELS` 与 `PROVIDER_AI` 同源，所以这张表天然跟着 Task 1 的声明走，不会出现「声明改了、设置页还写着旧文案」。

- [ ] **Step 3: 补能力表样式**

`src/styles/base.css` 末尾追加：

```css
.settings__caps {
  display: flex;
  flex-direction: column;
  gap: var(--s2);
}

.caps {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  overflow: hidden;
}

.caps__row {
  display: grid;
  grid-template-columns: 88px 132px 1fr;
  gap: var(--s3);
  align-items: baseline;
  padding: var(--s3) var(--s4);
  background: var(--paper);
}

.caps__row + .caps__row {
  border-top: 1px solid var(--line);
}

.caps__name {
  font-weight: 500;
}

.caps__state {
  font-size: 13px;
  color: var(--ink-muted);
}

.caps__state--on {
  color: var(--accent-link);
}

.caps__fallback {
  font-size: 13px;
  color: var(--ink-muted);
}
```

- [ ] **Step 4: 夹具补一本「一章很长」的书**

`fixtures/make-epub.ts` 末尾追加：

```ts
/**
 * 第一章特别长的书：用来触发「上下文预算不够」这条降级。
 *
 * 默认 36 段 × 300 字 ≈ 1.08 万汉字。kimi 的 moonshot-v1-8k 窗口只有 8000 token，
 * 预算算下来只装得下前几段 —— 后面被丢掉的段数必须出现在结果说明里。
 */
export function aiBookFiles({ paragraphs = 36, charsPerParagraph = 300 } = {}): EpubFiles {
  const sentence = '月色沉入河底，水面碎成一片。'

  const paragraph = (index: number): string => {
    const head = `第 ${index + 1} 段：`
    const bodyLength = Math.max(1, charsPerParagraph - head.length)
    const times = Math.ceil(bodyLength / sentence.length)
    return `<p>${head}${sentence.repeat(times).slice(0, bodyLength)}</p>`
  }

  const long = Array.from({ length: paragraphs }, (_, index) => paragraph(index)).join('\n')

  return {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': CONTAINER,
    'OEBPS/content.opf': `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>很长的一夜</dc:title>
    <dc:creator>测试作者</dc:creator>
    <dc:language>zh-CN</dc:language>
    <dc:identifier id="bookid">urn:isbn:9787000000002</dc:identifier>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="c1"/>
    <itemref idref="c2"/>
  </spine>
</package>`,
    'OEBPS/toc.ncx': `<?xml version="1.0"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <navMap>
    <navPoint id="n1"><navLabel><text>第一章 长夜</text></navLabel><content src="ch1.xhtml"/></navPoint>
    <navPoint id="n2"><navLabel><text>第二章 天亮</text></navLabel><content src="ch2.xhtml"/></navPoint>
  </navMap>
</ncx>`,
    'OEBPS/ch1.xhtml': `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一章</title></head>
<body><h1>第一章 长夜</h1>
${long}</body></html>`,
    'OEBPS/ch2.xhtml': `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第二章</title></head>
<body><h1>第二章 天亮</h1>
<p>天亮的时候河面起雾，他终于把那句话说出口。</p></body></html>`
  }
}
```

`CONTAINER` 是同一个文件里的模块级常量，直接用，不要重写一份。

- [ ] **Step 5: e2e 打桩**

`e2e/helpers.ts` 追加：

```ts
import type { ElectronApplication } from 'playwright'

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
    const state = { chat: 0, embed: 0 }
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
```

`app.evaluate` 的回调在主进程里执行，闭包是活的，所以 `original` 一直有效——别的 `fetch`（如果将来有）不会被这个桩吃掉。

- [ ] **Step 6: 写 `e2e/ai.spec.ts`**

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { novelFiles, writeEpub } from '../fixtures/make-epub'
import { aiCallCount, installAiStub, launchAppWithUserData } from './helpers'

test('划词解释：流式上屏、引用可点回原文、用量与历史都落地', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-ai-'))
  const epubPath = join(userDataDir, 'novel.epub')
  await writeEpub(epubPath, novelFiles())

  const app = await launchAppWithUserData(userDataDir)
  await installAiStub(app, { deltas: ['这句话的意思是', '月色写的是孤独[1]。'] })
  const win = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1200, 800))

  const bookId = await win.evaluate(async (file) => {
    await (window as any).api.secrets.set('deepseek', 'sk-stub-key')
    return (await (window as any).api.library.importPath(file)).bookId as string
  }, epubPath)

  const chapterId = await win.evaluate(async (id) => {
    const opened = await (window as any).api.reader.open(id)
    const first = opened.chapters.find((chapter: { href: string }) => chapter.href !== '')
    return first.id as number
  }, bookId)

  await win.reload()
  await win.locator('.book-list__open').first().click()
  await expect(win.locator('.reader__chapter')).toHaveText('第一章 河边')
  await win.locator('iframe.reader__view').waitFor()

  // 划第一句，点「解释」。这一下本身就是完整的显式指令，会立刻发请求
  await win.evaluate(() => {
    const frame = document.querySelector('iframe.reader__view') as HTMLIFrameElement
    const doc = frame.contentDocument!
    const node = doc.querySelector('p')!.firstChild as Text
    const range = doc.createRange()
    range.setStart(node, 0)
    range.setEnd(node, 8)
    const selection = doc.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
  })
  await win.locator('.sel-toolbar').waitFor()
  await win.getByRole('button', { name: '解释' }).click()

  const answer = win.locator('.ai-msg--assistant').last()
  await expect(answer.locator('.ai-msg__body')).toContainText('月色写的是孤独')
  // 引用上标是一个按钮，不是纯文本
  await expect(answer.locator('.ai-cite').first()).toBeVisible()
  // BYOK 的每一分钱都要看得见
  await expect(answer.locator('.ai-msg__meta')).toContainText('token')

  // 点引用回跳：闪烁高亮注册进章节文档
  await answer.locator('.ai-cite').first().click()
  await expect
    .poll(async () =>
      win.evaluate(() => {
        const frame = document.querySelector('iframe.reader__view') as HTMLIFrameElement
        const css = (frame.contentWindow as any).CSS
        return css?.highlights ? [...css.highlights.keys()] : []
      })
    )
    .toContain('cite-flash')

  // 用户那条 + 助手那条，两条都落了库
  await expect
    .poll(async () =>
      win.evaluate(
        async (arg: { bookId: string; scopeKey: string }) =>
          (await (window as any).api.ai.history(arg.bookId, arg.scopeKey)).length,
        { bookId, scopeKey: `chapter:${chapterId}` }
      )
    )
    .toBe(2)

  await app.close()
})

test('本章小结：先说成本、生成后重算走缓存、一次都没多花', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-ai-task-'))
  const epubPath = join(userDataDir, 'novel.epub')
  await writeEpub(epubPath, novelFiles())

  const app = await launchAppWithUserData(userDataDir)
  await installAiStub(app, {
    payload: { overview: '这一章写河边的月色与一次重逢。', keyPoints: ['月色', '重逢'], terms: [] }
  })
  const win = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1200, 800))

  const bookId = await win.evaluate(async (file) => {
    await (window as any).api.secrets.set('deepseek', 'sk-stub-key')
    return (await (window as any).api.library.importPath(file)).bookId as string
  }, epubPath)

  await win.reload()
  await win.locator('.book-list__open').first().click()
  await expect(win.locator('.reader__chapter')).toHaveText('第一章 河边')
  await win.locator('iframe.reader__view').waitFor()

  await win.getByRole('button', { name: 'AI', exact: true }).click()
  const card = win.locator('.ai-task').filter({ hasText: '本章小结' })

  // 成本要先说清楚，再等一句「开始」
  await card.getByRole('button', { name: '生成' }).click()
  await expect(card.locator('.ai-task__confirm')).toContainText('结构化小结')
  await card.getByRole('button', { name: '开始' }).click()

  await expect(card.locator('.ai-task__text')).toContainText('这一章写河边的月色')
  expect((await aiCallCount(app)).chat).toBe(1)

  // 重算命中缓存：结果照旧，但一次请求都没再发
  await card.getByRole('button', { name: '重新生成' }).click()
  await expect(card.locator('.ai-task__badge')).toHaveText('来自缓存')
  await expect(card.locator('.ai-task__meta')).toContainText('来自缓存，没有花钱')
  expect((await aiCallCount(app)).chat).toBe(1)

  await app.close()
})
```

**刻意没有跨章引用回跳的用例**：要让引用指向另一章，得控制检索命中来自别的章节，而打桩只能控制模型输出、控制不了 FTS 的命中结果。硬凑一个「假跨章」需要往 `ai_results` 里直接写数据，测到的就不是真实链路了。这一条留给手动验证：导入一本多章书，问一个只有第 3 章提到的问题。

- [ ] **Step 7: 写 `e2e/ai-degrade.spec.ts`**

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { aiBookFiles, novelFiles, writeEpub } from '../fixtures/make-epub'
import { installAiStub, launchAppWithUserData } from './helpers'

test('这家不提供向量检索 —— 面板明说降级，不静默', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-ai-noembed-'))
  const epubPath = join(userDataDir, 'novel.epub')
  await writeEpub(epubPath, novelFiles())

  const app = await launchAppWithUserData(userDataDir)
  await installAiStub(app, {})
  const win = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1200, 800))

  await win.evaluate(async (file) => {
    await (window as any).api.secrets.set('deepseek', 'sk-stub-key')
    await (window as any).api.library.importPath(file)
  }, epubPath)

  await win.reload()
  await win.locator('.book-list__open').first().click()
  await expect(win.locator('.reader__chapter')).toHaveText('第一章 河边')
  await win.locator('iframe.reader__view').waitFor()

  await win.evaluate(() => {
    const frame = document.querySelector('iframe.reader__view') as HTMLIFrameElement
    const doc = frame.contentDocument!
    const node = doc.querySelector('p')!.firstChild as Text
    const range = doc.createRange()
    range.setStart(node, 0)
    range.setEnd(node, 8)
    const selection = doc.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
  })
  await win.locator('.sel-toolbar').waitFor()
  await win.getByRole('button', { name: '解释' }).click()

  // deepseek 的声明里 embed 是 false，说明必须出现在回答上方
  const answer = win.locator('.ai-msg--assistant').last()
  await expect(answer.locator('.ai-degrade')).toContainText('不提供向量检索')
  await expect(answer.locator('.ai-degrade')).toContainText('关键词检索')

  await app.close()
})

test('模型其实不支持结构化输出 —— 结果里说明改用了提示词约束', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-ai-nojson-'))
  const epubPath = join(userDataDir, 'novel.epub')
  await writeEpub(epubPath, novelFiles())

  const app = await launchAppWithUserData(userDataDir)
  await installAiStub(app, {
    payload: { overview: '这一章写河边的月色。', keyPoints: ['月色'], terms: [] }
  })
  const win = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1200, 800))

  await win.evaluate(async (file) => {
    await (window as any).api.secrets.set('deepseek', 'sk-stub-key')
    await (window as any).api.library.importPath(file)
    // deepseek-reasoner 在内置清单里 jsonMode 为 false
    await (window as any).api.settings.set('ai.model', 'deepseek-reasoner')
  }, epubPath)

  await win.reload()
  await win.locator('.book-list__open').first().click()
  await expect(win.locator('.reader__chapter')).toHaveText('第一章 河边')
  await win.locator('iframe.reader__view').waitFor()

  await win.getByRole('button', { name: 'AI', exact: true }).click()
  const card = win.locator('.ai-task').filter({ hasText: '本章小结' })
  await card.getByRole('button', { name: '生成' }).click()
  await card.getByRole('button', { name: '开始' }).click()

  await expect(card.locator('.ai-task__text')).toContainText('这一章写河边的月色')
  await expect(card.locator('.ai-task__result .ai-degrade')).toContainText('已改为提示词约束')

  await app.close()
})

test('正文超出上下文上限 —— 结果里说明有段落没有送进去', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-ai-long-'))
  const epubPath = join(userDataDir, 'long.epub')
  await writeEpub(epubPath, aiBookFiles())

  const app = await launchAppWithUserData(userDataDir)
  await installAiStub(app, {
    payload: { overview: '第一章是一整夜。', keyPoints: ['长夜'], terms: [] }
  })
  const win = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1200, 800))

  await win.evaluate(async (file) => {
    await (window as any).api.secrets.set('kimi', 'sk-stub-key')
    await (window as any).api.library.importPath(file)
    // moonshot-v1-8k 的窗口只有 8000 token，装不下这一章
    await (window as any).api.settings.set('ai.provider', 'kimi')
    await (window as any).api.settings.set('ai.model', 'moonshot-v1-8k')
  }, epubPath)

  await win.reload()
  await win.locator('.book-list__open').first().click()
  await expect(win.locator('.reader__chapter')).toHaveText('第一章 长夜')
  await win.locator('iframe.reader__view').waitFor()

  await win.getByRole('button', { name: 'AI', exact: true }).click()
  const card = win.locator('.ai-task').filter({ hasText: '本章小结' })
  await card.getByRole('button', { name: '生成' }).click()
  await card.getByRole('button', { name: '开始' }).click()

  // 分段读取与「丢了多少段」必须同时出现：只说「分 4 段」，用户无从知道剩下 5 段被扔了
  await expect(card.locator('.ai-task__result .ai-degrade')).toContainText('分 4 段读取后合成')
  await expect(card.locator('.ai-task__result .ai-degrade')).toContainText(
    '超出当前模型的上下文上限'
  )

  await app.close()
})
```

- [ ] **Step 8: 跑全量**

Run: `npx tsc --noEmit`

Expected: 无错误。

Run: `npx vitest run`

Expected: PASS（含 Task 12 新增的 3 条）。

Run: `npm run e2e`

Expected: 全绿，其中 `ai.spec.ts` 2 passed、`ai-degrade.spec.ts` 3 passed。

排查指引：

- `secrets.set` 直接 reject、错误里带「无法提供安全的密钥存储」→ 这台机器上 `safeStorage` 不可用（无头 Linux 常见）。这三条 spec 会在这里就失败，换一台有钥匙串的机器跑，或在 `installAiStub` 之前先 `window.api.secrets.status()` 断言 `available`。
- `ai.spec.ts` 第一条卡在 `.ai-msg__body` 一直是空 → 桩没装上。确认 `installAiStub` 在 `app.firstWindow()` **之前**调用（`app.evaluate` 要等主进程起来，但不依赖窗口）。
- 引用上标一直不出现 → `usedCitations` 收到的是空数组，说明这次检索没命中。deepseek 走 FTS，划的第一句里有「月色沉入河底」这种实词，正常会命中；如果没命中，检查 `chunks` 是否为空（导入是否成功）。
- `cite-flash` 没出现 → 闪烁只亮 2000ms，`expect.poll` 是唯一可靠的抓法；直接 `expect(await ...)` 会随机失败。另外 `goToExcerpt` 返回 false 时页面会出现 `.reader__degrade` 的「没能在这章正文里定位到这段原文」——看到它就说明文本匹配失败了。
- `ai-degrade.spec.ts` 第三条的 note 里只有「分 4 段」没有超上限那句 → Task 12 Step 8 没改到 `runChapterSummary` 的 `composeNote`。

- [ ] **Step 9: Commit**

```bash
git add electron/main/ipc/ai.ts electron/preload/index.ts \
  src/features/settings/ModelSection.tsx src/styles/base.css \
  fixtures/make-epub.ts e2e/helpers.ts e2e/ai.spec.ts e2e/ai-degrade.spec.ts
git commit -m "feat: 设置页模型组（模型选择、测试连接、能力表）与 AI 端到端测试"
```

---

## Self-Review

### spec 覆盖表

| Spec 章节 | 落在哪个 Task |
|---|---|
| §1.2 进程模型与能力边界 | Task 4（Provider 只在主进程）、Task 8（service/ipc）、Task 9（preload 具名白名单，`boundary.spec.ts` 整表比对） |
| §3.5 AI 引用回跳 | Task 6（引用编号 ↔ chunk）、Task 11（文本定位、跨章落点、失败明说） |
| §4.6 设置页 | Task 13（模型选择、测试连接、常驻能力表） |
| §5.1 一个协议 + 四份能力声明 | Task 1（`OpenAICompatProvider` 的四份声明、运行时零探测） |
| §5.2 降级路径 | Task 7（没索引时不假装有）、Task 8（划词三条 `degraded`）、Task 12（运行时拒绝落库 + 截断明说）、Task 13（三条降级 e2e） |
| §5.3 花钱的事一律显式 | Task 7（建索引是显式动作、可中断可续）、Task 9（空输入不发请求、输入框空则按 explain 走）、Task 10（`TASK_CONFIRM` 先说成本、逐章计数、缓存复用不重复花钱） |
| §5.4 任务清单与输出结构 | Task 5（提示词模板 + `ai_results` 唯一键含 `prompt_version`）、Task 10（四个任务编排 + 六个纯校验函数） |
| §5.5 引用回跳 | Task 6、Task 11 |
| §5.6 并发、中断与失败 | Task 3（四类错误 + 只重试一次 + 800ms 退避）、Task 4（`AiQueue` 单通道）、Task 8（`cancel` 先撤排队再停流）、Task 10（`digestInflight` 按 bookId 停） |
| §5.7 密钥 | Task 4（key 缺失时抛 `AI_AUTH` + `openSettings`，detail 里洗掉 key）、Task 13（测试连接把失败原因原样说出来） |
| §6.1 测试策略 | 每个 Task 的 Run/Expected：vitest 只跑不碰原生模块与 DOM 的纯函数，碰 SQLite、布局引擎、iframe 的一律走 Playwright |
| §6.2 统一错误模型 | Task 3（`classifyError` → `AppError` + `action`）、Task 8（`toReadable` 只把 message 交给渲染进程，不抛对象） |
| §6.4 安全清单 | Task 3（`scrub` 洗 key）、Task 8（detail 不进 UI）、Task 9（preload 无通用 `invoke` 透传） |

**spec 里明确写了、但不属于本计划的**：§4.5 书架与笔记、§6.3 数据导出与迁移、§6.5 打包 —— 这三块归计划 06。

### 占位符扫描

对全文跑这三条：

```bash
grep -nE "TBD|TODO|待补|待定|类似 Task|加上适当的|此处省略|\.\.\.$" docs/superpowers/plans/2026-09-29-05-ai-capability-layer.md
grep -nE "^\- \[ \] \*\*Step [0-9]+[^\*]*\*\*$" docs/superpowers/plans/2026-09-29-05-ai-capability-layer.md | wc -l
grep -n "^### Task " docs/superpowers/plans/2026-09-29-05-ai-capability-layer.md | wc -l
```

第一条 Expected: 只有 `composeNote(...notes)` 这一类真实代码里的省略号与 `…`（UI 文案），没有 `TBD` / `TODO` / 「类似 Task N」。命中任何一处都要回去补全。

第二条与第三条对照检查：13 个 Task，每个 Task 的 Step 数应当与正文里出现的 `Step` 数量一致 —— 任何「在 Step 3 里说『下面加一个 Step』」而没有真的加一行的地方，都是漏写。

### 命名与类型一致性

- **`AiDegrade.kind`** 只有 `'noEmbed' | 'contextTruncated' | 'blindIndex'` 三个值，全部由 `runChat` 生产（Task 8）。结构化任务的降级一律走 `AiResultView.note`（Task 12），所以 `kind` 里不该再出现 `'noJson'`。
- **`CapabilityKey`** 与 `CAPABILITY_LABELS[].key` 同源；`markUnavailable` / `unavailableCaps` / 设置页能力表三处都吃这个类型，不会出现字符串漂移。
- **`AiResultView<T>`** 的字段（`payload` / `text` / `cached` / `usage` / `createdAt` / `note`）在 `toView`、`AiTasks`、`usageLine` 三处用法一致：`payload` 为 null 时必有 `note`。
- **`TaskKey`** 与 `CH.aiSummary` / `aiDigest` / `aiTerms` / `aiMindmap` 一一对应；`AiTasks` 的 `run` 里那个三元表达式必须与它同序。
- **`isJsonModeRejection(error, requestedJson)`** 的参数顺序统一：先错误、后布尔。Task 12 的调用点是 `isJsonModeRejection(normalized, wantedJson)`，测试里是 `isJsonModeRejection(classifyError(400, ''), true)`。
- **`askJson<T>(db, call, messages, validate)`** 四个参数，六处调用点全部带 `db`（Task 12 Step 6）。
- **`paginator.goToExcerpt(excerpt: string): boolean`** 与 `locate.ts` 的 `rangeFromExcerpt(doc, excerpt)` 名字对齐：`locate` 负责「摘录 → Range」，`paginator` 负责「Range → 落点 + 闪烁」。
- **`CITATION_FLASH_NAME = 'cite-flash'`** 在 `shared/highlights.ts` 定义一处，`highlights.ts`（注册）、`theme.ts`（配色）、`e2e/ai.spec.ts`（断言）三处引用同一个常量或同一个字符串。

---

## Execution Handoff

**两种执行方式，推荐第一种。**

### 方式一：Subagent-Driven（推荐）

每个 Task 交给一个 fresh subagent，主 agent 只负责编排与验收。理由很具体：

- Task 4、8、9、10、11、13 六个 Task 各自都要读多个既有文件、写几百行代码。串行 inline 执行时，这些中间产物会持续堆在主上下文里，到 Task 10 左右就开始出现「记不清 Task 1 里 `modelsFor` 到底叫什么」这类问题。
- 每个 Task 的 `Files` 列表与 `Run` / `Expected` 就是天然的交接契约：subagent 拿着这几行就能独立干活，跑完把测试输出贴回来。
- 主 agent 每次只做两件事：核对 diff 是否只碰了 `Files` 里列的文件；跑一遍该 Task 的 `Run` 命令看 `Expected` 是否成立。**不要相信 subagent 说「已通过」**——自己去跑。

交接时的固定指令模板：

> 执行 `docs/superpowers/plans/2026-09-29-05-ai-capability-layer.md` 的 Task N。只改这个 Task 的 `Files` 列出的文件；按 Step 顺序走，每一步的 `Run`/`Expected` 都要真的跑一遍并把输出贴回来；不要在最后额外加「顺便优化」。完成后给我：改动的文件清单、`npx tsc --noEmit` 的输出、`npx vitest run` 的汇总行、相关 e2e 的结果。

### 方式二：Inline Execution

一个 agent 顺序跑完全部 13 个 Task。适合你打算守着看每一步的情况。两个注意点：

- **Task 之间不要跳步。** 每个 Task 的 commit 是回滚点：Task 10 出问题时，`git revert` 到 Task 9 的 commit 比在一堆半成品里找错快得多。
- **Task 1、3、5、6、7、12 是纯函数 + 单测，跑得快**；Task 4、8、9、10、11、13 是重活。如果中途要停，停在纯函数 Task 的边界上，别停在 Task 10 那种写了一半的状态。

### 两个前置条件

1. **git 身份**：本计划每个 Task 结尾都有 commit，先确认 `git config user.name` / `user.email` 已配置（计划 01 的 Prerequisites 里已说明）。
2. **依赖计划 01–04 全部完成**。本计划依赖：计划 01 的 `shared/errors`、`settings` 表、`secrets`、设置页骨架；计划 02 的 `chunks` 表（FTS bigram）与 `fixtures/make-epub.ts`；计划 03 的 `ChapterPaginator`、`buildReaderCss`、`reader.spec.ts` 的启动手法；计划 04 的 `SelectionToolbar`、`highlights.ts`、`shared/highlights.ts`。**这四个计划里任何一处改了名字，本计划的代码都要跟着改。**
