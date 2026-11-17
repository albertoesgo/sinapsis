#!/usr/bin/env bash
# Instala Sinapsis como servicio de macOS (launchd): arranca al iniciar sesión y se reinicia si se cae.
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"
LABEL="com.sinapsis.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PORT="${SINAPSIS_PORT:-7420}"
# --lan: accesible desde el móvil en la misma wifi (con clave secreta). Desactívalo con SINAPSIS_LAN=0.
LANARG=""
if [ "${SINAPSIS_LAN:-1}" = "1" ]; then LANARG="<string>--lan</string>"; fi
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/.sinapsis"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$NODE</string><string>$DIR/server/index.js</string><string>--port</string><string>$PORT</string>$LANARG</array>
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
# bootout es asíncrono: espera a que el servicio anterior desaparezca antes de volver a cargarlo
for _ in $(seq 1 20); do launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || break; sleep 0.5; done
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Sinapsis queda funcionando en segundo plano: http://localhost:$PORT"
echo "Registro: ~/.sinapsis/sinapsis.log · Para quitarlo: npm run service:uninstall"
if [ -n "$LANARG" ]; then echo "Móvil: abre Sinapsis en el ordenador y pulsa «Móvil» para ver el código QR."; fi
