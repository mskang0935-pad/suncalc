@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo SUNCALC 웹 서비스를 시작합니다...
echo 브라우저에서 http://127.0.0.1:3000 을 여세요.
echo.
python -u server.py
pause
