@echo off
REM Install dependencies
call npm install --save-dev prettier eslint eslint-config-prettier eslint-plugin-node

REM Format all files with Prettier
call npm run format

REM Check linting with ESLint
call npm run lint

echo.
echo Style synchronization complete! Your code has been formatted and linted.
pause
