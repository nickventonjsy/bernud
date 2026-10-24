# Installs the Bernud PC helper for the current Windows user (no admin needed).
$ErrorActionPreference = 'Stop'
$src = Split-Path -Parent $MyInvocation.MyCommand.Path
$dst = Join-Path $env:LOCALAPPDATA 'Bernud'
New-Item -ItemType Directory -Force -Path $dst | Out-Null
Get-Process powershell -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne $PID } | ForEach-Object {
  try { if ((Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)").CommandLine -like '*bernud-pc.ps1*') { Stop-Process -Id $_.Id -Force } } catch {}
}
Copy-Item (Join-Path $src 'bernud-pc.ps1') $dst -Force
Get-ChildItem $dst | Unblock-File -ErrorAction SilentlyContinue
if (-not (Test-Path (Join-Path $dst 'config.json'))) { Copy-Item (Join-Path $src 'config.json') $dst -Force }
$runArgs = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$dst\bernud-pc.ps1`""
$lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'Bernud PC helper.lnk'
$s = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
$s.TargetPath = 'powershell.exe'; $s.Arguments = $runArgs; $s.WindowStyle = 7; $s.Description = 'Lets Bernud control this PC'; $s.Save()
Start-Process powershell.exe -ArgumentList $runArgs -WindowStyle Hidden
Start-Sleep -Seconds 4
Write-Host ''
Write-Host 'Bernud PC helper installed and running.' -ForegroundColor Green
Write-Host "It starts automatically when you sign in. Files and log: $dst"
Write-Host 'To remove it, run uninstall.cmd.'
