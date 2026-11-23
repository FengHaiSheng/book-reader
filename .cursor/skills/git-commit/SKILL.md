---
name: git-commit
description: Use when the user asks to commit, create a git commit, write a commit message, or mentions 提交 / commit / git commit.
---

# Git Commit（中文 Conventional Commits）

只在用户**明确要求提交**时执行。消息用中文 subject，遵循本仓库 Conventional Commits 风格。

## 提交前（并行）

```bash
git status
git diff && git diff --staged
git log -10 --pretty=format:'%s'
```

无改动则不提交。有未暂存改动时先 `git add` 相关文件（勿添加密钥：`.env`、credentials 等）。

## 提交前：校验并补齐 CHANGELOG.md

提交前必须检查仓库根 `CHANGELOG.md`，与本次 diff 对齐：

1. 读 `CHANGELOG.md` 顶层 + `package.json` 的 `version`；以 `package.json` 版本为准，缺该版本段则新建（`## <version>`），并把新条目放到最前。
2. 判断本次改动是否有用户可感知变化（`feat` / `fix` / `perf` / 行为相关 `refactor`）：
   - 有 → 在对应版本下补条目，沿用现有小节：`### 新增`、`### 修复`、`### 构建与发布`；必要时新建小节，顺序为 新增 → 修复 → 构建与发布。
   - 仅 `docs` / `test` / `chore` / 内部结构调整 → 默认不写日志。
3. 条目写法：`- ` 开头，一句话讲用户可见结果（与 commit subject 一致但可更完整）；不写文件名、不写实现细节；已存在的条目不要重复添加。
4. 若版本号已在代码中变更，确认 `CHANGELOG.md` 顶部版本与之匹配。
5. 更新后与本次改动一起 `git add CHANGELOG.md`，随同一提交落库；无 CHANGELOG.md 则跳过并告知用户。

## 消息格式

```
<type>: <中文摘要>
```

- 一行 subject 即可；需要时再加空行 + 正文说明「为什么」
- **聚焦 why / 用户可见结果**，勿罗列文件名
- 不加句号；不用英文 subject（本仓库惯例为中文）
- 一般**不加 scope**（如 `feat(reader):`）；除非同一次提交跨多域且不加 scope 会歧义
- 用 HEREDOC 提交：

```bash
git commit -m "$(cat <<'EOF'
feat: 阅读时壳层侧栏收成图标轨并统一离开确认

EOF
)"
```

提交后跑 `git status` 确认成功。

## type 对照

| type | 何时用 |
|------|--------|
| `feat` | 新功能或用户可感知行为 |
| `fix` | 修 bug |
| `docs` | 设计稿、计划、README、注释性文档 |
| `test` | 测试新增或对齐 |
| `refactor` | 无行为变化的结构调整 |
| `chore` | 构建、依赖、杂务 |
| `style` | 纯格式（不影响逻辑） |
| `perf` | 性能 |

## 本仓库示例

```
feat: AI 回答可显式记到划线
feat: 阅读器高亮浮层可查看并删除 AI 笔记
docs: 阅读壳层侧栏与离开确认设计
docs: 勾选 Task 10 计划步骤
test: 迁移单测对齐 v7 highlight_ai_notes
fix: 修复划线缺 CFI 时误创建 AI 笔记
```

## 起草步骤

1. 读 diff，判断**一个**主意图（一次提交一件事）
2. 选 type；写 ≤50 字中文摘要（动词开头或名词短语均可，与近期 log 一致即可）
3. 对照 `git log` 语气：短、具体、产品语言（「侧栏」「划线」「笔记」），少用实现黑话

## 禁止

- 未获明确要求就 commit / push
- `--no-verify`、改 git config、interactive rebase
- 空提交；把无关改动塞进同一 commit
- 把 secrets 打进仓库
- 用户可感知变更（feat / fix / perf）未校验并补齐 `CHANGELOG.md` 就提交
