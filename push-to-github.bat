@echo off
title Push Casino to GitHub
cd /d "%~dp0"
echo ========================================================
echo   UPLOADEN NAAR GITHUB (r-dscht/casino-multiplayer)
echo ========================================================
echo.
git push -u origin main
echo.
echo ========================================================
echo Klaar! Alles staat nu op GitHub.
echo Druk op een toets om dit venster te sluiten.
echo ========================================================
pause
