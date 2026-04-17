@echo off
setlocal enabledelayedexpansion

echo ========================================
echo Music AI App APK Build Script
echo ========================================

REM Check Node.js
echo.
echo Checking Node.js...
node --version
if errorlevel 1 (
    echo ERROR: Node.js is not installed
    exit /b 1
)

REM Check npm
echo.
echo Checking npm...
npm --version
if errorlevel 1 (
    echo ERROR: npm is not installed
    exit /b 1
)

REM Check Java
echo.
echo Checking Java...
java -version 2>&1
if errorlevel 1 (
    echo ERROR: Java is not installed
    exit /b 1
)

REM Install dependencies
echo.
echo ========================================
echo Installing Node dependencies...
echo ========================================
call npm install
if errorlevel 1 (
    echo ERROR: npm install failed
    exit /b 1
)

REM Run the build script
echo.
echo ========================================
echo Building APK...
echo ========================================
call npm run build:apk
if errorlevel 1 (
    echo ERROR: APK build failed
    exit /b 1
)

REM Check for APK file
echo.
echo ========================================
echo Looking for generated APK...
echo ========================================

REM Check debug APK location
set "apk_path=android\app\build\outputs\apk\debug\app-debug.apk"
if exist "!apk_path!" (
    echo.
    echo SUCCESS: APK generated successfully!
    echo Location: !apk_path!
    for %%A in ("!apk_path!") do (
        set size=%%~zA
        echo Size: !size! bytes
    )
    echo.
    echo ========================================
    echo Installation Instructions:
    echo ========================================
    echo 1. Connect your Android device to this PC via USB
    echo 2. Enable "Developer Mode" on your Android device
    echo 3. Allow USB Debugging when prompted
    echo 4. Run: adb install -r "!apk_path!"
    echo    (or double-click the APK file on the device)
    echo.
) else (
    echo ERROR: APK file not found at expected location
    echo Checked: !apk_path!
    exit /b 1
)

endlocal
