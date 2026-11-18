// El atlas: un solo mapa de todos tus proyectos, aprendido del historial real de Claude Code.
//
// Claude Code agrupa el historial por la carpeta en la que abriste la sesión. Si trabajas desde una
// carpeta «paraguas» (p. ej. ~/Proyectos), una misma sesión toca varios proyectos y el mapa de cada uno
// queda partido. El atlas reparte cada fichero, orden y petición en su proyecto real por su ruta
// absoluta: es la «región» del cerebro donde vive. Las conexiones entre regiones salen de lo que
// comparten de verdad: tareas que tocaron ambas, skills usadas en las dos y el mismo tipo de ficheros.
//
// Con el atlas, Sinapsis le da a Claude contexto útil y breve:
//   · brief(): al empezar o compactar una sesión, dónde está cada cosa (≈250 tokens).
//   · hint():  al escribir una tarea, por qué ficheros empezar, solo si hay una pista clara (≈120 tokens).
//   · evaluate(): repite tu historial a ciegas para medir cuántas veces habría acertado.
//   · savings(): compara las peticiones que recibieron pista con las que no.
// Módulo puro (sin Node).
import { tokenize, stem, where, projectMap } from './where.js';

const dirname = (p) => p.slice(0, p.lastIndexOf('/')) || '/';
const basename = (p) => p.slice(p.lastIndexOf('/') + 1);
const inside = (abs, root) => abs === root || abs.startsWith(root + '/');
const JUNK_DIR = /(^|\/)(node_modules|\.git|dist|build|out|coverage|\.cache|\.next|\.nuxt|\.venv|venv|__pycache__|\.turbo|\.vercel|\.wrangler)\//; // como en ingest.js
const EDIT_W = 2; // en una petición, peso ≥ 2 = el fichero se editó (Edit 3, sed -i / > 2)

/** Umbral de confianza para dar una pista sin que la pidan (calibrado con evaluate() sobre tu historial). */
export const HINT_CONF = 0.6;

export function buildAtlas(state, { home = '', now = Date.now() } = {}) {
  const ps = Object.values(state.projects || {}).filter((p) => p.cwd);
  const cwds = ps.map((p) => p.cwd);
  // carpeta paraguas: tu carpeta personal o una que contiene varios proyectos con historial propio
  const umbrella = new Set(cwds.filter((c) => c === home || cwds.filter((o) => o !== c && dirname(o) === c).length >= 2));
  const real = cwds.filter((c) => !umbrella.has(c)).sort((a, b) => b.length - a.length);
  const umb = [...umbrella].sort((a, b) => b.length - a.length);
  const names = new Map(ps.map((p) => [p.cwd, p.name || basename(p.cwd)]));

  /** Región (carpeta raíz del proyecto) a la que pertenece una ruta absoluta. */
  const rootOf = (abs) => {
    const r = real.find((c) => inside(abs, c));
    if (r) return r;
    const u = umb.find((c) => abs.startsWith(c + '/'));
    if (u) {
      const rest = abs.slice(u.length + 1);
      return rest.includes('/') ? u + '/' + rest.split('/')[0] : u;
    }
    return null;
  };

  const regions = new Map();
  const region = (root) => {
    let r = regions.get(root);
    if (!r) {
      r = { root, name: names.get(root) || basename(root), umbrella: umbrella.has(root), files: {}, cmds: {}, turns: [], skills: {}, ext: {}, last: 0 };
      regions.set(root, r);
    }
    return r;
  };
  const links = new Map();
  const link = (a, b, kind, w = 1) => {
    if (a === b) return;
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    const l = links.get(k) || links.set(k, { a: k.split('|')[0], b: k.split('|')[1], co: 0, skills: new Set() }).get(k);
    if (kind === 'co') l.co += w;
  };

  for (const p of ps) {
    for (const [rel, f] of Object.entries(p.files || {})) {
      if (JUNK_DIR.test(rel)) continue;
      const abs = p.cwd + '/' + rel;
      const root = rootOf(abs);
      if (!root) continue;
      const r = region(root);
      const k = abs.slice(root.length + 1);
      const g = r.files[k] || (r.files[k] = { r: 0, e: 0, last: 0 });
      g.r += f.r; g.e += f.e; g.last = Math.max(g.last, f.last || 0);
      r.last = Math.max(r.last, f.last || 0);
      const ext = (k.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
      if (ext) r.ext[ext] = (r.ext[ext] || 0) + f.r + f.e;
    }
    for (const [key, n] of Object.entries(p.cmds || {})) {
      const [d, c] = key.includes('\t') ? key.split('\t') : ['', key];
      const absDir = d ? p.cwd + '/' + d : p.cwd;
      const root = rootOf(absDir + '/_') || p.cwd;
      const r = region(root);
      const rd = absDir.length > root.length ? absDir.slice(root.length + 1) : '';
      const k = rd ? `${rd}\t${c}` : c;
      r.cmds[k] = (r.cmds[k] || 0) + n;
    }
    for (const t of p.turns || []) {
      const by = new Map();
      for (const [rel, w] of Object.entries(t.f || {})) {
        if (JUNK_DIR.test(rel)) continue;
        const abs = p.cwd + '/' + rel;
        const root = rootOf(abs);
        if (!root) continue;
        const m = by.get(root) || by.set(root, {}).get(root);
        m[abs.slice(root.length + 1)] = w;
      }
      const roots = [...by.keys()];
      for (let i = 0; i < roots.length; i++) for (let j = i + 1; j < roots.length; j++) link(roots[i], roots[j], 'co');
      for (const [root, f] of by) {
        const r = region(root);
        r.turns.push({ ts: t.ts, t: t.t, q: t.q, f, k: t.k, x: t.x, e: t.e });
        r.last = Math.max(r.last, t.ts || 0);
        for (const sk of t.k || []) r.skills[sk] = (r.skills[sk] || 0) + 1;
      }
    }
  }
  for (const r of regions.values()) r.turns.sort((a, b) => a.ts - b.ts);
  // las regiones paraguas sin nada propio no aportan
  for (const [root, r] of regions) if (r.umbrella && !Object.keys(r.files).length && !r.turns.length) regions.delete(root);

  // temas de cada región: palabras de sus peticiones que la distinguen de las demás
  const df = new Map();
  for (const r of regions.values()) for (const w of new Set(r.turns.flatMap((t) => t.q.map(stem)))) df.set(w, (df.get(w) || 0) + 1);
  for (const r of regions.values()) {
    const tf = new Map();
    const shown = new Map();
    for (const t of r.turns) for (const w of t.q) { const s = stem(w); tf.set(s, (tf.get(s) || 0) + 1); if (!shown.has(s)) shown.set(s, w); }
    const own = (atlas_home) => atlas_home.toLowerCase().split(/[^a-z0-9]+/);
    const skip = new Set([...own(home), ...own(r.root)].map(stem));
    // temas = sustantivos que distinguen la región: fuera verbos conjugados («gustaba», «desplegarlo»…)
    const verb = /(aba|aban|abas|ia|ian|aremos|eremos|iremos|amos|emos|imos|ando|iendo|arlo|erlo|irlo|alo|elo|ame|eme|ado|ada|ido)$/;
    r.topics = [...tf.entries()].filter(([s, n]) => n >= 2 && !skip.has(s) && !verb.test(shown.get(s)) && (df.get(s) || 0) / regions.size <= 0.4)
      .map(([s, n]) => [shown.get(s), n * Math.log(1 + regions.size / (df.get(s) || 1))])
      .sort((a, b) => b[1] - a[1]).slice(0, 5).map(([w]) => w);
  }

  // conexiones: tareas que tocaron ambas, skills en común y el mismo tipo de ficheros
  const cos = (a, b) => {
    let d = 0, na = 0, nb = 0;
    for (const [k, v] of Object.entries(a)) { na += v * v; if (b[k]) d += v * b[k]; }
    for (const v of Object.values(b)) nb += v * v;
    return na && nb ? d / Math.sqrt(na * nb) : 0;
  };
  const rs = [...regions.values()];
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
    const a = rs[i], b = rs[j];
    const shared = Object.keys(a.skills).filter((k) => b.skills[k]);
    const stack = cos(a.ext, b.ext);
    if (shared.length || stack > 0.6) { link(a.root, b.root, 'x'); const l = links.get(a.root < b.root ? `${a.root}|${b.root}` : `${b.root}|${a.root}`); shared.forEach((s) => l.skills.add(s)); l.stack = stack; }
  }
  const connections = [...links.values()].map((l) => {
    const why = [];
    if (l.co) why.push(`${l.co} tarea${l.co === 1 ? '' : 's'} tocaron las dos`);
    if (l.skills.size) why.push(`comparten ${[...l.skills].slice(0, 2).join(', ')}`);
    if ((l.stack || 0) > 0.6) why.push('mismo tipo de ficheros');
    return { a: l.a, b: l.b, w: l.co * 2 + l.skills.size + (l.stack > 0.6 ? l.stack : 0), why };
  }).filter((c) => c.w > 0).sort((x, y) => y.w - x.w);

  return { home, now, regions, connections, umbrella: [...umbrella] };
}

/** La región como «proyecto» para where()/projectMap(). */
export const asProject = (r) => ({ name: r.name, cwd: r.root, files: r.files, cmds: r.cmds, turns: r.turns });

/** Todo el atlas visto desde una carpeta paraguas: rutas relativas a ella («lookit/src/…»). */
function merged(atlas, base) {
  const files = {}, cmds = {}, turns = [];
  for (const r of atlas.regions.values()) {
    if (!inside(r.root, base)) continue;
    const pre = r.root === base ? '' : r.root.slice(base.length + 1) + '/';
    for (const [k, f] of Object.entries(r.files)) files[pre + k] = f;
    for (const [k, n] of Object.entries(r.cmds)) {
      const [d, c] = k.includes('\t') ? k.split('\t') : ['', k];
      const dd = (pre + d).replace(/\/$/, '');
      const kk = dd ? `${dd}\t${c}` : c;
      cmds[kk] = (cmds[kk] || 0) + n;
    }
    for (const t of r.turns) turns.push({ ...t, f: Object.fromEntries(Object.entries(t.f).map(([k, w]) => [pre + k, w])) });
  }
  turns.sort((a, b) => a.ts - b.ts);
  return { name: basename(base), cwd: base, files, cmds, turns };
}

/** Qué ve Claude desde una carpeta: una región o, si es paraguas, todo lo que cuelga de ella. */
export function scope(atlas, cwd) {
  const own = [...atlas.regions.values()].filter((r) => !r.umbrella && inside(cwd, r.root)).sort((a, b) => b.root.length - a.root.length)[0];
  if (own) return { mode: 'region', region: own, project: asProject(own), base: own.root, sub: cwd === own.root ? '' : cwd.slice(own.root.length + 1) };
  const anyInside = [...atlas.regions.values()].some((r) => inside(r.root, cwd));
  if (anyInside) return { mode: 'all', project: merged(atlas, cwd), base: cwd, sub: '' };
  return null;
}

const day = (ts) => new Date(ts).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
const tidy = (cmd) => cmd.replace(/\s*\(en ([^)]+)\/\)$/, ' (en $1/)');

/** En vista paraguas, solo las órdenes de los proyectos donde están los ficheros sugeridos. */
export function cmdsFor(cmds, files) {
  const tops = new Set(files.slice(0, 3).map((f) => (f.rel || f).split('/')[0]));
  return cmds.filter(([c]) => { const d = c.match(/\(en ([^)/]+)/)?.[1]; return d ? tops.has(d) : true; });
}

/** Regiones relacionadas con una, con el porqué. */
export function related(atlas, root, n = 3) {
  return atlas.connections.filter((c) => c.a === root || c.b === root).slice(0, n)
    .map((c) => ({ name: atlas.regions.get(c.a === root ? c.b : c.a)?.name, why: c.why }))
    .filter((x) => x.name);
}

/**
 * Contexto de arranque (SessionStart: al abrir, reanudar, limpiar o compactar una sesión).
 * Corto a propósito: se paga en cada sesión, así que solo lleva lo que evita explorar a ciegas.
 */
export function brief(atlas, cwd, { now = Date.now(), donde = 'donde.mjs', maxChars = 1500 } = {}) {
  const sc = scope(atlas, cwd);
  if (!sc) return null;
  const L = [];
  if (sc.mode === 'region') {
    const r = sc.region;
    const m = projectMap(asProject(r), { now, files: 6, cmds: 3, tasks: 3 });
    if (!m.hot.length && !m.turns) return null;
    L.push(`[Sinapsis] Mapa de «${r.name}» aprendido de ${m.turns} peticiones anteriores (es una pista: confirma leyendo).`);
    if (r.topics?.length) L.push(`Temas habituales: ${r.topics.join(', ')}.`);
    if (m.hot.length) L.push(`Ficheros clave: ${m.hot.map((h) => `${h.rel}${h.e ? ` (${h.e} edic.)` : ''}`).join(', ')}.`);
    if (m.cmds.length) L.push(`Se prueba con: ${m.cmds.map(([c]) => tidy(c)).join(' · ')}.`);
    if (m.recent.length) L.push(`Últimas tareas: ${m.recent.map((t) => `${day(t.ts)} «${t.text.slice(0, 60)}»${t.files.length ? ' → ' + t.files.slice(0, 2).map(basename).join(', ') : ''}`).join('; ')}.`);
    const sk = Object.entries(r.skills).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
    if (sk.length) L.push(`Skills que han servido aquí: ${sk.join(', ')}.`);
    const rel = related(atlas, r.root, 2);
    if (rel.length) L.push(`Conectado con: ${rel.map((x) => `${x.name} (${x.why[0]})`).join('; ')}.`);
  } else {
    const rs = [...atlas.regions.values()].filter((r) => !r.umbrella && inside(r.root, cwd) && (r.turns.length || Object.keys(r.files).length))
      .sort((a, b) => b.last - a.last).slice(0, 9);
    if (!rs.length) return null;
    L.push(`[Sinapsis] Estás en ${cwd.replace(atlas.home, '~')}. Dónde está cada cosa, aprendido de tu historial (pista: confirma leyendo):`);
    for (const r of rs) {
      const m = projectMap(asProject(r), { now, files: 3, cmds: 1, tasks: 0 });
      const pre = r.root.slice(cwd.length + 1);
      const parts = [];
      if (r.topics?.length) parts.push(r.topics.slice(0, 3).join(', '));
      if (m.hot.length) parts.push(m.hot.map((h) => h.rel).join(', '));
      if (m.cmds.length) parts.push(tidy(m.cmds[0][0]));
      L.push(`- ${pre}/ — ${parts.join(' · ')}`);
    }
  }
  L.push(`Para una tarea concreta: node ${donde} "<tarea>" te dice por qué ficheros empezar.`);
  let out = L.join('\n');
  if (out.length > maxChars) out = out.slice(0, maxChars - 1) + '…';
  return out;
}

/**
 * Pista para una tarea (UserPromptSubmit). Solo si hay algo claro: si no, nada (no gasta tokens).
 * Devuelve el texto y los ficheros sugeridos (para medir luego si acertó).
 */
export function hint(atlas, cwd, prompt, { now = Date.now(), minConf = HINT_CONF } = {}) {
  const text = String(prompt || '').trim();
  if (!text || text.startsWith('/') || text.startsWith('<')) return null;
  if (tokenize(text).length < 2) return null;
  const sc = scope(atlas, cwd);
  if (!sc) return null;
  const r = where(sc.project, text, { now, limit: 5 });
  const strong = r.conf >= minConf || (r.nameHit >= 2 && r.files.length);
  if (!strong || !r.files.length) return null;
  const files = r.files.filter((f) => f.score >= 0.35).slice(0, 4).map((f) => f.rel);
  const L = ['[Sinapsis] Pista para esta tarea, aprendida de peticiones parecidas (confirma leyendo; lee solo lo necesario):'];
  L.push(`· Empieza por: ${files.join(', ')}`);
  const sim = r.similar[0];
  if (sim && sim.sim >= minConf) L.push(`· Parecida: ${day(sim.ts)} «${sim.text.slice(0, 80)}»${sim.files.length ? ' → ' + sim.files.slice(0, 3).map(basename).join(', ') : ''}`);
  const skills = [...new Set(r.similar.filter((s) => s.sim >= minConf).flatMap((s) => s.k || []))].slice(0, 2);
  if (skills.length) L.push(`· En tareas así se usó la skill: ${skills.join(', ')}`);
  const cmds = sc.mode === 'all' ? cmdsFor(r.cmds, files) : r.cmds;
  if (cmds.length) L.push(`· Se prueba con: ${cmds.slice(0, 2).map(([c]) => tidy(c)).join(' · ')}`);
  // lo aprendido en otro proyecto: una tarea muy parecida resuelta en otra región
  if (sc.mode === 'region') {
    let best = null;
    for (const o of atlas.regions.values()) {
      if (o === sc.region || o.umbrella) continue;
      const w = where(asProject(o), text, { now, limit: 2 });
      const s = w.similar[0];
      if (s && s.sim >= minConf * 1.25 && (!best || s.sim > best.s.sim)) best = { o, s };
    }
    if (best) L.push(`· En ${best.o.name} hiciste algo parecido: «${best.s.text.slice(0, 70)}» → ${best.s.files.slice(0, 2).join(', ')}`);
  }
  return { text: L.join('\n'), files, conf: r.conf };
}

/**
 * Repite tu historial a ciegas: para cada tarea que acabó editando, busca con lo que se sabía ANTES
 * de ella y mira si el fichero que se editó estaba entre los 3 primeros. Es la prueba honesta del mapa.
 */
export function evaluate(atlas, { minConf = HINT_CONF, top = 3 } = {}) {
  let n = 0, hit = 0, given = 0, givenHit = 0, xAll = 0, xHit = 0;
  const byConf = [];
  for (const r of atlas.regions.values()) {
    if (r.umbrella) continue;
    const turns = r.turns;
    for (let i = 1; i < turns.length; i++) {
      const t = turns[i];
      const edited = Object.entries(t.f).filter(([, w]) => w >= EDIT_W).map(([f]) => f);
      if (!t.e || !edited.length) continue;
      const past = turns.slice(0, i);
      const files = {};
      for (const pt of past) for (const [f, w] of Object.entries(pt.f)) { const g = files[f] || (files[f] = { r: 0, e: 0, last: 0 }); if (w >= EDIT_W) g.e++; else g.r++; g.last = Math.max(g.last, pt.ts); }
      const w = where({ files, turns: past, cmds: {} }, t.t, { now: t.ts, limit: top });
      const ok = w.files.slice(0, top).some((f) => edited.includes(f.rel));
      n++; xAll += t.x || 0;
      if (ok) hit++;
      const strong = w.conf >= minConf || (w.nameHit >= 2 && w.files.length);
      if (strong) { given++; if (ok) { givenHit++; xHit += t.x || 0; } }
      byConf.push([w.conf, ok]);
    }
  }
  return {
    tasks: n,                                   // tareas con edición que se pudieron repetir
    hitRate: n ? hit / n : null,                // acierto del fichero a editar entre los 3 primeros
    coverage: n ? given / n : null,             // en cuántas habría dado pista (confianza suficiente)
    precision: given ? givenHit / given : null, // de las pistas dadas, cuántas acertaron
    exploreAvg: n ? xAll / n : null,            // pasos de búsqueda antes de editar, de media
    stepsSavable: given ? xHit / given : null,  // pasos que se podían ahorrar por pista dada (si acertó)
  };
}

/** Compara las peticiones que recibieron pista con las que no (en vivo, con el hook instalado). */
export function savings(state, { now = Date.now(), days = 30 } = {}) {
  const g = { with: { n: 0, x: 0, c: 0, hit: 0 }, without: { n: 0, x: 0, c: 0 } };
  for (const p of Object.values(state.projects || {})) {
    for (const t of p.turns || []) {
      if (!t.e || t.ts < now - days * 86400e3) continue;
      const k = Array.isArray(t.h) ? 'with' : 'without';
      g[k].n++; g[k].x += t.x || 0; g[k].c += t.c || 0;
      if (k === 'with') {
        const edited = Object.entries(t.f || {}).filter(([, w]) => w >= EDIT_W).map(([f]) => f);
        if (t.h.some((f) => edited.includes(f) || edited.some((e) => e.endsWith('/' + f) || f.endsWith('/' + e)))) g.with.hit++;
      }
    }
  }
  const avg = (o) => ({ n: o.n, x: o.n ? o.x / o.n : null, c: o.n ? o.c / o.n : null });
  const w = avg(g.with), wo = avg(g.without);
  return { days, with: { ...w, hitRate: g.with.n ? g.with.hit / g.with.n : null }, without: wo, enough: g.with.n >= 5 && g.without.n >= 5 };
}

/** Resumen del atlas para la web: regiones, conexiones y las dos mediciones. */
export function atlasSummary(atlas, state, { now = Date.now() } = {}) {
  const regions = [...atlas.regions.values()].filter((r) => !r.umbrella).sort((a, b) => b.last - a.last).map((r) => ({
    root: r.root.replace(atlas.home, '~'), name: r.name, turns: r.turns.length, files: Object.keys(r.files).length, topics: r.topics || [],
    skills: Object.entries(r.skills).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k), last: r.last,
  }));
  const name = (root) => atlas.regions.get(root)?.name;
  return {
    regions,
    connections: atlas.connections.slice(0, 20).map((c) => ({ a: name(c.a), b: name(c.b), why: c.why, w: c.w })),
    replay: evaluate(atlas),
    live: savings(state, { now }),
  };
}
