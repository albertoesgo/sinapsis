#!/usr/bin/env bash
# Instala Sinapsis como servicio de macOS (launchd): arranca al iniciar sesión y se reinicia si se cae.
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"
LABEL="com.sinapsis.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PORT="${SINAPSIS_PORT:-7420}"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/.sinapsis"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$NODE</string><string>$DIR/server/index.js</string><string>--port</string><string>$PORT</string></array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$HOME/.sinapsis/sinapsis.log</string>
  <key>StandardErrorPath</key><string>$HOME/.sinapsis/sinapsis.log</string>
</dict>
</plist>
PLIST
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Sinapsis queda funcionando en segundo plano: http://localhost:$PORT"
echo "Registro: ~/.sinapsis/sinapsis.log · Para quitarlo: npm run service:uninstall"
