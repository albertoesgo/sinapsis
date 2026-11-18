#!/usr/bin/env node
// Línea de estado de Claude Code (terminal) que además le pasa a Sinapsis tus porcentajes reales del plan.
// Claude Code entrega en cada respuesta `rate_limits` (5 h y semana, los mismos de /usage): se guardan en
// ~/.sinapsis/usage.json y Sinapsis deja de estimar. No usa claves ni red.
import { addReading, fromStatusLine } from '../server/usage.js';

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  let j = {};
  try { j = JSON.parse(raw || '{}'); } catch { /* entrada vacía */ }
  try { addReading(fromStatusLine(j.rate_limits)); } catch { /* sin permiso de escritura: solo se muestra */ }
  const pct = (x) => (x == null ? null : `${Math.round(x)} %`);
  const parts = [];
  const h5 = pct(j.rate_limits?.five_hour?.used_percentage);
  const wk = pct(j.rate_limits?.seven_day?.used_percentage);
  const cx = pct(j.context_window?.used_percentage);
  if (h5) parts.push(`5 h ${h5}`);
  if (wk) parts.push(`semana ${wk}`);
  if (cx) parts.push(`contexto ${cx}`);
  const model = j.model?.display_name;
  process.stdout.write([model, ...parts].filter(Boolean).join(' · '));
});
