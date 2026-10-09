@echo off
title RPA Dashboard Server
cd /d "%~dp0"

rem Start the dashboard server. Data updates run inside local_server.py:
rem   runs_poller every 60s / underway polling every 8s / full update daily 12:00.
rem If "python" is not on PATH, replace it below with the full python.exe path.

python core\local_server.py
pause
