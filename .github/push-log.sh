#!/usr/bin/env bash
# Сохраняет ci.log в отдельную ветку, чтобы ошибку сборки было легко прочитать.
# Использование: push-log.sh <ветка> <токен> <owner/repo>
set -e
branch="$1"; token="$2"; repo="$3"
mkdir -p ci-out
cp ci.log ci-out/ 2>/dev/null || echo "лога нет" > ci-out/ci.log
cd ci-out
git init -q -b "$branch"
git config user.name "github-actions"
git config user.email "github-actions@users.noreply.github.com"
git add -A
git commit -q -m "лог сборки"
git push -q -f "https://x-access-token:${token}@github.com/${repo}" "$branch"
