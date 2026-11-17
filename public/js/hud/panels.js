// Paneles: sesiones abiertas, consumo, proyectos, último pensamiento e inventario.
import { FUNCTIONS } from '../neurons.js';
import { $, $$, CTX, LIVE_MS, STOP, ago, cssColor, ctxLevel, dayKey, esc, money, norm, pctTxt, prettyM, stateOf, sumTok, tok } from './format.js';

export const panelsMethods = {
  // ---------- sesiones abiertas ----------
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
  },

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
    $$('#live-list li[data-id]').forEach((li) => { li.onclick = () => this.cb.onFocus(li.dataset.id); });
    this.updateCtxLabels();
  },

  onAlert(a) {
    const el = document.createElement('div');
    el.className = 'toast ' + (a.kind || '');
    el.innerHTML = `<b>${esc(a.title)}</b><span>${esc(a.body)}</span><button class="x" title="Cerrar">×</button>`;
    el.onclick = (e) => {
      el.remove();
      if (e.target.closest('.x')) return;
      if (a.kind === 'weekly') this.openReport();
      else if (a.kind === 'plan') { const c = $('.card[data-card="plan"]'); c.classList.remove('folded'); c.scrollIntoView({ behavior: 'smooth' }); }
      else if (a.s) this.cb.onFocus('session:' + a.s);
    };
    $('#toasts').prepend(el);
    setTimeout(() => el.remove(), 14000);
    try { if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.([80, 60, 80]); } catch { /* sin vibración */ }
  },

  // ---------- consumo ----------
  renderMetabolism(snap) {
    const days = Object.entries(snap.daily).sort(([a], [b]) => a.localeCompare(b));
    const sumDays = (n) => {
      const cut = dayKey(Date.now() - (n - 1) * 86400e3);
      return days.filter(([d]) => d >= cut).reduce((a, [, v]) => ({ cost: a.cost + v.cost, tok: a.tok + sumTok(v.tok) }), { cost: 0, tok: 0 });
    };
    const d1 = sumDays(1), d7 = sumDays(7), d30 = sumDays(30);
    const T = snap.totals;
    $('#m-today').textContent = money(d1.cost);
    $('#m-today-tok').textContent = 'hoy · ' + tok(d1.tok) + ' tokens';
    $('#m-grid').innerHTML = [
      ['7 días', money(d7.cost), tok(d7.tok)],
      ['30 días', money(d30.cost), tok(d30.tok)],
      ['Total', money(T.cost), tok(sumTok(T.tok))],
    ].map(([a, b, c]) => `<div><small>${a}</small><b>${b}</b><span>${c}</span></div>`).join('');
    const cache = T.tok.cr / Math.max(1, T.tok.cr + T.tok.cw + T.tok.in);
    $('#m-cache').innerHTML = `<span>Contexto servido desde caché</span><b>${(cache * 100).toLocaleString('es-ES', { maximumFractionDigits: 1 })} %</b>`;

    // barras diarias (30 días) apiladas por proyecto
    const cv = $('#m-days');
    const W = cv.clientWidth, H = cv.clientHeight;
    if (W) {
      const dpr = Math.min(2, window.devicePixelRatio);
      cv.width = W * dpr; cv.height = H * dpr;
      const c = cv.getContext('2d');
      c.scale(dpr, dpr);
      const list = [];
      for (let i = 29; i >= 0; i--) { const k = dayKey(Date.now() - i * 86400e3); list.push([k, snap.daily[k]]); }
      this.dayList = list;
      const max = Math.max(0.01, ...list.map(([, v]) => v?.cost || 0));
      const bw = W / list.length;
      list.forEach(([, v], i) => {
        let y = H;
        if (!v) { c.fillStyle = 'rgba(255,255,255,0.07)'; c.fillRect(i * bw + 1, H - 1, bw - 2, 1); return; }
        for (const [pk, cost] of Object.entries(v.byProject).sort((a, b) => b[1] - a[1])) {
          const h = (cost / max) * (H - 4);
          const n = this.nodes.get('project:' + pk);
          c.fillStyle = n ? cssColor(n.color) : '#888';
          c.globalAlpha = (this.hoverDayIdx == null || this.hoverDayIdx === i) ? (i === list.length - 1 ? 1 : 0.8) : 0.3;
          c.fillRect(i * bw + 1, y - h, bw - 2, h);
          y -= h;
        }
      });
      c.globalAlpha = 1;
      $('#m-days-max').textContent = 'máx. ' + money(max);
    }

    const models = [...snap.models].sort((a, b) => b.cost - a.cost);
    const mmax = Math.max(1e-6, ...models.map((m) => m.cost));
    $('#m-models').innerHTML = models.map((m) => `
      <div class="bar" data-id="model:${esc(m.name)}"><span>${esc(m.label)}</span><i><em style="width:${(m.cost / mmax) * 100}%"></em></i><b>${money(m.cost)}</b></div>`).join('');
    $$('#m-models .bar').forEach((el) => { el.onclick = () => this.cb.onFocus(el.dataset.id); });
  },

  hoverDay(e) {
    const cv = $('#m-days');
    const r = cv.getBoundingClientRect();
    const i = Math.floor(((e.clientX - r.left) / r.width) * 30);
    const it = this.dayList?.[i];
    const tip = $('#htip');
    if (!it) { tip.classList.remove('show'); return; }
    if (this.hoverDayIdx !== i) { this.hoverDayIdx = i; this.renderMetabolism(this.snap); }
    const [k, v] = it;
    const date = new Date(k + 'T12:00').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' });
    const pname = (key) => this.snap.projects.find((p) => p.key === key)?.name || key;
    const rows = v ? Object.entries(v.byProject).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([pk, c]) => {
      const n = this.nodes.get('project:' + pk);
      return `<div class="row"><span><i style="background:${n ? cssColor(n.color) : '#888'}"></i>${esc(pname(pk))}</span><b>${money(c)}</b></div>`;
    }).join('') : '';
    tip.innerHTML = `<div class="row"><b style="text-transform:capitalize">${date}</b><b>${v ? money(v.cost) : '—'}</b></div>${v ? `<div style="color:var(--faint);margin:2px 0 6px">${v.prompts || 0} peticiones · ${tok(sumTok(v.tok))}</div>${rows}` : '<div style="color:var(--faint)">sin actividad</div>'}`;
    tip.style.transform = `translate(${Math.min(window.innerWidth - 270, e.clientX + 14)}px, ${e.clientY + 14}px)`;
    tip.classList.add('show');
    clearTimeout(this._dayT);
    this._dayT = setTimeout(() => { if (!cv.matches(':hover')) { this.hoverDayIdx = null; this.renderMetabolism(this.snap); } }, 400);
    cv.onmouseleave = () => { tip.classList.remove('show'); this.hoverDayIdx = null; this.renderMetabolism(this.snap); };
  },

  // ---------- proyectos ----------
  projWeek(snap, offset) {
    const acc = {};
    for (let i = 0; i < 7; i++) {
      const d = snap.daily[dayKey(Date.now() - (i + offset) * 86400e3)];
      if (!d) continue;
      for (const [k, c] of Object.entries(d.byProject || {})) (acc[k] ||= { c: 0, n: 0 }).c += c;
      for (const [k, n] of Object.entries(d.byProjectPrompts || {})) (acc[k] ||= { c: 0, n: 0 }).n += n;
    }
    return acc;
  },

  renderProjects(snap) {
    const ps = [...snap.projects].sort((a, b) => b.last - a.last);
    const w0 = this.projWeek(snap, 0), w1 = this.projWeek(snap, 7);
    const wmax = Math.max(1e-6, ...Object.values(w0).map((x) => x.c));
    const ppr = (key) => {
      const a = w0[key], b = w1[key];
      if (!a || !a.n) return '';
      const v = a.c / a.n;
      let tr = '';
      if (b && b.n) { const d = (v - b.c / b.n) / (b.c / b.n); tr = ` <span class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'}${Math.abs(Math.round(d * 100))} %</span>`; }
      return ` · ${money(v)}/petición${tr}`;
    };
    const LIMIT = 6;
    const shown = this.allProjects ? ps : ps.slice(0, LIMIT);
    $('#proj-aside').textContent = `${ps.length} · ordenados por actividad`;
    $('#projects').innerHTML = shown.map((p) => {
      const n = this.nodes.get('project:' + p.key);
      const [st] = stateOf(p.last);
      const c = n ? cssColor(n.color) : '#888';
      const zone = n?.prof ? FUNCTIONS[n.prof.main].lobe : '';
      const wk = w0[p.key]?.c || 0;
      return `<li data-id="project:${esc(p.key)}" style="--c:${c}">
        <i class="dot ${p.live ? 'live' : st}"></i>
        <div class="pname"><b>${esc(p.name || p.key)}</b><small>${p.sessions.length} ses. · ${ago(p.last)}<span class="ppr">${ppr(p.key)}</span></small>
          ${zone ? `<span class="zone-tag">${zone}</span>` : ''}
          ${wk ? `<div class="share"><i style="width:${(wk / wmax) * 100}%"></i></div>` : ''}</div>
        <span class="pcost">${money(wk)}<small>7 días</small></span></li>`;
    }).join('') + (ps.length > LIMIT ? `<li class="more">${this.allProjects ? 'Mostrar menos' : `Ver los ${ps.length} proyectos`}</li>` : '');
    $$('#projects li').forEach((li) => {
      li.onclick = () => {
        if (li.classList.contains('more')) { this.allProjects = !this.allProjects; this.renderProjects(snap); return; }
        this.cb.onFocus(li.dataset.id);
      };
    });
  },

  // ---------- anatomía del último pensamiento ----------
  renderThought(t) {
    const el = $('#thought');
    if (!t) { $('.body', el).innerHTML = '<p class="muted">Aún no hay pensamientos registrados.</p>'; return; }
    const [inp, cr, cw, out, th] = t.u;
    const sh = t.shape || this.snap?.lastShape || null;
    const shOther = !t.shape && !!sh;
    // El tamaño exacto del prompt de sistema y de las herramientas se estima por proporción de caracteres (≈3,6 car./token)
    const sys = sh ? Math.round(sh.systemChars / 3.6) : 0;
    const tools = sh ? Math.round(sh.toolsChars / 3.6) : 0;
    const read = inp + cr + cw;
    const conv = Math.max(0, read - sys - tools);
    const segsIn = !sh ? [['Contexto completo', read, '#6fd3ff', '']] : [
      ['Instrucciones', Math.min(sys, read), '#7fa2ff', '≈'],
      ['Herramientas', Math.min(tools, Math.max(0, read - sys)), '#b993ff', '≈'],
      ['Conversación y ficheros', conv, '#6fd3ff', ''],
    ];
    const segsCache = [['De caché', cr, '#3f5d8a'], ['Escrito en caché', cw, '#8a6a3f'], ['Nuevo', inp, '#e8e4da']];
    const segsOut = [['Razonamiento', th, '#ffcf8a'], ['Respuesta y acciones', Math.max(0, out - th), '#f4f1ea']];
    const bar = (segs) => `<div class="stack">${segs.map(([n, v, c]) => v > 0 ? `<i style="flex:${v};background:${c}" title="${esc(n)}: ${tok(v)}"></i>` : '').join('')}</div>`;
    const leg = (segs) => `<div class="leg">${segs.map(([n, v, c, pre = '']) => `<span><i style="background:${c}"></i>${n} <b>${pre}${tok(v)}</b></span>`).join('')}</div>`;
    const turn = this.turns.get(t.s) || [];
    const steps = turn.slice(-12).map((e) => {
      if (e.k === 'prompt') return `<em class="st prompt" title="${esc(e.text)}">petición</em>`;
      if (e.k === 'thought') return `<em class="st thought" title="Tokens generados en este paso (incluye razonamiento)">${esc(prettyM(e.m).split(' ')[0])} · ${tok(e.u[3])}</em>`;
      if (e.k === 'tool') return `<em class="st ${e.tgt.split(':')[0]}" title="${esc(e.d || '')}">${esc(e.tgt.startsWith('tool:') ? e.n : e.tgt.split(':').slice(1).join(':').replace(/^claude_ai_/, ''))}</em>`;
      return '';
    }).join('<span class="arrow">›</span>');
    $('#thought-aside').textContent = `${prettyM(t.m)}${t.e ? ' · ' + t.e : ''} · ${ago(t.ts)}`;
    $('.body', el).innerHTML = `
      <div class="thead"><b>${esc(t.project || '')}</b><span>${esc(t.title || 'sesión sin título')}</span></div>
      <div class="row"><label>Tenía en contexto <b>${tok(read)}</b><span class="r">${pctTxt(cr / Math.max(1, read))} de caché</span></label>${bar(segsIn)}${leg(segsIn)}</div>
      <div class="row"><label>Produjo <b>${tok(out)}</b>${t.td ? `<span class="r">pensó ${(t.td / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} s</span>` : ''}</label>${bar(segsOut)}${leg(segsOut)}</div>
      ${steps ? `<div class="row chain"><label>Cadena del turno</label><div class="steps">${steps}</div></div>` : ''}
      <details><summary>Más detalle</summary>
        <div class="row"><label>De dónde salió el contexto</label>${bar(segsCache)}${leg(segsCache)}</div>
        ${sh ? `<div class="row tools"><label>Herramientas cargadas: ${sh.nTools}${shOther ? ' <span class="r">según la última petición registrada</span>' : ''}</label><div class="chips">${sh.topTools.map(([n, c]) => `<em>${esc(n)} <b>≈${tok(c / 3.6)}</b></em>`).join('')}</div></div>` : ''}
        <div class="foot">Este paso ≈ ${money(t.c)} · motivo de parada: ${esc(STOP[t.stop] || t.stop || '—')}</div>
      </details>`;
    const det = $('details', el);
    det.open = !!this.thoughtOpen;
    det.ontoggle = () => { this.thoughtOpen = det.open; };
  },

  trackTurn(ev) {
    if (ev.a) return;
    let arr = this.turns.get(ev.s);
    if (ev.k === 'prompt' || !arr) { arr = []; this.turns.set(ev.s, arr); }
    if (ev.k === 'result') return;
    arr.push(ev);
    if (arr.length > 60) arr.shift();
  },

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
    const q = norm($('#inv-filter').value);
    if (q) rows = rows.filter((r) => norm(r.name + ' ' + r.sub).includes(q));
    if (this.invState === 'used') rows = rows.filter((r) => r.last);
    if (this.invState === 'nunca') rows = rows.filter((r) => !r.last);
    $('#inv-list').innerHTML = rows.length ? rows.map((r) => {
      const [st, stl] = stateOf(r.last);
      return `<li data-id="${esc(r.id)}"><i class="dot ${st}"></i><div><b>${esc(r.name)}</b><small>${esc(r.sub || '')}</small></div><span>${r.n ? r.n.toLocaleString('es-ES') + ' ' + r.unit : '—'}<small>${stl}${r.last ? ' · ' + ago(r.last) : ''}</small></span></li>`;
    }).join('') : '<li class="empty" style="display:block">Nada coincide con el filtro.</li>';
    $$('#inv-list li[data-id]').forEach((li) => { li.onclick = () => this.cb.onFocus(li.dataset.id); });
  },
};
