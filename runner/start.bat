@echo off
chcp 65001 >nul
title 바이브코딩인력사무소 심부름꾼
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (set PY=py -3) else (set PY=python)
%PY% runner.py
echo.
echo 심부름꾼이 종료되었습니다. 창을 닫아도 됩니다.
pause
