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
