#!/bin/bash
# 作品集网站 一键部署
# 仓库: wangsy1150/wangsy1150.github.io
# 站点: https://wangsy1150.github.io/
set -e

cd "$(dirname "$0")"

echo "========================================"
echo "  作品集网站 一键部署"
echo "  仓库: wangsy1150/wangsy1150.github.io"
echo "  站点: https://wangsy1150.github.io/"
echo "========================================"
echo ""

echo "[1/3] 查看改动..."
git status --short

echo ""
echo "[2/3] 提交改动..."
git add -A
MSG="${1:-更新作品集内容}"
git commit -m "$MSG" || echo "(没有新改动可提交)"

echo ""
echo "[3/3] 推送到 GitHub..."
git push

echo ""
echo "========================================"
echo "  推送完成！等待 1-2 分钟后生效"
echo "  访问: https://wangsy1150.github.io/"
echo "========================================"
