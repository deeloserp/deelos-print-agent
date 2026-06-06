# One-click production build for Deelos Print Agent

This project includes a GitHub Actions workflow that builds the real production packages on the correct operating systems.

## Why use GitHub Actions?

Windows setup installers should be compiled on Windows because Inno Setup runs on Windows.
macOS pkg installers should be compiled on macOS because `pkgbuild` is a macOS tool.

## Steps

1. Create a private GitHub repository, for example `deelos-print-agent`.
2. Upload all files in this folder to the repository.
3. Go to **Actions**.
4. Open **Build Deelos Print Agent Packages**.
5. Click **Run workflow**.
6. Wait for the builds to finish.
7. Download the artifacts.

## Output artifacts

Windows:

```text
Deelos Print Agent Setup.exe
deelos-print-agent.exe
```

macOS Apple Silicon:

```text
Deelos Print Agent ARM64.pkg
deelos-print-agent
```

macOS Intel:

```text
Deelos Print Agent Intel.pkg
deelos-print-agent
```

## After installing on client computer

Check:

```text
http://127.0.0.1:4789/health
http://127.0.0.1:4789/printers
```

The agent should start automatically after boot.
