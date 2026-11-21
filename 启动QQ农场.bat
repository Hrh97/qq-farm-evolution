@echo off
chcp 65001 >nul
cd /d "D:\hrh\GithubProgra\qq-farm-evolution"
echo Starting QQ Farm Bot (Docker Compose)...
docker compose --env-file deploy-vars.txt up -d
echo.
echo Panel: http://127.0.0.1:3007
echo Health: http://127.0.0.1:3007/api/health
echo Logs:   docker compose logs -f
pause
