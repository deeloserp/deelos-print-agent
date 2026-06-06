#!/bin/bash
# Deelos Print Agent macOS installer script.
# Run with sudo.

set -e

APP_DIR="/Library/Application Support/Deelos Print Agent"
LOG_DIR="/Library/Logs/Deelos Print Agent"
PLIST="/Library/LaunchDaemons/com.deelos.printagent.plist"

echo "Installing Deelos Print Agent..."

mkdir -p "$APP_DIR"
mkdir -p "$LOG_DIR"

# The package should place these files beside this script or already inside APP_DIR.
if [ -f "./deelos-print-agent" ]; then
  cp "./deelos-print-agent" "$APP_DIR/deelos-print-agent"
fi

if [ -f "./config.json" ]; then
  cp -n "./config.json" "$APP_DIR/config.json"
fi

if [ -f "./com.deelos.printagent.plist" ]; then
  cp "./com.deelos.printagent.plist" "$PLIST"
fi

chmod +x "$APP_DIR/deelos-print-agent"
chown -R root:wheel "$APP_DIR"
chown root:wheel "$PLIST"
chmod 644 "$PLIST"

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

echo "Deelos Print Agent installed and started."
echo "Health: http://127.0.0.1:4789/health"
