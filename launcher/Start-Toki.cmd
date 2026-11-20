@echo off
setlocal
set "TOKI_GUI_SCRIPT=%~dp0Show-TokiLauncher.ps1"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -WindowStyle Hidden -Command "$p = New-Object System.Diagnostics.ProcessStartInfo; $p.FileName = Join-Path $PSHOME 'powershell.exe'; $p.Arguments = '-NoProfile -STA -ExecutionPolicy Bypass -File ' + [char]34 + $env:TOKI_GUI_SCRIPT + [char]34; $p.UseShellExecute = $false; $p.CreateNoWindow = $true; [void][System.Diagnostics.Process]::Start($p)"
