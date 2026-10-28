@echo off
chcp 65001 >nul
echo [바이브코딩인력사무소 심부름꾼] 설치를 시작합니다.
where py >nul 2>nul
if %errorlevel%==0 (set PY=py -3) else (set PY=python)
%PY% --version || (echo Python 이 없습니다. https://www.python.org/downloads/ 에서 설치한 뒤 다시 실행하세요. & pause & exit /b 1)
%PY% -m pip install --upgrade pip >nul
%PY% -m pip install -r "%~dp0requirements.txt"
if %errorlevel% neq 0 (echo 설치 실패. 인터넷 연결을 확인하세요. & pause & exit /b 1)
if not exist "%~dp0..\serviceAccount.json" (echo. & echo 주의: C:\CBAO\serviceAccount.json 열쇠 파일이 아직 없습니다. Firebase 콘솔에서 받아 넣으세요.)
echo.
echo 설치 완료. 이제 start.bat 을 더블클릭하면 심부름꾼이 켜집니다.
pause
