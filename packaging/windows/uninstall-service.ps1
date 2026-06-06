# Deelos Print Agent Windows service uninstaller
# Run PowerShell as Administrator.

$ErrorActionPreference = "Stop"

$ServiceName = "DeelosPrintAgent"

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
  Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
  sc.exe delete $ServiceName | Out-Null
  Start-Sleep -Seconds 2
  Write-Host "Deelos Print Agent service removed."
} else {
  Write-Host "Deelos Print Agent service was not found."
}
