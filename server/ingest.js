// Lee los registros reales de Claude Code (~/.claude/projects/**/*.jsonl) de forma incremental,
// agrega el consumo y emite "impulsos" (eventos) en tiempo real.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { costOf, prettyModel } from './pricing.js';
import { scanInventory } from './inventory.js';

const CACHE_VERSION = 7;

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
    const files = this.listFiles();
    let rebuild = false;
    for (const f of files) {
      let size;
      try { size = fs.statSync(f).size; } catch { continue; }
      const off = this.s.offsets[f] || 0;
      if (size < off) { rebuild = true; break; }
    }
    if (rebuild) {
      this.s = emptyState();
      this.seen = new Set();
      return this.scan();
    }
    let changed = false;
    for (const f of files) {
      let size;
      try { size = fs.statSync(f).size; } catch { continue; }
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
      p = this.s.projects[key] = { key, name: null, cwd: null, prof: zeroProf(), tok: zeroTok(), cost: 0, msgs: 0, prompts: 0, sessions: {}, tools: {}, skills: {}, agents: {}, mcps: {}, models: {}, first: 0, last: 0 };
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
    if (!m || !m.model || m.model === '<synthetic>') return;
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
        const dd = this.dayEntry(ts);
        addTok(dd.tok, tok); dd.cost += cost; dd.msgs++;
        inc(dd.byProject, p.key, cost); inc(dd.byModel, model, cost);
        if (agentType) dd.agentCost += cost;
        if (d.effort && !agentType) inc(dd.effort, d.effort);
      }
      if (!agentType) this.trackContext(s, p, tok, ts);
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

  snapshot() {
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
    const projects = Object.values(s.projects).map((p) => ({ ...p, sessions: Object.keys(p.sessions), live: Object.keys(p.sessions).some((id) => this.liveSessions.has(id)) }));
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
      recent: s.recent.filter((e) => e.ts > now - RECENT_MS).slice(-6000),
      liveSessions: [...this.liveSessions],
    };
  }
}
