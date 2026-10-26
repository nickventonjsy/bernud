# Sets up Bernud's helper on Nicholas's WORK laptop: printing CCP documents, opening them, and status only.
# Run from PowerShell with the line shown in Bernud's Settings, e.g.
#   $k='<work key>'; irm https://raw.githubusercontent.com/nickventonjsy/bernud/main/pc-helper/setup-work.ps1 | iex
# No admin needed. Remove later with: & "$env:LOCALAPPDATA\Bernud\uninstall.cmd"
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
if (-not $k) { $k = Read-Host 'Paste the work laptop key from Bernud Settings' }
if (-not $k -or $k.Length -lt 20) { throw 'That key looks wrong. Copy the whole line from Bernud Settings again.' }

$raw = 'https://raw.githubusercontent.com/nickventonjsy/bernud/main/pc-helper'
$dst = Join-Path $env:LOCALAPPDATA 'Bernud'
New-Item -ItemType Directory -Force -Path $dst | Out-Null

# Stop an older copy if it's running.
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*bernud-pc.ps1*' } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force } catch {} }

foreach ($f in @('bernud-pc.ps1', 'uninstall.cmd')) { Invoke-WebRequest -Uri "$raw/$f" -OutFile (Join-Path $dst $f) -UseBasicParsing }
Get-ChildItem $dst | Unblock-File -ErrorAction SilentlyContinue
@{ server = 'https://bernud-server.onrender.com'; key = $k; role = 'work'; allow_powershell = $false; scripts = @{} } | ConvertTo-Json | Set-Content -Path (Join-Path $dst 'config.json') -Encoding UTF8

# Start now and at every sign-in.
$runArgs = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$dst\bernud-pc.ps1`""
$lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'Bernud PC helper.lnk'
$s = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
$s.TargetPath = 'powershell.exe'; $s.Arguments = $runArgs; $s.WindowStyle = 7; $s.Description = 'Lets Bernud print CCP documents on this laptop'; $s.Save()
Start-Process powershell.exe -ArgumentList $runArgs -WindowStyle Hidden

# SumatraPDF prints PDFs silently. Install it for this user if it isn't there.
$sumatra = @("$env:LOCALAPPDATA\SumatraPDF\SumatraPDF.exe", "$env:ProgramFiles\SumatraPDF\SumatraPDF.exe", "${env:ProgramFiles(x86)}\SumatraPDF\SumatraPDF.exe") | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $sumatra) {
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Write-Host 'Installing SumatraPDF (free PDF reader used for printing)...'
    try { winget install -e --id SumatraPDF.SumatraPDF --scope user --silent --accept-source-agreements --accept-package-agreements | Out-Null } catch {}
  }
  $sumatra = @("$env:LOCALAPPDATA\SumatraPDF\SumatraPDF.exe", "$env:ProgramFiles\SumatraPDF\SumatraPDF.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
}

Start-Sleep -Seconds 4
Write-Host ''
Write-Host 'Bernud is set up on this work laptop.' -ForegroundColor Green
Write-Host 'He can print and open CCP documents here, and nothing else.'
if ($sumatra) { Write-Host "SumatraPDF found: $sumatra" -ForegroundColor Green }
else { Write-Host 'SumatraPDF is not installed yet. Install it from https://www.sumatrapdfreader.org (choose the installer), then printing will work.' -ForegroundColor Yellow }
Write-Host "Files and log: $dst"
