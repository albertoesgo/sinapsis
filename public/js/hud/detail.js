// Etiquetas 3D, tooltip y ficha de detalle de cada neurona.
import * as THREE from 'three';
import { TYPE_LABEL, FUNCTIONS } from '../neurons.js';
import { isMobile } from '../ui.js';
import { $, $$, LIVE_MS, REGIONS, REGION_OF, ago, copy, cssColor, ctxLevel, dayKey, esc, money, prettyM, stateOf, sumTok, tok } from './format.js';

export const detailMethods = {
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
    if (!this._eegT || t - this._eegT > 1 / 30) { this._eegT = t; this.drawEeg(); }
  },

  hover(n, mouse) {
    const tip = $('#tip');
    this.tipNode = n;
    this.mouse = mouse;
    if (!n || $$('[data-modal].open').length) { tip.classList.remove('show'); return; }
    if (tip.dataset.id !== n.id) {
      tip.dataset.id = n.id;
      tip.innerHTML = this.describe(n, true) + '<div class="hint">Clic para ver el detalle</div>';
      tip.style.setProperty('--c', cssColor(n.color));
    }
    tip.classList.add('show');
    this.positionTip();
  },

  positionTip() {
    const tip = $('#tip');
    if (!this.mouse) return;
    const x = Math.min(window.innerWidth - 300, this.mouse.x + 16);
    const y = Math.min(window.innerHeight - tip.offsetHeight - 12, this.mouse.y + 14);
    tip.style.transform = `translate(${x}px, ${y}px)`;
  },

  describe(n, short) {
    const d = n.data || {};
    const [, stl] = stateOf(d.last);
    const kv = (k, v) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`;
    let body = '';
    if (n.type === 'project' && n.prof) {
      const f = FUNCTIONS[n.prof.main];
      body += `<div class="zone"><b>${f.lobe}</b><span>Aquí porque destaca en «${f.name.toLowerCase()}»: ${Math.round(n.prof.share[n.prof.main] * 100)} % de su actividad frente al ${Math.round(n.prof.gshare[n.prof.main] * 100)} % de media.${short ? '' : ` Esta zona se encarga de ${f.why}.`}</span></div>`;
      if (!short) body += '<div class="prof">' + Object.entries(FUNCTIONS).map(([k, F]) => `<div><span>${F.name}</span><i><em style="width:${Math.round(n.prof.share[k] * 100)}%"></em><u style="left:${Math.round(n.prof.gshare[k] * 100)}%"></u></i><b>${Math.round(n.prof.share[k] * 100)} %</b></div>`).join('') + '<small>la marca blanca es la media de todos tus proyectos</small></div>';
    }
    if (short) {
      if (n.type === 'project') body += kv('Consumo total', money(d.cost)) + kv('Sesiones', d.sessions.length) + kv('Peticiones', d.prompts);
      if (n.type === 'session') body = (d.ctx ? kv('Contexto por paso', tok(d.ctx)) : '') + kv('Consumo', money(d.cost)) + kv('Peticiones', d.prompts);
      if (n.type === 'model') body = kv('Consumo', money(d.cost)) + kv('Respuestas', d.msgs.toLocaleString('es-ES'));
      if (n.type === 'tool') body = kv('Usos', d.uses.toLocaleString('es-ES')) + (d.errors ? kv('Errores', d.errors) : '');
      if (n.type === 'skill') body = kv('Usos', (d.uses || 0) + (d.attributed ? ` (+${d.attributed} pasos)` : ''));
      if (n.type === 'agent') body = kv('Lanzamientos', d.spawns || 0) + kv('Consumo', money(d.cost || 0));
      if (n.type === 'mcp') body = kv('Llamadas', d.uses);
      if (n.type === 'memory') body = kv('Ficheros', d.files || 0) + kv('Escrituras', d.writes || 0);
      if (n.type === 'input') body = kv('Peticiones totales', d.prompts);
    } else {
      if (n.type === 'project') body += kv('Peticiones', d.prompts.toLocaleString('es-ES')) + kv('Respuestas del modelo', d.msgs.toLocaleString('es-ES')) + kv('Tokens', tok(sumTok(d.tok)));
      if (n.type === 'session') body = kv('Subagentes', d.subagents) + kv('Modelos', Object.keys(d.models).map(prettyM).join(', ')) + (d.ctxMax ? kv('Contexto máximo', tok(d.ctxMax)) : '');
      if (n.type === 'model') body = kv('Leídos', tok(d.tok.in + d.tok.cr + d.tok.cw)) + kv('Generados', tok(d.tok.out)) + kv('Razonamiento', tok(d.tok.th));
      if (n.type === 'tool') body = kv('Usos', d.uses.toLocaleString('es-ES')) + kv('Errores', d.errors) + kv('Proyectos', Object.keys(d.projects).length);
      if (n.type === 'skill') body = kv('Usos', (d.uses || 0) + (d.attributed ? ` (+${d.attributed} pasos)` : '')) + kv('Origen', d.source || '—') + (d.installed === false ? kv('Instalada', 'no (externa)') : '');
      if (n.type === 'agent') body = kv('Lanzamientos', d.spawns || 0) + kv('Tokens', tok(sumTok(d.tok)));
      if (n.type === 'mcp') body = kv('Llamadas', d.uses) + kv('Herramientas', Object.keys(d.tools).length);
      if (n.type === 'memory') body = kv('Ficheros', d.files || 0) + kv('Lecturas', d.reads || 0) + kv('Escrituras', d.writes || 0);
      if (n.type === 'input') body = kv('Peticiones totales', d.prompts) + kv('Origen', 'tus mensajes');
    }
    const desc = !short && d.description ? `<p class="desc">${esc(d.description)}</p>` : '';
    const region = n.type === 'project' && n.prof ? FUNCTIONS[n.prof.main].lobe.toLowerCase() : REGION_OF[n.type];
    return `<small class="type">${TYPE_LABEL[n.type] || n.type}${region ? ' · ' + region : ''}</small><h4>${esc(n.label)}</h4>${body}${d.last ? kv('Última actividad', `${stl} · ${ago(d.last)}`) : ''}${desc}`;
  },

  /** Mini gráfica de 30 días para un proyecto o un modelo. */
  spark(field, key, color) {
    const snap = this.snap;
    const vals = [];
    for (let i = 29; i >= 0; i--) vals.push(snap.daily[dayKey(Date.now() - i * 86400e3)]?.[field]?.[key] || 0);
    const max = Math.max(1e-6, ...vals);
    const W = 300, H = 44, bw = W / 30;
    const bars = vals.map((v, i) => `<rect x="${(i * bw + 1).toFixed(1)}" y="${(H - (v / max) * (H - 2)).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${((v / max) * (H - 2)).toFixed(1)}" rx="1.5" fill="${color}" opacity="${i === 29 ? 1 : 0.7}"><title>${money(v)}</title></rect>`).join('');
    const total = vals.reduce((a, b) => a + b, 0);
    return `<h5>Últimos 30 días · ${money(total)}</h5><svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><rect x="0" y="${H - 1}" width="${W}" height="1" fill="rgba(255,255,255,0.06)"/>${bars}</svg>`;
  },

  /**
   * Abre la ficha de una neurona. Si ya había otra abierta, «atrás» vuelve a ella; si se abrió desde
   * una hoja del móvil, «atrás» vuelve a esa hoja. `restore` = volviendo atrás (no apila otra capa).
   */
  showDetail(n, snap, { restore = false } = {}) {
    if (!restore) {
      const prevId = this.isOpen('detail') ? this.detailId : null;
      if (prevId && prevId !== n.id) {
        this.nav.push('detail', () => { if (!this.cb.onFocus(prevId, { restore: true })) { this._hideDetail(); this.cb.onHome?.(); } });
      } else if (!prevId) {
        const prevTab = isMobile() && document.body.dataset.tab !== 'brain' ? document.body.dataset.tab : null;
        if (prevTab) this._setTab('brain');
        this.nav.push('detail', () => { this._hideDetail(); if (prevTab) this._setTab(prevTab); else this.cb.onHome?.(); });
      }
    }
    this.detailId = n.id;
    const el = $('#detail');
    const color = cssColor(n.color);
    el.style.setProperty('--c', color);
    this.coachDone?.();
    let extra = '', head = '';
    const d = n.data || {};
    const list = (title, obj, fmt = (k) => k, max = 8) => {
      const e = Object.entries(obj || {}).sort((a, b) => b[1] - a[1]).slice(0, max);
      return e.length ? `<h5>${title}</h5><ul class="mini">${e.map(([k, v]) => `<li><span>${esc(fmt(k))}</span><b>${typeof v === 'number' ? v.toLocaleString('es-ES', { maximumFractionDigits: 2 }) : v}</b></li>`).join('')}</ul>` : '';
    };
    const tiles = (arr) => `<div class="tiles">${arr.map(([k, v]) => `<div><small>${k}</small><b>${v}</b></div>`).join('')}</div>`;
    const cmd = (c, cap) => `<div class="detail-cmd"><code title="${esc(c)}">${esc(c)}</code><button data-copy="${esc(c)}">Copiar</button></div>${cap ? `<div class="cmd-cap">${cap}</div>` : ''}`;
    const pname = (k) => snap.projects.find((p) => p.key === k)?.name || k;
    const q = (s) => (/^[\w./~-]+$/.test(s) ? s : `"${s.replace(/(["\\$`])/g, '\\$1')}"`);
    if (n.type === 'project') {
      const w0 = this.projWeek(snap, 0)[d.key];
      head = tiles([['7 días', money(w0?.c || 0)], ['Total', money(d.cost)], ['Sesiones', d.sessions.length], ['Por petición', w0?.n ? money(w0.c / w0.n) : '—']]);
      const ss = snap.sessions.filter((s) => s.project === d.key).sort((a, b) => b.last - a.last);
      extra = this.spark('byProject', d.key, color)
        + (d.cwd && !this.remote ? `<h5>Abrir en la terminal</h5>${cmd(`cd ${q(d.cwd)} && claude`)}` : '')
        + `<h5>Sesiones</h5><ul class="mini click">${ss.slice(0, 12).map((s) => `<li data-id="session:${s.id}"><span>${s.live ? '● ' : ''}${esc(s.title || s.id.slice(0, 8))}</span><b>${s.ctx && Date.now() - (s.ctxTs || 0) < LIVE_MS ? tok(s.ctx) + ' · ' : ''}${money(s.cost)}</b></li>`).join('')}</ul>`
        + list('Agentes que trabajan aquí', d.agents) + list('Skills', d.skills) + list('Herramientas', d.tools, (k) => k, 6) + list('Conectores', d.mcps, (k) => k.replace(/^claude_ai_/, '')) + list('Modelos (respuestas)', d.models, prettyM);
    } else if (n.type === 'session') {
      const p = snap.projects.find((x) => x.key === d.project);
      const recent = d.ctx && Date.now() - (d.ctxTs || 0) < LIVE_MS;
      const l = d.ctx ? ctxLevel(d.ctx) : 'ok';
      head = tiles([['Contexto por paso', d.ctx ? tok(d.ctx) : '—'], ['Consumo', money(d.cost)], ['Peticiones', d.prompts], ['Proyecto', esc(pname(d.project))]]);
      if (recent && l !== 'ok') head += `<div class="advice lvl-${l}">${l === 'high' ? `Cada paso relee <b>${tok(d.ctx)}</b>. Escribe <code>/compact</code> en esta sesión, o abre una nueva para la siguiente tarea.` : `Va creciendo: cuando termines lo que estás haciendo, <code>/compact</code>.`}</div>`;
      extra = (p?.cwd && !this.remote ? `<h5>Retomar esta sesión</h5>${cmd(`cd ${q(p.cwd)} && claude --resume ${d.id}`, d.live ? 'Está abierta ahora mismo en otra terminal.' : '')}` : '')
        + list('Herramientas', d.tools) + list('Subagentes', d.agents) + list('Modelos (respuestas)', d.models, prettyM);
    } else if (n.type === 'model') {
      head = tiles([['Consumo', money(d.cost)], ['Respuestas', d.msgs.toLocaleString('es-ES')]]);
      extra = this.spark('byModel', d.name, color);
    } else if (['tool', 'skill', 'mcp'].includes(n.type)) {
      extra = list('Por proyecto', d.projects, pname) + (n.type === 'mcp' ? list('Herramientas del conector', d.tools) : '');
    } else if (n.type === 'agent') {
      head = d.cost ? tiles([['Consumo', money(d.cost)], ['Lanzamientos', d.spawns || 0]]) : '';
      extra = list('Por proyecto', d.projects, pname) + list('Herramientas que usa', d.tools);
    }
    const desc = this.describe(n, false);
    // las cifras clave van justo bajo el título
    const cut = desc.indexOf('</h4>') + 5;
    $('.content', el).innerHTML = desc.slice(0, cut) + head + desc.slice(cut) + extra;
    $$('.click li', el).forEach((li) => { li.onclick = () => this.cb.onFocus(li.dataset.id); });
    $$('[data-copy]', el).forEach((b) => {
      b.onclick = async () => {
        const ok = await copy(b.dataset.copy);
        b.textContent = ok ? 'Copiado' : 'Selecciónalo';
        b.classList.toggle('done', ok);
        setTimeout(() => { b.textContent = 'Copiar'; b.classList.remove('done'); }, 1800);
      };
    });
    el.scrollTop = 0;
    el.classList.add('open');
    this.syncSheet();
  },

  /** Cierra todas las fichas encadenadas (tocar el vacío, centrar). */
  hideDetail() {
    if (!this.nav.unwind((l) => l.kind === 'detail')) this._hideDetail();
  },

  /** × de la ficha o deslizar: vuelve a la pantalla inmediatamente anterior. */
  detailBack() {
    if (this.nav.is('detail')) this.nav.back();
    else { this._hideDetail(); this.cb.onHome?.(); }
  },

  _hideDetail() {
    $('#detail').classList.remove('open');
    this.detailId = null;
    this.syncSheet();
  },

  setReplay(ts, frac) {
    this.replaying = ts != null;
    $('#btn-replay').classList.toggle('on', this.replaying);
    $('#btn-replay span').textContent = this.replaying ? 'Detener' : 'Reproducir 24 h';
    const r = $('#replay');
    r.hidden = !this.replaying;
    document.body.classList.toggle('replaying', this.replaying);
    if (this.replaying) {
      $('b', r).textContent = new Date(ts).toLocaleString('es-ES', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
      $('i', r).style.width = (frac * 100).toFixed(1) + '%';
    }
  },
};
