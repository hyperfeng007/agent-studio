@echo off
rem Switch the console code page to UTF-8 so Chinese logs from the server and
rem from CLI sessions are not mangled (child processes inherit this setting).
chcp 65001 >nul
setlocal EnableExtensions
rem ==============================================================
rem  Agent Studio - Windows launcher
rem
rem  This file is intentionally pure ASCII with CRLF line endings
rem  and no BOM: cmd.exe reads .bat files in the OEM code page, so
rem  non-ASCII bytes here turn into garbage or break parsing (the
rem  classic "window flashes and closes" bug). Chinese output from
rem  the Node server still renders correctly because we switch the
rem  console to UTF-8 with chcp 65001 below.
rem
rem  Usage:   start.bat          (default port 3000)
rem           start.bat 3001     (custom port)
rem ==============================================================

cd /d "%~dp0"
set "DATA_DIR=%CD%\data"
chcp 65001 >nul
title Agent Studio

set "PORT=%~1"
if not defined PORT set "PORT=3000"

echo ============================================================
echo   Agent Studio  -  Windows launcher
echo ============================================================
echo   Folder : %CD%
echo   Port   : %PORT%
echo.

rem ---------- warn when run from inside the zip ----------
set "RUNPATH=%CD%"
echo %RUNPATH% | findstr /i /c:"\Temp\" >nul 2>nul
if errorlevel 1 goto not_temp
if exist "node_modules\express" goto not_temp
echo [WARN] This looks like a temporary folder, which usually means the
echo        script was double-clicked INSIDE the .zip archive. Extract the
echo        whole archive to a normal folder first, otherwise dependencies
echo        are installed into a temp directory and may be deleted later.
echo.
choice /c YN /m "        Continue anyway?  [Y]es / [N]o"
if errorlevel 2 goto aborted
echo.
:not_temp

rem ---------- 4. port already taken? ----------
netstat -ano -p tcp 2>nul | findstr /c:"LISTENING" | findstr /c:":%PORT% " >nul 2>nul
if errorlevel 1 goto port_ok
echo.
echo [WARN]   Port %PORT% is already in use. Close that program, or start
echo          on another port with:   start.bat 3001
echo          Startup stopped to avoid opening an OLD server in the browser.
goto port_busy
:port_ok


rem ---------- 1. Node.js ----------
where node >nul 2>nul
if errorlevel 1 goto no_node
for /f "delims=" %%v in ('node -v 2^>nul') do set "NODE_VER=%%v"
node -e "process.exit((Number(process.versions.node.split('.')[0])>20 || (Number(process.versions.node.split('.')[0])===20 && Number(process.versions.node.split('.')[1])>=19))?0:1)"
if errorlevel 1 goto node_old
echo [OK]     Node.js %NODE_VER%

where npm >nul 2>nul
if errorlevel 1 goto no_npm

rem ---------- 2. dependencies ----------
node scripts\dependency-state.cjs check
if not errorlevel 1 goto deps_ok
echo.
echo [1/3]    Installing dependencies - first run takes a few minutes ...
node scripts\install-dependencies.cjs
if errorlevel 1 goto install_failed
:deps_ok
node scripts\dependency-state.cjs write
if errorlevel 1 goto install_failed
echo [OK]     Dependencies ready

rem ---------- 3. web UI ----------
rem Always rebuild after overlay updates; an existing dist may belong to an older release.
echo [2/3]    Building web UI ...
call npm run build
if errorlevel 1 goto build_failed
:dist_ok
echo [OK]     Web UI ready  (web\dist)

rem ---------- 5. open the browser once the server is up ----------
set "AGENT_STUDIO_LAUNCH_ID=AS-%RANDOM%-%RANDOM%-%RANDOM%"
start "" /min powershell -NoProfile -WindowStyle Hidden -Command "for ($i=0; $i -lt 30; $i++) { Start-Sleep -Seconds 1; try { $h=Invoke-RestMethod -Uri 'http://localhost:%PORT%/api/health' -TimeoutSec 2; if ($h.instanceId -eq $env:AGENT_STUDIO_LAUNCH_ID) { Start-Process 'http://localhost:%PORT%'; break } } catch {} }"

echo.
echo [3/3]    Starting server ...
echo.
echo          URL     http://localhost:%PORT%
echo          Data    %CD%\data
echo          Stop    press Ctrl+C, or close this window
echo ------------------------------------------------------------
echo.

node server\index.js

echo.
echo ------------------------------------------------------------
echo   Server stopped.  Exit code: %ERRORLEVEL%
echo.
echo   If this happened right after you clicked "terminate process"
echo   in the web UI, read data\crash.log and the README-Windows.md
echo   section about terminating a CLI (Windows process trees).
echo ------------------------------------------------------------
echo.
pause
endlocal
exit /b 0

rem ================= error paths - all of them pause so the window
rem ================= never closes before you can read the message ====

:aborted
echo.
echo Nothing was started. Extract the archive to a normal folder and run
echo start.bat again.
echo.
pause
endlocal
exit /b 1

:no_node
echo.
echo [ERROR]  Node.js was not found in PATH.
echo.
echo          1. Install Node.js 24 LTS or newer:  https://nodejs.org/
echo          2. Open a NEW terminal window, then run this script again.
echo.
pause
endlocal
exit /b 1

:node_old
echo.
echo [ERROR]  Node.js %NODE_VER% is too old. Version 20.19 or newer is required,
echo          24 LTS or newer is recommended:  https://nodejs.org/
echo.
pause
endlocal
exit /b 1

:no_npm
echo.
echo [ERROR]  npm was not found in PATH. Reinstall Node.js from
echo          https://nodejs.org/ and make sure "npm package manager" is
echo          included, then open a NEW terminal and try again.
echo.
pause
endlocal
exit /b 1

:install_failed
echo.
echo [ERROR]  Dependency installation failed.
echo.
echo          The installer reads Windows system proxy settings automatically.
echo          Check the [PROXY] lines and Windows Settings - Network - Proxy.
echo          npm errors are not necessarily native build errors.
echo          Keep data and package-lock.json; inspect the npm debug log.
echo          Do not disable TLS certificate verification.
echo.

pause
endlocal
exit /b 1

:build_failed
echo.
echo [ERROR]  Building the web UI failed. The archive normally ships a
echo          prebuilt web\dist, so if it is missing the download was
echo          incomplete - extract the archive again, or run:
echo                npm run build
echo.
pause
endlocal
exit /b 1

:port_busy
echo.
echo [ERROR] Close the previous Agent Studio window, then run this script again.
echo         Do not delete your data folder. No running process was terminated.
pause
endlocal
exit /b 1
