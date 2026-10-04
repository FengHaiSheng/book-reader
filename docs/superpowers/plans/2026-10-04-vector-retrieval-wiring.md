# 修复：向量检索未接入 runChat

## Context

AI 能力层（计划 05）已全部落地，但最终审查发现一处功能缺口：**向量索引能被用户显式建立（真实花费 embedding 费用），建好后却从不参与检索**。

- [service.ts](file:///private/var/www/book-read/electron/main/ai/service.ts#L118) 的 `runChat` 只调用关键词检索 `searchChunks`；全仓 `searchByVector`（[index-builder.ts](file:///private/var/www/book-read/electron/main/ai/index-builder.ts#L130-L145)）**零调用点**。
- 界面却向用户承诺「跨章节的问题召回更准」（[AiIndexBar.tsx](file:///private/var/www/book-read/src/features/ai/AiIndexBar.tsx#L108)）。
- 结果：用户花了钱建索引，得到的行为与没建完全一样 —— 违背「能力降级要明说、不静默失效」的硬规则。

本次改动让建好的索引真正参与召回：**关键词检索 + 向量检索做混合（hybrid）融合**。

## 目标 / 非目标

**目标**
- `caps.embed` 为真且该书索引已存在（`indexState.done > 0`）时，用 query 向量 + `searchByVector` 补充召回，与关键词结果融合排序。

**非目标（明确不做）**
- 不改 `searchByVector` / `vector.ts` / `topK` 的任何签名。
- 不改 `AiDegrade` 联合类型、不新增 `kind`、不改渲染层。
- 不做归一化加权融合（RRF 已足够）。
- 不做「当前章节窗口段去重」，不修 `tasks.ts:359` 的预算重复扣（已知独立待办）。
- 不把 embedding 的 token 并入 `AiUsage`。
- 不新增文件（仅在既有测试文件内追加用例）。

## 改动清单

### 1. [retrieve.ts](file:///private/var/www/book-read/electron/main/ai/retrieve.ts) — 新增纯函数 `fuseRanks`（约 +35 行，追加在 `toPassages` 之后）

```ts
export function fuseRanks(lists: readonly (readonly number[])[], k = 60): { chunkId: number; score: number }[]
```

- 输入是若干条**已按相关度排好序**的 chunkId 列表；排序由调用方负责（关键词走 `searchChunks` 的 bm25、向量走余弦降序），融合层不感知量纲 —— 这正是选 RRF 的理由：bm25 越小越相关、余弦越大越相关，量纲不可比。
- rank 从 1 起，`score += 1 / (k + rank)`，k 默认 60。
- **跨列表与列表内都去重**：同一 chunkId 只累加分数、只输出一次。
- 排序：`score` 降序；并列时按**首次出现顺序**稳定破平局（遍历顺序 = 列表顺序 × 列表内名次，用 `Map` 插入序实现，不依赖 `Array.sort` 的稳定性）。
- 空输入 / 空列表 / 空 id 一律跳过，返回 `[]` 不抛错；无副作用、不改入参。

### 2. [repo.ts](file:///private/var/www/book-read/electron/main/library/repo.ts) — 新增 `chunksByIds`（约 +18 行，紧跟 `searchChunks`）

```ts
export function chunksByIds(db: Database.Database, ids: readonly number[]): SearchHit[]
```

- 空数组直接返回 `[]`（不发 SQL，避免 `IN ()` 语法错误）。
- 占位符用 `.map(() => '?')` 动态生成，**严禁拼接 id**；参数展开传入。
- SQL：`SELECT id AS chunkId, chapter_id AS chapterId, heading_path AS headingPath, text, 0 AS score FROM chunks WHERE id IN (...)`；`IN` 不保证顺序，用 `Map` 回填为传入 `ids` 的顺序，丢弃查不到的 id。
- 本次调用点最多 24 个 id（两列表各 12、去重后 ≤24），远低于 SQLite 变量上限。

### 3. [service.ts](file:///private/var/www/book-read/electron/main/ai/service.ts) — 修改 `runChat`（导入区 + 现 117–129 行）

- 导入新增：`searchByVector`（并入既有 `./index-builder` 那行）、`embed`（并入既有 `./provider` 那行）、`markUnavailable`（并入既有 `./repo` 那行）、`chunksByIds`（来自 `../library/repo`）、`fuseRanks`（来自 `./retrieve`）。
- 保留现有关键词结果（改名为 `keywordHits`，仍为 `query === '' ? [] : searchChunks(db, bookId, query, 12)`）。
- 其后插入向量分支：

```
若 canEmbed && state.done > 0 && query !== ''：
  try:
    const { vectors } = await embed(providerId, [query], hooks.signal)
    vectorRanked = searchByVector(db, bookId, vectors[0], 12).sort(desc by score).map(h => h.chunkId)
  catch error:
    if (hooks.signal.aborted) throw error            // 用户主动取消，不能记成「服务不可用」
    if (toAppError(error).code === 'AI_UNSUPPORTED') markUnavailable(db, providerId, 'embed')
    degraded.push({ kind: 'noEmbed', message: '本次向量检索没有成功，只用了关键词检索，跨章节召回会变弱。' })
const hits = vectorRanked 为空 ? keywordHits : chunksByIds(db, fuseRanks([keywordHits的id, vectorRanked]).map(f => f.chunkId))
```

- **130 行之后的窗口 unshift / `fitPassages` / 重编号 / `buildMessages` / `chat` / 引用流程一行不改**；融合结果替代 `hits` 即可，融合后的顺序即优先级。
- 加一句中文注释：向量检索的 token 不计入展示用量。

### 4. [ai-retrieve.test.ts](file:///private/var/www/book-read/tests/ai-retrieve.test.ts) — 追加 `describe('fuseRanks')`

用例：① 单列表退化为原顺序；② 两列表同 id 分数相加且排第一；③ 列表内重复 id 只算一次；④ `[]` / `[[], []]` 返回 `[]` 不抛错；⑤ 并列时按首次出现顺序（两次调用结果一致）；⑥ 输出 `score` 单调不增；⑦ 两列表不重叠时输出长度 = 并集大小；⑧ `k=0` 时 rank1 得 1、rank2 得 0.5（验证公式）。

## 关键风险处理

- **`searchByVector` 不改签名**：它只回 `{ chunkId, score }`，恰好够 RRF（只看名次）；文本回填交给 `chunksByIds`，职责更清，避免改动面扩散到 `index-builder` 的 `topK`。
- **取消优先于降级**：`embed` 已支持 `signal`，catch 里必须先判 `hooks.signal.aborted` 并原样抛出，否则用户点「停下」会被误记为一次「向量服务不可用」并污染持久化状态。
- **`usedCitations` 不受影响**：引用仍按 `numbered`（融合后顺序）从 1 连续编号，`usedCitations` 只按 `index` 映射，顺序变化只影响模型看到哪几段，不影响正确性。
- **窗口段 `chunkId: -1`** 在融合之后才 unshift，不会与融合结果撞号。
- **`noEmbed` 文案复用**：本次是「这一次调用失败」，与既有「服务商不提供」字面区分；UI 只渲染 `message`（不 switch `kind`），可接受。
- **部分索引**（`done < total`）不额外提示：关键词检索覆盖全部 chunk，融合只增益不损召回。
- **`markUnavailable` 的连锁**与 `buildIndex` 一致：下次 `canEmbed=false`，走既有降级分支，`AiIndexBar` 显示「已停用」。
- **成本**：仅在 `done > 0` 时多一次单条文本的 embeddings 调用，这正是「显式建索引」的用户预期，且仍由用户发起的对话触发（不违反「AI 永不后台自动调用」）。

## 验证

1. `npx vitest run tests/ai-retrieve.test.ts` —— 新增 `fuseRanks` 用例全绿（既有 12 例不回归）。
2. `npx vitest run` —— 全量（当前 237 passed）不回归。
3. `npx tsc --noEmit` —— 无输出。
4. `npm run e2e` —— 全量（当前 26 passed）不回归；`ai.spec.ts` 的检索/引用流程仍通过。
5. 手动/半自动确认：在 qwen 或 zhipu 下建索引后提问，确认日志/降级区不再出现「没有建立向量索引」，且未建索引时行为与改动前一致。

## 提交

工作区当前干净，本次为单一提交，只 stage 这 4 个文件（禁止 `git add -A`）：
`electron/main/ai/retrieve.ts`、`electron/main/library/repo.ts`、`electron/main/ai/service.ts`、`tests/ai-retrieve.test.ts`。

## 关键文件

- [retrieve.ts](file:///private/var/www/book-read/electron/main/ai/retrieve.ts)
- [service.ts](file:///private/var/www/book-read/electron/main/ai/service.ts)
- [repo.ts](file:///private/var/www/book-read/electron/main/library/repo.ts)
- [ai-retrieve.test.ts](file:///private/var/www/book-read/tests/ai-retrieve.test.ts)