# Deelos Print Agent Windows auto-start installer
# This script is run by the Inno Setup installer as Administrator.
# It installs the Print Agent as a Windows startup task that runs as SYSTEM.
# We use Task Scheduler because the packaged Node executable is a normal long-running app,
# not a native Windows Service executable that talks to the Service Control Manager.

$ErrorActionPreference = "Stop"

$InstallDir = "C:\Program Files\Deelos Print Agent"
$ExePath = Join-Path $InstallDir "deelos-print-agent.exe"
$ServiceName = "DeelosPrintAgent"
$TaskName = "DeelosPrintAgent"
$TaskDescription = "Local Deelos ERP POS direct print agent. Listens on 127.0.0.1:4789."

function Write-Step($Message) {
  Write-Host "[Deelos Print Agent] $Message"
}

function Stop-OldService {
  $existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  if ($existing) {
    Write-Step "Stopping old Windows service..."
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1

    Write-Step "Removing old Windows service..."
    sc.exe delete $ServiceName | Out-Null
    Start-Sleep -Seconds 2
  }
}

function Stop-OldTask {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($task) {
    Write-Step "Stopping existing startup task..."
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

    Write-Step "Removing existing startup task..."
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
  }
}

function Stop-RunningAgentProcesses {
  Write-Step "Stopping any running agent process..."

  $processes = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    ($_.ExecutablePath -and ($_.ExecutablePath -ieq $ExePath)) -or
    ($_.CommandLine -and ($_.CommandLine -like "*$ExePath*"))
  }

  foreach ($p in $processes) {
    try {
      Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    } catch {}
  }
}

if (!(Test-Path $ExePath)) {
  throw "Agent executable not found: $ExePath"
}

if (!(Test-Path $InstallDir)) {
  New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

$LogDir = Join-Path $InstallDir "logs"
if (!(Test-Path $LogDir)) {
  New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

Stop-OldTask
Stop-OldService
Stop-RunningAgentProcesses

Write-Step "Creating Windows startup task..."

$action = New-ScheduledTaskAction `
  -Execute $ExePath `
  -WorkingDirectory $InstallDir

$trigger = New-ScheduledTaskTrigger -AtStartup

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1)

$principal = New-ScheduledTaskPrincipal `
  -UserId "SYSTEM" `
  -LogonType ServiceAccount `
  -RunLevel Highest

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Description $TaskDescription `
  -Force | Out-Null

Write-Step "Starting Deelos Print Agent now..."
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 3

$taskState = (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue).State
Write-Step "Startup task state: $taskState"
Write-Step "Installed and configured for automatic startup."
Write-Step "Health: http://127.0.0.1:4789/health"
Write-Step "Printers: http://127.0.0.1:4789/printers"
