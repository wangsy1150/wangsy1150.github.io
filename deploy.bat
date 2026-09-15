@echo off
chcp 65001 >nul
echo ========================================
echo   作品集网站 一键部署
echo   仓库: wangsy1150/wangsy1150.github.io
echo   站点: https://wangsy1150.github.io/
echo ========================================
echo.

where git >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Git，请先安装 Git for Windows
    pause
    exit /b 1
)

cd /d "%~dp0"

echo [1/3] 查看改动...
git status --short

echo.
echo [2/3] 提交改动...
git add -A
set /p MSG=请输入提交说明（直接回车用默认）: 
if "%MSG%"=="" set MSG=更新作品集内容
git commit -m "%MSG%"

echo.
echo [3/3] 推送到 GitHub...
git push

if %errorlevel% neq 0 (
    echo.
    echo [提示] 推送失败。若提示认证问题：
    echo   1. 确认已登录 GitHub 凭据管理器
    echo   2. 或改用 SSH 远端
    pause
    exit /b 1
)

echo.
echo ========================================
echo   推送完成！等待 1-2 分钟后生效
echo   访问: https://wangsy1150.github.io/
echo ========================================
pause
