// «Dónde mirar»: el mapa de cada proyecto aprendido del historial real de Claude Code.
// En cada petición se apuntan las palabras que usaste y los ficheros que el modelo leyó o editó para
// resolverla. Ante una tarea nueva, se buscan las peticiones parecidas (TF-IDF) y se devuelven sus ficheros.
// Módulo puro (sin Node): lo usan el servidor, la línea de órdenes, el vault y la demo del navegador.

const STOP = new Set(('de la que el en y a los se del las un por con no una su para es al lo como mas o pero sus le ya ' +
  'este si porque esta entre cuando muy sin sobre tambien me hasta hay donde quien desde todo nos durante todos uno les ' +
  'ni contra otros ese eso ante ellos e esto mi antes algunos que unos yo otro otras otra tanto esa estos mucho quienes ' +
  'nada muchos cual poco ella estar estas algunas algo nosotros mis tu te ti tus ellas puedes puede hacer haz hazlo ' +
  'quiero quieres creo ahora bien mejor tambien pues vale dime dame mira mirar ver favor gracias the and for with that ' +
  'this from into you your are was can will have has not but all any its our use make please just also need want que ' +
  'cosa cosas algo esto eso aqui alli asi tal vez solo sea ser son fue han hemos tiene tienen ' +
  'https http www com html sigue seguir hecho hace implementa implementalo cambia cambios parte sale salen queda quedan ' +
  'pon quita anade nose soy estoy esta estan sigo ok genial perfecto revisa revisalo prueba ahi').split(' '));

/** Palabras con significado de un texto (sin acentos, en minúsculas, sin palabras vacías), sin repetir. */
export function tokenize(text, max = 24) {
  const out = [];
  const seen = new Set();
  for (const w of String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9ñ_]+/)) {
    if (w.length < 3 || STOP.has(w) || /^\d+$/.test(w) || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= max) break;
  }
  return out;
}

/** Raíz aproximada para comparar palabras (sesión/sesiones, aviso/avisos, móvil/móviles). */
export const stem = (w) => (w.length > 4 ? w.replace(/s$/, '').replace(/e$/, '') : w).slice(0, 7);
const pathWords = (rel) => tokenize(rel.replace(/\.[a-z0-9]+$/i, '').replace(/[/._-]+/g, ' '), 12);
const fileScore = (f, now) => (f.r + 3 * f.e) * (0.4 + 0.6 * Math.exp(-(now - (f.last || 0)) / (21 * 86400e3)));

/** El proyecto al que pertenece una ruta (el de cwd más largo que la contiene), o por nombre o clave. */
export function findProject(state, where) {
  const ps = Object.values(state.projects || {});
  const byName = ps.find((p) => p.key === where || (p.name && p.name.toLowerCase() === String(where).toLowerCase()));
  if (byName) return byName;
  return ps.filter((p) => p.cwd && (where === p.cwd || String(where).startsWith(p.cwd + '/')))
    .sort((a, b) => b.cwd.length - a.cwd.length)[0] || null;
}

/** Resumen del proyecto: ficheros clave, cómo se ejecuta, exploración media y tareas recientes. */
export function projectMap(p, { now = Date.now(), files = 12, cmds = 8, tasks = 10 } = {}) {
  const hot = Object.entries(p.files || {})
    .map(([rel, f]) => ({ rel, r: f.r, e: f.e, last: f.last, score: fileScore(f, now) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, files);
  const turns = p.turns || [];
  const done = turns.filter((t) => t.e);
  const explore = done.length ? done.reduce((a, t) => a + t.x, 0) / done.length : null;
  const steps = turns.length ? turns.reduce((a, t) => a + (t.n || 0), 0) / turns.length : null;
  return {
    hot,
    cmds: Object.entries(p.cmds || {}).sort((a, b) => b[1] - a[1]).slice(0, cmds)
      .map(([k, n]) => { const [d, c] = k.includes('\t') ? k.split('\t') : ['', k]; return [d ? `${c} (en ${d}/)` : c, n]; }),
    explore,           // pasos buscando (leer, grep, glob, ls…) antes de la primera edición, de media
    exploreShare: explore != null && steps ? Math.min(1, explore / steps) : null,
    turns: turns.length,
    recent: turns.slice(Math.max(0, turns.length - tasks)).reverse().map((t) => ({ ts: t.ts, text: t.t, files: Object.entries(t.f || {}).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([f]) => f) })),
  };
}

/**
 * Ficheros por los que empezar para una tarea nueva.
 * Puntúa las peticiones pasadas por parecido (palabras en común, ponderadas por su rareza en el proyecto)
 * y reparte esa puntuación entre los ficheros que se tocaron en cada una (editar pesa más que leer).
 * Además, si el nombre de un fichero contiene palabras de la tarea, sube.
 */
export function where(p, query, { now = Date.now(), limit = 8 } = {}) {
  const q = tokenize(query);
  const qs = [...new Set(q.map(stem))];
  const turns = p.turns || [];
  if (!q.length) return { query: q, files: [], similar: [], cmds: projectMap(p, { now }).cmds, conf: 0, nameHit: 0 };
  const df = new Map();
  const tstems = turns.map((t) => new Set(t.q.map(stem)));
  for (const set of tstems) for (const w of set) df.set(w, (df.get(w) || 0) + 1);
  const idf = (w) => Math.log(1 + (turns.length + 1) / ((df.get(w) || 0) + 0.5));
  const score = new Map();
  const why = new Map();
  const similar = [];
  turns.forEach((t, i) => {
    const shared = qs.filter((w) => tstems[i].has(w));
    if (!shared.length) return;
    const sim = shared.reduce((a, w) => a + idf(w), 0) / Math.sqrt(t.q.length + 3);
    const age = Math.exp(-(now - t.ts) / (60 * 86400e3));
    similar.push({ sim: sim * (0.5 + 0.5 * age), raw: sim, t });
  });
  // solo cuentan las peticiones de verdad parecidas (cerca de la mejor); cada una reparte su parecido
  // entre sus ficheros según lo que pesaron en ella (editar > leer), sin que un fichero tocado cien
  // veces en tareas sin relación tape al de la tarea gemela
  const best = Math.max(0, ...similar.map((x) => x.sim));
  for (const { sim, t } of similar) {
    if (sim < best * 0.3) continue;
    const ws = Object.entries(t.f || {});
    const wmax = Math.max(1e-9, ...ws.map(([, w]) => w));
    for (const [f, w] of ws) {
      score.set(f, (score.get(f) || 0) + sim * sim * Math.sqrt(w / wmax));
      if (!why.has(f) || sim >= best) why.set(f, t.t);
    }
  }
  // lo aprendido de peticiones parecidas, normalizado; luego, el nombre del fichero (pesa mucho)
  const files = p.files || {};
  let nameHit = 0;
  const tmax = Math.max(1e-9, ...score.values());
  for (const [k, v] of score) score.set(k, v / tmax);
  for (const [rel, f] of Object.entries(files)) {
    const hits = pathWords(rel).filter((w) => q.some((x) => x === w || stem(x) === stem(w) || (w.length >= 3 && x.startsWith(w)) || (x.length > 4 && w.startsWith(x))));
    if (hits.length) nameHit = Math.max(nameHit, hits.length);
    if (hits.length) score.set(rel, (score.get(rel) || 0) + Math.min(1.2, hits.length * 0.7) + 0.03 * Math.log1p(f.r + f.e));
  }
  const max = Math.max(1e-9, ...score.values());
  const ranked = [...score.entries()]
    .map(([rel, s]) => ({ rel, score: s / max, r: files[rel]?.r || 0, e: files[rel]?.e || 0, why: why.get(rel) || null }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return {
    query: q,
    files: ranked,
    similar: similar.sort((a, b) => b.sim - a.sim).slice(0, 4).map(({ raw, t }) => ({ text: t.t, ts: t.ts, files: Object.entries(t.f || {}).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([f]) => f), sim: raw, k: t.k || [] })),
    cmds: projectMap(p, { now }).cmds,
    // confianza: parecido de la mejor petición pasada (0 = nada en común) y palabras de la tarea en nombres de fichero
    conf: Math.max(0, ...similar.map((x) => x.raw)),
    nameHit,
  };
}
