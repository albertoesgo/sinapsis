// Modo demostración: genera actividad sintética con el mismo formato que Claude Code.
// Sirve para probar Sinapsis sin datos propios (y para las capturas del README).
import { randomUUID } from 'node:crypto';

const PROJECTS = [
  { key: 'demo-atlas', cwd: '/demo/atlas-web' },
  { key: 'demo-cafe', cwd: '/demo/tienda-cafe' },
  { key: 'demo-rutas', cwd: '/demo/app-rutas' },
  { key: 'demo-notas', cwd: '/demo/notas' },
  { key: 'demo-datos', cwd: '/demo/datos-clima' },
];
const MODELS = ['claude-opus-5-5', 'claude-opus-5-5', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-2'];
const TOOLS = ['Bash', 'Bash', 'Bash', 'Read', 'Read', 'Edit', 'Write', 'WebFetch', 'WebSearch', 'ToolSearch'];
const MCP = ['mcp__claude_ai_Canva__generate-image', 'mcp__claude_ai_Unsplash__search_photos', 'mcp__claude_ai_Docs__batch'];
const SKILLS = ['dataviz', 'pdf', 'redes', 'docs'];
const AGENTS = ['general-purpose', 'Explore', 'Plan'];
const PROMPTS = [
  'Añade un modo oscuro a la página de inicio',
  'Revisa por qué falla el build en producción',
  'Haz un carrusel de 5 posts para la nueva colección',
  'Optimiza las imágenes y el LCP de la home',
  'Escribe tests para el cálculo de rutas',
  'Resume los datos de lluvia de la última semana',
  'Prepara el PR con los cambios del checkout',
];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const R = (a, b) => Math.floor(a + Math.random() * (b - a));

export function startDemo(brain) {
  const sessions = PROJECTS.map((p) => ({ p, id: randomUUID(), sub: [] }));
  const extra = PROJECTS.slice(0, 3).map((p) => ({ p, id: randomUUID(), sub: [] }));
  const all = [...sessions, ...extra];

  const feed = (sess, rec, agentId = null) => {
    brain.processRecord({ ...rec, sessionId: sess.id, cwd: sess.p.cwd, ...(agentId ? { agentId } : {}) }, { projectKey: sess.p.key, sessionId: sess.id, agentId });
  };
  let o = 0;
  const assistant = (sess, ts, model, content, agentId) => feed(sess, {
    type: 'assistant', timestamp: new Date(ts).toISOString(), effort: pick(['medium', 'high', 'xhigh']), thinkingDurationMs: R(400, 9000),
    message: {
      id: 'msg_' + randomUUID(), model, stop_reason: content.some((c) => c.type === 'tool_use') ? 'tool_use' : 'end_turn', content,
      usage: { input_tokens: R(2, 40), cache_read_input_tokens: R(20000, 160000), cache_creation_input_tokens: R(200, 6000), output_tokens: (o = R(80, 2600)), output_tokens_details: { thinking_tokens: R(0, Math.floor(o * 0.7)) }, cache_creation: { ephemeral_5m_input_tokens: R(200, 6000), ephemeral_1h_input_tokens: 0 } },
    },
  }, agentId);
  const result = (sess, ts, id, agentId) => feed(sess, { type: 'user', timestamp: new Date(ts).toISOString(), message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: Math.random() < 0.05 }] } }, agentId);

  // Un "turno": petición → pensamientos → herramientas → resultados
  function turn(sess, t0, onStep) {
    const steps = [];
    let t = t0;
    const model = pick(MODELS);
    steps.push([t, () => feed(sess, { type: 'user', timestamp: new Date(t0).toISOString(), message: { content: pick(PROMPTS) } })]);
    const n = R(2, 7);
    for (let i = 0; i < n; i++) {
      t += R(1500, 6000);
      const r = Math.random();
      let tool;
      if (r < 0.08) tool = { name: 'Skill', input: { skill: pick(SKILLS) } };
      else if (r < 0.16) tool = { name: 'Agent', input: { subagent_type: pick(AGENTS), description: 'Investigar en paralelo' } };
      else if (r < 0.24) tool = { name: pick(MCP), input: {} };
      else tool = { name: pick(TOOLS), input: { description: pick(['Compilar', 'Ejecutar tests', 'Listar ficheros', 'Instalar dependencias']), file_path: '/demo/src/app.js' } };
      const id = 'toolu_' + randomUUID();
      const tt = t;
      steps.push([tt, () => assistant(sess, tt, model, [{ type: 'tool_use', id, ...tool }])]);
      if (tool.name === 'Agent') {
        const aid = 'demo' + R(1e6, 9e6);
        brain.s.agentMeta[aid] = { type: tool.input.subagent_type, desc: 'Investigar en paralelo' };
        for (let j = 0; j < R(2, 5); j++) {
          const ta = tt + 800 + j * 1300;
          const sid = 'toolu_' + randomUUID();
          steps.push([ta, () => assistant(sess, ta, 'claude-sonnet-5-5', [{ type: 'tool_use', id: sid, name: pick(['Read', 'WebFetch', 'Bash']), input: {} }], aid)]);
          steps.push([ta + 600, () => result(sess, ta + 600, sid, aid)]);
        }
      }
      t += R(500, 3000);
      const tr = t;
      steps.push([tr, () => result(sess, tr, id)]);
    }
    t += R(1000, 4000);
    const tf = t;
    steps.push([tf, () => assistant(sess, tf, model, [{ type: 'text', text: 'Hecho.' }])]);
    if (onStep) return steps;
    for (const [, fn] of steps) fn();
    return t;
  }

  // Historia: últimos 30 días
  const now = Date.now();
  for (let d = 30; d >= 0; d--) {
    const turns = R(3, 14);
    for (let i = 0; i < turns; i++) {
      const ts = now - d * 86400000 - R(0, 20) * 3600000 - R(0, 3600000);
      if (ts > now - 60000) continue;
      turn(pick(all), ts);
    }
  }
  for (let i = 0; i < 40; i++) {
    const ts = now - R(5, 23 * 60) * 60000;
    turn(pick(all), ts);
  }
  brain.s.recent.sort((a, b) => a.ts - b.ts);
  for (const s of all) brain.s.shapes[s.id] = { ts: now, systemChars: 31000, systemBlocks: 3, toolsChars: 98000, nTools: 26, topTools: [['Artifact', 56000], ['Bash', 9800], ['Agent', 7600], ['Edit', 4200]] };
  brain.inventory = {
    skills: Object.fromEntries([...SKILLS, 'xlsx', 'pptx', 'skill-creator', 'deep-research'].map((n) => [n, { name: n, source: 'demo', description: 'Skill de demostración' }])),
    agents: {},
    memory: Object.fromEntries(PROJECTS.map((p) => [p.key, { files: R(1, 6), bytes: 4000 }])),
  };
  const titles = ['Modo oscuro', 'Build roto', 'Carrusel otoño', 'Rendimiento home', 'Tests de rutas', 'Informe lluvia', 'Checkout', 'Ideas'];
  all.forEach((s, i) => { if (brain.s.sessions[s.id]) brain.s.sessions[s.id].title = titles[i % titles.length]; });
  brain.liveSessions = new Set(all.slice(0, 3).map((s) => s.id));
  brain.live = true;

  // Actividad en vivo
  const loop = () => {
    const sess = pick(all.slice(0, 4));
    const steps = turn(sess, Date.now(), true);
    const t0 = steps[0][0];
    for (const [t, fn] of steps) setTimeout(fn, (t - t0) * 0.6);
    setTimeout(loop, R(6000, 16000));
  };
  setTimeout(loop, 1500);
}
