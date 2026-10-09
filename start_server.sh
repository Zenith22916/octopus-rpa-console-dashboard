#!/usr/bin/env bash
# Start the dashboard server. Data updates run inside local_server.py:
#   runs_poller every 60s / underway polling every 8s / full update daily 12:00.
cd "$(dirname "$0")"
python3 core/local_server.py
