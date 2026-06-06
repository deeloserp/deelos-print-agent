#!/bin/bash
# Build macOS pkg after creating dist/macos-arm64/deelos-print-agent or dist/macos-x64/deelos-print-agent.

set -e

ARCH="${1:-arm64}"
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
PAYLOAD="$ROOT_DIR/release/macos-payload"
SCRIPTS="$ROOT_DIR/release/macos-scripts"
OUT="$ROOT_DIR/release/macos"

rm -rf "$PAYLOAD" "$SCRIPTS"
mkdir -p "$PAYLOAD/Library/Application Support/Deelos Print Agent"
mkdir -p "$SCRIPTS"
mkdir -p "$OUT"

if [ "$ARCH" = "x64" ]; then
  BIN="$ROOT_DIR/dist/macos-x64/deelos-print-agent"
else
  BIN="$ROOT_DIR/dist/macos-arm64/deelos-print-agent"
fi

cp "$BIN" "$PAYLOAD/Library/Application Support/Deelos Print Agent/deelos-print-agent"
cp "$ROOT_DIR/config.json" "$PAYLOAD/Library/Application Support/Deelos Print Agent/config.json"
cp "$ROOT_DIR/packaging/macos/com.deelos.printagent.plist" "$PAYLOAD/Library/Application Support/Deelos Print Agent/com.deelos.printagent.plist"

cat > "$SCRIPTS/postinstall" <<'POSTINSTALL'
#!/bin/bash
set -e
APP_DIR="/Library/Application Support/Deelos Print Agent"
LOG_DIR="/Library/Logs/Deelos Print Agent"
PLIST="/Library/LaunchDaemons/com.deelos.printagent.plist"

mkdir -p "$LOG_DIR"
cp "$APP_DIR/com.deelos.printagent.plist" "$PLIST"

chmod +x "$APP_DIR/deelos-print-agent"
chown -R root:wheel "$APP_DIR"
chown root:wheel "$PLIST"
chmod 644 "$PLIST"

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

exit 0
POSTINSTALL

chmod +x "$SCRIPTS/postinstall"

pkgbuild \
  --root "$PAYLOAD" \
  --scripts "$SCRIPTS" \
  --identifier "com.deelos.printagent" \
  --version "1.0.0" \
  --install-location "/" \
  "$OUT/Deelos Print Agent.pkg"

echo "Created: $OUT/Deelos Print Agent.pkg"
