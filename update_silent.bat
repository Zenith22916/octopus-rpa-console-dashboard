@echo off
cd /d "E:\bazhuayu_crawler"

set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY (
    where python >nul 2>nul && set "PY=python"
)
if not defined PY ( exit /b 1 )

echo [%date% %time%] update start >> output\update_log.txt
%PY% crawler.py --config config.json --out output >> output\update_log.txt 2>&1
%PY% organize.py --input output\triggers_normalized.csv --out output >> output\update_log.txt 2>&1
%PY% dashboard.py --input output\triggers_normalized.csv --out output >> output\update_log.txt 2>&1
echo [%date% %time%] update done >> output\update_log.txt
exit /b 0
