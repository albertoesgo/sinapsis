#!/usr/bin/env bash
set -euo pipefail
LABEL="com.sinapsis.server"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
echo "Servicio de Sinapsis eliminado. (La caché sigue en ~/.sinapsis; bórrala si quieres.)"
