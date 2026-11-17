// Formato y utilidades compartidas por los paneles.
import * as THREE from 'three';

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const usd = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
export const usd0 = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
export const money = (x) => (x >= 100 ? usd0 : usd).format(x || 0);
export function tok(n) {
  n = n || 0;
  if (n >= 1e9) return (n / 1e9).toLocaleString('es-ES', { maximumFractionDigits: 2 }) + ' G';
  if (n >= 1e6) return (n / 1e6).toLocaleString('es-ES', { maximumFractionDigits: 1 }) + ' M';
  if (n >= 1e3) return (n / 1e3).toLocaleString('es-ES', { maximumFractionDigits: 1 }) + ' k';
  return String(Math.round(n));
}
export const sumTok = (t) => (t ? t.in + t.cr + t.cw + t.out : 0);
export function ago(ts) {
  if (!ts) return 'nunca';
  const s = (Date.now() - ts) / 1000;
  if (s < 45) return 'ahora';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  const d = Math.round(s / 86400);
  return d === 1 ? 'ayer' : `hace ${d} días`;
}
export function inTime(ts) {
  const m = Math.max(0, Math.round((ts - Date.now()) / 60e3));
  if (m < 60) return `en ${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  if (h < 48) return `en ${h} h${r ? ` ${r} min` : ''}`;
  return `en ${Math.round(h / 24)} días`;
}
export const hhmm = (ts) => new Date(ts).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
export const hm = (ts) => new Date(ts).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
export const wday = (ts) => new Date(ts).toLocaleDateString('es-ES', { weekday: 'long' });
export const dayKey = (ts) => new Date(ts).toLocaleDateString('sv-SE');
export const pctTxt = (x) => `${Math.round(x * 100)} %`;
export const cssColor = (c) => '#' + c.getHexString();
export const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function stateOf(last) {
  if (!last) return ['nunca', 'Sin usar'];
  const s = Date.now() - last;
  if (s < 10 * 60e3) return ['vivo', 'En uso'];
  if (s < 24 * 3600e3) return ['hoy', 'Activa hoy'];
  if (s < 7 * 86400e3) return ['semana', 'Esta semana'];
  return ['dormida', 'Dormida'];
}
export async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* http en la wifi: sin portapapeles moderno */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

export const CTX = { warn: 100000, high: 200000, max: 600000 };
export const ctxLevel = (c) => (c >= CTX.high ? 'high' : c >= CTX.warn ? 'warn' : 'ok');
export const LIVE_MS = 30 * 60e3;
export const levelOf = (p) => (p == null ? 'none' : p >= 0.9 ? 'bad' : p >= 0.7 ? 'warn' : 'ok');

export const CH = [
  { key: 'prompt', label: 'Entrada', color: '#f4f1ea' },
  { key: 'thought', label: 'Razonamiento', color: '#ffcf8a' },
  { key: 'tool', label: 'Acción', color: '#b993ff' },
  { key: 'agent', label: 'Subagentes', color: '#ff9a5c' },
];

export const FOLD_KEY = 'sinapsis.folded';

export const STOP = { end_turn: 'terminó el turno', tool_use: 'usar una herramienta', max_tokens: 'límite de tokens', refusal: 'rechazo', pause_turn: 'pausa' };
export function prettyM(m = '') {
  const s = m.replace(/^claude-/, '');
  const [f, ...v] = s.split('-');
  return f ? f[0].toUpperCase() + f.slice(1) + (v.length ? ' ' + v.join('.') : '') : m;
}

export const REGION_OF = { session: 'corteza', model: 'tálamo', tool: 'corteza motora', skill: 'cerebelo', agent: 'giro cingulado', mcp: 'lóbulo parietal', memory: 'hipocampo', input: 'tronco encefálico' };
export const REGIONS = [
  { name: 'Corteza prefrontal', sub: 'proyectos que planifican', pos: new THREE.Vector3(0, 3.6, 6.9) },
  { name: 'Corteza premotora', sub: 'proyectos que ejecutan', pos: new THREE.Vector3(4.4, 5.1, 3.2) },
  { name: 'Corteza motora', sub: 'herramientas', pos: new THREE.Vector3(0, 6.0, 0.6) },
  { name: 'Lóbulo temporal izq.', sub: 'proyectos de lenguaje', pos: new THREE.Vector3(-6.6, -2.4, 0.4) },
  { name: 'Lóbulo occipital', sub: 'proyectos visuales', pos: new THREE.Vector3(0, 1.6, -7.6) },
  { name: 'Lóbulo parietal', sub: 'conectores', pos: new THREE.Vector3(0, 5.2, -3.6) },
  { name: 'Cerebelo', sub: 'skills', pos: new THREE.Vector3(0, -4.4, -5.6) },
  { name: 'Tálamo', sub: 'modelos', pos: new THREE.Vector3(0, 0.2, 0.2) },
  { name: 'Giro cingulado', sub: 'subagentes', pos: new THREE.Vector3(0, 3.6, -1.2) },
  { name: 'Hipocampo', sub: 'memoria', pos: new THREE.Vector3(2.6, -2.3, -0.4) },
  { name: 'Tronco encefálico', sub: 'tus peticiones', pos: new THREE.Vector3(0, -7.7, -2.5) },
];
