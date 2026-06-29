# Deelos Print Agent Windows auto-start installer
# Run by the Inno Setup installer as Administrator.
# Creates multiple auto-start entries so the agent starts after boot/login reliably.

param(
  [string]$InstallDir = "C:\Program Files\Deelos Print Agent"
)

$ErrorActionPreference = "Continue"

$ExePath = Join-Path $InstallDir "deelos-print-agent.exe"
$LogDir = Join-Path $InstallDir "logs"
$InstallLog = Join-Path $LogDir "windows-autostart-install.log"
$LauncherPath = Join-Path $InstallDir "run-agent-hidden.vbs"
$TaskBoot = "DeelosPrintAgent"
$TaskLogon = "DeelosPrintAgentLogon"
$RegRunPath = "HKLM:\Software\Microsoft\Windows\CurrentVersion\Run"
$RegRunName = "DeelosPrintAgent"

function Ensure-Dir($Path) {
  if (!(Test-Path $Path)) {
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
  }
}

function Write-Step($Message) {
  Ensure-Dir $LogDir
  $line = "[{0}] {1}" -f (Get-Date).ToString("s"), $Message
  Write-Host $line
  Add-Content -Path $InstallLog -Value $line -Encoding UTF8
}

function Run-Exe($File, $Args) {
  Write-Step "RUN: $File $Args"
  $p = Start-Process -FilePath $File -ArgumentList $Args -Wait -PassThru -WindowStyle Hidden
  Write-Step "EXIT: $($p.ExitCode)"
  return $p.ExitCode
}

function Stop-OldItems {
  Write-Step "Stopping old auto-start entries and running agent processes..."

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
}

function Create-HiddenLauncher {
  Write-Step "Creating hidden launcher: $LauncherPath"

  $escapedExe = $ExePath.Replace('"', '""')
  $vbs = @"
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = "$InstallDir"
shell.Run Chr(34) & "$escapedExe" & Chr(34), 0, False
"@

  Set-Content -Path $LauncherPath -Value $vbs -Encoding ASCII -Force
}

function Create-StartupTasks {
  $wscript = Join-Path $env:WINDIR "System32\wscript.exe"
  $taskCmd = "`"$wscript`" `"$LauncherPath`""

  Write-Step "Creating boot startup task: $TaskBoot"
  Run-Exe "schtasks.exe" "/Create /F /TN `"$TaskBoot`" /SC ONSTART /RU SYSTEM /RL HIGHEST /TR `"$taskCmd`" /DELAY 0000:15" | Out-Null

  Write-Step "Creating logon fallback task: $TaskLogon"
  Run-Exe "schtasks.exe" "/Create /F /TN `"$TaskLogon`" /SC ONLOGON /RU SYSTEM /RL HIGHEST /TR `"$taskCmd`" /DELAY 0000:10" | Out-Null

  Write-Step "Creating HKLM Run fallback"
  try {
    New-Item -Path $RegRunPath -Force | Out-Null
    Set-ItemProperty -Path $RegRunPath -Name $RegRunName -Value "`"$wscript`" `"$LauncherPath`"" -Type String
  } catch {
    Write-Step "HKLM Run fallback failed: $($_.Exception.Message)"
  }
}

function Start-AgentNow {
  Write-Step "Starting Deelos Print Agent now..."
  try {
    Start-Process -FilePath $LauncherPath -WindowStyle Hidden -WorkingDirectory $InstallDir
  } catch {
    Write-Step "Hidden launcher start failed: $($_.Exception.Message)"
    try { Start-Process -FilePath $ExePath -WindowStyle Hidden -WorkingDirectory $InstallDir } catch {}
  }

  for ($i = 1; $i -le 10; $i++) {
    Start-Sleep -Seconds 1
    try {
      $res = Invoke-WebRequest -Uri "http://127.0.0.1:4789/health" -UseBasicParsing -TimeoutSec 2
      if ($res.StatusCode -eq 200) {
        Write-Step "Health check OK. Agent is running."
        return
      }
    } catch {
      Write-Step "Health check waiting... attempt $i"
    }
  }

  Write-Step "Health check did not respond yet. It may start after restart/login."
}

Ensure-Dir $LogDir
Write-Step "Installing Deelos Print Agent Windows auto-start"
Write-Step "InstallDir: $InstallDir"
Write-Step "ExePath: $ExePath"

if (!(Test-Path $ExePath)) {
  Write-Step "ERROR: Agent executable not found: $ExePath"
  exit 1
}

Stop-OldItems
Create-HiddenLauncher
Create-StartupTasks
Start-AgentNow

Write-Step "Installed. Check Task Scheduler Library for $TaskBoot and $TaskLogon."
Write-Step "Health: http://127.0.0.1:4789/health"
Write-Step "Printers: http://127.0.0.1:4789/printers"
exit 0
