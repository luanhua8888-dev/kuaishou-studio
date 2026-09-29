@echo off
chcp 65001 > nul
title Đăng nhập Instagram - Kuaishou Tool
echo ========================================================
echo   Đang khởi động trình duyệt để đăng nhập Instagram...
echo ========================================================
cd /d "%~dp0"
node ig_poster.js login
pause
