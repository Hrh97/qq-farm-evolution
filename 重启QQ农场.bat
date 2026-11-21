@echo off
chcp 65001 >nul
cd /d "D:\hrh\GithubProgra\qq-farm-evolution"
echo Restarting QQ Farm Bot (Docker Compose)...
docker compose restart
echo.
echo Panel: http://127.0.0.1:3007
pause
