@echo off
REM Duzce FENTEK Odev Destek - yerel sunucu baslatici (on kontrollu)
REM Tum mantik: baslat-backend.ps1  (Node/paket/.env/port denetimi + saglik sonrasi tarayici)
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Duzce FENTEK - Yerel Sunucu

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0baslat-backend.ps1" %*
set "KOD=%ERRORLEVEL%"

if not "%KOD%"=="0" (
  echo.
  echo Baslatma tamamlanmadi. Cikis kodu: %KOD%
  echo Ayrintilar yukarida yaziyor.
  pause
)

endlocal & exit /b %KOD%
