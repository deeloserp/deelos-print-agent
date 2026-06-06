# Deelos Print Agent Production Package

This package contains the production-ready Deelos Print Agent source and packaging files for Windows and macOS.

## Standard endpoint

The agent listens on:

```text
http://127.0.0.1:4789
```

Deelos POS should call:

```text
http://127.0.0.1:4789/print
```

Health check:

```text
http://127.0.0.1:4789/health
```

Printer discovery:

```text
http://127.0.0.1:4789/printers
```

## Development run

```bash
npm install
npm start
```

## Build executable files

Install dependencies:

```bash
npm install
```

Build Windows executable:

```bash
npm run build:win
```

Build macOS executable:

```bash
npm run build:mac-arm64
```

For Intel Mac:

```bash
npm run build:mac-x64
```

## Windows production installer

Build the Windows executable first:

```bash
npm run build:win
```

Then open this file in Inno Setup on a Windows machine:

```text
packaging/windows/deelos-print-agent.iss
```

Compile it. It will produce:

```text
release/windows/Deelos Print Agent Setup.exe
```

When the client runs the setup, it will:

```text
Install files into C:\Program Files\Deelos Print Agent
Create Windows Service: DeelosPrintAgent
Set it to Automatic startup
Start it immediately
Restart it automatically if it crashes
```

## macOS production package

Build the macOS executable:

```bash
npm run build:mac-arm64
```

Then build the pkg:

```bash
bash packaging/macos/build-pkg.sh arm64
```

For Intel Mac:

```bash
bash packaging/macos/build-pkg.sh x64
```

It will produce:

```text
release/macos/Deelos Print Agent.pkg
```

When the client installs it, macOS will:

```text
Install files into /Library/Application Support/Deelos Print Agent
Create LaunchDaemon: com.deelos.printagent
Start the agent automatically
Keep it alive in the background
```

## Manual Windows service install

After copying the executable and config.json to:

```text
C:\Program Files\Deelos Print Agent
```

Run PowerShell as Administrator:

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Program Files\Deelos Print Agent\service\install-service.ps1"
```

## Manual macOS install

From the folder containing the built macOS binary:

```bash
sudo bash packaging/macos/install-macos.sh
```

## Important

The Print Agent is not a printer driver.

For USB/shared printers, the printer must be installed in Windows/macOS first. Then check:

```text
http://127.0.0.1:4789/printers
```

Use the exact printer name in Deelos Print Station config.

For network printers, use:

```text
connection_type = network
printer_ip = printer IP
printer_port = 9100
```

## Log files

Windows:

```text
C:\Program Files\Deelos Print Agent\logs\agent.log
```

macOS:

```text
/Library/Application Support/Deelos Print Agent/logs/agent.log
/Library/Logs/Deelos Print Agent/agent.out.log
/Library/Logs/Deelos Print Agent/agent.err.log
```
