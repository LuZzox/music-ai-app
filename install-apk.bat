@echo off
REM Quick APK Installation Script for Music AI App

setlocal enabledelayedexpansion

echo.
echo ========================================
echo Music AI App - APK Installation Helper
echo ========================================
echo.

set "APK_PATH=C:\Users\sharl\Desktop\music-ai-app\android\app\build\outputs\apk\debug\app-debug.apk"

if not exist "!APK_PATH!" (
    echo ERROR: APK file not found at:
    echo !APK_PATH!
    echo.
    echo Please ensure the APK has been built first.
    exit /b 1
)

echo Checking for ADB...
adb version >nul 2>&1
if errorlevel 1 (
    echo ERROR: ADB (Android Debug Bridge) is not installed or not in PATH
    echo.
    echo To install ADB:
    echo 1. Download Android SDK Platform Tools from:
    echo    https://developer.android.com/studio/releases/platform-tools
    echo 2. Extract to a folder
    echo 3. Add the folder to your Windows PATH environment variable
    echo.
    echo Or use full path to adb.exe:
    echo   C:\Users\sharl\AppData\Local\Android\Sdk\platform-tools\adb.exe install -r "!APK_PATH!"
    exit /b 1
)

echo.
echo Checking for connected devices...
adb devices
echo.

echo APK ready to install at:
echo !APK_PATH!
echo.

echo Installation methods:
echo.
echo Method 1 - Using ADB (Automatic):
echo   adb install -r "!APK_PATH!"
echo.
echo Method 2 - Manual:
echo   1. Transfer the APK to your device via USB or cloud storage
echo   2. Open the file manager on your device
echo   3. Navigate to the APK and tap to install
echo.
echo Method 3 - Use File Explorer:
echo   1. Open the folder containing the APK
echo   2. Drag and drop the APK onto your connected device
echo.

echo ========================================
echo Pre-Installation Checklist:
echo ========================================
echo.
echo [ ] Device is connected via USB
echo [ ] USB Debugging is enabled on the device
echo     (Settings ^> Developer Options ^> USB Debugging)
echo [ ] Device recognizes this PC (check: adb devices)
echo [ ] App not already installed, or ready to replace it
echo.

:install_menu
echo.
echo Would you like to install the APK now? (Y/N)
set /p choice="Enter your choice: "

if /i "!choice!"=="Y" (
    echo.
    echo Installing APK...
    adb install -r "!APK_PATH!"
    
    if errorlevel 1 (
        echo.
        echo Installation failed. Check:
        echo 1. Device is connected: adb devices
        echo 2. USB Debugging is enabled
        echo 3. Device isn't locked
        exit /b 1
    ) else (
        echo.
        echo ========================================
        echo Installation successful!
        echo ========================================
        echo.
        echo The musica app is now installed on your device.
        echo.
        echo To launch the app:
        echo 1. Unlock your device
        echo 2. Go to your app drawer
        echo 3. Find and tap "Musicify"
        echo.
        pause
    )
) else if /i "!choice!"=="N" (
    echo.
    echo Installation cancelled.
    echo.
    echo The APK is located at:
    echo !APK_PATH!
) else (
    echo Invalid choice. Please enter Y or N.
    goto install_menu
)

endlocal
