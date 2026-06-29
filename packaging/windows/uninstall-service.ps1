# Deelos Print Agent Windows auto-start uninstaller
# Removes both the new scheduled task and any older Windows service installation.

$ErrorActionPreference = "SilentlyContinue"

$InstallDir = "C:\Program Files\Deelos Print Agent"
$ExePath = Join-Path $InstallDir "deelos-print-agent.exe"
$ServiceName = "DeelosPrintAgent"
$TaskName = "DeelosPrintAgent"

Write-Host "[Deelos Print Agent] Removing startup task..."
Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

Write-Host "[Deelos Print Agent] Removing old Windows service if present..."
Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
sc.exe delete $ServiceName | Out-Null

Write-Host "[Deelos Print Agent] Stopping running agent process..."
$processes = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  ($_.ExecutablePath -and ($_.ExecutablePath -ieq $ExePath)) -or
  ($_.CommandLine -and ($_.CommandLine -like "*$ExePath*"))
}

foreach ($p in $processes) {
  try {
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
  } catch {}
}

Write-Host "[Deelos Print Agent] Removed."
