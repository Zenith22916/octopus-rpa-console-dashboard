#!/usr/bin/env bash
# ============================================================================
# start_server.sh -- one-click launcher for Linux / macOS
#                    (same behaviour as start_server.bat)
#
# Steps:
#   1. Check the service port: if it is already in use, print the owning process
#      (PID / name / command line) and ask for confirmation, then free the port
#      (SIGTERM first, SIGKILL after 10s). Aborts untouched if you answer no.
#   2. Fetch triggers and run records                     crawler.py
#   3. Build the trigger schedule                         organize.py
#   4. Start the LAN server (foreground, Ctrl+C to stop)  local_server.py
#
# Usage:
#   chmod +x start_server.sh     # once
#   ./start_server.sh            # normal start (asks before killing anything)
#   ./start_server.sh -y         # free the port without asking (cron / systemd)
#   ./start_server.sh silent     # update data only, do not start the server
#
# The port is read from PORT in local_server.py (single source of truth) and can
# be overridden with the PORT environment variable.
# Keep this file LF-only: CRLF endings cause "bad interpreter" errors.
#
# NOTE: keep every message in this file ASCII-only. Non-ASCII output breaks on
# terminals whose locale is not UTF-8 (shows up as mojibake).
# ============================================================================
set -uo pipefail

# Same as "cd /d %~dp0" in the .bat: move to the script directory (resolve symlinks)
SELF="$0"
while [ -L "$SELF" ]; do SELF="$(readlink "$SELF")"; done
cd "$(dirname "$SELF")"

# ------------------------------------------------------------------- options
MODE=normal      # normal | silent
AUTO_YES=0       # 1 = do not ask before freeing the port
for a in "$@"; do
  case "$a" in
    silent)      MODE=silent ;;
    -y|--yes)    AUTO_YES=1 ;;
    -h|--help)   sed -n '2,26p' "$0"; exit 0 ;;
    *)           echo "[WARN] unknown argument: $a (available: silent / -y)" ;;
  esac
done

# ------------------------------------------------------ interpreter / deps
# Same order as the .bat: py launcher -> python -> explicit path
PY="$(command -v python3 || command -v python || true)"
if [ -z "$PY" ]; then
  echo "[ERROR] python3 not found. Install it first"
  echo "        Debian/Ubuntu: sudo apt install python3 python3-pip"
  exit 1
fi
if ! "$PY" -c "import requests" >/dev/null 2>&1; then
  echo "[WARN] the 'requests' module is missing, installing ..."
  "$PY" -m pip install -q requests || {
    echo "[ERROR] failed to install requests. Run manually: $PY -m pip install requests"
    exit 1
  }
fi

# ---------------------------------------------------------------------- port
# Read the port from local_server.py so it is defined in exactly one place
PORT="${PORT:-$(sed -n 's/^PORT *= *\([0-9][0-9]*\).*/\1/p' local_server.py 2>/dev/null | head -1)}"
PORT="${PORT:-8000}"

# Print the PIDs listening on the port (fall back through the available tools)
port_pids() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltnp 2>/dev/null | grep -E "[:.]${PORT}[[:space:]]" | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u
  elif command -v lsof >/dev/null 2>&1; then
    lsof -t -iTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null | sort -u
  elif command -v netstat >/dev/null 2>&1; then
    netstat -ltnp 2>/dev/null | grep -E "[:.]${PORT}[[:space:]]" | grep -o '[0-9][0-9]*/' | cut -d/ -f1 | sort -u
  fi
}

# Is anything listening on the port? Last resort: bash built-in /dev/tcp probe
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

# Terminate the given PIDs and wait for the port to be released (SIGTERM -> SIGKILL)
kill_pids() {
  local pids="$1" pid i=0
  for pid in $pids; do kill "$pid" 2>/dev/null || true; done
  while [ $i -lt 10 ] && port_in_use; do sleep 1; i=$((i + 1)); done
  if port_in_use; then
    echo "[WARN] process did not exit on SIGTERM, sending SIGKILL"
    for pid in $pids; do kill -9 "$pid" 2>/dev/null || true; done
    i=0
    while [ $i -lt 5 ] && port_in_use; do sleep 1; i=$((i + 1)); done
  fi
  ! port_in_use
}

free_port() {
  if ! port_in_use; then
    echo "  [OK] port ${PORT} is free"
    return 0
  fi

  local pids pid
  pids="$(port_pids | tr '\n' ' ')"
  echo "[WARN] port ${PORT} is already in use"
  if [ -n "$pids" ]; then
    for pid in $pids; do
      echo "        process: PID ${pid}  $(ps -o comm= -p "$pid" 2>/dev/null)"
      ps -o args= -p "$pid" 2>/dev/null | sed 's/^ */        command: /'
    done
  else
    echo "        (cannot read the owning process: it probably belongs to another user, re-run with sudo)"
  fi

  # ---- ask for confirmation ----
  local ans=
  if [ "$AUTO_YES" = "1" ]; then
    echo "        -y given, freeing the port without asking"
    ans=y
  elif [ ! -t 0 ]; then
    echo "[ERROR] not an interactive terminal, cannot ask for confirmation."
    echo "        Add -y to allow killing the process, or handle it manually."
    return 1
  else
    read -r -p "        Kill the process(es) above and continue? [y/N] " ans
  fi
  case "$ans" in
    y|Y|yes|YES) ;;
    *) echo "[INFO] cancelled, nothing was changed."; return 1 ;;
  esac

  if [ -z "$pids" ]; then
    echo "[ERROR] cannot determine the PID holding the port. Handle it manually, e.g.:"
    echo "        sudo fuser -k ${PORT}/tcp   (or: sudo lsof -i:${PORT})"
    return 1
  fi

  if kill_pids "$pids"; then
    echo "[OK] port ${PORT} released"
    return 0
  fi
  echo "[ERROR] port ${PORT} is still in use, handle it manually and retry"
  return 1
}

# ---------------------------------------------------------- silent mode only
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

# ----------------------------------------------------------- normal startup
echo "============================================"
echo "  RPA Trigger Dashboard - one-click"
echo "  Steps: 1.port  2.fetch  3.schedule  4.serve"
echo "============================================"
echo

echo "[1/4] Checking port ${PORT} ..."
if ! free_port; then
  exit 1
fi

echo
echo "[2/4] Fetching triggers and run records ..."
if ! "$PY" crawler.py --config config.json --out output; then
  echo
  echo "[ERROR] fetch failed. Check network / login state (see $LOG)"
  exit 1
fi

echo
echo "[3/4] Building schedule ..."
if ! "$PY" organize.py --input output/triggers_normalized.csv --out output; then
  echo
  echo "[ERROR] schedule build failed"
  exit 1
fi

echo
echo "[4/4] Starting LAN server on port ${PORT} ..."
echo "  Local:      http://localhost:${PORT}"
echo "  Update log: ${LOG}"
echo "  Press Ctrl+C to stop the server"
echo
exec "$PY" local_server.py
