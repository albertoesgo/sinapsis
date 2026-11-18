// Uso real del plan: lecturas del porcentaje que da Anthropic, guardadas en ~/.sinapsis/usage.json.
// Fuentes, de menos a más automática:
//   · 'manual'      lo escribes tú en Sinapsis (lo que ves en Claude → Ajustes → Uso).
//   · 'claude-code' la línea de estado de Claude Code en la terminal (scripts/statusline.mjs): Claude Code
//                   le pasa tus porcentajes reales en cada respuesta. No usa claves ni red.
//   · 'anthropic'   opcional (usoReal: true en ~/.sinapsis/config.json): Sinapsis pregunta a Anthropic con la
//                   sesión que Claude Code guarda en el llavero de macOS, igual que hace /usage. El token
//                   no se guarda ni se envía a ningún otro sitio. Desactivado por defecto.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

export const USAGE_FILE = process.env.SINAPSIS_USAGE || path.join(os.homedir(), '.sinapsis', 'usage.json');
const KEEP = 300;

export function readReadings(file = USAGE_FILE) {
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(j.readings) ? j.readings : []; } catch { return []; }
}

const same = (a, b) => (!a && !b) || (a && b && Math.round(a.pct) === Math.round(b.pct) && Math.abs(a.reset - b.reset) < 120e3);

/** Añade una lectura (sin duplicar la misma cifra seguida) con escritura atómica. */
export function addReading(r, file = USAGE_FILE) {
  if (!r || (!r.h5 && !r.week)) return false;
  const list = readReadings(file);
  const last = list[list.length - 1];
  if (last && last.src === r.src && same(last.h5, r.h5) && same(last.week, r.week) && r.ts - last.ts < 15 * 60e3) return false;
  list.push(r);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ readings: list.slice(-KEEP) }));
  fs.renameSync(tmp, file);
  return true;
}

const win = (pct, reset) => (Number.isFinite(pct) && Number.isFinite(reset) ? { pct: Math.max(0, Math.min(100, pct)), reset } : null);

/** Desde la entrada de la línea de estado de Claude Code (`rate_limits`, resets_at en segundos). */
export function fromStatusLine(rl, ts = Date.now()) {
  if (!rl) return null;
  return { ts, src: 'claude-code', h5: win(rl.five_hour?.used_percentage, rl.five_hour?.resets_at * 1000), week: win(rl.seven_day?.used_percentage, rl.seven_day?.resets_at * 1000) };
}

/** Desde la respuesta de /api/oauth/usage (utilization 0-100, resets_at ISO). */
export function fromUsageApi(j, ts = Date.now()) {
  if (!j) return null;
  return { ts, src: 'anthropic', h5: win(j.five_hour?.utilization, Date.parse(j.five_hour?.resets_at)), week: win(j.seven_day?.utilization, Date.parse(j.seven_day?.resets_at)) };
}

/** Lo que escribes tú: porcentajes y, si no se dan, los reinicios que ya conoce Sinapsis. */
export function manualReading({ h5, week }, plan, ts = Date.now()) {
  const n = (v) => (v === '' || v == null ? NaN : Number(String(v).replace(',', '.')));
  return { ts, src: 'manual', h5: win(n(h5), plan?.h5?.end || NaN), week: win(n(week), plan?.week?.end || NaN) };
}

/** Consulta opcional a Anthropic con la sesión de Claude Code del llavero (solo macOS). */
export function pollAnthropic({ onReading, log = () => {} }) {
  let backoff = 0;
  const once = () => {
    if (Date.now() < backoff) return;
    execFile('/usr/bin/security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], { timeout: 5000 }, async (err, out) => {
      if (err) { log('uso real: no se pudo leer la sesión de Claude Code del llavero'); backoff = Date.now() + 30 * 60e3; return; }
      let tok;
      try { const o = JSON.parse(out).claudeAiOauth; if (o?.expiresAt && o.expiresAt < Date.now()) { backoff = Date.now() + 10 * 60e3; return; } tok = o?.accessToken; } catch { /* formato desconocido */ }
      if (!tok) { backoff = Date.now() + 30 * 60e3; return; }
      try {
        const r = await fetch('https://api.anthropic.com/api/oauth/usage', { headers: { Authorization: `Bearer ${tok}`, 'anthropic-beta': 'oauth-2025-04-20', 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(8000) });
        if (!r.ok) { log(`uso real: Anthropic respondió ${r.status}`); backoff = Date.now() + (r.status === 401 ? 10 : 30) * 60e3; return; }
        onReading(fromUsageApi(await r.json()));
      } catch (e) { log('uso real: ' + e.message); }
    });
  };
  once();
  return setInterval(once, 5 * 60e3);
}
