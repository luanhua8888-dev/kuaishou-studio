@echo off
chcp 65001 > nul
title Kuaishou Downloader & Studio
echo ========================================================
echo   Đang khởi động Kuaishou Tool Web UI...
echo ========================================================
cd /d "%~dp0.."
node server.js
pause
