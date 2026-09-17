#!/usr/bin/env bash
# ============================================================================
# start_server.sh —— Linux / macOS 版一键启动（与 start_server.bat 功能一致）
#
# 流程：
#   1. 检查服务端口占用：被占用则打印占用进程（PID / 名称 / 命令行），
#      请求确认后清空端口（先 SIGTERM，10 秒不退再 SIGKILL），确认不通过则原样退出
#   2. 抓取触发器和运行记录      crawler.py
#   3. 生成触发器排期            organize.py
#   4. 启动局域网服务（前台运行，Ctrl+C 停止）  local_server.py
#
# 用法：
#   chmod +x start_server.sh     # 只需一次
#   ./start_server.sh            # 正常启动（端口被占用时会停下来问你）
#   ./start_server.sh -y         # 端口被占用时不再询问，直接清空（cron / systemd 用）
#   ./start_server.sh silent     # 与 .bat 的 silent 一致：只静默更新数据，不启动服务
#
# 端口以 local_server.py 里的 PORT 为准（单一出处）；也可用环境变量 PORT 临时覆盖。
# 注意：本文件必须是 LF 换行，带 \r 会报 "bad interpreter"。
# ============================================================================
set -uo pipefail

# 等价于 bat 的 cd /d "%~dp0"：切到脚本所在目录（并解析软链接）
SELF="$0"
while [ -L "$SELF" ]; do SELF="$(readlink "$SELF")"; done
cd "$(dirname "$SELF")"

# ------------------------------------------------------------------ 参数
MODE=normal      # normal | silent
AUTO_YES=0       # 1 = 端口被占用时不再询问
for a in "$@"; do
  case "$a" in
    silent)      MODE=silent ;;
    -y|--yes)    AUTO_YES=1 ;;
    -h|--help)   sed -n '2,20p' "$0"; exit 0 ;;
    *)           echo "[WARN] 未知参数：$a（可用：silent / -y）" ;;
  esac
done

# ------------------------------------------------------- 解释器与依赖自检
# 等价于 bat 的 py -3 -> python -> 绝对路径 逐级探测
PY="$(command -v python3 || command -v python || true)"
if [ -z "$PY" ]; then
  echo "[ERROR] 未找到 Python 3，请先安装（Debian/Ubuntu: sudo apt install python3 python3-pip）"
  exit 1
fi
if ! "$PY" -c "import requests" >/dev/null 2>&1; then
  echo "[WARN] 缺少 requests，正在安装 …"
  "$PY" -m pip install -q requests || { echo "[ERROR] requests 安装失败，请手动执行：$PY -m pip install requests"; exit 1; }
fi

# ------------------------------------------------------------------ 端口
# 端口号从 local_server.py 读取，避免两处各写一份
PORT="${PORT:-$(sed -n 's/^PORT *= *\([0-9][0-9]*\).*/\1/p' local_server.py 2>/dev/null | head -1)}"
PORT="${PORT:-8000}"

# 输出占用该端口的 PID（按可用工具逐级降级）
port_pids() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltnp 2>/dev/null | grep -E "[:.]${PORT}[[:space:]]" | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u
  elif command -v lsof >/dev/null 2>&1; then
    lsof -t -iTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null | sort -u
  elif command -v netstat >/dev/null 2>&1; then
    netstat -ltnp 2>/dev/null | grep -E "[:.]${PORT}[[:space:]]" | grep -o '[0-9][0-9]*/' | cut -d/ -f1 | sort -u
  fi
}

# 端口是否在监听（工具全缺时退回 bash 内建的 /dev/tcp 连接探测）
port_in_use() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | grep -qE "[:.]${PORT}[[:space:]]"
  elif command -v netstat >/dev/null 2>&1; then
    netstat -ltn 2>/dev/null | grep -qE "[:.]${PORT}[[:space:]]"
  elif command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"${PORT}" -sTCP:LISTEN >/dev/null 2>&1
  else
    (exec 3<>/dev/tcp/127.0.0.1/"${PORT}") 2>/dev/null
  fi
}

# 结束进程并等待端口释放：先温和后强制
kill_pids() {
  local pids="$1" pid i=0
  for pid in $pids; do kill "$pid" 2>/dev/null || true; done
  while [ $i -lt 10 ] && port_in_use; do sleep 1; i=$((i + 1)); done
  if port_in_use; then
    echo "[WARN] 进程未响应结束信号，改用 SIGKILL 强制结束"
    for pid in $pids; do kill -9 "$pid" 2>/dev/null || true; done
    i=0
    while [ $i -lt 5 ] && port_in_use; do sleep 1; i=$((i + 1)); done
  fi
  ! port_in_use
}

free_port() {
  if ! port_in_use; then
    echo "  [OK] 端口 ${PORT} 空闲"
    return 0
  fi

  local pids pid
  pids="$(port_pids | tr '\n' ' ')"
  echo "[WARN] 端口 ${PORT} 已被占用"
  if [ -n "$pids" ]; then
    for pid in $pids; do
      echo "        占用进程：PID ${pid}  $(ps -o comm= -p "$pid" 2>/dev/null)"
      ps -o args= -p "$pid" 2>/dev/null | sed 's/^ */        命令行：/'
    done
  else
    echo "        （读不到占用进程：多半是别的用户起的，请用 sudo 重跑本脚本）"
  fi

  # ---- 请求确认 ----
  local ans=
  if [ "$AUTO_YES" = "1" ]; then
    echo "        已指定 -y，直接清空端口"
    ans=y
  elif [ ! -t 0 ]; then
    echo "[ERROR] 当前不是交互终端，无法确认。请加 -y 明确同意清空端口，或自行处理该进程。"
    return 1
  else
    read -r -p "        是否结束上述进程并继续？[y/N] " ans
  fi
  case "$ans" in
    y|Y|yes|YES) ;;
    *) echo "[INFO] 已取消，未做任何改动。"; return 1 ;;
  esac

  if [ -z "$pids" ]; then
    echo "[ERROR] 拿不到占用进程的 PID，请手动处理（例如 sudo fuser -k ${PORT}/tcp 或 sudo lsof -i:${PORT}）"
    return 1
  fi

  if kill_pids "$pids"; then
    echo "[OK] 端口 ${PORT} 已释放"
    return 0
  fi
  echo "[ERROR] 端口 ${PORT} 仍未释放，请手动处理后重试"
  return 1
}

# ------------------------------------------------------------ silent 分支
LOG="output/update_log.txt"
mkdir -p output

if [ "$MODE" = "silent" ]; then
  rc=0
  {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] update start"
    if "$PY" crawler.py --config config.json --out output &&
       "$PY" organize.py --input output/triggers_normalized.csv --out output; then
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] update done"
    else
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] update FAILED"
      rc=1
    fi
  } >> "$LOG" 2>&1
  exit $rc
fi

# -------------------------------------------------------------- 正常启动
echo "============================================"
echo "  RPA 触发器仪表盘 - 一键启动"
echo "  步骤：1.检查端口  2.抓取  3.整理  4.起服务"
echo "============================================"
echo

echo "[1/4] 检查端口 ${PORT} …"
if ! free_port; then
  exit 1
fi

echo
echo "[2/4] 抓取触发器和运行记录 …"
if ! "$PY" crawler.py --config config.json --out output; then
  echo
  echo "[ERROR] 抓取失败，请检查网络 / 登录态（详见 $LOG）"
  exit 1
fi

echo
echo "[3/4] 生成触发器排期 …"
if ! "$PY" organize.py --input output/triggers_normalized.csv --out output; then
  echo
  echo "[ERROR] 排期生成失败"
  exit 1
fi

echo
echo "[4/4] 启动局域网服务（端口 ${PORT}）…"
echo "  本机：  http://localhost:${PORT}"
echo "  更新日志：${LOG}"
echo "  按 Ctrl+C 停止服务"
echo
exec "$PY" local_server.py
