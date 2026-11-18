// Vault de Obsidian generado a partir de la actividad real: una nota por proyecto, skill, conector y zona
// del cerebro, enlazadas entre sí. Sirve para dos cosas:
//  · Claude (con la skill contexto-proyectos o donde.mjs) sabe dónde mirar sin explorar a ciegas.
//  · Tú lo abres en Obsidian y la vista de grafo es el mismo cerebro que Sinapsis, en notas.
// Solo escribe en sus carpetas (Proyectos, Skills, Conectores, Zonas) y en Inicio.md; tus notas no se tocan.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { projectMap } from './where.js';
import { buildAtlas, asProject, related } from './atlas.js';

const ZONES = {
  plan: { name: 'Corteza prefrontal', fn: 'planificar y razonar', why: 'planificación, decisiones y razonamiento' },
  exec: { name: 'Corteza premotora', fn: 'ejecutar y construir', why: 'preparar y encadenar acciones, junto a la corteza motora' },
  lang: { name: 'Lóbulo temporal izquierdo', fn: 'leer, investigar y escribir', why: 'comprensión del lenguaje, lateralizada a la izquierda' },
  vision: { name: 'Lóbulo occipital', fn: 'trabajar con imágenes', why: 'corteza visual' },
};
const FIXED = [
  ['Tálamo', 'Los modelos: todo pensamiento pasa por aquí.'],
  ['Corteza motora', 'Las herramientas (Bash, Read, Edit…).'],
  ['Cerebelo', 'Las skills: memoria procedimental, lo que Claude sabe hacer.'],
  ['Lóbulo parietal', 'Los conectores MCP: integran lo que llega de fuera.'],
  ['Hipocampo', 'La memoria persistente de cada proyecto.'],
];
const MANAGED = ['Proyectos', 'Skills', 'Conectores', 'Zonas'];

const safe = (s) => String(s || 'sin nombre').replace(/[\\/:*?"<>|#^[\]]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80);
const link = (folder, name, label) => `[[${folder}/${safe(name)}${label && label !== safe(name) ? '|' + label : ''}]]`;
const day = (ts) => (ts ? new Date(ts).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const iso = (ts) => (ts ? new Date(ts).toISOString().slice(0, 10) : '');
const usd = (x) => (x || 0).toLocaleString('es-ES', { style: 'currency', currency: 'USD', maximumFractionDigits: x >= 100 ? 0 : 2 });
const nf = (n) => (Math.round(n * 10) / 10).toLocaleString('es-ES');
const md = (s) => String(s || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** Zona principal de cada proyecto (misma regla que el cerebro: lo que más destaca frente a la media). */
function zones(projects) {
  const g = { plan: 0, exec: 0, lang: 0, vision: 0 };
  for (const p of projects) for (const k in g) g[k] += p.prof?.[k] || 0;
  const gt = Object.values(g).reduce((a, b) => a + b, 0) || 1;
  const out = new Map();
  for (const p of projects) {
    const t = Object.values(p.prof || {}).reduce((a, b) => a + b, 0);
    if (!t) { out.set(p.key, { main: 'exec', share: 0, avg: g.exec / gt }); continue; }
    const lift = Object.fromEntries(Object.keys(g).map((k) => [k, ((p.prof[k] || 0) / t) / ((g[k] / gt) || 1)]));
    const main = Object.keys(lift).sort((a, b) => lift[b] - lift[a])[0];
    out.set(p.key, { main, share: (p.prof[main] || 0) / t, avg: g[main] / gt });
  }
  return out;
}

function lines(abs) {
  try {
    const st = fs.statSync(abs);
    if (st.size > 4e6) return null;
    const buf = fs.readFileSync(abs);
    if (buf.includes(0)) return null; // binario
    let n = 0;
    for (const b of buf) if (b === 10) n++;
    return n + 1;
  } catch { return null; }
}

function cost30(state, key) {
  let c = 0;
  const cut = new Date(Date.now() - 29 * 86400e3).toLocaleDateString('sv-SE');
  for (const [d, v] of Object.entries(state.daily || {})) if (d >= cut) c += v.byProject?.[key] || 0;
  return c;
}

export function buildVault(state, inventory = {}, dir = path.join(os.homedir(), '.sinapsis', 'vault'), { atlas = buildAtlas(state, { home: os.homedir() }) } = {}) {
  const files = new Map(); // ruta relativa → contenido
  // el atlas reparte lo hecho desde carpetas paraguas (p. ej. ~/Proyectos) en su proyecto real
  const regionOf = (p) => { const r = p.cwd && atlas.regions.get(p.cwd); return r && !r.umbrella ? r : null; };
  const relLinks = (root) => related(atlas, root, 5).map((x) => `${link('Proyectos', x.name, x.name)} (${x.why.join(', ')})`);
  const projects = Object.values(state.projects || {}).filter((p) => p.name && (p.prompts || p.msgs)).sort((a, b) => b.last - a.last);
  const zone = zones(projects);
  const sessions = Object.values(state.sessions || {});
  const skillsUse = new Map(); // skill → {proyecto: n}
  const mcpUse = new Map();

  // ---------- proyectos ----------
  for (const p of projects) {
    const reg = regionOf(p);
    const m = projectMap(reg ? asProject(reg) : p, { files: 15, cmds: 8, tasks: 10 });
    const z = zone.get(p.key);
    const zn = ZONES[z.main];
    const ss = sessions.filter((s) => s.project === p.key && s.mainMsgs);
    const avgCtx = ss.length ? ss.reduce((a, s) => a + s.mainRead / s.mainMsgs, 0) / ss.length : 0;
    for (const [k, n] of Object.entries(p.skills || {})) { if (!skillsUse.has(k)) skillsUse.set(k, {}); skillsUse.get(k)[p.name] = n; }
    for (const [k, n] of Object.entries(p.mcps || {})) { if (!mcpUse.has(k)) mcpUse.set(k, {}); mcpUse.get(k)[p.name] = n; }

    const L = [];
    L.push('---', 'tipo: proyecto', `ruta: "${p.cwd || ''}"`, `zona: "${link('Zonas', zn.name)}"`, `sesiones: ${Object.keys(p.sessions || {}).length}`, `peticiones: ${p.prompts}`, `ultima: ${iso(p.last)}`, 'tags: [sinapsis/proyecto]', '---', '');
    L.push(`# ${p.name}`, '', '> Mapa generado por Sinapsis con el historial real de Claude Code. Se actualiza solo: escribe tus notas en otro fichero.', '');
    L.push(`**Zona:** ${link('Zonas', zn.name, zn.name)}, porque destaca en ${zn.fn} (${Math.round(z.share * 100)} % de su actividad frente al ${Math.round(z.avg * 100)} % de media).  `);
    const nS = Object.keys(p.sessions || {}).length;
    L.push(`**Actividad:** ${p.prompts} ${p.prompts === 1 ? 'petición' : 'peticiones'} · ${nS} ${nS === 1 ? 'sesión' : 'sesiones'} · última ${day(p.last)} · consumo en 30 días ≈ ${usd(cost30(state, p.key))} (equivalente API).  `);
    if (m.explore != null) L.push(`**Búsqueda antes de editar:** ${nf(m.explore)} pasos de media${m.exploreShare != null ? ` (${Math.round(m.exploreShare * 100)} % de los pasos)` : ''}.  `);
    if (avgCtx) L.push(`**Contexto medio por paso:** ${Math.round(avgCtx / 1000)} k tokens.  `);
    if (reg?.topics?.length) L.push(`**Temas:** ${reg.topics.join(', ')}.`);
    L.push('');
    const subs = [...atlas.regions.values()].filter((r) => !r.umbrella && p.cwd && r.root.startsWith(p.cwd + '/'));
    if (atlas.umbrella.includes(p.cwd) && subs.length) {
      L.push('## Contiene', '', 'Carpeta paraguas: lo que se hace desde aquí se reparte en el proyecto de cada subcarpeta.', '');
      for (const r of subs.sort((a, b) => b.last - a.last)) L.push(`- ${link('Proyectos', r.name, r.name)} · \`${r.root.slice(p.cwd.length + 1)}/\` · ${r.turns.length} tareas`);
      L.push('');
    }

    L.push('## Dónde mirar', '');
    if (m.hot.length) {
      L.push('| Fichero | Líneas | Lecturas | Ediciones | Última vez |', '|---|---:|---:|---:|---|');
      for (const h of m.hot) L.push(`| \`${md(h.rel)}\` | ${p.cwd ? (lines(path.join(p.cwd, h.rel)) ?? '—') : '—'} | ${h.r} | ${h.e} | ${day(h.last)} |`);
    } else L.push('Aún no hay ficheros registrados.');
    L.push('', `Para una tarea concreta: \`node ~/Proyectos/sinapsis/scripts/donde.mjs --dir "${p.cwd || '.'}" "<tarea>"\``, '');

    if (m.cmds.length) { L.push('## Cómo se ejecuta', ''); for (const [c, n] of m.cmds) L.push(`- \`${c}\` ×${n}`); L.push(''); }

    if (m.recent.length) {
      L.push('## Tareas recientes', '');
      for (const t of m.recent) L.push(`- ${day(t.ts)} · «${md(t.text)}»${t.files.length ? ' → ' + t.files.map((f) => `\`${f}\``).join(', ') : ''}`);
      L.push('');
    }

    const conn = [];
    const sk = Object.entries(p.skills || {}).sort((a, b) => b[1] - a[1]);
    const mc = Object.entries(p.mcps || {}).sort((a, b) => b[1] - a[1]);
    const ag = Object.entries(p.agents || {}).sort((a, b) => b[1] - a[1]);
    if (sk.length) conn.push(`- **Skills:** ${sk.map(([k, n]) => `${link('Skills', k, k)} ×${n}`).join(' · ')}`);
    if (mc.length) conn.push(`- **Conectores:** ${mc.map(([k, n]) => `${link('Conectores', state.mcps?.[k]?.label || k)} ×${n}`).join(' · ')}`);
    if (ag.length) conn.push(`- **Subagentes:** ${ag.map(([k, n]) => `${k} ×${n}`).join(' · ')}`);
    const memDir = path.join(os.homedir(), '.claude', 'projects', p.key, 'memory');
    if (fs.existsSync(memDir)) conn.push(`- **Memoria:** \`${memDir.replace(os.homedir(), '~')}\` (${link('Zonas', 'Hipocampo', 'hipocampo')})`);
    if (reg) { const rl = relLinks(reg.root); if (rl.length) conn.unshift(`- **Proyectos:** ${rl.join(' · ')}`); }
    if (conn.length) L.push('## Conectado con', '', ...conn, '');

    // consejos concretos para gastar menos
    const tips = [];
    if (m.explore != null && m.explore >= 4) tips.push(`Claude da ${nf(m.explore)} pasos buscando antes de editar. Empieza las peticiones nombrando el fichero (ver «Dónde mirar») o deja que la skill *contexto-proyectos* lo haga por ti.`);
    const reread = m.hot.filter((h) => h.r >= 10).map((h) => ({ ...h, n: p.cwd ? lines(path.join(p.cwd, h.rel)) : null })).filter((h) => h.n && h.n > 300);
    for (const h of reread.slice(0, 3)) tips.push(`\`${h.rel}\` (${h.n} líneas) se ha leído ${h.r} veces: pide leer solo la parte que toca (un rango de líneas o una función).`);
    if (avgCtx > 150000) tips.push(`Las sesiones de este proyecto trabajan con ${Math.round(avgCtx / 1000)} k de contexto de media: abre una sesión por tarea y usa \`/compact\` al pasar de 200 k.`);
    if (tips.length) L.push('## Para gastar menos tokens', '', ...tips.map((t) => `- ${t}`), '');

    files.set(`Proyectos/${safe(p.name)}.md`, L.join('\n'));
  }

  // ---------- proyectos que solo se tocan desde una carpeta paraguas ----------
  const own = new Set(projects.map((p) => p.cwd));
  const virtual = [...atlas.regions.values()].filter((r) => !r.umbrella && !own.has(r.root) && (r.turns.length || Object.keys(r.files).length)).sort((a, b) => b.last - a.last);
  for (const r of virtual) {
    const m = projectMap(asProject(r), { files: 15, cmds: 8, tasks: 10 });
    const L = ['---', 'tipo: proyecto', `ruta: "${r.root}"`, `peticiones: ${r.turns.length}`, `ultima: ${iso(r.last)}`, 'tags: [sinapsis/proyecto]', '---', '',
      `# ${r.name}`, '', '> Proyecto que se trabaja desde una carpeta paraguas. Mapa generado por Sinapsis con el historial real de Claude Code.', ''];
    if (r.topics?.length) L.push(`**Temas:** ${r.topics.join(', ')}.  `);
    if (m.explore != null) L.push(`**Búsqueda antes de editar:** ${nf(m.explore)} pasos de media.`);
    L.push('', '## Dónde mirar', '');
    if (m.hot.length) {
      L.push('| Fichero | Líneas | Lecturas | Ediciones | Última vez |', '|---|---:|---:|---:|---|');
      for (const h of m.hot) L.push(`| \`${md(h.rel)}\` | ${lines(path.join(r.root, h.rel)) ?? '—'} | ${h.r} | ${h.e} | ${day(h.last)} |`);
    } else L.push('Aún no hay ficheros registrados.');
    L.push('', `Para una tarea concreta: \`node ~/Proyectos/sinapsis/scripts/donde.mjs --dir "${r.root}" "<tarea>"\``, '');
    if (m.cmds.length) { L.push('## Cómo se ejecuta', ''); for (const [c, n] of m.cmds) L.push(`- \`${c}\` ×${n}`); L.push(''); }
    if (m.recent.length) { L.push('## Tareas recientes', ''); for (const t of m.recent) L.push(`- ${day(t.ts)} · «${md(t.text)}»${t.files.length ? ' → ' + t.files.map((f) => `\`${f}\``).join(', ') : ''}`); L.push(''); }
    const conn = [];
    const rl = relLinks(r.root);
    if (rl.length) conn.push(`- **Proyectos:** ${rl.join(' · ')}`);
    const sk = Object.entries(r.skills).sort((a, b) => b[1] - a[1]);
    if (sk.length) conn.push(`- **Skills:** ${sk.map(([k, n]) => `${link('Skills', k, k)} ×${n}`).join(' · ')}`);
    for (const [k, n] of sk) { if (!skillsUse.has(k)) skillsUse.set(k, {}); skillsUse.get(k)[r.name] = (skillsUse.get(k)[r.name] || 0) + n; }
    if (conn.length) L.push('## Conectado con', '', ...conn, '');
    files.set(`Proyectos/${safe(r.name)}.md`, L.join('\n'));
  }

  // ---------- skills ----------
  const skillNames = new Set([...Object.keys(inventory.skills || {}), ...Object.keys(state.skills || {})]);
  for (const name of skillNames) {
    const used = state.skills?.[name];
    const inv = inventory.skills?.[name];
    const byP = skillsUse.get(name) || {};
    const L = ['---', 'tipo: skill', `usos: ${(used?.uses || 0) + (used?.attributed || 0)}`, `ultima: ${iso(used?.last)}`, 'tags: [sinapsis/skill]', '---', '', `# ${name}`, ''];
    if (inv?.description) L.push(`> ${md(inv.description)}`, '');
    L.push(`Vive en el ${link('Zonas', 'Cerebelo', 'cerebelo')}. ${used ? `${used.uses || 0} usos directos${used.attributed ? ` y ${used.attributed} pasos atribuidos` : ''}; último, ${day(used.last)}.` : 'Nunca se ha usado.'}`, '');
    const ps = Object.entries(byP).sort((a, b) => b[1] - a[1]);
    if (ps.length) L.push('## Proyectos', '', ...ps.map(([n, c]) => `- ${link('Proyectos', n, n)} ×${c}`), '');
    files.set(`Skills/${safe(name)}.md`, L.join('\n'));
  }

  // ---------- conectores ----------
  for (const [key, mc] of Object.entries(state.mcps || {})) {
    const byP = mcpUse.get(key) || {};
    const tools = Object.entries(mc.tools || {}).sort((a, b) => b[1] - a[1]);
    const L = ['---', 'tipo: conector', `llamadas: ${mc.uses}`, `ultima: ${iso(mc.last)}`, 'tags: [sinapsis/conector]', '---', '', `# ${mc.label || key}`, '', `Vive en el ${link('Zonas', 'Lóbulo parietal', 'lóbulo parietal')}. ${mc.uses} llamadas; última, ${day(mc.last)}.`, ''];
    if (tools.length) L.push('## Herramientas', '', ...tools.slice(0, 15).map(([t, n]) => `- \`${t}\` ×${n}`), '');
    const ps = Object.entries(byP).sort((a, b) => b[1] - a[1]);
    if (ps.length) L.push('## Proyectos', '', ...ps.map(([n, c]) => `- ${link('Proyectos', n, n)} ×${c}`), '');
    files.set(`Conectores/${safe(mc.label || key)}.md`, L.join('\n'));
  }

  // ---------- zonas ----------
  for (const [k, zn] of Object.entries(ZONES)) {
    const ps = projects.filter((p) => zone.get(p.key).main === k);
    files.set(`Zonas/${safe(zn.name)}.md`, ['---', 'tipo: zona', 'tags: [sinapsis/zona]', '---', '', `# ${zn.name}`, '', `En el cerebro humano se encarga de ${zn.why}. Aquí van los proyectos que más destacan en **${zn.fn}**.`, '',
      ...(ps.length ? ps.map((p) => `- ${link('Proyectos', p.name, p.name)}`) : ['Ningún proyecto, por ahora.']), ''].join('\n'));
  }
  for (const [name, desc] of FIXED) files.set(`Zonas/${safe(name)}.md`, ['---', 'tipo: zona', 'tags: [sinapsis/zona]', '---', '', `# ${name}`, '', desc, ''].join('\n'));

  // ---------- inicio ----------
  const I = ['---', 'tipo: indice', 'tags: [sinapsis]', '---', '', '# Sinapsis · mapa de proyectos', '',
    'Generado a partir del historial real de Claude Code. Cada proyecto dice **dónde mirar** (los ficheros que de verdad se leen y editan), **cómo se ejecuta**, sus tareas recientes y con qué skills y conectores trabaja. La vista de grafo de Obsidian dibuja el mismo cerebro que Sinapsis.', '',
    '## Proyectos', '', '| Proyecto | Zona | Peticiones | Búsqueda antes de editar | Última vez |', '|---|---|---:|---:|---|'];
  for (const p of projects) {
    const m = projectMap(p, { files: 0, cmds: 0, tasks: 0 });
    const zn = ZONES[zone.get(p.key).main];
    I.push(`| ${link('Proyectos', p.name, p.name)} | ${link('Zonas', zn.name, zn.name)} | ${p.prompts} | ${m.explore != null ? nf(m.explore) + ' pasos' : '—'} | ${day(p.last)} |`);
  }
  for (const r of virtual) {
    const m = projectMap(asProject(r), { files: 0, cmds: 0, tasks: 0 });
    I.push(`| ${link('Proyectos', r.name, r.name)} | — | ${r.turns.length} | ${m.explore != null ? nf(m.explore) + ' pasos' : '—'} | ${day(r.last)} |`);
  }
  I.push('', '## Cómo lo usa Claude', '', '- Al abrir o compactar una sesión, el hook de Sinapsis le da a Claude un resumen de dónde está cada cosa; al escribir una tarea, le sugiere por qué ficheros empezar si hay una pista clara.',
    '- La skill **contexto-proyectos** consulta este mapa antes de explorar un proyecto y va directa a los ficheros.', '- A mano: `node ~/Proyectos/sinapsis/scripts/donde.mjs "<tarea>"` desde la carpeta del proyecto, o `--mapa` para el resumen.', '');
  files.set('Inicio.md', I.join('\n'));

  // ---------- escribir solo lo que cambia y retirar notas viejas ----------
  let written = 0;
  for (const [rel, txt] of files) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    let old = null;
    try { old = fs.readFileSync(abs, 'utf8'); } catch { /* nueva */ }
    if (old !== txt) { fs.writeFileSync(abs, txt); written++; }
  }
  let removed = 0;
  for (const folder of MANAGED) {
    const d = path.join(dir, folder);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) if (f.endsWith('.md') && !files.has(`${folder}/${f}`)) { fs.rmSync(path.join(d, f)); removed++; }
  }
  // colores del grafo como en el cerebro (solo la primera vez: después manda la configuración de Obsidian)
  const graph = path.join(dir, '.obsidian', 'graph.json');
  if (!fs.existsSync(graph)) {
    fs.mkdirSync(path.dirname(graph), { recursive: true });
    const rgb = (h) => parseInt(h.slice(1), 16);
    fs.writeFileSync(graph, JSON.stringify({
      colorGroups: [
        { query: 'path:Proyectos', color: { a: 1, rgb: rgb('#6fd3ff') } },
        { query: 'path:Skills', color: { a: 1, rgb: rgb('#6ff0b0') } },
        { query: 'path:Conectores', color: { a: 1, rgb: rgb('#ff6fae') } },
        { query: 'path:Zonas', color: { a: 1, rgb: rgb('#ffcf8a') } },
      ],
      showArrow: false, lineSizeMultiplier: 1, nodeSizeMultiplier: 1.2,
    }, null, 2));
  }
  return { dir, notes: files.size, written, removed };
}
