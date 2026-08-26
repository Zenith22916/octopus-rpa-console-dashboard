@echo off
title RPA Dashboard - One-click Update

echo ============================================
echo   RPA Trigger Dashboard - One-click Update
echo   Steps: 1.fetch  2.schedule  3.dashboard
echo ============================================
echo.

cd /d "E:\bazhuayu_crawler"

set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY (
    where python >nul 2>nul && set "PY=python"
)
if not defined PY (
    echo [ERROR] Python not found. Install Python 3 and add to PATH.
    pause
    exit /b 1
)
echo [INFO] Python: %PY%
echo.

echo [1/3] Fetching triggers ...
%PY% crawler.py --config config.json --out output
if errorlevel 1 (
    echo.
    echo [ERROR] Fetch failed. Check network / login.
    pause
    exit /b 1
)
echo.

echo [2/3] Building schedule ...
%PY% organize.py --input output\triggers_normalized.csv --out output
if errorlevel 1 (
    echo.
    echo [ERROR] Schedule build failed.
    pause
    exit /b 1
)
echo.

echo [3/3] Generating dashboard ...
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
echo   Dashboard: E:\bazhuayu_crawler\output\dashboard.html
echo   Schedule : E:\bazhuayu_crawler\output\schedule_all.md
echo ============================================
pause
