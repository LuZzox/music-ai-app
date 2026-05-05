@echo off
REM Rebuild musica APK with latest code
REM This rebuilds the APK with all current changes

setlocal enabledelayedexpansion

cd /d C:\Users\sharl\Desktop\music-ai-app

echo.
echo ========================================
echo   Building musica APK
echo   (Using Render backend)
echo ========================================
echo.

REM Step 0: Generate Assets (Icon/Splash)
if exist "assets\icon.svg" (
    set "ICON_SOURCE=assets\icon.svg"
) else if exist "assets\icon.png" (
    set "ICON_SOURCE=assets\icon.png"
)

if defined ICON_SOURCE (
    echo [0/4] Generating Android assets from !ICON_SOURCE!...
    call npx @capacitor/assets generate --android --icon !ICON_SOURCE!
) else (
    echo [0/4] No icon found in assets folder, skipping asset generation.
)

REM Step 1: Copy web assets
echo [1/4] Copying web assets...
call npm run cap:copy
if errorlevel 1 (
    echo ERROR: Failed to copy assets
    goto error
)

REM Step 2: Sync with Android
echo [2/4] Syncing with Android project...
call npx cap sync android
if errorlevel 1 (
    echo ERROR: Failed to sync
    goto error
)

REM Step 3: Build APK
echo [3/4] Building APK (this takes a minute)...
cd android
call gradlew.bat assembleDebug
if errorlevel 1 (
    echo ERROR: Build failed
    goto error
)

REM Step 4: Verify APK
cd ..
echo [4/4] Verifying APK...
if exist "android\app\build\outputs\apk\debug\app-debug.apk" (
    for /f "tokens=*" %%A in ('dir /b android\app\build\outputs\apk\debug\app-debug.apk') do set APK_FILE=%%A
    
    echo.
    echo ========================================
    echo   ✅ BUILD SUCCESSFUL!
    echo ========================================
    echo.
    echo APK Ready: android\app\build\outputs\apk\debug\app-debug.apk
    echo.
    echo App Name: musica
    echo Backend: https://music-ai-app.onrender.com
    echo Theme: GREEN
    echo.
    echo Next steps:
    echo 1. Connect Android device via USB
    echo 2. Enable USB Debugging
    echo 3. Run: install-apk.bat
    echo.
    pause
    exit /b 0
) else (
    echo ERROR: APK file not found
    goto error
)

:error
echo.
echo ========================================
echo   ❌ BUILD FAILED
echo ========================================
echo.
echo Check the errors above
echo.
pause
exit /b 1
