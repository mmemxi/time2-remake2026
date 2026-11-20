@echo off
setlocal EnableExtensions
title Time2 launcher
cd /d "%~dp0"

call :find_python
if defined TIME2_PYTHON goto launch_game

call :message python_missing
choice /C YN /N
if errorlevel 2 goto install_cancelled

where winget >nul 2>&1
if errorlevel 1 goto no_winget

call :message installing
winget install --exact --id Python.Python.3.13 --source winget --scope user --accept-package-agreements --accept-source-agreements
if errorlevel 1 goto install_failed

call :find_python
if defined TIME2_PYTHON goto launch_game

call :message restart_required
call :wait_key
exit /b 1

:no_winget
call :message no_winget
start "" "https://www.python.org/downloads/windows/"
call :wait_key
exit /b 1

:install_failed
call :message install_failed
start "" "https://www.python.org/downloads/windows/"
call :wait_key
exit /b 1

:install_cancelled
call :message install_cancelled
call :wait_key
exit /b 1

:launch_game
call :message starting "%TIME2_PYTHON%"
%TIME2_PYTHON% "%~dp0server.py"
set "TIME2_EXIT=%ERRORLEVEL%"
if not "%TIME2_EXIT%"=="0" (
  call :message server_error "%TIME2_EXIT%"
  call :wait_key
)
exit /b %TIME2_EXIT%

:message
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher-messages.ps1" "%~1" "%~2"
exit /b 0

:wait_key
call :message wait_key
pause >nul
exit /b 0

:find_python
set "TIME2_PYTHON="

where python >nul 2>&1
if not errorlevel 1 (
  python -c "import sys; raise SystemExit(0 if sys.version_info.major == 3 else 1)" >nul 2>&1
  if not errorlevel 1 set "TIME2_PYTHON=python"
)
if defined TIME2_PYTHON exit /b 0

where python3 >nul 2>&1
if not errorlevel 1 (
  python3 -c "import sys; raise SystemExit(0 if sys.version_info.major == 3 else 1)" >nul 2>&1
  if not errorlevel 1 set "TIME2_PYTHON=python3"
)
if defined TIME2_PYTHON exit /b 0

where py >nul 2>&1
if not errorlevel 1 (
  py -3 -c "import sys; raise SystemExit(0 if sys.version_info.major == 3 else 1)" >nul 2>&1
  if not errorlevel 1 set "TIME2_PYTHON=py -3"
)
if defined TIME2_PYTHON exit /b 0

for /d %%D in ("%LocalAppData%\Programs\Python\Python3*") do (
  if exist "%%~fD\python.exe" (
    "%%~fD\python.exe" -c "import sys; raise SystemExit(0 if sys.version_info.major == 3 else 1)" >nul 2>&1
    if not errorlevel 1 set "TIME2_PYTHON=^"%%~fD\python.exe^""
  )
)
if defined TIME2_PYTHON exit /b 0

for /d %%D in ("%ProgramFiles%\Python*" "%SystemDrive%\Python*") do (
  if exist "%%~fD\python.exe" (
    "%%~fD\python.exe" -c "import sys; raise SystemExit(0 if sys.version_info.major == 3 else 1)" >nul 2>&1
    if not errorlevel 1 set "TIME2_PYTHON=^"%%~fD\python.exe^""
  )
)
exit /b 0

