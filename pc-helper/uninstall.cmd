@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | Where-Object { $_.CommandLine -like '*bernud-pc.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; Remove-Item -Force -ErrorAction SilentlyContinue ([Environment]::GetFolderPath('Startup') + '\Bernud PC helper.lnk'); Write-Host 'Bernud PC helper stopped and removed from startup. Your files in %LOCALAPPDATA%\Bernud are left in place.'"
pause
