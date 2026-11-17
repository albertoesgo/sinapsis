// Demo estática para GitHub Pages: sin servidor ni datos personales.
// `npm run build:demo` graba una instantánea y unos minutos de actividad con el modo demostración;
// aquí se desplazan todas las fechas para que parezca que ocurre ahora y se reproducen los eventos en bucle.

const TS_KEYS = new Set(['ts', 'last', 'first', 'ctxTs', 'start', 'end', 'resetTs', 'generatedAt', 'eta', 'from', 'to']);
let offset = 0;
let dayShift = 0;
let cached = null;
let mapsP = null;

const midnight = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

function shift(o) {
  if (Array.isArray(o)) { for (const x of o) shift(x); return o; }
  if (!o || typeof o !== 'object') return o;
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === 'number' && TS_KEYS.has(k) && v > 1e12) o[k] = v + offset;
    else if (v && typeof v === 'object') shift(v);
  }
  return o;
}

function shiftDay(key) {
  const d = new Date(key + 'T12:00');
  d.setDate(d.getDate() + dayShift);
  return d.toLocaleDateString('sv-SE');
}

export async function snapshot() {
  if (cached) return cached;
  const snap = await fetch('demo/snapshot.json').then((r) => r.json());
  offset = Date.now() - snap.generatedAt;
  dayShift = Math.round((midnight(Date.now()) - midnight(snap.generatedAt)) / 86400e3);
  const daily = {};
  for (const [k, v] of Object.entries(snap.daily)) daily[shiftDay(k)] = v;
  snap.daily = daily;
  cached = shift(snap);
  return cached;
}

export async function api(path) {
  if (path.startsWith('api/report')) return shift(await fetch('demo/report.json').then((r) => r.json()));
  if (path.startsWith('api/mobile')) return { remote: true };
  if (path.startsWith('api/alerts')) return [];
  if (path.startsWith('api/where')) {
    const u = new URL(path, location.href);
    const [{ where }, maps] = await Promise.all([import('./where.js'), mapsP ||= fetch('demo/maps.json').then((r) => r.json())]);
    const p = maps[u.searchParams.get('p')];
    return p ? where({ ...p, turns: p.turns.map((t) => ({ ...t, ts: t.ts + offset })) }, u.searchParams.get('q') || '', { limit: 8 }) : null;
  }
  return null;
}

/** Reproduce en bucle la actividad grabada, al ritmo real (algo acelerado). */
export async function play(onPulse, onAlert) {
  const events = await fetch('demo/events.json').then((r) => r.json());
  if (!events.length) return;
  let i = 0;
  const step = () => {
    const ev = events[i];
    onPulse({ ...ev, ts: Date.now() });
    i++;
    if (i >= events.length) { i = 0; setTimeout(step, 4000); return; }
    setTimeout(step, Math.max(30, (events[i].ts - ev.ts) * 0.6));
  };
  setTimeout(step, 1500);
  // un aviso de ejemplo, como los que llegan cuando una sesión crece demasiado
  setTimeout(() => onAlert({ kind: 'context', ts: Date.now(), title: 'Demo · 230 k de contexto', body: '«Build roto» relee 230 k tokens en cada paso. Usa /compact o abre una sesión nueva para la siguiente tarea.' }), 9000);
}
