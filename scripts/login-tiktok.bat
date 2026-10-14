@echo off
chcp 65001 > nul
title Đăng nhập TikTok - Kuaishou Tool
echo ========================================================
echo   Đang khởi động trình duyệt để đăng nhập TikTok...
echo ========================================================
cd /d "%~dp0.."
node src/platforms/tiktok/poster.js login
pause
