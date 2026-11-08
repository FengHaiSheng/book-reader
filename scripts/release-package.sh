#!/usr/bin/env bash
# 本地准备发版：对齐版本号 → 提交打包相关文件 → 打标签。
# GitHub Actions 触发 / 下产物请你在网页上自己做（或加 --push 把分支与标签推上去）。
#
# 用法：
#   ./scripts/release-package.sh                 # 用 package.json 当前 version
#   ./scripts/release-package.sh 26.4.2
#   ./scripts/release-package.sh 26.4.2 --push  # 提交后推送分支与标签（推标签会触发 Package workflow）
#   ./scripts/release-package.sh 26.4.2 --no-tag
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION=""
DO_PUSH=0
DO_TAG=1

for arg in "$@"; do
  case "$arg" in
    --push) DO_PUSH=1 ;;
    --no-tag) DO_TAG=0 ;;
    -h|--help)
      sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    -*)
      echo "未知参数: $arg" >&2
      exit 1
      ;;
    *)
      if [[ -n "$VERSION" ]]; then
        echo "版本号只能指定一次" >&2
        exit 1
      fi
      VERSION="$arg"
      ;;
  esac
done

if [[ -z "$VERSION" ]]; then
  VERSION="$(node -p "require('./package.json').version")"
fi

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "版本号须为 x.y.z，收到: $VERSION" >&2
  exit 1
fi

if [[ ! -f .github/workflows/package.yml ]]; then
  echo "缺少 .github/workflows/package.yml" >&2
  exit 1
fi

# 工作区里若还有与发版无关的改动，提醒但不强行中止（只 add 白名单文件）
EXTRA="$(git status --porcelain | awk '{print $NF}' | grep -Ev '^(package\.json|package-lock\.json|\.github/workflows/package\.yml)$' || true)"
if [[ -n "$EXTRA" ]]; then
  echo "注意：工作区还有未纳入本次提交的改动（将被忽略）："
  echo "$EXTRA" | sed 's/^/  /'
  echo
fi

echo "→ 写入版本 $VERSION"
node -e "
const fs = require('fs')
const version = process.argv[1]
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
pkg.version = version
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n')
if (fs.existsSync('package-lock.json')) {
  const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'))
  lock.version = version
  if (lock.packages && lock.packages['']) lock.packages[''].version = version
  fs.writeFileSync('package-lock.json', JSON.stringify(lock, null, 2) + '\n')
}
" "$VERSION"

git add package.json package-lock.json .github/workflows/package.yml

if git diff --cached --quiet; then
  echo "没有可提交的改动（版本与工作流可能已提交）。"
else
  git commit -m "$(cat <<EOF
chore: 发布 $VERSION 并加入 Actions 打包流程

EOF
)"
  echo "→ 已提交"
fi

if [[ "$DO_TAG" -eq 1 ]]; then
  if git rev-parse "$VERSION" >/dev/null 2>&1; then
    echo "→ 标签 $VERSION 已存在，跳过创建"
  else
    git tag -a "$VERSION" -m "release $VERSION"
    echo "→ 已打标签 $VERSION"
  fi
fi

BRANCH="$(git branch --show-current)"

if [[ "$DO_PUSH" -eq 1 ]]; then
  echo "→ 推送分支 $BRANCH"
  git push -u origin "HEAD"
  if [[ "$DO_TAG" -eq 1 ]]; then
    echo "→ 推送标签 ${VERSION}（会触发 Actions Package）"
    git push origin "$VERSION"
  fi
  echo
  echo "完成。到 GitHub → Actions → Package 看进度；或 Releases 等标签产物。"
else
  echo
  echo "本地已就绪。你在 GitHub 上可以任选："
  echo
  echo "  1) 先推代码，再手动跑 Actions："
  echo "       git push -u origin HEAD"
  echo "       # 打开 https://github.com/FengHaiSheng/book-reader/actions"
  echo "       # Package → Run workflow → 选 win / mac / all"
  echo
  if [[ "$DO_TAG" -eq 1 ]]; then
    echo "  2) 推标签自动打包并挂 Release："
    echo "       git push -u origin HEAD"
    echo "       git push origin $VERSION"
  fi
  echo
  echo "或一次推完：  $0 $VERSION --push"
fi
