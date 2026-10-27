@echo off
chcp 65001 > nul
title Đăng nhập Threads - Kuaishou Tool
echo ========================================================
echo   Đang khởi động trình duyệt để đăng nhập Threads...
echo ========================================================
cd /d "%~dp0.."
node src/platforms/threads/poster.js login
pause
