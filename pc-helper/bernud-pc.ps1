# Bernud PC helper
# Runs quietly in the background on Nicholas's PC. It asks Bernud's server for commands
# (outbound HTTPS only, nothing listens on this PC), carries them out and reports back.
# Log: %LOCALAPPDATA%\Bernud\bernud-pc.log    Stop it: run uninstall.cmd, or end "powershell" in Task Manager.

$ErrorActionPreference = 'Stop'
$Version = '1.1'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Config = Get-Content (Join-Path $Dir 'config.json') -Raw | ConvertFrom-Json
$Server = ($Config.server).TrimEnd('/')
$Headers = @{ 'x-device-key' = $Config.key }
# "home" (full control) or "work" (printing, opening documents and status only).
$Role = if ($Config.role) { [string]$Config.role } else { 'home' }
$WorkActions = @('print', 'list_printers', 'open_url', 'system_info', 'status')
$LogFile = Join-Path $Dir 'bernud-pc.log'

# Only one copy at a time.
$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'Global\BernudPcHelper', [ref]$created)
if (-not $created) { exit 0 }

function Log([string]$m) {
  try {
    if ((Test-Path $LogFile) -and ((Get-Item $LogFile).Length -gt 1MB)) { Move-Item $LogFile "$LogFile.old" -Force }
    Add-Content -Path $LogFile -Value ("{0:yyyy-MM-dd HH:mm:ss} {1}" -f (Get-Date), $m)
  } catch {}
}

# ---------------- Volume (Windows Core Audio) ----------------
try {
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int f(); int g(); int h(); int i();
  int SetMasterVolumeLevelScalar(float fLevel, System.Guid pguidEventContext);
  int j();
  int GetMasterVolumeLevelScalar(out float pfLevel);
  int k(); int l(); int m(); int n();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, System.Guid pguidEventContext);
  int GetMute(out bool pbMute);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref System.Guid id, int clsCtx, int activationParams, out IAudioEndpointVolume aev); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int f(); int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorComObject { }
public class BernudAudio {
  static IAudioEndpointVolume Vol() {
    var enumerator = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator;
    IMMDevice dev = null;
    Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out dev));
    IAudioEndpointVolume epv = null;
    var epvid = typeof(IAudioEndpointVolume).GUID;
    Marshal.ThrowExceptionForHR(dev.Activate(ref epvid, 23, 0, out epv));
    return epv;
  }
  public static float Volume {
    get { float v = -1; Marshal.ThrowExceptionForHR(Vol().GetMasterVolumeLevelScalar(out v)); return v; }
    set { Marshal.ThrowExceptionForHR(Vol().SetMasterVolumeLevelScalar(value, System.Guid.Empty)); }
  }
  public static bool Mute {
    get { bool mute; Marshal.ThrowExceptionForHR(Vol().GetMute(out mute)); return mute; }
    set { Marshal.ThrowExceptionForHR(Vol().SetMute(value, System.Guid.Empty)); }
  }
}
'@
  $script:HasAudio = $true
} catch { $script:HasAudio = $false; Log "Core Audio unavailable: $($_.Exception.Message)" }

$Shell = New-Object -ComObject WScript.Shell
function Press([int]$code, [int]$times = 1) { for ($i = 0; $i -lt $times; $i++) { $Shell.SendKeys([string][char]$code); Start-Sleep -Milliseconds 40 } }

function Get-VolumeText {
  if (-not $script:HasAudio) { return 'Volume changed.' }
  $v = [math]::Round([BernudAudio]::Volume * 100)
  if ([BernudAudio]::Mute) { return "Volume $v% (muted)" } else { return "Volume $v%" }
}

# ---------------- Actions ----------------
function Open-App([string]$name) {
  if (-not $name) { throw 'Which app?' }
  $apps = @(Get-StartApps)
  $app = $apps | Where-Object { $_.Name -eq $name } | Select-Object -First 1
  if (-not $app) { $app = $apps | Where-Object { $_.Name -like "$name*" } | Select-Object -First 1 }
  if (-not $app) { $app = $apps | Where-Object { $_.Name -like "*$name*" } | Select-Object -First 1 }
  if ($app) { Start-Process "shell:AppsFolder\$($app.AppID)"; return "Opened $($app.Name)." }
  try { Start-Process $name; return "Started $name." } catch { throw "I couldn't find an app called '$name' on the PC." }
}

function Close-App([string]$name) {
  if (-not $name) { throw 'Which app?' }
  $procs = @(Get-Process | Where-Object { $_.Id -ne $PID -and $_.MainWindowHandle -ne 0 -and ($_.ProcessName -like "*$name*" -or $_.MainWindowTitle -like "*$name*") })
  if (-not $procs.Count) { return "Nothing called '$name' is open." }
  $names = ($procs | Select-Object -ExpandProperty ProcessName -Unique) -join ', '
  foreach ($p in $procs) { try { [void]$p.CloseMainWindow() } catch {} }
  Start-Sleep -Seconds 3
  foreach ($p in $procs) { try { if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force } } catch {} }
  return "Closed $names."
}

function Set-Volume([string]$target, [string]$value) {
  $t = "$target $value".Trim().ToLower()
  if ($t -match '^\d+') {
    $n = [math]::Max(0, [math]::Min(100, [int]$Matches[0]))
    if ($script:HasAudio) { [BernudAudio]::Mute = $false; [BernudAudio]::Volume = $n / 100 } else { Press 174 50; Press 175 ([int]($n / 2)) }
  }
  elseif ($t -match 'unmute') { if ($script:HasAudio) { [BernudAudio]::Mute = $false } else { Press 173 } }
  elseif ($t -match 'mute') { if ($script:HasAudio) { [BernudAudio]::Mute = $true } else { Press 173 } }
  elseif ($t -match 'up|louder') { Press 175 5 }
  elseif ($t -match 'down|quieter|lower') { Press 174 5 }
  elseif ($t -eq '' -or $t -match 'get|what|level') { }
  else { throw "Volume: say a number 0-100, up, down, mute or unmute." }
  return (Get-VolumeText)
}

function Media([string]$t) {
  switch -Regex ($t.ToLower()) {
    'next|skip' { Press 176; return 'Next track.' }
    'prev|back' { Press 177; return 'Previous track.' }
    'stop' { Press 178; return 'Stopped.' }
    default { Press 179; return 'Play/pause.' }
  }
}

function Power([string]$t) {
  switch -Regex ($t.ToLower()) {
    '^lock' { rundll32.exe user32.dll,LockWorkStation; return 'PC locked.' }
    'sleep' { Start-Job { Start-Sleep 3; rundll32.exe powrprof.dll,SetSuspendState 0,1,0 } | Out-Null; return 'Going to sleep in 3 seconds.' }
    'restart|reboot' { shutdown.exe /r /t 60 /c 'Bernud: restarting in 60 seconds. Ask Bernud to cancel if you need to.'; return 'Restarting in 60 seconds. Say cancel to stop it.' }
    'shut|off' { shutdown.exe /s /t 60 /c 'Bernud: shutting down in 60 seconds. Ask Bernud to cancel if you need to.'; return 'Shutting down in 60 seconds. Say cancel to stop it.' }
    'cancel|abort' { shutdown.exe /a | Out-Null; return 'Cancelled the pending restart or shutdown.' }
    'sign|log' { shutdown.exe /l; return 'Signing out.' }
    default { throw 'Power: lock, sleep, restart, shutdown, cancel or sign out.' }
  }
}

function Get-Scripts { if ($Config.scripts) { return $Config.scripts.PSObject.Properties } else { return @() } }

function Run-Script([string]$name) {
  $s = @(Get-Scripts) | Where-Object { $_.Name -eq $name } | Select-Object -First 1
  if (-not $s) { $s = @(Get-Scripts) | Where-Object { $_.Name -like "*$name*" } | Select-Object -First 1 }
  if (-not $s) { throw "No approved script called '$name'. Approved: $((@(Get-Scripts) | ForEach-Object Name) -join ', ')" }
  Start-Process -FilePath 'cmd.exe' -ArgumentList '/k', $s.Value -WindowStyle Normal
  return "Started $($s.Name) in a new window."
}

function Type-Text([string]$text) {
  $escaped = [regex]::Replace($text, '[+^%~(){}\[\]]', { param($m) '{' + $m.Value + '}' })
  $Shell.SendKeys($escaped)
  return "Typed $($text.Length) characters into the active window."
}

function Say([string]$text) {
  $v = New-Object -ComObject SAPI.SpVoice
  [void]$v.Speak($text)
  return 'Said it on the PC.'
}

function Run-PowerShell([string]$cmd) {
  if (-not $cmd) { throw 'No command given.' }
  $job = Start-Job -ScriptBlock { param($c) Invoke-Expression $c 2>&1 | Out-String -Width 200 } -ArgumentList $cmd
  if (Wait-Job $job -Timeout 20) { $out = Receive-Job $job; Remove-Job $job -Force; if (-not $out) { $out = '(no output)' }; return $out.Trim() }
  Remove-Job $job -Force
  return 'Still running after 20 seconds, so I stopped waiting for its output.'
}

function System-Info {
  $os = Get-CimInstance Win32_OperatingSystem
  $cpu = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
  $disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
  $bat = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue
  $up = (Get-Date) - $os.LastBootUpTime
  $lines = @(
    "PC: $env:COMPUTERNAME, $($os.Caption)",
    "CPU load: $cpu%",
    ("Memory: {0:N1} GB free of {1:N1} GB" -f ($os.FreePhysicalMemory / 1MB), ($os.TotalVisibleMemorySize / 1MB)),
    ("Disk C: {0:N0} GB free of {1:N0} GB" -f ($disk.FreeSpace / 1GB), ($disk.Size / 1GB)),
    ("Up for {0} days {1} hours" -f $up.Days, $up.Hours)
  )
  if ($bat) { $lines += "Battery: $($bat.EstimatedChargeRemaining)%" + $(if ($bat.BatteryStatus -eq 2) { ' (charging)' } else { '' }) }
  return ($lines -join "`n")
}

function List-Windows {
  $w = Get-Process | Where-Object { $_.MainWindowTitle } | ForEach-Object { "$($_.ProcessName): $($_.MainWindowTitle)" }
  if ($w) { return ($w -join "`n") } else { return 'No open windows.' }
}

# ---------------- Printing (CCP documents from Bernud's server) ----------------
function Find-Sumatra {
  $paths = @("$env:LOCALAPPDATA\SumatraPDF\SumatraPDF.exe", "$env:ProgramFiles\SumatraPDF\SumatraPDF.exe", "${env:ProgramFiles(x86)}\SumatraPDF\SumatraPDF.exe")
  foreach ($p in $paths) { if ($p -and (Test-Path $p)) { return $p } }
  $cmd = Get-Command SumatraPDF.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return $null
}
function List-Printers {
  $list = Get-CimInstance Win32_Printer | ForEach-Object { if ($_.Default) { "$($_.Name) (default)" } else { $_.Name } }
  if ($list) { return ($list -join "`n") } else { return 'No printers found.' }
}
function Print-Document([string]$url, [string]$opts) {
  if ($url -notmatch '^https://bernud-server\.onrender\.com/files/[0-9a-f]{32}\.pdf$') { throw 'Only documents sent by Bernud can be printed.' }
  $parts = $opts -split '\|', 2
  $copies = [math]::Max(1, [math]::Min(20, [int]("0" + ($parts[0] -replace '[^0-9]', '')) ))
  $printer = if ($parts.Count -gt 1) { $parts[1].Trim() } else { '' }
  $file = Join-Path $env:TEMP ("bernud-print-" + [guid]::NewGuid().ToString('N') + ".pdf")
  Invoke-WebRequest -Uri $url -OutFile $file -UseBasicParsing -TimeoutSec 60
  try {
    $sumatra = Find-Sumatra
    if ($printer) {
      $match = Get-CimInstance Win32_Printer | Where-Object { $_.Name -like "*$printer*" } | Select-Object -First 1
      if (-not $match) { throw "No printer called '$printer'. Printers: $((Get-CimInstance Win32_Printer | ForEach-Object Name) -join ', ')" }
      $printer = $match.Name
    }
    if ($sumatra) {
      $sa = @()
      if ($printer) { $sa += @('-print-to', "`"$printer`"") } else { $sa += '-print-to-default' }
      $sa += @('-print-settings', "`"${copies}x`"", '-silent', '-exit-when-done', "`"$file`"")
      $p = Start-Process -FilePath $sumatra -ArgumentList $sa -PassThru -WindowStyle Hidden
      if (-not $p.WaitForExit(120000)) { try { $p.Kill() } catch {}; throw 'Printing took too long.' }
    } else {
      if ($printer -or $copies -gt 1) { throw 'Install SumatraPDF to choose a printer or print several copies.' }
      Start-Process -FilePath $file -Verb Print -WindowStyle Hidden | Out-Null
      Start-Sleep -Seconds 15
    }
    $where = if ($printer) { $printer } else { ((Get-CimInstance Win32_Printer | Where-Object Default | Select-Object -First 1).Name) }
    return "Sent $copies cop$(if ($copies -eq 1) {'y'} else {'ies'}) to $where."
  } finally { Start-Sleep -Seconds 2; Remove-Item $file -Force -ErrorAction SilentlyContinue }
}

function Do-BernudCommand([object]$c) {
  $t = [string]$c.target; $v = [string]$c.value
  if ($Role -eq 'work' -and $WorkActions -notcontains $c.action) { throw "Not allowed on the work laptop (only printing, opening documents and status)." }
  switch ($c.action) {
    'print'        { return Print-Document $t $v }
    'list_printers' { return List-Printers }
    'status'       { return "Online: $env:COMPUTERNAME ($Role)" }
    'open_app'     { return Open-App $t }
    'close_app'    { return Close-App $t }
    'open_url'     { $u = if ($t) { $t } else { $v }; if ($u -notmatch '^https?://') { $u = "https://$u" }; Start-Process $u; return "Opened $u." }
    'media'        { return Media "$t $v" }
    'volume'       { return Set-Volume $t $v }
    'power'        { return Power "$t $v".Trim() }
    'run_script'   { return Run-Script $t }
    'list_scripts' { $n = (@(Get-Scripts) | ForEach-Object Name) -join ', '; if ($n) { return "Approved scripts: $n" } else { return 'No scripts approved yet. Add them to config.json.' } }
    'list_windows' { return List-Windows }
    'type_text'    { return Type-Text ("$t$v") }
    'say'          { return Say ("$t $v".Trim()) }
    'powershell'   { if ($Config.allow_powershell -eq $false) { throw 'Free-form commands are switched off in config.json.' }; return Run-PowerShell ("$t $v".Trim()) }
    'system_info'  { return System-Info }
    default        { throw "Unknown action '$($c.action)'." }
  }
}

function Post-Result($id, [bool]$ok, [string]$output) {
  $body = [Text.Encoding]::UTF8.GetBytes((@{ id = $id; ok = $ok; output = $output } | ConvertTo-Json -Compress))
  Invoke-RestMethod -Method Post -Uri "$Server/device/pc/result" -Headers $Headers -ContentType 'application/json; charset=utf-8' -Body $body -TimeoutSec 20 | Out-Null
}

# ---------------- Main loop ----------------
Log "Bernud PC helper $Version started on $env:COMPUTERNAME"
$pollUrl = "$Server/device/pc/poll?host=$([uri]::EscapeDataString($env:COMPUTERNAME))&v=$Version&role=$Role"
$backoff = 5
while ($true) {
  try {
    $r = Invoke-RestMethod -Uri $pollUrl -Headers $Headers -TimeoutSec 45
    $backoff = 5
    if ($r -and $r.command) {
      $c = $r.command
      Log "command: $($c.action) | $($c.target) | $($c.value)"
      try { $out = Do-BernudCommand $c; Post-Result $c.id $true ([string]$out); Log "  ok: $out" }
      catch { $msg = $_.Exception.Message; Post-Result $c.id $false $msg; Log "  failed: $msg" }
    }
  } catch {
    Log "connection problem: $($_.Exception.Message) (retrying in $backoff s)"
    Start-Sleep -Seconds $backoff
    $backoff = [math]::Min($backoff * 2, 60)
  }
}
