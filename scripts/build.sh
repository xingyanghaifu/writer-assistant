#!/bin/bash
# Bash 兼容的一键打包脚本（v3 P4）
# 用法：在仓库根目录执行 bash scripts/build.sh [win|mac|linux]
# 默认打包当前平台

set -euo pipefail

TARGET="${1:-auto}"

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) DEFAULT=win ;;
  Darwin*)               DEFAULT=mac ;;
  Linux*)                DEFAULT=linux ;;
  *) echo "未知平台"; exit 1 ;;
esac

[ "$TARGET" = "auto" ] && TARGET="$DEFAULT"

echo "[1/4] Type check..."
npx tsc -p tsconfig.node.json --noEmit
npx tsc -p tsconfig.web.json --noEmit

echo "[2/4] Electron-vite build..."
npx electron-vite build

echo "[3/4] electron-builder ($TARGET)..."
export CSC_IDENTITY_AUTO_DISCOVERY=false

case "$TARGET" in
  win)    npx electron-builder --win nsis ;;
  mac)    npx electron-builder --mac dmg zip ;;
  linux)  npx electron-builder --linux AppImage deb ;;
  *) echo "未知目标: $TARGET"; exit 1 ;;
esac

echo "[4/4] 完成。产物在 release/"