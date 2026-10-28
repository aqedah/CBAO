@echo off
REM Vibe Coding Office Runner - install (run once)
echo [Runner] Installing...
where py >nul 2>nul
if %errorlevel%==0 (set PY=py -3) else (set PY=python)
%PY% --version
if %errorlevel% neq 0 (
  echo Python not found. Install it from https://www.python.org/downloads/ and run again.
  pause
  exit /b 1
)
%PY% -m pip install --upgrade pip
%PY% -m pip install -r "%~dp0requirements.txt"
if %errorlevel% neq 0 (
  echo Install failed. Check the internet connection.
  pause
  exit /b 1
)
if not exist "%~dp0..\serviceAccount.json" (
  echo.
  echo WARNING: C:\CBAO\serviceAccount.json is missing. Download it from Firebase console.
)
echo.
echo Install complete. Now double-click start.bat
pause
