@echo off
title RPA Dashboard - Update and Server
setlocal
cd /d "%~dp0"

rem ============================================
rem  RPA Trigger Dashboard - One-click
rem  Usage:
rem    Double click: check port -> fetch -> schedule -> start LAN server (port 8000)
rem    -y / --yes  : free the port without asking (for scheduled tasks)
rem    silent      : silent update only (log to output\update_log.txt), no server
rem
rem  与 start_server.sh 功能一致（同样四步、同样的端口确认交互）
rem ============================================

set "MODE=normal"
set "AUTO_YES="
if /i "%~1"=="silent" set "MODE=silent"
if /i "%~1"=="-y" set "AUTO_YES=1"
if /i "%~1"=="--yes" set "AUTO_YES=1"

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

if /i "%MODE%"=="silent" goto silent

set "PORT=8000"

echo ============================================
echo   RPA Trigger Dashboard - One-click
echo   Steps: 1.port  2.fetch  3.schedule  4.serve
echo ============================================
echo.

echo [1/4] Checking port %PORT% ...
call :free_port
if errorlevel 1 (
    echo.
    pause
    exit /b 1
)

echo.
echo [2/4] Fetching triggers and run records ...
%PY% crawler.py --config config.json --out output
if errorlevel 1 (
    echo.
    echo [ERROR] Fetch failed. Check network / login.
    pause
    exit /b 1
)

echo.
echo [3/4] Building schedule ...
%PY% organize.py --input output\triggers_normalized.csv --out output
if errorlevel 1 (
    echo.
    echo [ERROR] Schedule build failed.
    pause
    exit /b 1
)

echo.
echo [4/4] Starting LAN server on port %PORT% ...
echo   Local:  http://localhost:%PORT%
echo   LAN:    http://[this-PC-IP]:%PORT%   (IP printed by the server on startup)
echo   Update log: output\update_log.txt
echo   Close this window to stop the server.
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
echo [%date% %time%] update done >> output\update_log.txt
exit /b 0
:silent_fail
echo [%date% %time%] update FAILED >> output\update_log.txt
exit /b 1

rem ============================================
rem  :free_port -- 端口被占用则列出占用进程，请求确认后清空
rem  返回 0 = 端口可用（本来就空，或已清空）
rem  返回 1 = 用户取消 / 清空失败 / 拿不到 PID
rem ============================================
:free_port
set "FP_FOUND="

for /f "tokens=5" %%p in ('netstat -ano ^| findstr /c:":%PORT% " ^| findstr /c:"LISTENING"') do (
    set "FP_FOUND=1"
    call :fp_show %%p
)

if not defined FP_FOUND (
    echo   [OK] port %PORT% is free
    exit /b 0
)

if defined AUTO_YES (
    echo         已指定 -y，直接清空端口
    goto :fp_kill
)

choice /C YN /N /M "        是否结束上述进程并继续？[Y/N] "
if errorlevel 2 (
    echo   [INFO] 已取消，未做任何改动。
    exit /b 1
)

:fp_kill
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /c:":%PORT% " ^| findstr /c:"LISTENING"') do (
    taskkill /PID %%p /F >nul 2>&1
)

rem 等端口释放，最多 10 秒（用 ping 当 sleep：timeout 在输入被重定向时会报错）
set "FP_WAIT="
for /l %%i in (1,1,10) do (
    if not defined FP_WAIT (
        netstat -ano | findstr /c:":%PORT% " | findstr /c:"LISTENING" >nul 2>&1
        if errorlevel 1 (set "FP_WAIT=1") else (ping -n 2 127.0.0.1 >nul)
    )
)
if not defined FP_WAIT (
    echo   [ERROR] port %PORT% was not released, please handle it manually.
    exit /b 1
)
echo   [OK] port %PORT% released
exit /b 0

rem 打印单个占用进程的信息（由 :free_port 对每个 PID 调用一次）
:fp_show
echo   [WARN] port %PORT% is in use, PID=%1
for /f "delims=" %%l in ('tasklist /FI "PID eq %1" /NH') do echo         %%l
exit /b 0
