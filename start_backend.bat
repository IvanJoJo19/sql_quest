@echo off
setlocal
cd /d "%~dp0"
set "PATH=%USERPROFILE%\scoop\apps\python\current;%USERPROFILE%\scoop\apps\postgresql\current\bin;%PATH%"

echo Starting SQL Quest...
echo.
echo Keep this window open while using the app.
echo The browser will open automatically after the backend starts.
echo.

start "" powershell -NoProfile -ExecutionPolicy Bypass -Command "$url='http://127.0.0.1:8000'; for ($i=0; $i -lt 40; $i++) { try { Invoke-RestMethod -Uri ($url + '/api/health') -TimeoutSec 1 | Out-Null; Start-Process $url; exit 0 } catch { Start-Sleep -Seconds 1 } }; Start-Process notepad.exe '%~dp0backend-launch.err.log'"

python -u backend.py

echo.
echo SQL Quest stopped.
pause
