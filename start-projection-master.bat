@echo off
setlocal
cd /d "%~dp0"
set PORT=5181

where python >nul 2>nul
if errorlevel 1 (
  echo Python was not found. Please install Python or open this folder with another static web server.
  pause
  exit /b 1
)

start "Projection Master Server" /min python -m http.server %PORT% --bind 127.0.0.1
timeout /t 1 >nul
start "" "http://127.0.0.1:%PORT%/index.html"

echo Projection Master is running at:
echo http://127.0.0.1:%PORT%/index.html
echo.
echo Keep this window available while using the page.
pause
