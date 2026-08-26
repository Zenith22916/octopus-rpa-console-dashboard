@echo off
title RPA Dashboard - Update and Server
setlocal
cd /d "%~dp0"

rem ============================================
rem  RPA Trigger Dashboard - One-click
rem  Usage:
rem    Double click : update data + start LAN server (port 8000)
rem    silent       : silent update (log to output\update_log.txt)
rem ============================================

rem Try Python 3 in order: py launcher -> python -> system install path
set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY (
    where python >nul 2>nul && set "PY=python"
)
if not defined PY (
    if exist "C:\Program Files\Python\Python314\python.exe" set "PY=C:\Program Files\Python\Python314\python.exe"
)
if not defined PY (
    echo [ERROR] Python 3 not found. Install Python 3 and add to PATH.
    pause
    exit /b 1
)

rem Check requests dependency, auto install if missing
%PY% -c "import requests" >nul 2>&1
if errorlevel 1 (
    echo [WARN] requests module not found for %PY%, installing ...
    %PY% -m pip install requests -q
    if errorlevel 1 (
        echo [ERROR] requests install failed. Run: %PY% -m pip install requests
        pause
        exit /b 1
    )
)

if /i "%~1"=="silent" goto silent

echo ============================================
echo   RPA Trigger Dashboard - One-click
echo   Steps: 1.fetch  2.schedule  3.dashboard
echo ============================================
echo.

echo [1/3] Fetching triggers and run records ...
%PY% crawler.py --config config.json --out output
if errorlevel 1 (
    echo.
    echo [ERROR] Fetch failed. Check network / login.
    pause
    exit /b 1
)

echo [2/3] Building schedule ...
%PY% organize.py --input output\triggers_normalized.csv --out output
if errorlevel 1 (
    echo.
    echo [ERROR] Schedule build failed.
    pause
    exit /b 1
)

echo [3/3] Generating dashboard and gantt ...
%PY% dashboard.py --input output\triggers_normalized.csv --out output
if errorlevel 1 (
    echo.
    echo [ERROR] Dashboard generation failed.
    pause
    exit /b 1
)

echo.
echo ============================================
echo   DONE!
echo   Dashboard: output\dashboard.html
echo   Gantt    : output\runs_gantt.html
echo ============================================
echo.

rem Check if port 8000 is already in use (server may be running)
netstat -ano | findstr /c:":8000 " | findstr LISTENING >nul 2>&1
if not errorlevel 1 (
    echo [INFO] Port 8000 already in use. Server is probably already running.
    echo        Open http://localhost:8000 in your browser.
    start http://localhost:8000
    pause
    exit /b 0
)

echo Starting LAN server on port 8000 ...
echo Open http://[this-PC-IP]:8000 from other computers in LAN.
echo Close this window to stop the server.
echo.
%PY% local_server.py
pause
exit /b 0

:silent
echo [%date% %time%] update start >> output\update_log.txt
%PY% crawler.py --config config.json --out output >> output\update_log.txt 2>&1
if errorlevel 1 goto silent_fail
%PY% organize.py --input output\triggers_normalized.csv --out output >> output\update_log.txt 2>&1
if errorlevel 1 goto silent_fail
%PY% dashboard.py --input output\triggers_normalized.csv --out output >> output\update_log.txt 2>&1
if errorlevel 1 goto silent_fail
echo [%date% %time%] update done >> output\update_log.txt
exit /b 0
:silent_fail
echo [%date% %time%] update FAILED >> output\update_log.txt
exit /b 1
