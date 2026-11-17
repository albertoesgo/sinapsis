// Capa de datos: paneles, EEG, anatomía del pensamiento, inventario, etiquetas y detalle.
import * as THREE from 'three';
import { TYPE_COLOR, TYPE_LABEL } from './neurons.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const usd = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
const usd0 = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const money = (x) => (x >= 100 ? usd0 : usd).format(x || 0);
export function tok(n) {
  n = n || 0;
  if (n >= 1e9) return (n / 1e9).toLocaleString('es-ES', { maximumFractionDigits: 2 }) + ' G';
  if (n >= 1e6) return (n / 1e6).toLocaleString('es-ES', { maximumFractionDigits: 1 }) + ' M';
  if (n >= 1e3) return (n / 1e3).toLocaleString('es-ES', { maximumFractionDigits: 1 }) + ' k';
  return String(Math.round(n));
}
const sumTok = (t) => (t ? t.in + t.cr + t.cw + t.out : 0);
export function ago(ts) {
  if (!ts) return 'nunca';
  const s = (Date.now() - ts) / 1000;
  if (s < 45) return 'ahora';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  const d = Math.round(s / 86400);
  return d === 1 ? 'ayer' : `hace ${d} días`;
}
const hhmm = (ts) => new Date(ts).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const cssColor = (c) => '#' + c.getHexString();
function stateOf(last) {
  if (!last) return ['nunca', 'Sin usar'];
  const s = Date.now() - last;
  if (s < 10 * 60e3) return ['vivo', 'En uso'];
  if (s < 24 * 3600e3) return ['hoy', 'Activa hoy'];
  if (s < 7 * 86400e3) return ['semana', 'Esta semana'];
  return ['dormida', 'Dormida'];
}

const CTX = { warn: 100000, high: 200000, max: 600000 };
const ctxLevel = (c) => (c >= CTX.high ? 'high' : c >= CTX.warn ? 'warn' : 'ok');
const LIVE_MS = 30 * 60e3;

const CH = [
  { key: 'prompt', label: 'Entrada', color: '#f4f1ea' },
  { key: 'thought', label: 'Razonamiento', color: '#ffcf8a' },
  { key: 'tool', label: 'Acción', color: '#b993ff' },
  { key: 'agent', label: 'Subagentes', color: '#ff9a5c' },
];

export class Hud {
  constructor(cb) {
    this.cb = cb;
    this.nodes = new Map();
    this.snap = null;
    this.feed = [];
    this.eeg = [];
    this.labels = new Map();
    this.showLabels = true;
    this.turns = new Map();
    this.bind();
  }

  bind() {
    $('#btn-replay').onclick = () => {
      if (this.replaying) { this.cb.onReplay(null); return; }
      if (!this.snap?.recent?.length) return;
      this.cb.onReplay(this.snap.recent);
    };
    $('#btn-rotate').onclick = (e) => { const on = e.currentTarget.classList.toggle('on'); this.cb.onToggleRotate(on); };
    $('#btn-labels').onclick = (e) => { this.showLabels = e.currentTarget.classList.toggle('on'); };
    $('#btn-info').onclick = () => $('#info').classList.add('open');
    $('#info').onclick = (e) => { if (e.target.id === 'info' || e.target.closest('.close')) $('#info').classList.remove('open'); };
    $('#detail .close').onclick = () => this.hideDetail();
    document.querySelectorAll('#inventory .tabs button').forEach((b) => {
      b.onclick = () => {
        document.querySelectorAll('#inventory .tabs button').forEach((x) => x.classList.toggle('on', x === b));
        this.invTab = b.dataset.tab;
        this.renderInventory();
      };
    });
    $('#inv-toggle').onclick = (e) => { const o = $('#inventory').classList.toggle('open'); e.currentTarget.classList.toggle('on', o); };
    document.querySelectorAll('.panel .collapse').forEach((b) => { b.onclick = () => b.closest('.panel').classList.toggle('min'); });
    this.invTab = 'skills';
    // barra inferior (móvil)
    document.body.dataset.tab = 'brain';
    document.querySelectorAll('#tabbar button').forEach((b) => {
      b.onclick = () => this.setTab(b.dataset.tab === document.body.dataset.tab ? 'brain' : b.dataset.tab);
    });
    // QR para abrirlo en el móvil (solo disponible desde el propio ordenador)
    fetch('/api/mobile').then((r) => (r.ok ? r.json() : null)).then((m) => {
      if (!m || m.remote) { $('#btn-mobile').remove(); return; }
      this.mobileInfo = m;
    }).catch(() => $('#btn-mobile')?.remove());
    $('#btn-mobile').onclick = () => {
      const m = this.mobileInfo;
      if (!m) return;
      const box = $('#mobile');
      if (m.lan) {
        box.querySelector('.qr').innerHTML = m.qr;
        box.querySelector('.urls').innerHTML = m.urls.map((u) => esc(u.replace(/\?k=.*/, ''))).join('<br>');
      } else {
        box.querySelector('.qr').innerHTML = '';
        box.querySelector('.how').innerHTML = 'El acceso desde la red está desactivado. Arranca Sinapsis con <code>npm start -- --lan</code> o instala el servicio con <code>npm run service:install</code>.';
        box.querySelector('.tip').textContent = '';
      }
      box.classList.add('open');
    };
    $('#btn-report').onclick = () => this.openReport();
    $('#report').onclick = (e) => { if (e.target.id === 'report' || e.target.closest('.close')) $('#report').classList.remove('open'); };
    $('#mobile').onclick = (e) => { if (e.target.id === 'mobile' || e.target.closest('.close')) $('#mobile').classList.remove('open'); };
    this.eegCanvas = $('#eeg canvas');
    this.ctx = this.eegCanvas.getContext('2d');
    $('#eeg .legend').innerHTML = CH.map((c) => `<span><i style="background:${c.color}"></i>${c.label}</span>`).join('');
  }

  setTab(tab) {
    document.body.dataset.tab = tab;
    document.querySelectorAll('#tabbar button').forEach((x) => x.classList.toggle('on', x.dataset.tab === tab));
    if (tab !== 'brain') this.hideDetail();
    if (tab === 'inv') this.renderInventory();
    if (tab === 'metab' && this.snap) this.renderMetabolism(this.snap);
  }

  setConnection(ok) {
    $('#conn').className = ok ? 'ok' : 'off';
    $('#conn').title = ok ? 'Conectado en tiempo real' : 'Reconectando…';
  }

  setNodes(nodes) {
    this.nodes = nodes;
    const host = $('#labels');
    host.innerHTML = '';
    this.labels.clear();
    for (const n of nodes.values()) {
      if (!['project', 'model'].includes(n.type)) continue;
      const el = document.createElement('div');
      el.className = 'lbl ' + n.type;
      el.innerHTML = `<span>${esc(n.label)}</span>`;
      el.style.setProperty('--c', cssColor(n.color));
      el.onclick = () => this.cb.onFocus(n.id);
      host.appendChild(el);
      this.labels.set(n.id, el);
    }
    for (const n of nodes.values()) {
      if (n.type !== 'session') continue;
      const el = document.createElement('div');
      el.className = 'lbl ctx';
      el.innerHTML = '<span></span>';
      host.appendChild(el);
      this.labels.set('ctx:' + n.id, el);
    }
    this.updateCtxLabels();
    for (const r of REGIONS) {
      const el = document.createElement('div');
      el.className = 'lbl region';
      el.innerHTML = `<b>${r.name}</b><span>${r.sub}</span>`;
      host.appendChild(el);
      this.labels.set('region:' + r.name, el);
    }
  }

  updateCtxLabels() {
    const now = Date.now();
    for (const [id, el] of this.labels) {
      if (!id.startsWith('ctx:')) continue;
      const s = this.nodes.get(id.slice(4))?.data;
      const on = s && s.ctx && (s.live || now - (s.ctxTs || 0) < LIVE_MS);
      el.dataset.on = on ? '1' : '';
      if (!on) continue;
      el.className = 'lbl ctx lvl-' + ctxLevel(s.ctx) + (el.classList.contains('vis') ? ' vis' : '');
      el.querySelector('span').textContent = tok(s.ctx);
    }
  }

  renderLive() {
    const snap = this.snap;
    if (!snap) return;
    const now = Date.now();
    const pname = (k) => snap.projects.find((p) => p.key === k)?.name || '';
    const list = snap.sessions.filter((s) => s.ctx && (s.live || now - (s.ctxTs || 0) < LIVE_MS)).sort((a, b) => b.ctx - a.ctx);
    const tipFor = (s) => {
      const l = ctxLevel(s.ctx);
      if (l === 'high') return 'Pesada: /compact o sesión nueva';
      if (l === 'warn') return 'Creciendo: /compact al terminar la tarea';
      return 'Ligera';
    };
    $('#live-list').innerHTML = list.length ? list.map((s) => {
      const l = ctxLevel(s.ctx);
      const w = Math.min(100, (s.ctx / CTX.max) * 100);
      return `<li class="lvl-${l}" data-id="session:${esc(s.id)}">
        <div class="top"><b>${esc(s.title || 'Sesión sin título')}</b><small>${esc(pname(s.project))}</small><span class="v">${tok(s.ctx)}</span></div>
        <div class="gauge"><i style="width:${w.toFixed(1)}%"></i><em style="left:${(CTX.warn / CTX.max) * 100}%"></em><em style="left:${(CTX.high / CTX.max) * 100}%"></em></div>
        <div class="tip">${tipFor(s)}${s.turnSteps ? ` · ${s.turnSteps} pasos en esta petición` : ''} · ${ago(s.ctxTs)}</div></li>`;
    }).join('') : '<li class="empty">Ninguna sesión trabajando en los últimos 30 min.</li>';
    $('#live-list').querySelectorAll('li[data-id]').forEach((li) => { li.onclick = () => this.cb.onFocus(li.dataset.id); });
    this.updateCtxLabels();
  }

  onAlert(a) {
    const el = document.createElement('div');
    el.className = 'toast ' + (a.kind || '');
    el.innerHTML = `<b>${esc(a.title)}</b><span>${esc(a.body)}</span>`;
    el.onclick = () => { el.remove(); if (a.kind === 'weekly') this.openReport(); else if (a.s) this.cb.onFocus('session:' + a.s); };
    $('#toasts').prepend(el);
    setTimeout(() => el.remove(), 14000);
    try { navigator.vibrate?.([80, 60, 80]); } catch { /* sin vibración */ }
  }

  async openReport() {
    const box = $('#report');
    box.classList.add('open');
    const r = await fetch('/api/report').then((x) => x.json());
    const pct = (d, invert = false) => {
      if (d == null) return '<span>sin datos previos</span>';
      const up = d > 0;
      const cls = (invert ? !up : up) ? 'up' : 'down';
      return `<span class="${cls}">${up ? '▲' : '▼'} ${Math.abs(Math.round(d * 100))} %</span> <span>vs semana anterior</span>`;
    };
    const f = (ts) => new Date(ts).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
    const effTot = Object.values(r.cur.effort).reduce((a, b) => a + b, 0) || 1;
    const eff = ['low', 'medium', 'high', 'xhigh', 'max'].filter((e) => r.cur.effort[e]).map((e) => `${e} ${Math.round((r.cur.effort[e] / effTot) * 100)} %`).join(' · ');
    box.querySelector('.content').innerHTML = `
      <p class="range">${f(r.from)} – ${f(r.to)} · valores orientativos a precios de la API, no lo que pagas</p>
      <div class="kpis">
        <div><small>Peticiones</small><b>${r.cur.prompts}</b>${pct(r.delta.prompts, true)}</div>
        <div><small>Por petición</small><b>${money(r.cur.perPrompt)}</b>${pct(r.delta.perPrompt)}</div>
        <div><small>Valor semana</small><b>${money(r.cur.cost)}</b>${pct(r.delta.cost)}</div>
        <div><small>Leído / escrito</small><b>${Math.round(r.cur.read / Math.max(1, r.cur.out))} : 1</b><span>${tok(r.cur.read)} leídos</span></div>
      </div>
      <h3>Qué cambiar</h3>
      <ul class="tips">${r.tips.map((t) => `<li class="t-${t.level}"><b>${esc(t.title)}</b><span>${esc(t.text)}</span></li>`).join('')}</ul>
      ${r.sessions.length ? `<h3>Sesiones más pesadas</h3><table><tr><th>Sesión</th><th>Proyecto</th><th class="n">Contexto medio</th><th class="n">Pasos</th><th class="n">Pasos/petición</th></tr>
        ${r.sessions.map((s) => `<tr><td>${esc(s.title || 'Sin título')}</td><td>${esc(s.project)}</td><td class="n ${s.avgCtx > CTX.high ? 'up' : ''}">${tok(s.avgCtx)}</td><td class="n">${s.steps}</td><td class="n">${Math.round(s.stepsPerPrompt)}</td></tr>`).join('')}</table>` : ''}
      ${r.projects.length ? `<h3>Por proyecto</h3><table><tr><th>Proyecto</th><th class="n">Peticiones</th><th class="n">Por petición</th><th class="n">Tendencia</th><th class="n">Valor</th></tr>
        ${r.projects.map((p) => `<tr><td>${esc(p.name)}</td><td class="n">${p.prompts}</td><td class="n">${p.perPrompt != null ? money(p.perPrompt) : '—'}</td><td class="n">${p.trend == null ? '—' : `<span class="${p.trend > 0 ? 'up' : 'down'}">${p.trend > 0 ? '▲' : '▼'} ${Math.abs(Math.round(p.trend * 100))} %</span>`}</td><td class="n">${money(p.cost)}</td></tr>`).join('')}</table>` : ''}
      ${eff ? `<h3>Esfuerzo usado</h3><p class="muted">${eff}</p>` : ''}`;
  }

  render(snap) {
    this.snap = snap;
    if (!this.eegSeeded) {
      this.eegSeeded = true;
      for (const ev of snap.recent) if (Date.now() - ev.ts < 6 * 60e3) this.pushEeg(ev);
      this.feed = snap.recent.filter((e) => e.k !== 'result' || e.err).slice(-40).reverse();
      for (const ev of snap.recent) this.trackTurn(ev);
      this.renderFeed();
    }
    $('#demo-badge').hidden = !snap.demo;
    const live = snap.liveSessions.length;
    const day24 = snap.recent.length;
    $('#status').innerHTML = `<b>${live}</b> ${live === 1 ? 'sesión viva' : 'sesiones vivas'} · <b>${day24.toLocaleString('es-ES')}</b> impulsos en 24 h`;
    this.renderMetabolism(snap);
    this.renderProjects(snap);
    this.renderLive();
    this.renderThought(snap.lastThought);
    this.renderInventory();
  }

  // ---------- metabolismo ----------
  renderMetabolism(snap) {
    const days = Object.entries(snap.daily).sort(([a], [b]) => a.localeCompare(b));
    const today = new Date().toLocaleDateString('sv-SE');
    const sumDays = (n) => {
      const cut = new Date(Date.now() - (n - 1) * 86400e3).toLocaleDateString('sv-SE');
      return days.filter(([d]) => d >= cut).reduce((a, [, v]) => ({ cost: a.cost + v.cost, tok: a.tok + sumTok(v.tok) }), { cost: 0, tok: 0 });
    };
    const d1 = sumDays(1), d7 = sumDays(7), d30 = sumDays(30);
    const T = snap.totals;
    $('#m-today').textContent = money(d1.cost);
    $('#m-today-tok').textContent = tok(d1.tok) + ' tokens hoy';
    $('#m-grid').innerHTML = [
      ['7 días', money(d7.cost), tok(d7.tok)],
      ['30 días', money(d30.cost), tok(d30.tok)],
      ['Total', money(T.cost), tok(sumTok(T.tok))],
    ].map(([a, b, c]) => `<div><small>${a}</small><b>${b}</b><span>${c}</span></div>`).join('');
    const cache = T.tok.cr / Math.max(1, T.tok.cr + T.tok.cw + T.tok.in);
    $('#m-cache').innerHTML = `<span>Contexto servido desde caché</span><b>${(cache * 100).toLocaleString('es-ES', { maximumFractionDigits: 1 })} %</b>`;

    // barras diarias (30 días) apiladas por proyecto
    const cv = $('#m-days');
    const dpr = Math.min(2, window.devicePixelRatio);
    const W = cv.clientWidth, H = cv.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    const c = cv.getContext('2d');
    c.scale(dpr, dpr);
    const list = [];
    for (let i = 29; i >= 0; i--) {
      const k = new Date(Date.now() - i * 86400e3).toLocaleDateString('sv-SE');
      list.push([k, snap.daily[k]]);
    }
    const max = Math.max(0.01, ...list.map(([, v]) => v?.cost || 0));
    const bw = W / list.length;
    list.forEach(([k, v], i) => {
      let y = H;
      if (!v) { c.fillStyle = 'rgba(255,255,255,0.06)'; c.fillRect(i * bw + 1, H - 1, bw - 2, 1); return; }
      for (const [pk, cost] of Object.entries(v.byProject).sort((a, b) => b[1] - a[1])) {
        const h = (cost / max) * (H - 4);
        const n = this.nodes.get('project:' + pk);
        c.fillStyle = n ? cssColor(n.color) : '#888';
        c.globalAlpha = k === today ? 1 : 0.75;
        c.fillRect(i * bw + 1, y - h, bw - 2, h);
        y -= h;
      }
    });
    c.globalAlpha = 1;
    $('#m-days-max').textContent = money(max);

    const models = [...snap.models].sort((a, b) => b.cost - a.cost);
    const mmax = Math.max(1e-6, ...models.map((m) => m.cost));
    $('#m-models').innerHTML = models.map((m) => `
      <div class="bar" data-id="model:${esc(m.name)}"><span>${esc(m.label)}</span><i><em style="width:${(m.cost / mmax) * 100}%"></em></i><b>${money(m.cost)}</b></div>`).join('');
    $('#m-models').querySelectorAll('.bar').forEach((el) => { el.onclick = () => this.cb.onFocus(el.dataset.id); });
  }

  renderProjects(snap) {
    const ps = [...snap.projects].sort((a, b) => b.last - a.last);
    const week = (offset) => {
      const acc = {};
      for (let i = 0; i < 7; i++) {
        const d = snap.daily[new Date(Date.now() - (i + offset) * 86400e3).toLocaleDateString('sv-SE')];
        if (!d) continue;
        for (const [k, c] of Object.entries(d.byProject || {})) (acc[k] ||= { c: 0, n: 0 }).c += c;
        for (const [k, n] of Object.entries(d.byProjectPrompts || {})) (acc[k] ||= { c: 0, n: 0 }).n += n;
      }
      return acc;
    };
    const w0 = week(0), w1 = week(7);
    const ppr = (key) => {
      const a = w0[key], b = w1[key];
      if (!a || !a.n) return '';
      const v = a.c / a.n;
      let tr = '';
      if (b && b.n) { const d = (v - b.c / b.n) / (b.c / b.n); tr = ` <span class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'}${Math.abs(Math.round(d * 100))} %</span>`; }
      return `<div class="ppr">≈${money(v)} por petición (7 días)${tr}</div>`;
    };
    $('#projects').innerHTML = ps.map((p) => {
      const n = this.nodes.get('project:' + p.key);
      const [st] = stateOf(p.last);
      const ag = Object.entries(p.agents).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `<em class="t-agent">${esc(k)} ×${v}</em>`).join('');
      const sk = Object.entries(p.skills).slice(0, 3).map(([k, v]) => `<em class="t-skill">${esc(k)} ×${v}</em>`).join('');
      const mc = Object.entries(p.mcps).slice(0, 2).map(([k, v]) => `<em class="t-mcp">${esc(k.replace(/^claude_ai_/, ''))} ×${v}</em>`).join('');
      return `<li data-id="project:${esc(p.key)}">
        <i class="dot ${p.live ? 'live' : st}" style="--c:${n ? cssColor(n.color) : '#888'}"></i>
        <div class="pname"><b>${esc(p.name || p.key)}</b><small>${p.sessions.length} ses. · ${tok(sumTok(p.tok))} · ${ago(p.last)}</small>
        ${ppr(p.key)}<div class="chips">${ag}${sk}${mc}</div></div>
        <span class="pcost">${money(p.cost)}</span></li>`;
    }).join('');
    $('#projects').querySelectorAll('li').forEach((li) => { li.onclick = () => this.cb.onFocus(li.dataset.id); });
  }

  // ---------- anatomía del último pensamiento ----------
  renderThought(t) {
    const el = $('#thought');
    if (!t) { el.querySelector('.body').innerHTML = '<p class="muted">Aún no hay pensamientos registrados.</p>'; return; }
    const [inp, cr, cw, out, th] = t.u;
    const sh = t.shape || this.snap?.lastShape || null;
    const shOther = !t.shape && !!sh;
    // El tamaño exacto del prompt de sistema y de las herramientas se estima por proporción de caracteres (≈3,6 car./token)
    const sys = sh ? Math.round(sh.systemChars / 3.6) : 0;
    const tools = sh ? Math.round(sh.toolsChars / 3.6) : 0;
    const read = inp + cr + cw;
    const conv = Math.max(0, read - sys - tools);
    const segsIn = !sh ? [['Contexto completo', read, '#6fd3ff', '']] : [
      ['Instrucciones de sistema', Math.min(sys, read), '#7fa2ff', '≈'],
      ['Definición de herramientas', Math.min(tools, Math.max(0, read - sys)), '#b993ff', '≈'],
      ['Conversación y ficheros', conv, '#6fd3ff', ''],
    ];
    const segsCache = [['Leído de caché', cr, '#3f5d8a'], ['Escrito en caché', cw, '#8a6a3f'], ['Nuevo', inp, '#e8e4da']];
    const segsOut = [['Razonamiento', th, '#ffcf8a'], ['Respuesta y acciones', Math.max(0, out - th), '#f4f1ea']];
    const bar = (segs, total) => `<div class="stack">${segs.map(([n, v, c]) => v > 0 ? `<i style="flex:${v};background:${c}" title="${esc(n)}: ${tok(v)}"></i>` : '').join('')}</div>`;
    const leg = (segs) => `<div class="leg">${segs.map(([n, v, c, pre = '']) => `<span><i style="background:${c}"></i>${n} <b>${pre}${tok(v)}</b></span>`).join('')}</div>`;
    const turn = this.turns.get(t.s) || [];
    const steps = turn.slice(-14).map((e) => {
      if (e.k === 'prompt') return `<em class="st prompt" title="${esc(e.text)}">petición</em>`;
      if (e.k === 'thought') return `<em class="st thought" title="Tokens generados en este paso (incluye razonamiento)">${esc(prettyM(e.m).split(' ')[0])} · ${tok(e.u[3])}</em>`;
      if (e.k === 'tool') return `<em class="st ${e.tgt.split(':')[0]}" title="${esc(e.d || '')}">${esc(e.tgt.startsWith('tool:') ? e.n : e.tgt.split(':').slice(1).join(':').replace(/^claude_ai_/, ''))}</em>`;
      return '';
    }).join('<span class="arrow">›</span>');
    el.querySelector('.body').innerHTML = `
      <div class="thead"><b>${esc(t.project || '')}</b><span>${esc(t.title || 'sesión sin título')}</span><span class="r">${esc(prettyM(t.m))}${t.e ? ' · esfuerzo ' + esc(t.e) : ''} · ${ago(t.ts)}</span></div>
      <div class="row"><label>Lo que tenía en la cabeza <b>${tok(read)}</b> tokens${shOther ? ' <span class="muted">· reparto ≈ según la última petición registrada</span>' : ''}</label>${bar(segsIn)}${leg(segsIn)}</div>
      <div class="row"><label>De dónde salió</label>${bar(segsCache)}${leg(segsCache)}</div>
      <div class="row"><label>Lo que produjo <b>${tok(out)}</b> tokens${t.td ? ` · pensó durante ${(t.td / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} s` : ''}</label>${bar(segsOut)}${leg(segsOut)}</div>
      ${sh ? `<div class="row tools"><label>Herramientas cargadas en el contexto: ${sh.nTools}</label><div class="chips">${sh.topTools.map(([n, c]) => `<em>${esc(n)} <b>≈${tok(c / 3.6)}</b></em>`).join('')}</div></div>` : ''}
      ${steps ? `<div class="row chain"><label>Cadena del turno</label><div class="steps">${steps}</div></div>` : ''}
      <div class="foot">Coste de este paso ≈ ${money(t.c)} · motivo de parada: ${esc(STOP[t.stop] || t.stop || '—')}</div>`;
  }

  trackTurn(ev) {
    if (ev.a) return;
    let arr = this.turns.get(ev.s);
    if (ev.k === 'prompt' || !arr) { arr = []; this.turns.set(ev.s, arr); }
    if (ev.k === 'result') return;
    arr.push(ev);
    if (arr.length > 60) arr.shift();
  }

  // ---------- impulsos ----------
  onPulse(ev, fromReplay) {
    this.pushEeg({ ...ev, ts: fromReplay ? Date.now() : Math.max(ev.ts, Date.now() - 500) });
    if (ev.k === 'result' && !ev.err) return;
    this.trackTurn(ev);
    this.feed.unshift(ev);
    if (this.feed.length > 60) this.feed.length = 60;
    const ul = $('#feed');
    ul.insertAdjacentHTML('afterbegin', this.feedItem(ev));
    while (ul.children.length > 40) ul.lastElementChild.remove();
    if (ev.k === 'thought' && !ev.a && !fromReplay && this.snap) {
      const ss = this.snap.sessions.find((x) => x.id === ev.s);
      if (ss) { ss.ctx = ev.u[0] + ev.u[1] + ev.u[2]; ss.ctxTs = ev.ts; ss.turnSteps = (ss.turnSteps || 0) + 1; this.renderLive(); }
    } else if (ev.k === 'prompt' && !fromReplay && this.snap) {
      const ss = this.snap.sessions.find((x) => x.id === ev.s);
      if (ss) { ss.turnSteps = 0; this.renderLive(); }
    }
    if (ev.k === 'thought' && !ev.a && !fromReplay && this.snap) {
      const p = this.snap.projects.find((x) => x.key === ev.p);
      const s = this.snap.sessions.find((x) => x.id === ev.s);
      this.snap.lastThought = { ...ev, shape: this.snap.lastThought?.s === ev.s ? this.snap.lastThought.shape : null, project: p?.name, title: s?.title };
      this.renderThought(this.snap.lastThought);
    } else if (ev.k === 'tool' && !ev.a && this.snap?.lastThought?.s === ev.s) {
      this.renderThought(this.snap.lastThought);
    }
  }

  renderFeed() {
    $('#feed').innerHTML = this.feed.slice(0, 40).map((e) => this.feedItem(e, true)).join('');
  }

  feedItem(e, quiet = false) {
    const projName = (k) => this.snap?.projects.find((p) => p.key === k)?.name || '';
    {
      let kind = e.k, txt = '';
      if (e.k === 'prompt') txt = `<q>${esc(e.text)}</q>`;
      else if (e.k === 'thought') txt = `${esc(prettyM(e.m))} piensa <b>${tok(e.u[3])}</b> tok · lee ${tok(e.u[0] + e.u[1] + e.u[2])}`;
      else if (e.k === 'tool') { kind = e.tgt.split(':')[0]; txt = `<b>${esc(e.tgt.startsWith('mcp:') ? e.tgt.slice(4).replace(/^claude_ai_/, '') + ' · ' + e.d : e.tgt.startsWith('tool:') ? e.n : e.tgt.split(':').slice(1).join(':'))}</b> ${e.tgt.startsWith('mcp:') ? '' : esc(e.d || '')}`; }
      else if (e.k === 'result') { kind = 'error'; txt = `error en <b>${esc(e.n)}</b>`; }
      const who = e.a ? `<span class="who agent">${esc(e.at)}</span>` : '';
      return `<li class="k-${kind}${quiet ? ' quiet' : ''}"><time>${hhmm(e.ts)}</time><i></i><div><small>${esc(projName(e.p))}${who}</small>${txt}</div></li>`;
    }
  }

  pushEeg(ev) {
    let ch, amp;
    if (ev.a && ev.k !== 'result') { ch = 3; amp = ev.k === 'thought' ? Math.min(1, 0.3 + (ev.u?.[3] || 0) / 3000) : 0.5; }
    else if (ev.k === 'prompt') { ch = 0; amp = 1; }
    else if (ev.k === 'thought') { ch = 1; amp = Math.min(1, 0.2 + (ev.u?.[3] || 0) / 2500); }
    else if (ev.k === 'tool') { ch = ev.tgt?.startsWith('agent:') ? 3 : 2; amp = 0.7; }
    else return;
    this.eeg.push({ ts: ev.ts, ch, amp });
    if (this.eeg.length > 3000) this.eeg.splice(0, 1000);
  }

  drawEeg(t) {
    const cv = this.eegCanvas, c = this.ctx;
    const dpr = Math.min(2, window.devicePixelRatio);
    const W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    const span = 180e3; // 3 minutos
    const now = Date.now();
    const rowH = H / CH.length;
    // rejilla temporal
    c.strokeStyle = 'rgba(255,255,255,0.04)';
    c.lineWidth = 1;
    for (let s = 0; s <= 180; s += 30) { const x = W - (s / 180) * W; c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
    const evs = this.eeg.filter((e) => now - e.ts < span + 4000);
    CH.forEach((chn, i) => {
      const mid = rowH * i + rowH * 0.62;
      const list = evs.filter((e) => e.ch === i);
      c.beginPath();
      c.strokeStyle = chn.color;
      c.globalAlpha = 0.85;
      c.lineWidth = 1.2;
      for (let x = 0; x <= W; x += 2) {
        const tt = now - ((W - x) / W) * span;
        let y = 0;
        for (const e of list) {
          const d = (tt - e.ts) / 1000;
          if (d < -0.2 || d > 4) continue;
          // potencial de acción: subida rápida, hiperpolarización y oscilación amortiguada
          y += e.amp * (d < 0 ? Math.exp(-(d * d) / 0.004) : Math.exp(-d * 2.2) * Math.cos(d * 14) * 0.9);
        }
        const yy = mid - Math.max(-0.8, Math.min(1.4, y)) * rowH * 0.42;
        x === 0 ? c.moveTo(x, yy) : c.lineTo(x, yy);
      }
      c.stroke();
      c.globalAlpha = 1;
    });
  }

  // ---------- inventario ----------
  renderInventory() {
    const snap = this.snap;
    if (!snap) return;
    const tab = this.invTab;
    let rows = [];
    if (tab === 'skills') rows = snap.skills.map((s) => ({ id: 'skill:' + s.name, name: s.name, sub: s.description || s.source, n: (s.uses || 0) + (s.attributed || 0), unit: 'usos', last: s.last }));
    if (tab === 'agents') rows = snap.agents.map((a) => ({ id: 'agent:' + a.name, name: a.name, sub: `${a.source || ''} · ${tok(sumTok(a.tok))} · ${money(a.cost || 0)}`, n: a.spawns || 0, unit: 'lanzados', last: a.last }));
    if (tab === 'tools') rows = snap.tools.filter((t) => !t.name.startsWith('mcp__')).map((t) => ({ id: 'tool:' + t.name, name: t.name, sub: t.errors ? `${t.errors} errores` : '', n: t.uses, unit: 'usos', last: t.last }));
    if (tab === 'mcps') rows = snap.mcps.map((m) => ({ id: 'mcp:' + m.name, name: m.label, sub: Object.keys(m.tools).slice(0, 4).join(', '), n: m.uses, unit: 'llamadas', last: m.last }));
    if (tab === 'memory') rows = snap.memory.map((m) => ({ id: 'memory:' + m.key, name: snap.projects.find((p) => p.key === m.key)?.name || m.key, sub: `${m.files || 0} ficheros · ${m.writes || 0} escrituras`, n: (m.reads || 0) + (m.writes || 0), unit: 'accesos', last: m.last }));
    rows.sort((a, b) => (b.last || 0) - (a.last || 0) || b.n - a.n);
    const counts = rows.reduce((a, r) => { a[stateOf(r.last)[0]] = (a[stateOf(r.last)[0]] || 0) + 1; return a; }, {});
    $('#inv-summary').innerHTML = `${rows.length} en total · <span class="s-vivo">${counts.vivo || 0} en uso</span> · <span class="s-hoy">${counts.hoy || 0} hoy</span> · <span class="s-nunca">${counts.nunca || 0} nunca usadas</span>`;
    $('#inv-list').innerHTML = rows.map((r) => {
      const [st, stl] = stateOf(r.last);
      return `<li data-id="${esc(r.id)}"><i class="dot ${st}"></i><div><b>${esc(r.name)}</b><small>${esc(r.sub || '')}</small></div><span>${r.n ? r.n.toLocaleString('es-ES') + ' ' + r.unit : '—'}<small>${stl}${r.last ? ' · ' + ago(r.last) : ''}</small></span></li>`;
    }).join('');
    $('#inv-list').querySelectorAll('li').forEach((li) => { li.onclick = () => this.cb.onFocus(li.dataset.id); });
  }

  // ---------- etiquetas y tooltip ----------
  frame(camera, nodes, t) {
    const W = window.innerWidth, H = window.innerHeight;
    const v = new THREE.Vector3();
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    for (const [id, el] of this.labels) {
      let pos;
      if (id.startsWith('region:')) pos = REGIONS.find((r) => 'region:' + r.name === id).pos;
      else pos = nodes.get(id)?.pos;
      if (id.startsWith('ctx:')) pos = el.dataset.on ? nodes.get(id.slice(4))?.pos : null;
      if (!pos || !this.showLabels) { el.style.opacity = 0; continue; }
      v.copy(pos).project(camera);
      const x = (v.x * 0.5 + 0.5) * W, y = (-v.y * 0.5 + 0.5) * H;
      const depth = v.z;
      const facing = pos.clone().sub(camera.position).normalize().dot(camDir);
      const dist = pos.distanceTo(camera.position);
      let op = depth < 1 && facing > 0 ? Math.max(0, Math.min(1, (34 - dist) / 14)) : 0;
      if (id.startsWith('region:')) op *= 0.75;
      el.style.opacity = op.toFixed(2);
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      el.classList.toggle('vis', op > 0.3);
    }
    if (this.tipNode) this.positionTip();
    if (!this._eegT || t - this._eegT > 1 / 30) { this._eegT = t; this.drawEeg(t); }
  }

  hover(n, mouse) {
    const tip = $('#tip');
    this.tipNode = n;
    this.mouse = mouse;
    if (!n) { tip.classList.remove('show'); return; }
    if (tip.dataset.id !== n.id) {
      tip.dataset.id = n.id;
      tip.innerHTML = this.describe(n, true);
      tip.style.setProperty('--c', cssColor(n.color));
    }
    tip.classList.add('show');
    this.positionTip();
  }

  positionTip() {
    const tip = $('#tip');
    if (!this.mouse) return;
    const x = Math.min(window.innerWidth - 300, this.mouse.x + 16);
    const y = Math.min(window.innerHeight - 160, this.mouse.y + 14);
    tip.style.transform = `translate(${x}px, ${y}px)`;
  }

  describe(n, short) {
    const d = n.data || {};
    const [, stl] = stateOf(d.last);
    const kv = (k, v) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`;
    let body = '';
    if (n.type === 'project') body = kv('Coste estimado', money(d.cost)) + kv('Tokens', tok(sumTok(d.tok))) + kv('Sesiones', d.sessions.length) + kv('Peticiones', d.prompts) + kv('Respuestas del modelo', d.msgs.toLocaleString('es-ES'));
    if (n.type === 'session') body = kv('Coste estimado', money(d.cost)) + kv('Tokens', tok(sumTok(d.tok))) + kv('Peticiones', d.prompts) + kv('Subagentes', d.subagents) + kv('Modelos', Object.keys(d.models).map(prettyM).join(', '));
    if (n.type === 'model') body = kv('Coste estimado', money(d.cost)) + kv('Respuestas', d.msgs.toLocaleString('es-ES')) + kv('Leídos', tok(d.tok.in + d.tok.cr + d.tok.cw)) + kv('Generados', tok(d.tok.out)) + kv('Razonamiento', tok(d.tok.th));
    if (n.type === 'tool') body = kv('Usos', d.uses.toLocaleString('es-ES')) + kv('Errores', d.errors) + kv('Proyectos', Object.keys(d.projects).length);
    if (n.type === 'skill') body = kv('Usos', (d.uses || 0) + (d.attributed ? ` (+${d.attributed} pasos)` : '')) + kv('Origen', d.source || '—') + (d.installed === false ? kv('Instalada', 'no (externa)') : '');
    if (n.type === 'agent') body = kv('Lanzamientos', d.spawns || 0) + kv('Coste estimado', money(d.cost || 0)) + kv('Tokens', tok(sumTok(d.tok)));
    if (n.type === 'mcp') body = kv('Llamadas', d.uses) + kv('Herramientas', Object.keys(d.tools).length);
    if (n.type === 'memory') body = kv('Ficheros', d.files || 0) + kv('Lecturas', d.reads || 0) + kv('Escrituras', d.writes || 0);
    if (n.type === 'input') body = kv('Peticiones totales', d.prompts) + kv('Origen', 'tus mensajes');
    const desc = !short && d.description ? `<p class="desc">${esc(d.description)}</p>` : '';
    return `<small class="type">${TYPE_LABEL[n.type] || n.type}${REGION_OF[n.type] ? ' · ' + REGION_OF[n.type] : ''}</small><h4>${esc(n.label)}</h4>${body}${d.last ? kv('Última actividad', `${stl} · ${ago(d.last)}`) : ''}${desc}`;
  }

  showDetail(n, snap) {
    const el = $('#detail');
    el.style.setProperty('--c', cssColor(n.color));
    let extra = '';
    const d = n.data || {};
    const list = (title, obj, fmt = (k) => k, max = 8) => {
      const e = Object.entries(obj || {}).sort((a, b) => b[1] - a[1]).slice(0, max);
      return e.length ? `<h5>${title}</h5><ul class="mini">${e.map(([k, v]) => `<li><span>${esc(fmt(k))}</span><b>${typeof v === 'number' ? v.toLocaleString('es-ES', { maximumFractionDigits: 2 }) : v}</b></li>`).join('')}</ul>` : '';
    };
    const pname = (k) => snap.projects.find((p) => p.key === k)?.name || k;
    if (n.type === 'project') {
      const ss = snap.sessions.filter((s) => s.project === d.key).sort((a, b) => b.last - a.last);
      extra = `<h5>Sesiones</h5><ul class="mini click">${ss.map((s) => `<li data-id="session:${s.id}"><span>${s.live ? '● ' : ''}${esc(s.title || s.id.slice(0, 8))}</span><b>${money(s.cost)}</b></li>`).join('')}</ul>`
        + list('Agentes que trabajan aquí', d.agents) + list('Skills', d.skills) + list('Herramientas', d.tools) + list('Conectores', d.mcps, (k) => k.replace(/^claude_ai_/, '')) + list('Modelos (respuestas)', d.models, prettyM);
    } else if (n.type === 'session') {
      extra = list('Herramientas', d.tools) + list('Subagentes', d.agents) + list('Modelos (respuestas)', d.models, prettyM);
    } else if (['tool', 'skill', 'mcp'].includes(n.type)) {
      extra = list('Por proyecto', d.projects, pname) + (n.type === 'mcp' ? list('Herramientas del conector', d.tools) : '');
    } else if (n.type === 'agent') {
      extra = list('Por proyecto', d.projects, pname) + list('Herramientas que usa', d.tools);
    }
    el.querySelector('.content').innerHTML = this.describe(n, false) + extra;
    el.querySelectorAll('.click li').forEach((li) => { li.onclick = () => this.cb.onFocus(li.dataset.id); });
    el.classList.add('open');
    if (matchMedia('(max-width: 760px)').matches && document.body.dataset.tab !== 'brain') this.setTab('brain');
  }

  hideDetail() { $('#detail').classList.remove('open'); }

  setReplay(ts, frac) {
    this.replaying = ts != null;
    $('#btn-replay').classList.toggle('on', this.replaying);
    $('#btn-replay').querySelector('span').textContent = this.replaying ? 'Detener' : 'Reproducir 24 h';
    const r = $('#replay');
    r.hidden = !this.replaying;
    if (this.replaying) {
      r.querySelector('b').textContent = new Date(ts).toLocaleString('es-ES', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
      r.querySelector('i').style.width = (frac * 100).toFixed(1) + '%';
    }
  }
}

const STOP = { end_turn: 'terminó el turno', tool_use: 'usar una herramienta', max_tokens: 'límite de tokens', refusal: 'rechazo', pause_turn: 'pausa' };
function prettyM(m = '') {
  const s = m.replace(/^claude-/, '');
  const [f, ...v] = s.split('-');
  return f ? f[0].toUpperCase() + f.slice(1) + (v.length ? ' ' + v.join('.') : '') : m;
}

const REGION_OF = { project: 'corteza', session: 'corteza', model: 'tálamo', tool: 'corteza motora', skill: 'cerebelo', agent: 'giro cingulado', mcp: 'lóbulo temporal', memory: 'hipocampo', input: 'tronco encefálico' };
const REGIONS = [
  { name: 'Corteza motora', sub: 'herramientas', pos: new THREE.Vector3(0, 5.6, 0.6) },
  { name: 'Cerebelo', sub: 'skills', pos: new THREE.Vector3(0, -4.4, -5.6) },
  { name: 'Tálamo', sub: 'modelos', pos: new THREE.Vector3(0, 0.2, 0.2) },
  { name: 'Lóbulo temporal', sub: 'conectores', pos: new THREE.Vector3(-5.7, -2.6, 1.2) },
  { name: 'Giro cingulado', sub: 'subagentes', pos: new THREE.Vector3(0, 3.9, -2.6) },
  { name: 'Hipocampo', sub: 'memoria', pos: new THREE.Vector3(2.6, -2.3, -0.4) },
  { name: 'Tronco encefálico', sub: 'tus peticiones', pos: new THREE.Vector3(0, -7.7, -2.5) },
];
