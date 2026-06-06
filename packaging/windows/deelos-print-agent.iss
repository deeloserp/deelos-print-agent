; Inno Setup script for Deelos Print Agent
; Build this on Windows after creating dist/windows/deelos-print-agent.exe.
; Requires Inno Setup: https://jrsoftware.org/isinfo.php

#define MyAppName "Deelos Print Agent"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Jodsuns Technology"
#define MyAppExeName "deelos-print-agent.exe"

[Setup]
AppId={{BD7C9D91-2C4F-4B63-BE16-DEELOS4789}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\Deelos Print Agent
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=..\..\release\windows
OutputBaseFilename=Deelos Print Agent Setup
Compression=lzma
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
UninstallDisplayIcon={app}\{#MyAppExeName}

[Files]
Source: "..\..\dist\windows\deelos-print-agent.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\config.json"; DestDir: "{app}"; Flags: ignoreversion onlyifdoesntexist
Source: "install-service.ps1"; DestDir: "{app}\service"; Flags: ignoreversion
Source: "uninstall-service.ps1"; DestDir: "{app}\service"; Flags: ignoreversion

[Dirs]
Name: "{app}\logs"

[Run]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\service\install-service.ps1"""; Flags: runhidden waituntilterminated

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\service\uninstall-service.ps1"""; Flags: runhidden waituntilterminated

[Icons]
Name: "{group}\Deelos Print Agent Health"; Filename: "http://127.0.0.1:4789/health"
Name: "{group}\Deelos Print Agent Printers"; Filename: "http://127.0.0.1:4789/printers"
