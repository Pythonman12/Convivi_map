@echo off
chcp 65001 > nul
echo ===================================================
echo   부산 편의점 지도 웹 서비스 실행기
echo ===================================================
echo.
echo 웹 브라우저에서 실행 중...
echo URL: http://localhost:8080/
echo.
echo 브라우저 창을 열고 웹 서버를 시작합니다.
echo 서버를 종료하려면 이 창에서 Ctrl+C를 누르세요.
echo.

start "" "http://localhost:8080/"
python -m http.server 8080
if %errorlevel% neq 0 (
    uv run python -m http.server 8080
)
pause
