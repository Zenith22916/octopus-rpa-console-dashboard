@echo off
title RPA Dashboard - LAN Server
cd /d "E:\bazhuayu_crawler"
echo Starting LAN server on port 8000 ...
echo Open http://[this-PC-IP]:8000 from other computers in LAN.
echo Close this window to stop the server.
echo.
python local_server.py
pause
