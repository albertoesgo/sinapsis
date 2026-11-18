// Lee los registros reales de Claude Code (~/.claude/projects/**/*.jsonl) de forma incremental,
// agrega el consumo y emite "impulsos" (eventos) en tiempo real.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { costOf, prettyModel } from './pricing.js';
import { scanInventory } from './inventory.js';
import { planStatus } from './plan.js';
import { tokenize, projectMap } from './where.js';

const CACHE_VERSION = 10;
const TURNS_MAX = 400;   // peticiones recordadas por proyecto para el mapa «dónde mirar»
const FILES_MAX = 600;
const SLOT_MS = 10 * 60e3; // consumo en franjas de 10 min, para las ventanas del plan
const SLOT_KEEP_MS = 45 * 86400e3;

// ---------- perfil de actividad: a qué se dedica de verdad cada proyecto ----------
// Cada acción real se clasifica en una de cuatro funciones; el cerebro coloca el proyecto
// en la zona cortical que hace esa función en un cerebro humano.
const IMG = /\.(png|jpe?g|webp|gif|svg|heic|bmp|avif)$/i;
const DOC = /\.(md|mdx|txt|pdf|docx?|rtf|csv)$/i;
export function toolCategory(name, input = {}) {
  if (name.startsWith('mcp__')) {
    if (/canva|unsplash|figma|image|photo|design|video/i.test(name)) return 'vision';
    if (/docs|drive|notion|gmail|calendar|slack|search|wiki/i.test(name)) return 'lang';
    return 'exec';
  }
  if (name === 'WebFetch' || name === 'WebSearch') return 'lang';
  if (name === 'Agent' || name === 'Task') return /plan/i.test(input.subagent_type || '') ? 'plan' : null;
  if (['AskUserQuestion', 'TodoWrite', 'EnterPlanMode', 'ExitPlanMode'].includes(name)) return 'plan';
  const fp = String(input.file_path || input.path || input.notebook_path || '');
  if (name === 'Read' || name === 'Write' || name === 'Edit') return IMG.test(fp) ? 'vision' : DOC.test(fp) ? 'lang' : 'exec';
  if (name === 'Bash') return /screenshot|playwright|puppeteer|ffmpeg|magick|\bsips\b|\.(png|jpe?g|webp|mp4|mov)\b/i.test(input.command || '') ? 'vision' : 'exec';
  if (['Glob', 'Grep', 'NotebookEdit'].includes(name)) return 'exec';
  return null;
}
const zeroProf = () => ({ plan: 0, exec: 0, lang: 0, vision: 0 });
// Umbrales de contexto (tokens que el modelo relee en cada paso) para avisar
export const CTX_LEVELS = { warn: 100000, high: 200000 };
const CTX_ALERTS = [200000, 400000, 600000];
const RECENT_MS = 24 * 3600 * 1000;
const RECENT_MAX = 12000;
const TOP_TYPES = new Set(['ai-title', 'custom-title', 'agent-name', 'api-request-shape']);
const CHUNK = 8 * 1024 * 1024;

const zeroTok = () => ({ in: 0, cr: 0, cw: 0, out: 0, th: 0 });
const addTok = (a, b) => { a.in += b.in; a.cr += b.cr; a.cw += b.cw; a.out += b.out; a.th += b.th; };
const inc = (obj, k, n = 1) => { obj[k] = (obj[k] || 0) + n; };
const day = (ts) => new Date(ts).toLocaleDateString('sv-SE'); // AAAA-MM-DD en hora local
const clip = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');

// Solo órdenes que ejecutan algo del proyecto (no git, ni utilidades de shell, ni texto suelto)
const RUNNER = /^(npm|npx|pnpm|yarn|bun|bunx|node|deno|tsx|python3?|pip3?|uv|poetry|pytest|make|cargo|go|docker|docker-compose|wrangler|vercel|netlify|supabase|firebase|flutter|dart|swift|xcodebuild|gradle|ruby|bundle|rails|php|composer|mvn|dotnet|terraform|kubectl|vite|remotion|bash|sh|\.{1,2}\/\S+|\.venv\/bin\/\S+|venv\/bin\/\S+)$/;
/** «npm run build -- --x» → «npm run build»; solo órdenes de ejecución reconocibles y de 2 o 3 palabras. */
export function normCmd(cmd) {
  const out = [];
  for (const t of String(cmd).trim().split(/\s+/)) {
    if (out.length >= 3 || /^-|["'`$<>|&;=*(){}\\]|:\/\//.test(t) || t.length > 40) break;
    out.push(t);
  }
  if (out.length < 2 || !RUNNER.test(out[0])) return null;
  // ni instalaciones ni scripts temporales: el mapa guarda cómo se prueba y se ejecuta el proyecto
  if (/^(install|i|ci|add|remove|uninstall|update|upgrade|init|create|exec|-m)$/.test(out[1]) || out.some((t) => /^\/(tmp|private|var)\//.test(t))) return null;
  if (/^(bash|sh)$/.test(out[0]) && !/\.sh$/.test(out[1])) return null;
  return out.join(' ');
}

const fileCache = new Map();
/** ¿Existe este fichero? (con caché: la misma ruta aparece en muchas órdenes) */
function isFile(abs) {
  if (!fileCache.has(abs)) { let ok = false; try { ok = fs.statSync(abs).isFile(); } catch { ok = false; } fileCache.set(abs, ok); if (fileCache.size > 50000) fileCache.clear(); }
  return fileCache.get(abs);
}
const PATH_RE = /(?:^|[\s'"=(:,])((?:~\/|\.{1,2}\/|\/)?[\w@.-]+(?:\/[\w@.[\]-]+)*\/?[\w@.[\]-]*\.(?:js|mjs|cjs|ts|tsx|jsx|css|scss|html|md|mdx|json|py|rb|go|rs|java|kt|swift|vue|svelte|astro|sh|yml|yaml|toml|sql|txt|csv))\b/gi;
/** Rutas de fichero que aparecen en una orden de terminal (como mucho 24). */
export function pathTokens(cmd) {
  const out = new Set();
  for (const m of String(cmd).matchAll(PATH_RE)) { if (!/^https?:/.test(m[1]) && !m[1].includes('node_modules')) out.add(m[1]); if (out.size >= 24) break; }
  return out;
}


const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
/** «10:50pm», «3am», «Nov 13 at 1am» → marca de tiempo (hora local del ordenador). */
export function parseReset(txt, ts) {
  const t = String(txt).trim().match(/(?:([A-Za-z]{3})[a-z]*\s+(\d{1,2})(?:,?\s*(\d{4}))?\s*(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (!t) return null;
  let h = +t[4] % 12; if (t[6].toLowerCase() === 'pm') h += 12;
  const d = new Date(ts);
  if (t[1]) {
    const mo = MONTHS[t[1].toLowerCase()];
    if (mo == null) return null;
    d.setMonth(mo, +t[2]);
    if (t[3]) d.setFullYear(+t[3]);
  }
  d.setHours(h, +(t[5] || 0), 0, 0);
  if (d.getTime() <= ts) {
    if (t[1]) { if (!t[3]) d.setFullYear(d.getFullYear() + 1); } else d.setDate(d.getDate() + 1);
  }
  return d.getTime();
}

export function mcpName(server) {
  return server.replace(/^claude_ai_/, '').replace(/^plugin_[^_]+_/, '').replace(/_/g, ' ');
}

function emptyState() {
  return {
    version: CACHE_VERSION,
    offsets: {},
    totals: { tok: zeroTok(), cost: 0, msgs: 0, prompts: 0, tools: 0 },
    projects: {},
    sessions: {},
    models: {},
    tools: {},
    skills: {},
    agentTypes: {},
    mcps: {},
    memory: {},
    daily: {},
    edges: {},
    shapes: {},
    recent: [],
    lastThought: null,
    seenMsg: [],
    agentMeta: {},
    slots: {},
    limits: {},
  };
}

export class Brain {
  constructor({ claudeDir = path.join(os.homedir(), '.claude'), cacheFile, onEvent = () => {}, onTopology = () => {}, onAlert = () => {} } = {}) {
    this.onAlert = onAlert;
    this.claudeDir = claudeDir;
    this.root = path.join(claudeDir, 'projects');
    this.cacheFile = cacheFile;
    this.onEvent = onEvent;
    this.onTopology = onTopology;
    this.s = emptyState();
    this.seen = new Set();
    this.pendingTools = new Map();
    this.live = false;
    this.dirty = false;
    this.liveSessions = new Set();
    this.inventory = { skills: {}, agents: {}, memory: {} };
    this.home = os.homedir();
    this.openTurn = new Map(); // sesión → petición en curso (para saber qué ficheros sirvieron para qué)
    this.readings = []; // lecturas reales del % del plan (server/usage.js)
    this.hints = new Map(); // sesión → pistas que Sinapsis le dio a Claude (para medir si ahorran)
  }

  // ---------- persistencia ----------
  load() {
    if (!this.cacheFile) return false;
    try {
      const st = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8'));
      if (st.version !== CACHE_VERSION) return false;
      this.s = st;
      this.seen = new Set(st.seenMsg || []);
      return true;
    } catch {
      return false;
    }
  }

  save() {
    if (!this.cacheFile || !this.dirty) return;
    const arr = [...this.seen];
    this.s.seenMsg = arr.slice(-20000);
    if (this.seen.size > 30000) this.seen = new Set(this.s.seenMsg);
    this.s.recent = this.s.recent.filter((e) => e.ts > Date.now() - RECENT_MS).slice(-RECENT_MAX);
    for (const p of Object.values(this.s.projects)) {
      const fs_ = Object.entries(p.files || {});
      if (fs_.length > FILES_MAX) p.files = Object.fromEntries(fs_.sort((a, b) => (b[1].r + 3 * b[1].e) - (a[1].r + 3 * a[1].e) || b[1].last - a[1].last).slice(0, Math.round(FILES_MAX * 0.7)));
      const cs = Object.entries(p.cmds || {});
      if (cs.length > 80) p.cmds = Object.fromEntries(cs.sort((a, b) => b[1] - a[1]).slice(0, 60));
    }
    const minSlot = Math.floor((Date.now() - SLOT_KEEP_MS) / SLOT_MS);
    for (const k of Object.keys(this.s.slots)) if (+k < minSlot) delete this.s.slots[k];
    fs.mkdirSync(path.dirname(this.cacheFile), { recursive: true });
    const tmp = this.cacheFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.s));
    fs.renameSync(tmp, this.cacheFile);
    this.dirty = false;
  }

  // ---------- lectura de ficheros ----------
  listFiles() {
    const out = [];
    const walk = (d, depth) => {
      let ents;
      try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (depth < 4 && e.name !== 'memory') walk(p, depth + 1); }
        else if (e.name.endsWith('.jsonl')) out.push(p);
      }
    };
    walk(this.root, 0);
    return out;
  }

  ctxFor(file) {
    const rel = path.relative(this.root, file).split(path.sep);
    const projectKey = rel[0];
    let sessionId = path.basename(file, '.jsonl');
    let agentId = null;
    const si = rel.indexOf('subagents');
    if (si > 0) {
      sessionId = rel[si - 1];
      agentId = path.basename(file, '.jsonl').replace(/^agent-/, '');
      this.loadAgentMeta(file.replace(/\.jsonl$/, '.meta.json'), agentId);
    }
    return { projectKey, sessionId, agentId };
  }

  loadAgentMeta(metaFile, agentId) {
    if (this.s.agentMeta[agentId]) return;
    try {
      const m = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      this.s.agentMeta[agentId] = { type: m.agentType || 'subagente', desc: clip(m.description || '', 80) };
    } catch { /* aún no existe */ }
  }

  scan() {
    // Un solo stat por fichero: si alguno ha encogido (se reescribió), se relee todo desde cero.
    const sizes = [];
    for (const f of this.listFiles()) {
      let size;
      try { size = fs.statSync(f).size; } catch { continue; }
      if (size < (this.s.offsets[f] || 0)) {
        this.s = emptyState();
        this.seen = new Set();
        return this.scan();
      }
      sizes.push([f, size]);
    }
    let changed = false;
    for (const [f, size] of sizes) {
      const off = this.s.offsets[f] || 0;
      if (size > off) { this.readFrom(f, off, size); changed = true; }
    }
    if (changed) this.dirty = true;
    return changed;
  }

  readFrom(file, start, end) {
    const ctx = this.ctxFor(file);
    const fd = fs.openSync(file, 'r');
    let pos = start;
    let carry = '';
    const buf = Buffer.alloc(Math.min(CHUNK, Math.max(1, end - start)));
    try {
      while (pos < end) {
        const n = fs.readSync(fd, buf, 0, Math.min(buf.length, end - pos), pos);
        if (n <= 0) break;
        pos += n;
        const text = carry + buf.toString('utf8', 0, n);
        const lines = text.split('\n');
        carry = lines.pop();
        for (const line of lines) this.processLine(line, ctx);
      }
    } finally {
      fs.closeSync(fd);
    }
    // una línea incompleta al final se vuelve a leer en la siguiente pasada
    this.s.offsets[file] = end - Buffer.byteLength(carry, 'utf8');
  }

  processLine(line, ctx) {
    if (!line || line.length < 10) return;
    if (line.startsWith('{"type":"')) {
      const t = line.slice(9, line.indexOf('"', 9));
      if (!TOP_TYPES.has(t)) return;
    }
    let d;
    try { d = JSON.parse(line); } catch { return; }
    this.processRecord(d, ctx);
  }

  // ---------- agregación ----------
  project(key, cwd) {
    let p = this.s.projects[key];
    if (!p) {
      p = this.s.projects[key] = { key, name: null, cwd: null, prof: zeroProf(), tok: zeroTok(), cost: 0, msgs: 0, prompts: 0, sessions: {}, tools: {}, skills: {}, agents: {}, mcps: {}, models: {}, files: {}, cmds: {}, turns: [], first: 0, last: 0 };
      this.topologyChanged();
    }
    if (!p.name && cwd) {
      p.cwd = cwd;
      p.name = cwd === this.home ? '~ (inicio)' : path.basename(cwd);
    }
    return p;
  }

  session(id, pkey) {
    let s = this.s.sessions[id];
    if (!s) {
      s = this.s.sessions[id] = { id, project: pkey, title: null, tok: zeroTok(), cost: 0, msgs: 0, prompts: 0, tools: {}, models: {}, agents: {}, subagents: 0, first: 0, last: 0 };
      this.s.projects[pkey].sessions[id] = 1;
      this.topologyChanged();
    }
    return s;
  }

  touch(obj, ts) {
    if (!ts) return;
    if (!obj.first || ts < obj.first) obj.first = ts;
    if (ts > obj.last) obj.last = ts;
  }

  edge(a, b, ts, n = 1) {
    const k = a + '|' + b;
    let e = this.s.edges[k];
    if (!e) { e = this.s.edges[k] = { n: 0, last: 0 }; this.topologyChanged(); }
    e.n += n;
    if (ts > e.last) e.last = ts;
  }

  emit(ev) {
    if (ev.ts > Date.now() - RECENT_MS) {
      this.s.recent.push(ev);
      if (this.s.recent.length > RECENT_MAX * 1.2) this.s.recent = this.s.recent.slice(-RECENT_MAX);
    }
    if (this.live) this.onEvent(ev);
  }

  topologyChanged() {
    if (this.live) this.onTopology();
  }

  processRecord(d, ctx) {
    const type = d.type;
    if (type === 'ai-title' || type === 'custom-title' || type === 'agent-name') {
      const sid = d.sessionId || ctx.sessionId;
      const s = this.s.sessions[sid];
      const title = d.customTitle || d.aiTitle || d.agentName;
      if (s && title && (type !== 'ai-title' || !s.customTitle)) {
        s.title = clip(title, 70);
        if (type === 'custom-title') s.customTitle = true;
      } else if (!s && title) {
        // el título puede llegar antes que el primer mensaje
        this.s.pendingTitles = this.s.pendingTitles || {};
        this.s.pendingTitles[sid] = clip(title, 70);
      }
      return;
    }
    if (type === 'api-request-shape') {
      if (d.agentId || ctx.agentId) return;
      const sh = d.shape || {};
      const sys = (sh.system || []).map((b) => (b.text || '').length);
      const tools = (sh.tools || []).map((t) => [t.name || '?', JSON.stringify(t).length]);
      tools.sort((a, b) => b[1] - a[1]);
      this.s.shapes[ctx.sessionId] = {
        ts: Date.parse(d.timestamp) || 0,
        systemChars: sys.reduce((a, b) => a + b, 0),
        systemBlocks: sys.length,
        toolsChars: tools.reduce((a, b) => a + b[1], 0),
        nTools: tools.length,
        topTools: tools.slice(0, 8),
      };
      return;
    }
    if (type !== 'user' && type !== 'assistant') return;

    const ts = Date.parse(d.timestamp) || 0;
    const agentId = d.agentId || ctx.agentId || null;
    const sid = d.sessionId || ctx.sessionId;
    const p = this.project(ctx.projectKey, d.cwd);
    const s = this.session(sid, ctx.projectKey);
    if (!s.title && this.s.pendingTitles?.[sid]) s.title = this.s.pendingTitles[sid];
    this.touch(p, ts);
    this.touch(s, ts);
    const meta = agentId ? this.s.agentMeta[agentId] : null;
    const agentType = agentId ? (meta?.type || 'subagente') : null;
    const fromNode = agentId ? 'agent:' + agentType : 'session:' + sid;
    const base = { ts, p: ctx.projectKey, s: sid };
    if (agentId) { base.a = agentId; base.at = agentType; }

    if (type === 'assistant') this.onAssistant(d, p, s, fromNode, base, agentType);
    else this.onUser(d, p, s, base, agentId);
  }

  onAssistant(d, p, s, fromNode, base, agentType) {
    const m = d.message;
    if (m?.model === '<synthetic>') { this.onSynthetic(d, base.ts); return; }
    if (!m || !m.model) return;
    const model = m.model;
    const ts = base.ts;
    const modelNode = 'model:' + model;

    if (m.id && !this.seen.has(m.id)) {
      this.seen.add(m.id);
      const u = m.usage || {};
      const tok = {
        in: u.input_tokens || 0,
        cr: u.cache_read_input_tokens || 0,
        cw: u.cache_creation_input_tokens || 0,
        out: u.output_tokens || 0,
        th: u.output_tokens_details?.thinking_tokens || 0,
      };
      const cost = costOf(model, u);
      const T = this.s.totals;
      addTok(T.tok, tok); T.cost += cost; T.msgs++;
      addTok(p.tok, tok); p.cost += cost; p.msgs++; inc(p.models, model);
      addTok(s.tok, tok); s.cost += cost; s.msgs++; inc(s.models, model);
      const md = this.s.models[model] || (this.s.models[model] = { name: model, label: prettyModel(model), tok: zeroTok(), cost: 0, msgs: 0, first: 0, last: 0 });
      if (!md.msgs) this.topologyChanged();
      addTok(md.tok, tok); md.cost += cost; md.msgs++; this.touch(md, ts);
      if (agentType) {
        const at = this.agentType(agentType);
        addTok(at.tok, tok); at.cost += cost; at.msgs++; this.touch(at, ts);
      }
      if (ts) {
        const sk = Math.floor(ts / SLOT_MS);
        this.s.slots[sk] = (this.s.slots[sk] || 0) + cost;
        const dd = this.dayEntry(ts);
        addTok(dd.tok, tok); dd.cost += cost; dd.msgs++;
        inc(dd.byProject, p.key, cost); inc(dd.byModel, model, cost);
        if (agentType) dd.agentCost += cost;
        if (d.effort && !agentType) inc(dd.effort, d.effort);
      }
      if (!agentType) this.trackContext(s, p, tok, ts);
      const turn = this.openTurn.get(base.s);
      if (turn) turn.c = (turn.c || 0) + cost; // coste de la petición, subagentes incluidos
      this.edge(fromNode, modelNode, ts);
      const ev = { ...base, k: 'thought', m: model, u: [tok.in, tok.cr, tok.cw, tok.out, tok.th], c: cost, e: d.effort || null, td: d.thinkingDurationMs || null, stop: m.stop_reason || null };
      if (!base.a && (!this.s.lastThought || ts >= this.s.lastThought.ts)) {
        const sh = this.s.shapes[s.id];
        this.s.lastThought = { ...ev, shape: sh || null, project: p.name, title: s.title };
        s.lastThought = ev;
      }
      if (d.attributionSkill) this.useSkill(d.attributionSkill, p, ts, false);
      p.prof.plan += tok.th / 1000; // razonar ≈ planificar (1 unidad por cada 1.000 tokens de razonamiento)
      this.emit(ev);
    }

    for (const b of m.content || []) {
      if (!b || b.type !== 'tool_use' || !b.id) continue;
      if (this.pendingTools.has(b.id)) continue;
      this.onToolUse(b, p, s, model, modelNode, base, agentType);
    }
  }

  /** Mensajes que escribe el propio Claude Code, p. ej. «You've hit your 5-hour limit · resets 10:50pm». */
  onSynthetic(d, ts) {
    const text = (d.message?.content || []).map((b) => b?.text || '').join(' ');
    const m = text.match(/hit your (.+?) limit\s*[·•-]\s*resets\s+(.+?)\s*(?:\(([^)]+)\))?\s*$/i);
    if (!m || !ts) return;
    const kind = /5-hour/i.test(m[1]) ? '5h' : /weekly/i.test(m[1]) ? (/opus|sonnet|fable/i.test(m[1]) ? 'model-week' : 'week') : 'other';
    const resetTs = parseReset(m[2], ts);
    const key = `${kind}|${resetTs || m[2]}`;
    this.s.limits ||= {};
    const prev = this.s.limits[key];
    if (prev && prev.ts <= ts) return;
    this.s.limits[key] = { kind, label: m[1], ts, resetTs, resetText: m[2] };
    this.dirty = true;
  }

  dayEntry(ts) {
    const dk = day(ts);
    const dd = this.s.daily[dk] || (this.s.daily[dk] = { tok: zeroTok(), cost: 0, msgs: 0, byProject: {}, byModel: {} });
    dd.prompts ??= 0; dd.byProjectPrompts ??= {}; dd.effort ??= {}; dd.agentCost ??= 0;
    return dd;
  }

  /** Contexto real que el modelo releyó en este paso del hilo principal (entrada + caché). */
  trackContext(s, p, tok, ts) {
    const ctx = tok.in + tok.cr + tok.cw;
    s.ctx = ctx; s.ctxTs = ts;
    s.ctxMax = Math.max(s.ctxMax || 0, ctx);
    s.mainRead = (s.mainRead || 0) + ctx;
    s.mainMsgs = (s.mainMsgs || 0) + 1;
    s.turnSteps = (s.turnSteps || 0) + 1;
    if (ctx < 100000) s.alerted = 0; // tras /compact el contexto baja: se rearman los avisos
    if (!this.live) return;
    for (const th of CTX_ALERTS) {
      if (ctx >= th && (s.alerted || 0) < th) {
        s.alerted = th;
        this.onAlert({
          kind: 'context', ts, s: s.id, p: p.key, ctx, level: th,
          title: `${p.name || 'Sesión'}: ${Math.round(ctx / 1000)} k de contexto`,
          body: `«${s.title || 'Sesión sin título'}» relee ${Math.round(ctx / 1000)} k tokens en cada paso. Usa /compact o abre una sesión nueva para la siguiente tarea.`,
        });
      }
    }
  }

  agentType(name) {
    let at = this.s.agentTypes[name];
    if (!at) {
      at = this.s.agentTypes[name] = { name, spawns: 0, tok: zeroTok(), cost: 0, msgs: 0, tools: {}, projects: {}, first: 0, last: 0 };
      this.topologyChanged();
    }
    return at;
  }

  useSkill(rawName, p, ts, explicit) {
    const name = String(rawName).replace(/^[\w-]+:/, '');
    let sk = this.s.skills[name];
    if (!sk) { sk = this.s.skills[name] = { name, uses: 0, attributed: 0, first: 0, last: 0, projects: {} }; this.topologyChanged(); }
    if (explicit) sk.uses++; else sk.attributed++;
    inc(sk.projects, p.key);
    this.touch(sk, ts);
    if (explicit) inc(p.skills, name);
    return name;
  }

  onToolUse(b, p, s, model, modelNode, base, agentType) {
    const ts = base.ts;
    const name = b.name;
    const input = b.input || {};
    let target;
    let detail = '';
    if (name.startsWith('mcp__')) {
      const parts = name.split('__');
      const server = parts[1] || 'mcp';
      const mc = this.s.mcps[server] || (this.s.mcps[server] = { name: server, label: mcpName(server), uses: 0, tools: {}, first: 0, last: 0, projects: {} });
      if (!mc.uses) this.topologyChanged();
      mc.uses++; inc(mc.tools, parts.slice(2).join('__')); inc(mc.projects, p.key); this.touch(mc, ts);
      inc(p.mcps, server);
      target = 'mcp:' + server;
      detail = parts.slice(2).join(' ');
    } else if (name === 'Skill') {
      const sk = this.useSkill(input.skill || input.command || '?', p, ts, true);
      const turn = this.openTurn.get(base.s);
      if (turn && !(turn.k ||= []).includes(sk)) turn.k.push(sk); // qué skills sirvieron para qué tareas
      target = 'skill:' + sk;
      detail = sk;
    } else if (name === 'Agent' || name === 'Task') {
      const t = input.subagent_type || 'general-purpose';
      const at = this.agentType(t);
      at.spawns++; inc(at.projects, p.key); this.touch(at, ts);
      inc(p.agents, t); inc(s.agents, t); s.subagents++;
      target = 'agent:' + t;
      detail = clip(input.description || '', 60);
    } else {
      target = 'tool:' + name;
      if (input.description) detail = input.description;
      else if (input.file_path) detail = path.basename(String(input.file_path));
      else if (input.url) { try { detail = new URL(input.url).host; } catch { detail = ''; } }
      else if (input.query) detail = input.query;
      else if (input.pattern) detail = input.pattern;
      else if (input.command) detail = input.command;
      detail = clip(String(detail), 70);
    }
    const cat = toolCategory(name, input);
    if (cat) p.prof[cat]++;
    this.trackMap(name, input, p, base);
    const tl = this.s.tools[name] || (this.s.tools[name] = { name, uses: 0, errors: 0, first: 0, last: 0, projects: {} });
    if (!tl.uses) this.topologyChanged();
    tl.uses++; inc(tl.projects, p.key); this.touch(tl, ts);
    inc(p.tools, name); inc(s.tools, name);
    this.s.totals.tools++;
    if (agentType) inc(this.agentType(agentType).tools, name);

    let mem = null;
    const fp = String(input.file_path || input.path || '');
    if (fp.includes('/.claude/projects/') && fp.includes('/memory/')) {
      const mkey = fp.split('/.claude/projects/')[1].split('/')[0];
      const mm = this.s.memory[mkey] || (this.s.memory[mkey] = { key: mkey, reads: 0, writes: 0, first: 0, last: 0 });
      if (name === 'Read') mm.reads++; else mm.writes++;
      this.touch(mm, ts);
      mem = mkey;
      this.edge(modelNode, 'memory:' + mkey, ts);
    }

    this.edge(modelNode, target, ts);
    this.pendingTools.set(b.id, { name, target, mem });
    if (this.pendingTools.size > 5000) this.pendingTools.delete(this.pendingTools.keys().next().value);
    const ev = { ...base, k: 'tool', m: model, n: name, tgt: target, d: detail, id: b.id };
    if (mem) ev.mem = mem;
    this.emit(ev);
  }

  /**
   * Mapa del proyecto: qué ficheros se leen y editan (y en qué petición), qué órdenes se ejecutan
   * y cuántos pasos se dedican a buscar antes de tocar nada.
   */
  trackMap(name, input, p, base) {
    const turn = this.openTurn.get(base.s);
    const edit = /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(name);
    let explore = false;
    if (name === 'Read' || edit) {
      const rel = this.relPath(p, String(input.file_path || input.notebook_path || ''));
      if (rel) {
        const f = p.files[rel] || (p.files[rel] = { r: 0, e: 0, last: 0 });
        if (edit) f.e++; else f.r++;
        if (base.ts > f.last) f.last = base.ts;
        if (turn) turn.f[rel] = (turn.f[rel] || 0) + (edit ? 3 : 1);
      }
      explore = !edit;
      if (edit && turn) turn.e = true;
    } else if (name === 'Grep' || name === 'Glob' || name === 'LS') {
      explore = true;
    } else if (name === 'Bash') {
      const cmd = String(input.command || '').replace(/^\s*cd\s+[^&;]+(&&|;)\s*/, '');
      if (/^\s*(ls|find|grep|rg|cat|head|tail|tree|wc|sed\s+-n|awk)\b/.test(cmd)) explore = true;
      // ficheros nombrados en la orden (sed -i, scripts, redirecciones…): también cuentan para el mapa
      const raw = String(input.command || '');
      // la terminal de Claude Code conserva el «cd» entre órdenes (si no sale de la carpeta del proyecto)
      const ss = this.s.sessions[base.s];
      let at = ss?.sh && p.cwd && (ss.sh === p.cwd || ss.sh.startsWith(p.cwd + '/')) ? ss.sh : p.cwd;
      const cd = raw.match(/^\s*cd\s+("[^"]+"|'[^']+'|[^\s&;]+)\s*(?:&&|;|$)/)?.[1];
      if (cd && p.cwd) {
        const to = path.resolve(at || p.cwd, cd.replace(/^["']|["']$/g, '').replace(/^~(?=\/|$)/, this.home));
        at = to === p.cwd || to.startsWith(p.cwd + '/') ? to : p.cwd;
        if (ss) ss.sh = at;
      }
      const dir = at && at !== p.cwd ? at : null;
      if (!explore) {
        const k = normCmd(cmd);
        // la orden se apunta con la subcarpeta donde se ejecutó («sinapsis\tnpm test»)
        const relDir = dir && dir.startsWith(p.cwd + '/') ? dir.slice(p.cwd.length + 1) : '';
        if (k) { const key = relDir ? `${relDir}\t${k}` : k; p.cmds[key] = (p.cmds[key] || 0) + 1; }
      }
      for (const tok of pathTokens(raw)) {
        const abs = path.resolve(dir ? path.resolve(p.cwd || '/', dir) : (p.cwd || '/'), tok.replace(/^~(?=\/)/, this.home));
        const rel = this.relPath(p, abs);
        if (!rel || !isFile(abs)) continue; // solo rutas reales: en los scripts aparecen nombres que no son ficheros
        const ed = new RegExp(`(sed\\s+-i[^|;&\\n]*|>{1,2}\\s*|open\\(['"]?[^'"]*)${tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(raw) || /\.write\(|writeFileSync|open\([^)]*['"]w['"]/.test(raw);
        const f = p.files[rel] || (p.files[rel] = { r: 0, e: 0, last: 0 });
        if (ed) f.e++; else f.r++;
        if (base.ts > f.last) f.last = base.ts;
        if (turn) { turn.f[rel] = (turn.f[rel] || 0) + (ed ? 2 : 0.5); if (ed) turn.e = true; }
      }
    }
    if (turn) { turn.n++; if (explore && !turn.e) turn.x++; if (turn.h === undefined) this.attachHint(turn); }
  }

  /** Apunta una pista que Sinapsis dio a Claude (lo llama el servidor al responder al hook). */
  noteHint(h) {
    const list = this.hints.get(h.sid) || [];
    list.push(h);
    if (list.length > 20) list.shift();
    this.hints.set(h.sid, list);
    const turn = this.openTurn.get(h.sid);
    if (turn && turn.h === undefined) this.attachHint(turn);
  }

  /** Une la petición con la pista que recibió (misma sesión, casi el mismo momento). */
  attachHint(turn) {
    const list = this.hints.get(turn.s);
    if (!list) return;
    const i = list.findIndex((h) => Math.abs(h.ts - turn.ts) < 120e3);
    if (i < 0) return;
    const [h] = list.splice(i, 1);
    turn.h = h.files || [];
    this.dirty = true;
  }

  relPath(p, fp) {
    if (!fp || !p.cwd || !fp.startsWith(p.cwd + '/')) return null;
    const rel = fp.slice(p.cwd.length + 1);
    return /(^|\/)(node_modules|\.git|dist|build)\//.test(rel) ? null : rel;
  }

  onUser(d, p, s, base, agentId) {
    const c = d.message?.content;
    if (Array.isArray(c)) {
      for (const b of c) {
        if (b?.type !== 'tool_result') continue;
        const pend = this.pendingTools.get(b.tool_use_id);
        if (!pend) continue;
        this.pendingTools.delete(b.tool_use_id);
        if (b.is_error) { const t = this.s.tools[pend.name]; if (t) t.errors++; }
        this.emit({ ...base, k: 'result', n: pend.name, tgt: pend.target, err: !!b.is_error, id: b.tool_use_id });
      }
    }
    if (Array.isArray(c) && !agentId) p.prof.vision += c.filter((b) => b?.type === 'image').length; // imágenes que le enseñas
    if (d.isMeta || agentId || d.isSidechain || d.isCompactSummary) return;
    let text = '';
    if (typeof c === 'string') text = c;
    else if (Array.isArray(c)) text = c.filter((b) => b?.type === 'text').map((b) => b.text).join(' ');
    if (!text) return;
    const cmd = text.match(/<command-name>\/?([\w:-]+)<\/command-name>/);
    if (cmd) {
      const nm = cmd[1].replace(/^[\w-]+:/, '');
      if (this.inventory.skills[nm] || this.s.skills[nm]) {
        this.useSkill(nm, p, base.ts, true);
        this.edge('session:' + s.id, 'skill:' + nm, base.ts);
      }
      text = '/' + cmd[1];
    } else if (/^\s*</.test(text) || text.startsWith('Caveat:') || text.startsWith('[Request interrupted')) {
      return;
    }
    p.prompts++; s.prompts++; this.s.totals.prompts++;
    s.turnSteps = 0;
    if (!text.startsWith('/') && !agentId) {
      const turn = { ts: base.ts, s: s.id, t: clip(text.replace(/\s+/g, ' ').trim(), 110), q: tokenize(text, 40), f: {}, x: 0, n: 0, e: false };
      (p.turns ||= []).push(turn);
      if (p.turns.length > TURNS_MAX) p.turns.splice(0, p.turns.length - TURNS_MAX);
      this.openTurn.set(s.id, turn);
      this.attachHint(turn);
    }
    if (base.ts) { const dd = this.dayEntry(base.ts); dd.prompts++; inc(dd.byProjectPrompts, p.key); }
    this.edge('input', 'session:' + s.id, base.ts);
    this.emit({ ...base, k: 'prompt', text: clip(text.replace(/\s+/g, ' ').trim(), 140) });
  }

  // ---------- estado vivo ----------
  refreshLiveSessions() {
    const dir = path.join(this.claudeDir, 'sessions');
    const live = new Set();
    try {
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.json')) continue;
        try {
          const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
          if (!j.pid || !j.sessionId) continue;
          process.kill(j.pid, 0);
          live.add(j.sessionId);
        } catch { /* proceso muerto */ }
      }
    } catch { /* sin carpeta */ }
    const changed = live.size !== this.liveSessions.size || [...live].some((x) => !this.liveSessions.has(x));
    this.liveSessions = live;
    return changed;
  }

  refreshInventory() {
    const cwds = Object.values(this.s.projects).map((p) => p.cwd).filter(Boolean);
    this.inventory = scanInventory(this.claudeDir, cwds);
  }

  /** Estado agregado para el navegador. Con `{ recent: false }` omite los eventos de 24 h (lo más pesado). */
  snapshot({ recent = true } = {}) {
    const s = this.s;
    const now = Date.now();
    const inv = this.inventory;
    const skills = {};
    for (const [k, v] of Object.entries(inv.skills)) skills[k] = { ...v, uses: 0, attributed: 0, last: 0, installed: true };
    for (const [k, v] of Object.entries(s.skills)) skills[k] = { ...(skills[k] || { name: k, installed: false, source: 'externa' }), ...v };
    const agents = {};
    for (const [k, v] of Object.entries(inv.agents)) agents[k] = { ...v, spawns: 0, tok: zeroTok(), cost: 0, last: 0, installed: true };
    for (const [k, v] of Object.entries(s.agentTypes)) agents[k] = { ...(agents[k] || { name: k, source: 'integrado' }), ...v };
    const memory = {};
    for (const [k, v] of Object.entries(inv.memory)) memory[k] = { key: k, reads: 0, writes: 0, last: 0, ...v };
    for (const [k, v] of Object.entries(s.memory)) memory[k] = { ...(memory[k] || { files: 0 }), ...v };
    const sessions = Object.values(s.sessions).map((x) => ({ ...x, live: this.liveSessions.has(x.id), lastThought: undefined }));
    const projects = Object.values(s.projects).map(({ files: _f, turns: _t, cmds: _c, ...p }) => ({ ...p, sessions: Object.keys(p.sessions), live: Object.keys(p.sessions).some((id) => this.liveSessions.has(id)), map: projectMap(s.projects[p.key], { now, files: 8, cmds: 5, tasks: 0 }) }));
    return {
      generatedAt: now,
      totals: s.totals,
      projects,
      sessions,
      models: Object.values(s.models),
      tools: Object.values(s.tools),
      skills: Object.values(skills),
      agents: Object.values(agents),
      mcps: Object.values(s.mcps),
      memory: Object.values(memory),
      edges: Object.entries(s.edges).map(([k, v]) => { const [a, b] = k.split('|'); return { a, b, n: v.n, last: v.last }; }),
      daily: s.daily,
      lastThought: s.lastThought,
      lastShape: Object.values(s.shapes).sort((a, b) => b.ts - a.ts)[0] || null,
      recent: recent ? s.recent.filter((e) => e.ts > now - RECENT_MS).slice(-6000) : undefined,
      recentCount: s.recent.filter((e) => e.ts > now - RECENT_MS).length,
      liveSessions: [...this.liveSessions],
      plan: planStatus(s, now, this.readings),
    };
  }
}
