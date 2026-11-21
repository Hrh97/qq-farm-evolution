@echo off
chcp 65001 >nul
cd /d "D:\hrh\GithubProgra\qq-farm-evolution"
echo Stopping QQ Farm Bot (Docker Compose)...
docker compose stop
echo Stopped. Data preserved in D:\hrh\GithubProgra\data
pause
