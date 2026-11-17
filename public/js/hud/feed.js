// Impulsos en directo agrupados por petición y EEG.
import { $, $$, CH, cssColor, esc, hhmm, hm, money, prettyM, tok } from './format.js';

export const feedMethods = {
  // ---------- impulsos ----------
  onPulse(ev, fromReplay) {
    this.pushEeg({ ...ev, ts: fromReplay ? Date.now() : Math.max(ev.ts, Date.now() - 500) });
    if (ev.k === 'result' && !ev.err) return;
    this.trackTurn(ev);
    this.feed.unshift(ev);
    if (this.feed.length > 400) this.feed.length = 400;
    this.fresh = ev;
    this._freshAt = Date.now();
    this.scheduleFeed();
    if (fromReplay || !this.snap) return;
    if (ev.k === 'thought') this.livePlan(ev);
    if (ev.k === 'thought' && !ev.a) {
      const ss = this.snap.sessions.find((x) => x.id === ev.s);
      if (ss) { ss.ctx = ev.u[0] + ev.u[1] + ev.u[2]; ss.ctxTs = ev.ts; ss.turnSteps = (ss.turnSteps || 0) + 1; this.renderLive(); this.renderNow(); }
      const p = this.snap.projects.find((x) => x.key === ev.p);
      this.snap.lastThought = { ...ev, shape: this.snap.lastThought?.s === ev.s ? this.snap.lastThought.shape : null, project: p?.name, title: ss?.title };
      this.renderThought(this.snap.lastThought);
    } else if (ev.k === 'prompt') {
      const ss = this.snap.sessions.find((x) => x.id === ev.s);
      if (ss) { ss.turnSteps = 0; this.renderLive(); }
    } else if (ev.k === 'tool' && !ev.a && this.snap.lastThought?.s === ev.s) {
      this.renderThought(this.snap.lastThought);
    }
  },

  scheduleFeed() {
    if (this._feedT) return;
    this._feedT = setTimeout(() => { this._feedT = null; this.renderFeed(); }, 250);
  },

  /** Impulsos agrupados por petición: tu mensaje como cabecera y debajo los pasos que desencadenó. */
  renderFeed() {
    const filter = this.feedFilter || 'all';
    const isAgent = (e) => !!e.a || (e.k === 'tool' && e.tgt?.startsWith('agent:'));
    const CAT = {
      all: ['Todo', () => true],
      prompt: ['Peticiones', null],
      think: ['Razonamiento', (e) => e.k === 'thought' && !e.a],
      tool: ['Acciones', (e) => e.k === 'tool' && !isAgent(e)],
      agent: ['Subagentes', isAgent],
      error: ['Errores', (e) => e.k === 'result' && e.err],
    };
    // cronológico para agrupar
    const evs = this.feed.slice().reverse();
    const groups = [], open = new Map();
    for (const e of evs) {
      let g = open.get(e.s);
      if (!g || (e.k === 'prompt' && !e.a)) {
        g = { key: e.s + ':' + e.ts, s: e.s, p: e.p, prompt: null, start: e.ts, last: e.ts, steps: [] };
        groups.push(g); open.set(e.s, g);
        if (e.k === 'prompt' && !e.a) { g.prompt = e; continue; }
      }
      g.last = Math.max(g.last, e.ts);
      g.steps.push(e);
    }
    groups.sort((a, b) => b.last - a.last);

    // contadores de los filtros (última hora visible en la lista)
    const counts = {};
    for (const [k, [, fn]] of Object.entries(CAT)) counts[k] = k === 'prompt' ? groups.filter((g) => g.prompt).length : k === 'all' ? this.feed.length : this.feed.filter(fn).length;
    $('#feed-filter').innerHTML = Object.entries(CAT).map(([k, [label]]) => (k === 'error' && !counts.error) ? '' : `<button data-f="${k}" class="${k === filter ? 'on' : ''} f-${k}">${label}<small>${counts[k]}</small></button>`).join('');
    $$('#feed-filter button').forEach((b) => { b.onclick = () => { this.feedFilter = b.dataset.f; this.renderFeed(); $('#feed').scrollTop = 0; }; });

    const snap = this.snap;
    const pname = (k) => snap?.projects.find((p) => p.key === k)?.name || '';
    const sTitle = (id) => snap?.sessions.find((x) => x.id === id)?.title || 'Sesión sin título';
    const pcol = (k) => { const n = this.nodes.get('project:' + k); return n ? cssColor(n.color) : '#888'; };
    const keep = CAT[filter][1];
    const now = Date.now();
    let html = '';
    let shownGroups = 0;
    for (const g of groups) {
      if (shownGroups >= 40) break;
      if (filter === 'prompt' && !g.prompt) continue;
      const steps = filter === 'prompt' ? [] : g.steps.filter(keep);
      if (filter !== 'all' && filter !== 'prompt' && !steps.length) continue;
      shownGroups++;
      // herramientas iguales seguidas se funden en una sola línea (×n)
      const rows = [];
      for (const e of steps) {
        const prev = rows[rows.length - 1];
        if (prev && e.k === 'tool' && prev.e.k === 'tool' && prev.e.tgt === e.tgt && !!prev.e.a === !!e.a) { prev.n++; prev.last = e; continue; }
        rows.push({ e, n: 1, last: e });
      }
      const MAX = this.expanded?.has(g.key) ? 999 : 7;
      const hidden = Math.max(0, rows.length - MAX);
      const live = now - g.last < 90e3;
      const thoughts = g.steps.filter((e) => e.k === 'thought');
      const cost = thoughts.reduce((a, e) => a + (e.c || 0), 0);
      const nTools = g.steps.filter((e) => e.k === 'tool').length;
      const meta = [hm(g.start), nTools ? `${nTools} ${nTools === 1 ? 'acción' : 'acciones'}` : '', cost ? money(cost) : ''].filter(Boolean).join(' · ');
      html += `<li class="grp${live ? ' live' : ''}" style="--c:${pcol(g.p)}">
        <div class="gh" data-id="session:${esc(g.s)}"><i></i><b>${esc(pname(g.p))}</b><span>${esc(sTitle(g.s))}</span><time>${meta}</time></div>
        ${g.prompt ? `<q>${esc(g.prompt.text)}</q>` : '<p class="cont">continúa la sesión</p>'}
        ${rows.length ? `<ol>${hidden ? `<li class="more" data-g="${esc(g.key)}">+ ${hidden} pasos anteriores</li>` : ''}${rows.slice(-MAX).map((r) => this.feedRow(r)).join('')}</ol>` : ''}
      </li>`;
    }
    $('#feed').innerHTML = html || `<li class="empty">${filter === 'all' ? 'Sin actividad en las últimas 24 horas.' : 'Nada de este tipo por ahora.'}</li>`;
    $$('#feed .gh').forEach((h) => { h.onclick = () => this.cb.onFocus(h.dataset.id); });
    $$('#feed .more').forEach((m) => { m.onclick = () => { (this.expanded ||= new Set()).add(m.dataset.g); this.renderFeed(); }; });
    const evN = this.feed.filter((e) => now - e.ts < 3600e3).length;
    $('#feed-aside').textContent = `${evN.toLocaleString('es-ES')} en la última hora`;
  },

  feedRow({ e, n, last }) {
    const fresh = this.fresh && (last === this.fresh) && Date.now() - (this._freshAt ||= Date.now()) < 1500;
    let kind = e.k, label = '', detail = '';
    if (e.k === 'thought') { label = prettyM(e.m); detail = `piensa ${tok(e.u[3])} · relee ${tok(e.u[0] + e.u[1] + e.u[2])}`; }
    else if (e.k === 'tool') {
      kind = e.tgt.split(':')[0];
      if (e.tgt.startsWith('mcp:')) { label = e.tgt.slice(4).replace(/^claude_ai_/, '').replace(/_/g, ' '); detail = e.d || ''; }
      else if (e.tgt.startsWith('tool:')) { label = e.n; detail = last.d || ''; }
      else { label = e.tgt.split(':').slice(1).join(':'); detail = last.d || ''; }
    } else if (e.k === 'result') { kind = 'error'; label = 'Error'; detail = 'en ' + e.n; }
    const who = e.a ? `<em class="who">${esc(e.at)}</em>` : '';
    return `<li class="k-${kind}${e.a ? ' sub' : ''}${fresh ? ' fresh' : ''}"><i></i><b>${esc(label)}${n > 1 ? `<sup>×${n}</sup>` : ''}</b>${who}<span>${esc(detail)}</span><time>${hhmm(last.ts)}</time></li>`;
  },

  pushEeg(ev) {
    let ch, amp;
    if (ev.a && ev.k !== 'result') { ch = 3; amp = ev.k === 'thought' ? Math.min(1, 0.3 + (ev.u?.[3] || 0) / 3000) : 0.5; }
    else if (ev.k === 'prompt') { ch = 0; amp = 1; }
    else if (ev.k === 'thought') { ch = 1; amp = Math.min(1, 0.2 + (ev.u?.[3] || 0) / 2500); }
    else if (ev.k === 'tool') { ch = ev.tgt?.startsWith('agent:') ? 3 : 2; amp = 0.7; }
    else return;
    this.eeg.push({ ts: ev.ts, ch, amp });
    if (this.eeg.length > 3000) this.eeg.splice(0, 1000);
  },

  drawEeg() {
    const cv = this.eegCanvas, c = this.ctx;
    const dpr = Math.min(2, window.devicePixelRatio);
    const W = cv.clientWidth, H = cv.clientHeight;
    if (!W) return;
    if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    const span = 180e3; // 3 minutos
    const now = Date.now();
    const rowH = H / CH.length;
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
  },
};
