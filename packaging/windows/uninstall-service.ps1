# Deelos Print Agent Windows auto-start uninstaller

param(
  [string]$InstallDir = "C:\Program Files\Deelos Print Agent"
)

$TaskBoot = "DeelosPrintAgent"
$TaskLogon = "DeelosPrintAgentLogon"
$RegRunPath = "HKLM:\Software\Microsoft\Windows\CurrentVersion\Run"
$RegRunName = "DeelosPrintAgent"
$ExePath = Join-Path $InstallDir "deelos-print-agent.exe"
$LauncherPath = Join-Path $InstallDir "run-agent-hidden.vbs"

try { schtasks.exe /End /TN $TaskBoot 2>$null | Out-Null } catch {}
try { schtasks.exe /End /TN $TaskLogon 2>$null | Out-Null } catch {}
try { schtasks.exe /Delete /TN $TaskBoot /F 2>$null | Out-Null } catch {}
try { schtasks.exe /Delete /TN $TaskLogon /F 2>$null | Out-Null } catch {}

try {
  Stop-Service -Name "DeelosPrintAgent" -Force -ErrorAction SilentlyContinue
  sc.exe delete "DeelosPrintAgent" | Out-Null
} catch {}

try {
  Remove-ItemProperty -Path $RegRunPath -Name $RegRunName -ErrorAction SilentlyContinue
} catch {}

try {
  $processes = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    ($_.Name -ieq "deelos-print-agent.exe") -or
    ($_.ExecutablePath -and ($_.ExecutablePath -ieq $ExePath)) -or
    ($_.CommandLine -and ($_.CommandLine -like "*$ExePath*"))
  }
  foreach ($p in $processes) {
    try { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
  }
} catch {}

try { Remove-Item -Path $LauncherPath -Force -ErrorAction SilentlyContinue } catch {}
exit 0
