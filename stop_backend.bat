@echo off
echo Stopping SQL Quest backend...
taskkill /IM python.exe /F >nul 2>nul
echo Done.
pause
