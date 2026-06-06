#!/bin/bash
# Deelos Print Agent macOS uninstaller script.
# Run with sudo.

set -e

APP_DIR="/Library/Application Support/Deelos Print Agent"
PLIST="/Library/LaunchDaemons/com.deelos.printagent.plist"

launchctl unload "$PLIST" 2>/dev/null || true

rm -f "$PLIST"
rm -rf "$APP_DIR"

echo "Deelos Print Agent removed."
