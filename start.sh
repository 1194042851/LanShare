#!/usr/bin/env bash
# LanShare 启动脚本（Linux / macOS）
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-8090}"
NAME="${LANSHARE_NAME:-$(hostname)}"

# LANSHARE_ROOT 可以指向任意要共享的目录；默认是本项目下的 files/
exec node server.js --port "$PORT" --name "$NAME" "$@"
