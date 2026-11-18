// Pruebas del núcleo: precios, lectura de los registros, límites del plan y clasificación de actividad.
//   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { costOf } from '../server/pricing.js';
import { Brain, parseReset, toolCategory } from '../server/ingest.js';
import { planStatus } from '../server/plan.js';
import { weeklyReport } from '../server/report.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
const newBrain = () => new Brain({ cacheFile: null, claudeDir: path.join(os.tmpdir(), 'sinapsis-test-vacio') });
const ctx = { projectKey: 'proj', sessionId: 'ses-1', agentId: null };

function assistant(id, ts, usage, content = [], extra = {}) {
  return { type: 'assistant', timestamp: new Date(ts).toISOString(), sessionId: 'ses-1', cwd: '/tmp/proj', message: { id, model: 'claude-opus-5-5', usage, content, stop_reason: 'end_turn' }, ...extra };
}

test('costOf: precios por millón, caché leída y escrita', () => {
  const M = 1e6;
  close(costOf('claude-opus-5-5', { input_tokens: M }), 4);
  close(costOf('claude-opus-5-5', { output_tokens: M }), 20);
  close(costOf('claude-opus-5-5', { cache_read_input_tokens: M }), 0.2);
  // escritura en caché de 5 min: 1,25× la entrada
  close(costOf('claude-opus-5-5', { cache_creation_input_tokens: M }), 5);
  close(costOf('claude-sonnet-5-5', { input_tokens: M, output_tokens: M }), 12);
  // un id con fecha o sufijo sigue encontrando su precio
  close(costOf('claude-opus-5-5[1m]', { input_tokens: M }), 4);
});

test('parseReset: horas, minutos y fechas en inglés', () => {
  const base = new Date(2026, 10, 8, 20, 17).getTime(); // 8 nov 2026, 20:17 (hora local)
  assert.equal(new Date(parseReset('10:50pm', base)).getHours(), 22);
  assert.equal(new Date(parseReset('10:50pm', base)).getMinutes(), 50);
  // si la hora ya ha pasado hoy, es mañana
  const next = new Date(parseReset('3:50am', base));
  assert.equal(next.getDate(), 9);
  assert.equal(next.getHours(), 3);
  const week = new Date(parseReset('Nov 13 at 1am', base));
  assert.deepEqual([week.getMonth(), week.getDate(), week.getHours()], [10, 13, 1]);
  assert.equal(parseReset('pronto', base), null);
});

test('toolCategory: cada acción cuenta para su función', () => {
  assert.equal(toolCategory('WebFetch'), 'lang');
  assert.equal(toolCategory('Read', { file_path: '/a/foto.png' }), 'vision');
  assert.equal(toolCategory('Read', { file_path: '/a/notas.md' }), 'lang');
  assert.equal(toolCategory('Edit', { file_path: '/a/app.js' }), 'exec');
  assert.equal(toolCategory('Bash', { command: 'npx playwright screenshot' }), 'vision');
  assert.equal(toolCategory('Agent', { subagent_type: 'Plan' }), 'plan');
  assert.equal(toolCategory('mcp__claude_ai_Canva__generate'), 'vision');
});

test('ingest: un mensaje repartido en varias líneas solo cuenta una vez', () => {
  const b = newBrain();
  const t = Date.now() - 60e3;
  const usage = { input_tokens: 10, cache_read_input_tokens: 100000, output_tokens: 500 };
  // Claude Code escribe una línea por bloque de contenido, todas con el mismo id y el mismo usage
  b.processRecord(assistant('msg_1', t, usage, [{ type: 'thinking', thinking: '' }]), ctx);
  b.processRecord(assistant('msg_1', t, usage, [{ type: 'tool_use', id: 'tu_1', name: 'Bash', input: { command: 'ls' } }]), ctx);
  assert.equal(b.s.totals.msgs, 1);
  assert.equal(b.s.totals.tok.cr, 100000);
  assert.equal(b.s.tools.Bash.uses, 1);
  assert.equal(b.s.sessions['ses-1'].ctx, 100010);
  // el resultado de la herramienta cierra la llamada
  b.processRecord({ type: 'user', timestamp: new Date(t + 1000).toISOString(), sessionId: 'ses-1', message: { content: [{ type: 'tool_result', tool_use_id: 'tu_1', is_error: true }] } }, ctx);
  assert.equal(b.s.tools.Bash.errors, 1);
});

test('ingest: cuenta peticiones reales, no avisos internos', () => {
  const b = newBrain();
  const t = Date.now() - 60e3;
  const user = (content, extra = {}) => ({ type: 'user', timestamp: new Date(t).toISOString(), sessionId: 'ses-1', cwd: '/tmp/proj', message: { content }, ...extra });
  b.processRecord(user('Arregla el build'), ctx);
  b.processRecord(user('Caveat: The messages below were generated…'), ctx);
  b.processRecord(user('<local-command-stdout>ok</local-command-stdout>'), ctx);
  b.processRecord(user('meta', { isMeta: true }), ctx);
  assert.equal(b.s.totals.prompts, 1);
  assert.equal(b.s.projects.proj.name, 'proj');
});

test('ingest: registra los cortes del plan que escribe Claude Code', () => {
  const b = newBrain();
  const t = new Date(2026, 10, 8, 20, 17).getTime();
  const synthetic = (text) => ({ type: 'assistant', timestamp: new Date(t).toISOString(), sessionId: 'ses-1', message: { model: '<synthetic>', content: [{ type: 'text', text }] } });
  b.processRecord(synthetic("You've hit your 5-hour limit · resets 10:50pm (Europe/Madrid)"), ctx);
  b.processRecord(synthetic("You've hit your 5-hour limit · resets 10:50pm (Europe/Madrid)"), { ...ctx, agentId: 'a1' }); // repetido por un subagente
  b.processRecord(synthetic("You've hit your weekly limit · resets Nov 13 at 1am (Europe/Madrid)"), ctx);
  const hits = Object.values(b.s.limits);
  assert.equal(hits.length, 2);
  assert.deepEqual(hits.map((h) => h.kind).sort(), ['5h', 'week']);
  assert.equal(b.s.totals.msgs, 0); // los mensajes sintéticos no cuentan como respuestas
});

test('planStatus: el presupuesto es lo consumido antes de cada corte (mediana)', () => {
  const SLOT = 600e3;
  const now = Date.now();
  const slots = {};
  const limits = {};
  // tres ventanas pasadas que acabaron en corte tras consumir 40, 50 y 45
  [[3, 40], [2, 50], [1, 45]].forEach(([daysAgo, used], i) => {
    const start = Math.floor((now - daysAgo * 86400e3) / SLOT) * SLOT;
    for (let k = 0; k < 10; k++) slots[start / SLOT + k] = used / 10;
    limits['h' + i] = { kind: '5h', ts: start + 10 * SLOT, resetTs: start + 5 * 3600e3 };
  });
  // ventana actual: 18 consumidos en la última hora
  const cur = Math.floor((now - 3600e3) / SLOT) * SLOT;
  for (let k = 0; k < 6; k++) slots[cur / SLOT + k] = 3;
  const pl = planStatus({ slots, limits }, now);
  close(pl.h5.budget, 45, 1e-6);
  close(pl.h5.used, 18, 1e-6);
  assert.equal(pl.h5.samples, 3);
  assert.ok(pl.h5.end > now && pl.h5.end <= cur + 5 * 3600e3);
  // al ritmo de 18/h, los 27 que faltan llegan en 1,5 h: antes de que acabe la ventana
  assert.ok(pl.h5.eta && pl.h5.eta < pl.h5.end);
  assert.equal(pl.windows.filter((w) => w.hit).length, 3);
});

test('weeklyReport: mapa de ritmo de 7 × 24', () => {
  const now = Date.now();
  const r = weeklyReport({ daily: {}, sessions: {}, projects: {}, slots: { [Math.floor(now / 600e3)]: 2 } }, null);
  assert.equal(r.rhythm.length, 7);
  assert.equal(r.rhythm[0].length, 24);
  close(r.rhythm.flat().reduce((a, b) => a + b, 0), 2);
  assert.ok(r.tips.length >= 1);
});

// ---------- mapa «dónde mirar» ----------
import { tokenize, where, projectMap, stem } from '../server/where.js';
import { normCmd, pathTokens } from '../server/ingest.js';

test('tokenize: palabras con significado, sin acentos ni palabras vacías', () => {
  assert.deepEqual(tokenize('Arregla el botón de pagar en el móvil, por favor'), ['arregla', 'boton', 'pagar', 'movil']);
  assert.equal(stem('sesiones'), stem('sesion'));
  assert.equal(stem('avisos'), stem('aviso'));
});

test('normCmd y pathTokens: órdenes útiles y ficheros nombrados en la terminal', () => {
  assert.equal(normCmd('npm run build -- --watch'), 'npm run build');
  assert.equal(normCmd('node server/index.js --port 7421'), 'node server/index.js');
  assert.equal(normCmd('git status'), null);
  assert.equal(normCmd('ls -la'), null);
  assert.deepEqual([...pathTokens("sed -i '' 's/a/b/' public/style.css && node scripts/build.mjs")], ['public/style.css', 'scripts/build.mjs']);
});

test('ingest: cada petición recuerda sus ficheros y los pasos de búsqueda antes de editar', () => {
  const b = newBrain();
  const t = Date.now() - 60e3;
  const at = (s) => new Date(t + s * 1000).toISOString();
  b.processRecord({ type: 'user', timestamp: at(0), sessionId: 'ses-1', cwd: '/tmp/proj', message: { content: 'Arregla el cálculo del carrito' } }, ctx);
  const tool = (id, name, input, s) => b.processRecord(assistant(id, t + s * 1000, { output_tokens: 10 }, [{ type: 'tool_use', id: 'tu_' + id, name, input }]), ctx);
  tool('a', 'Grep', { pattern: 'cart' }, 1);
  tool('b', 'Read', { file_path: '/tmp/proj/src/cart.js' }, 2);
  tool('c', 'Edit', { file_path: '/tmp/proj/src/cart.js' }, 3);
  tool('d', 'Bash', { command: 'npm test' }, 4);
  const p = b.s.projects.proj;
  assert.equal(p.turns.length, 1);
  assert.deepEqual(p.turns[0].f, { 'src/cart.js': 4 });
  assert.equal(p.turns[0].x, 2); // Grep y Read antes de la primera edición
  assert.equal(p.turns[0].e, true);
  assert.deepEqual(p.files['src/cart.js'], { r: 1, e: 1, last: t + 3000 });
  assert.equal(p.cmds['npm test'], 1);
  assert.equal(projectMap(p).explore, 2);
});

test('where: peticiones parecidas y nombres de fichero llevan al sitio correcto', () => {
  const now = Date.now();
  const p = {
    files: { 'src/cart.js': { r: 5, e: 4, last: now }, 'src/login.js': { r: 3, e: 2, last: now }, 'src/styles/theme.css': { r: 2, e: 2, last: now } },
    cmds: { 'npm test': 3 },
    turns: [
      { ts: now - 1e6, q: tokenize('el carrito suma mal los descuentos'), t: 'el carrito suma mal', f: { 'src/cart.js': 4 } },
      { ts: now - 2e6, q: tokenize('no se puede iniciar sesión con google'), t: 'login google', f: { 'src/login.js': 4 } },
      { ts: now - 3e6, q: tokenize('modo oscuro en la portada'), t: 'modo oscuro', f: { 'src/styles/theme.css': 4 } },
    ],
  };
  assert.equal(where(p, 'los descuentos del carrito').files[0].rel, 'src/cart.js');
  assert.equal(where(p, 'falla iniciar sesión').files[0].rel, 'src/login.js');
  assert.equal(where(p, 'cambiar el theme').files[0].rel, 'src/styles/theme.css'); // por el nombre del fichero
  assert.equal(where(p, 'xyz').files.length, 0);
});

// ---------- atlas: un solo mapa para todos los proyectos ----------
import { buildAtlas, brief, hint, evaluate, scope } from '../server/atlas.js';
import { applyReadings } from '../server/plan.js';
import { fromStatusLine, fromUsageApi, manualReading } from '../server/usage.js';

function umbrellaState(now) {
  const T = (d, text, f, extra = {}) => ({ ts: now - d * 86400e3, s: 's', t: text, q: tokenize(text), f, x: 3, n: 6, e: true, ...extra });
  return {
    projects: {
      paraguas: {
        key: 'paraguas', name: 'Proyectos', cwd: '/u/Proyectos',
        files: { 'tienda/src/cart.js': { r: 4, e: 3, last: now }, 'blog/posts/hola.md': { r: 1, e: 1, last: now } },
        cmds: { 'tienda\tnpm test': 2 },
        turns: [
          T(5, 'el carrito suma mal los descuentos', { 'tienda/src/cart.js': 4 }, { k: ['revisar'] }),
          T(4, 'nuevo post sobre el viaje', { 'blog/posts/hola.md': 3 }),
          T(3, 'el carrito y el post comparten estilo', { 'tienda/src/cart.js': 1, 'blog/posts/hola.md': 1 }),
        ],
      },
      tienda: { key: 'tienda', name: 'tienda', cwd: '/u/Proyectos/tienda', files: { 'src/login.js': { r: 2, e: 2, last: now } }, cmds: {}, turns: [T(2, 'arregla el login con google', { 'src/login.js': 4 })] },
      otro: { key: 'otro', name: 'otro', cwd: '/u/Proyectos/otro', files: {}, cmds: {}, turns: [] },
    },
  };
}

test('atlas: lo hecho desde la carpeta paraguas vuelve a su proyecto real', () => {
  const now = Date.now();
  const A = buildAtlas(umbrellaState(now), { home: '/u', now });
  const tienda = A.regions.get('/u/Proyectos/tienda');
  assert.ok(tienda.files['src/cart.js'] && tienda.files['src/login.js']); // de la sesión paraguas y de la propia
  assert.equal(tienda.cmds['npm test'], 2);
  assert.equal(tienda.turns.length, 3);
  assert.ok(A.regions.get('/u/Proyectos/blog')); // subcarpeta sin sesiones propias: también es un proyecto
  assert.ok(A.connections.some((c) => c.why[0].includes('tocaron las dos')));
  assert.equal(scope(A, '/u/Proyectos').mode, 'all');
  assert.equal(scope(A, '/u/Proyectos/tienda/src').sub, 'src');
});

test('atlas: pista solo si hay algo claro, y brief corto', () => {
  const now = Date.now();
  const A = buildAtlas(umbrellaState(now), { home: '/u', now });
  const h = hint(A, '/u/Proyectos/tienda', 'los descuentos del carrito están mal', { now });
  assert.ok(h && h.files[0] === 'src/cart.js');
  assert.match(h.text, /revisar/); // la skill que sirvió en la tarea parecida
  assert.equal(hint(A, '/u/Proyectos/tienda', 'qué tiempo hace', { now }), null);
  assert.equal(hint(A, '/u/Proyectos/tienda', '/compact', { now }), null);
  const all = hint(A, '/u/Proyectos', 'los descuentos del carrito', { now });
  assert.equal(all.files[0], 'tienda/src/cart.js');
  const b = brief(A, '/u/Proyectos', { now });
  assert.match(b, /tienda\//);
  assert.ok(b.length < 1500);
  const ev = evaluate(A);
  assert.ok(ev.tasks >= 1 && ev.hitRate >= 0 && ev.hitRate <= 1);
});

test('plan: una lectura real manda sobre la estimación', () => {
  const SLOT = 600e3;
  const now = Date.now();
  const slots = {};
  const start = Math.floor((now - 2 * 86400e3) / SLOT);
  for (let k = start; k <= Math.floor(now / SLOT); k++) slots[k] = 0.1; // consumo constante
  const reset = now + 2 * 86400e3;
  const readTs = now - 3600e3;
  const plan = { h5: { used: 0, budget: 45 }, week: { used: 0, budget: 290 }, rate: 0.6 };
  applyReadings(plan, [{ ts: readTs, src: 'claude-code', week: { pct: 50, reset } }], slots, now);
  assert.equal(plan.week.real.pct, 0.5);
  assert.equal(plan.week.end, reset);
  // el presupuesto sale de la lectura (lo visto en local ÷ 50 %) y después se suma lo gastado
  assert.ok(plan.week.pct > 0.5 && plan.week.pct < 0.6, String(plan.week.pct));
  const sl = fromStatusLine({ five_hour: { used_percentage: 6, resets_at: 1795050600 }, seven_day: { used_percentage: 77, resets_at: 1795132800 } }, 1);
  assert.deepEqual(sl.week, { pct: 77, reset: 1795132800000 });
  const api = fromUsageApi({ five_hour: { utilization: 12, resets_at: '2026-11-19T01:10:00Z' } }, 1);
  assert.equal(api.h5.pct, 12);
  assert.equal(api.week, null);
  assert.equal(manualReading({ week: '77,5' }, { week: { end: 5 } }).week.pct, 77.5);
});

test('ingest: la terminal recuerda el cd entre órdenes', () => {
  const b = newBrain();
  const t = Date.now() - 60e3;
  const tool = (id, command, s) => b.processRecord(assistant(id, t + s * 1000, { output_tokens: 1 }, [{ type: 'tool_use', id: 'tu_' + id, name: 'Bash', input: { command } }]), { ...ctx });
  b.processRecord({ type: 'user', timestamp: new Date(t).toISOString(), sessionId: 'ses-1', cwd: '/tmp/proj', message: { content: 'prueba la web' } }, ctx);
  tool('a', 'cd web && ls', 1);
  tool('b', 'npm run build', 2);
  assert.equal(b.s.projects.proj.cmds['web\tnpm run build'], 1);
  assert.equal(normCmd('npm install three'), null);
  assert.equal(normCmd('.venv/bin/python /tmp/x.py'), null);
});
