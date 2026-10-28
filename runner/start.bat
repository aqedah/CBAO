@echo off
REM Vibe Coding Office Runner - start
title CBAO Runner
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (set PY=py -3) else (set PY=python)
set PYTHONIOENCODING=utf-8
set PYTHONUTF8=1
%PY% runner.py
echo.
echo Runner stopped. You can close this window.
pause
