#!/usr/bin/env bash
# Instala la skill «contexto-proyectos» en Claude Code (~/.claude/skills) apuntando a esta copia de Sinapsis.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/contexto-proyectos"
mkdir -p "$DEST"
sed "s#__SINAPSIS__#$ROOT#g" "$ROOT/skills/contexto-proyectos/SKILL.md" > "$DEST/SKILL.md"
echo "· Skill instalada en $DEST"
echo "· Claude Code la usará antes de explorar un proyecto: node $ROOT/scripts/donde.mjs \"<tarea>\""
