#!/usr/bin/env node
// Dónde mirar para una tarea, según el historial real de Claude Code (lo aprende Sinapsis).
//
//   node scripts/donde.mjs "<tarea>"                 en la carpeta del proyecto
//   node scripts/donde.mjs --dir <ruta> "<tarea>"
//   node scripts/donde.mjs --mapa                    resumen del proyecto (ficheros clave, órdenes, tareas recientes)
//   añade --json para una salida legible por programas
//
// Lee la caché de Sinapsis (~/.sinapsis/state.json); no necesita el servidor en marcha.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { projectMap, where } from '../server/where.js';
import { buildAtlas, scope, cmdsFor } from '../server/atlas.js';

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); if (i < 0) return null; const v = args[i + 1]; args.splice(i, v && !v.startsWith('--') ? 2 : 1); return v && !v.startsWith('--') ? v : true; };
const asJson = !!flag('--json');
const mapa = !!flag('--mapa');
const dir = path.resolve(String(flag('--dir') || process.cwd()));
const limit = Number(flag('--limit') || 8);
const query = args.join(' ').trim();
const STATE = process.env.SINAPSIS_STATE || path.join(os.homedir(), '.sinapsis', 'state.json');

function bail(msg) {
  if (asJson) console.log(JSON.stringify({ error: msg }));
  else console.log(`Sinapsis · ${msg}`);
  process.exit(0); // nunca rompe el flujo de quien lo llama: sin datos, se explora como siempre
}

let state;
try { state = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { bail('no hay datos todavía (¿está instalado y en marcha Sinapsis?). Explora el proyecto como siempre.'); }
// el atlas reparte lo hecho desde carpetas paraguas (p. ej. ~/Proyectos) en el proyecto real de cada fichero
const sc = scope(buildAtlas(state, { home: os.homedir() }), dir);
if (!sc) bail(`no conozco ${dir}: aún no hay historial de Claude Code en esta carpeta. Explora como siempre.`);
const p = sc.project;

// Si estás en una subcarpeta del proyecto, solo cuenta lo de esa subcarpeta y las rutas salen relativas a ella
const sub = sc.sub ? sc.sub + '/' : '';
const scoped = sub ? {
  ...p,
  files: Object.fromEntries(Object.entries(p.files || {}).filter(([f]) => f.startsWith(sub)).map(([f, v]) => [f.slice(sub.length), v])),
  cmds: Object.fromEntries(Object.entries(p.cmds || {}).flatMap(([k, n]) => {
    const [d, c] = k.includes('\t') ? k.split('\t') : ['', k];
    if (d === sub.slice(0, -1)) return [[c, n]];
    if (d.startsWith(sub)) return [[`${d.slice(sub.length)}\t${c}`, n]];
    return [];
  })),
  turns: (p.turns || []).map((t) => ({ ...t, f: Object.fromEntries(Object.entries(t.f || {}).filter(([f]) => f.startsWith(sub)).map(([f, v]) => [f.slice(sub.length), v])) })).filter((t) => Object.keys(t.f).length),
} : p;
const name = sub ? `${p.name}/${sub.slice(0, -1)}` : sc.mode === 'all' ? `${p.name} (todos sus proyectos)` : p.name;
const day = (ts) => new Date(ts).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
const stars = (s) => (s > 0.66 ? '★★★' : s > 0.33 ? '★★ ' : '★  ');
const nf = (n) => (Math.round(n * 10) / 10).toLocaleString('es-ES');

if (mapa || !query) {
  const m = projectMap(scoped, { files: 15, cmds: 8, tasks: 8 });
  if (asJson) { console.log(JSON.stringify({ project: name, ...m })); process.exit(0); }
  console.log(`Sinapsis · mapa de «${name}» (${m.turns} peticiones registradas)\n`);
  if (m.hot.length) {
    console.log('Ficheros clave (más leídos y editados):');
    const w = Math.min(56, Math.max(...m.hot.map((h) => h.rel.length)));
    for (const h of m.hot) console.log(`  ${h.rel.padEnd(w)}  ${h.r} lect. · ${h.e} edic.`);
  } else console.log('Aún no hay ficheros registrados.');
  if (m.cmds.length) console.log(`\nCómo se ejecuta: ${m.cmds.map(([c]) => c).join(' · ')}`);
  if (m.recent.length) {
    console.log('\nTareas recientes:');
    for (const t of m.recent) console.log(`  · ${day(t.ts)} «${t.text}»${t.files.length ? ' → ' + t.files.join(', ') : ''}`);
  }
  if (m.explore != null) console.log(`\nAntes de editar, Claude dedica de media ${nf(m.explore)} pasos a buscar en este proyecto.`);
  process.exit(0);
}

const r = where(scoped, query, { limit });
if (asJson) { console.log(JSON.stringify({ project: name, ...r })); process.exit(0); }
console.log(`Sinapsis · dónde mirar en «${name}» para: ${query}\n`);
if (!r.files.length) {
  console.log('No hay peticiones parecidas ni ficheros con ese nombre en el historial: explora como siempre.');
} else {
  console.log('Empieza por:');
  const w = Math.min(56, Math.max(...r.files.map((f) => f.rel.length)));
  for (const f of r.files) console.log(`  ${f.rel.padEnd(w)}  ${stars(f.score)}  ${f.r} lect. · ${f.e} edic.${f.why ? `  ← «${f.why.slice(0, 60)}${f.why.length > 60 ? '…' : ''}»` : ''}`);
}
if (r.similar.length) {
  console.log('\nPeticiones parecidas:');
  for (const t of r.similar) console.log(`  · ${day(t.ts)} «${t.text}»${t.files.length ? ' → ' + t.files.join(', ') : ''}`);
}
const cmds = sc.mode === 'all' ? cmdsFor(r.cmds, r.files) : r.cmds;
if (cmds.length) console.log(`\nCómo se ejecuta: ${cmds.slice(0, 5).map(([c]) => c).join(' · ')}`);
console.log('\nEs una pista aprendida del historial: confirma leyendo, y lee solo las partes que necesites.');
