@echo off
REM Start the musica backend server
REM This will run the Node.js server on http://localhost:3000

cd /d C:\Users\sharl\Desktop\music-ai-app

echo.
echo ========================================
echo   Starting musica Backend Server
echo ========================================
echo.
echo Server will run on: http://localhost:3000
echo.
echo To use the app:
echo 1. Keep this window open
echo 2. Open musica app on your Android device
echo 3. In the app Library tab, set Backend URL to: http://<YOUR_PC_IP>:3000
echo.
echo To find your PC IP:
echo   Open Command Prompt and type: ipconfig
echo   Look for IPv4 Address (usually 192.168.x.x)
echo.
echo Press CTRL+C to stop the server
echo.
echo ========================================
echo.

npm start

pause
