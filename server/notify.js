// Avisos fuera del navegador.
// - macOS: notificación nativa del sistema (local, no sale nada del ordenador).
// - ntfy (opcional, desactivado por defecto): notificación push al móvil con la app ntfy.
//   Envía solo el título y el texto del aviso (nombre del proyecto y tamaño del contexto) al servidor ntfy elegido.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';

export const CONFIG_FILE = path.join(os.homedir(), '.sinapsis', 'config.json');
const DEFAULTS = { macNotify: true, ntfy: null, ntfyServer: 'https://ntfy.sh', weeklyReport: true, weeklyDay: 1, weeklyHour: 9 };

export function loadConfig() {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) }; } catch { return { ...DEFAULTS }; }
}

export function notify(cfg, title, body) {
  const clean = (s) => String(s).replace(/[\r\n]+/g, ' ').slice(0, 240);
  if (cfg.macNotify && process.platform === 'darwin') {
    const script = `display notification ${JSON.stringify(clean(body))} with title "Sinapsis" subtitle ${JSON.stringify(clean(title))}`;
    execFile('osascript', ['-e', script], () => {});
  }
  if (cfg.ntfy) {
    const url = `${cfg.ntfyServer.replace(/\/$/, '')}/${encodeURIComponent(cfg.ntfy)}?title=${encodeURIComponent(clean(title))}&tags=brain`;
    fetch(url, { method: 'POST', body: clean(body) }).catch(() => {});
  }
}
