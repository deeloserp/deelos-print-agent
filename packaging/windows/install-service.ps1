# Deelos Print Agent Windows service installer
# Run PowerShell as Administrator.

$ErrorActionPreference = "Stop"

$InstallDir = "C:\Program Files\Deelos Print Agent"
$ExePath = Join-Path $InstallDir "deelos-print-agent.exe"
$ServiceName = "DeelosPrintAgent"
$DisplayName = "Deelos Print Agent"

if (!(Test-Path $ExePath)) {
  throw "Agent executable not found: $ExePath"
}

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
  Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
  sc.exe delete $ServiceName | Out-Null
  Start-Sleep -Seconds 2
}

New-Service `
  -Name $ServiceName `
  -BinaryPathName "`"$ExePath`"" `
  -DisplayName $DisplayName `
  -Description "Local Deelos ERP POS direct print agent. Listens on 127.0.0.1:4789." `
  -StartupType Automatic

sc.exe failure $ServiceName reset= 60 actions= restart/5000/restart/5000/restart/10000 | Out-Null

Start-Service -Name $ServiceName

Write-Host "Deelos Print Agent installed and started."
Write-Host "Health: http://127.0.0.1:4789/health"
