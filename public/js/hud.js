// Capa de datos: paneles, plan, búsqueda, diálogos, EEG, anatomía del pensamiento, inventario, etiquetas y detalle.
import * as THREE from 'three';
import { TYPE_COLOR, TYPE_LABEL, FUNCTIONS } from './neurons.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
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
function inTime(ts) {
  const m = Math.max(0, Math.round((ts - Date.now()) / 60e3));
  if (m < 60) return `en ${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  if (h < 48) return `en ${h} h${r ? ` ${r} min` : ''}`;
  return `en ${Math.round(h / 24)} días`;
}
const hhmm = (ts) => new Date(ts).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const hm = (ts) => new Date(ts).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
const wday = (ts) => new Date(ts).toLocaleDateString('es-ES', { weekday: 'long' });
const dayKey = (ts) => new Date(ts).toLocaleDateString('sv-SE');
const pctTxt = (x) => `${Math.round(x * 100)} %`;
const cssColor = (c) => '#' + c.getHexString();
const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function stateOf(last) {
  if (!last) return ['nunca', 'Sin usar'];
  const s = Date.now() - last;
  if (s < 10 * 60e3) return ['vivo', 'En uso'];
  if (s < 24 * 3600e3) return ['hoy', 'Activa hoy'];
  if (s < 7 * 86400e3) return ['semana', 'Esta semana'];
  return ['dormida', 'Dormida'];
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* http en la wifi: sin portapapeles moderno */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

const CTX = { warn: 100000, high: 200000, max: 600000 };
const ctxLevel = (c) => (c >= CTX.high ? 'high' : c >= CTX.warn ? 'warn' : 'ok');
const LIVE_MS = 30 * 60e3;
const levelOf = (p) => (p == null ? 'none' : p >= 0.9 ? 'bad' : p >= 0.7 ? 'warn' : 'ok');

const CH = [
  { key: 'prompt', label: 'Entrada', color: '#f4f1ea' },
  { key: 'thought', label: 'Razonamiento', color: '#ffcf8a' },
  { key: 'tool', label: 'Acción', color: '#b993ff' },
  { key: 'agent', label: 'Subagentes', color: '#ff9a5c' },
];

const FOLD_KEY = 'sinapsis.folded';

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
    this.invTab = 'skills';
    this.invState = 'all';
    this.allProjects = false;
    this.bind();
  }

  // ================= interacción =================
  bind() {
    $('#btn-replay').onclick = () => this.toggleReplay();
    $('#replay .stop').onclick = () => this.cb.onReplay(null);
    $('#btn-rotate').onclick = (e) => { const on = e.currentTarget.classList.toggle('on'); this.cb.onToggleRotate(on); };
    $('#btn-labels').onclick = (e) => { this.showLabels = e.currentTarget.classList.toggle('on'); };
    $('#btn-info').onclick = () => this.openModal('info');
    $('#btn-home').onclick = () => { this.hideDetail(); this.cb.onHome?.(); };
    $('#btn-report').onclick = () => this.openReport();
    $('#btn-search').onclick = () => this.openPalette();
    $('#inv-toggle').onclick = () => this.toggleInventory();
    $('#inventory .close').onclick = () => this.toggleInventory(false);
    $('#detail .close').onclick = () => { this.hideDetail(); this.cb.onHome?.(); };

    // diálogos: cierre con el fondo, la × o Esc
    $$('[data-modal]').forEach((m) => {
      m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('.close')) this.closeModal(m.id); });
    });

    // tarjetas plegables (se recuerda la elección)
    let folded = [];
    try { folded = JSON.parse(localStorage.getItem(FOLD_KEY) || '[]'); } catch { folded = []; }
    $$('.card').forEach((c) => {
      if (folded.includes(c.dataset.card)) c.classList.add('folded');
      $('header', c).onclick = () => {
        c.classList.toggle('folded');
        const list = $$('.card.folded').map((x) => x.dataset.card);
        try { localStorage.setItem(FOLD_KEY, JSON.stringify(list)); } catch { /* sin almacenamiento */ }
        if (c.dataset.card === 'metab' && !c.classList.contains('folded') && this.snap) this.renderMetabolism(this.snap);
      };
    });

    // inventario
    $$('#inventory .tabs button').forEach((b) => {
      b.onclick = () => {
        $$('#inventory .tabs button').forEach((x) => x.classList.toggle('on', x === b));
        this.invTab = b.dataset.tab;
        this.renderInventory();
      };
    });
    $$('#inventory .states button').forEach((b) => {
      b.onclick = () => {
        $$('#inventory .states button').forEach((x) => x.classList.toggle('on', x === b));
        this.invState = b.dataset.st;
        this.renderInventory();
      };
    });
    $('#inv-filter').oninput = () => this.renderInventory();

    // barra inferior (móvil)
    document.body.dataset.tab = 'brain';
    $$('#tabbar button').forEach((b) => {
      b.onclick = () => this.setTab(b.dataset.tab === document.body.dataset.tab ? 'brain' : b.dataset.tab);
    });

    // QR para el móvil (solo desde el propio ordenador)
    fetch('/api/mobile').then((r) => (r.ok ? r.json() : null)).then((m) => {
      if (!m || m.remote) { $('#btn-mobile').remove(); return; }
      this.mobileInfo = m;
    }).catch(() => $('#btn-mobile')?.remove());
    $('#btn-mobile').onclick = () => this.openMobile();

    // paleta
    const inp = $('#pal-input');
    inp.oninput = () => { this.palSel = 0; this.renderPalette(); };
    inp.onkeydown = (e) => {
      const items = this.palItems || [];
      if (e.key === 'ArrowDown') { e.preventDefault(); this.palSel = Math.min(items.length - 1, (this.palSel || 0) + 1); this.renderPalette(true); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); this.palSel = Math.max(0, (this.palSel || 0) - 1); this.renderPalette(true); }
      else if (e.key === 'Enter') { e.preventDefault(); const it = items[this.palSel || 0]; if (it) this.runItem(it); }
    };

    // teclado
    document.addEventListener('keydown', (e) => this.onKey(e));

    // gráfica diaria: detalle al pasar el ratón
    const cv = $('#m-days');
    cv.addEventListener('mousemove', (e) => this.hoverDay(e));
    cv.addEventListener('mouseleave', () => $('#htip').classList.remove('show'));

    this.eegCanvas = $('#eeg canvas');
    this.ctx = this.eegCanvas.getContext('2d');
    $('#eeg .legend').innerHTML = CH.map((c) => `<span><i style="background:${c.color}"></i>${c.label}</span>`).join('');

    // primera visita: cómo se maneja
    const coach = $('#coach');
    if (!localStorage.getItem('sinapsis.coach')) {
      setTimeout(() => { coach.hidden = false; }, 2500);
      const done = () => { coach.hidden = true; try { localStorage.setItem('sinapsis.coach', '1'); } catch { /* nada */ } };
      $('button', coach).onclick = done;
      this.coachDone = done;
      setTimeout(done, 20000);
    }

    // el plan y las cuentas atrás se refrescan solos
    setInterval(() => { if (this.snap) { this.renderPlan(); this.renderNow(); } }, 30000);
  }

  onKey(e) {
    const typing = e.target.matches?.('input, textarea');
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); this.isOpen('palette') ? this.closeModal('palette') : this.openPalette(); return; }
    if (e.key === 'Escape') {
      const open = $$('[data-modal].open');
      if (open.length) { this.closeModal(open[open.length - 1].id); return; }
      if ($('#inventory').classList.contains('open')) { this.toggleInventory(false); return; }
      if ($('#detail').classList.contains('open')) { this.hideDetail(); this.cb.onHome?.(); return; }
      if (document.body.dataset.tab !== 'brain') this.setTab('brain');
      return;
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey || $$('[data-modal].open').length) return;
    const k = e.key.toLowerCase();
    if (k === '/') { e.preventDefault(); this.openPalette(); }
    else if (k === 'r') this.openReport();
    else if (k === 'i') this.toggleInventory();
    else if (k === 'h') { this.hideDetail(); this.cb.onHome?.(); }
    else if (k === 'l') $('#btn-labels').click();
    else if (k === 'p') this.toggleReplay();
    else if (k === ' ') { e.preventDefault(); $('#btn-rotate').click(); }
    else if (e.key === '?') this.openModal('info');
  }

  isOpen(id) { return $('#' + id).classList.contains('open'); }
  openModal(id) {
    this.lastFocus = document.activeElement;
    $('#' + id).classList.add('open');
    $('#tip').classList.remove('show');
    setTimeout(() => $('#' + id + ' input')?.focus({ preventScroll: true }), 30);
  }
  closeModal(id) {
    $('#' + id).classList.remove('open');
    this.lastFocus?.focus?.({ preventScroll: true });
  }

  toggleReplay() {
    if (this.replaying) { this.cb.onReplay(null); return; }
    if (!this.snap?.recent?.length) return;
    this.cb.onReplay(this.snap.recent);
  }

  toggleInventory(force) {
    if (matchMedia('(max-width: 760px)').matches) { this.setTab('inv'); return; }
    const o = $('#inventory').classList.toggle('open', force);
    $('#inv-toggle').classList.toggle('on', o);
    if (!o && $('#inventory').contains(document.activeElement)) document.activeElement.blur();
    if (o) { this.renderInventory(); setTimeout(() => $('#inv-filter').focus({ preventScroll: true }), 30); }
  }

  openMobile() {
    const m = this.mobileInfo;
    if (!m) return;
    const box = $('#mobile');
    if (m.lan) {
      $('.qr', box).innerHTML = m.qr;
      $('.urls', box).innerHTML = m.urls.map((u) => esc(u.replace(/\?k=.*/, ''))).join('<br>');
    } else {
      $('.qr', box).innerHTML = '';
      $('.how', box).innerHTML = 'El acceso desde la red está desactivado. Arranca Sinapsis con <code>npm start -- --lan</code> o instala el servicio con <code>npm run service:install</code>.';
      $('.tip', box).textContent = '';
    }
    this.openModal('mobile');
  }

  setTab(tab) {
    document.body.dataset.tab = tab;
    $$('#tabbar button').forEach((x) => x.classList.toggle('on', x.dataset.tab === tab));
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

  // ================= render general =================
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
    const today = snap.daily[dayKey(Date.now())];
    $('#status').innerHTML = `<b>${live}</b> ${live === 1 ? 'sesión abierta' : 'sesiones abiertas'} · <b>${(today?.prompts || 0).toLocaleString('es-ES')}</b> peticiones hoy<span class="opt"> · <b>${snap.recent.length.toLocaleString('es-ES')}</b> impulsos en 24 h</span>`;
    this.renderPlan();
    this.renderMetabolism(snap);
    this.renderProjects(snap);
    this.renderNow();
    this.renderLive();
    this.renderThought(snap.lastThought);
    this.renderInventory();
    if (this.isOpen('palette')) this.renderPalette();
  }

  // ================= tu plan =================
  renderPlan() {
    const pl = this.snap?.plan;
    const card = $('#plan');
    if (!pl) { card.hidden = true; return; }
    card.hidden = false;
    const { h5, week } = pl;
    const C = 2 * Math.PI * 26;
    const ring = (title, w, sub, tip) => {
      const ref = w.budget || null;
      const pct = ref ? w.used / ref : null;
      const lvl = levelOf(pct);
      const shown = pct == null ? '—' : Math.round(pct * 100);
      const off = C * (1 - Math.min(1, pct ?? 0));
      return `<div class="ring g-${lvl}" title="${esc(tip)}">
        <div class="wrap"><svg viewBox="0 0 62 62"><circle class="trk" cx="31" cy="31" r="26"/><circle class="val" cx="31" cy="31" r="26" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/></svg><b>${shown}${pct == null ? '' : '<small>%</small>'}</b></div>
        <div class="txt"><strong>${title}</strong><span>${sub}</span></div></div>`;
    };
    const sub5 = h5.end ? `se reinicia a las ${hm(h5.end)}<br>${inTime(h5.end)}` : 'sin ventana abierta<br>empieza al escribir';
    const subW = week.end ? `se reinicia el ${wday(week.end)}<br>${inTime(week.end)}` : 'últimos 7 días';
    const tip5 = h5.budget ? `≈${money(h5.used)} de ≈${money(h5.budget)} equivalentes (estimado con ${h5.samples} cortes reales)` : `${money(h5.used)} en esta ventana · aún no has llegado nunca al límite de 5 h`;
    const tipW = week.budget ? `≈${money(week.used)} de ≈${money(week.budget)} equivalentes (estimado con ${week.samples} corte${week.samples === 1 ? '' : 's'} real${week.samples === 1 ? '' : 'es'})` : `${money(week.used)} esta semana`;

    // veredicto: una frase con lo que importa
    let v, lvl;
    const p5 = h5.budget ? h5.used / h5.budget : null;
    const pw = week.budget ? week.used / week.budget : null;
    if (p5 != null && p5 >= 0.9 && h5.end) { lvl = 'bad'; v = `<b>Casi sin margen en esta ventana.</b> Se reinicia a las ${hm(h5.end)}. Para estirarla: Sonnet en vez de Opus, esfuerzo más bajo y sesiones cortas.`; }
    else if (pw != null && pw >= 0.9) { lvl = 'bad'; v = `<b>Te queda poco de la semana</b> (${pctTxt(pw)}). Se reinicia el ${wday(week.end)} a las ${hm(week.end)}.`; }
    else if (h5.eta) { lvl = 'warn'; v = `Al ritmo de la última hora llegarías al límite <b>hacia las ${hm(h5.eta)}</b>, antes de que se reinicie (${hm(h5.end)}).`; }
    else if (week.eta) { lvl = 'warn'; v = `A tu ritmo de los últimos 3 días, el límite semanal llegaría <b>el ${wday(week.eta)}</b>, antes del reinicio (${wday(week.end)}).`; }
    else if (p5 == null && pw == null) { lvl = 'none'; v = 'Aún no has llegado nunca al límite, así que no hay con qué comparar. En cuanto ocurra, Sinapsis aprende tu presupuesto.'; }
    else { lvl = 'ok'; v = `<b>Vas bien.</b> A este ritmo no llegarás al límite ni en esta ventana ni esta semana.`; }

    // últimas ventanas de 5 h
    const wins = pl.windows || [];
    const ref = h5.budget || Math.max(1e-6, ...wins.map((w) => w.used));
    const bars = wins.map((w) => {
      const cur = Date.now() < w.end && Date.now() >= w.start;
      return `<i class="${w.hit ? 'hit' : ''} ${cur ? 'cur' : ''}" style="height:${Math.max(4, Math.min(100, (w.used / ref) * 100))}%" title="${new Date(w.start).toLocaleString('es-ES', { weekday: 'short', hour: '2-digit', minute: '2-digit' })} · ${money(w.used)}${w.hit ? ' · llegaste al límite' : ''}"></i>`;
    }).join('');
    const hits = wins.some((w) => w.hit);
    $('#plan-aside').textContent = h5.budget ? 'estimado con tus cortes reales' : '';
    $('.body', card).innerHTML = `
      <div class="rings">${ring('Ventana de 5 h', h5, sub5, tip5)}${ring('Semana', week, subW, tipW)}</div>
      <div class="verdict g-${lvl}">${v}</div>
      ${wins.length ? `<div class="wins g-${levelOf(p5)}">${bars}</div><div class="wins-cap"><span>tus últimas ventanas de 5 h</span><span>${hits ? `<span style="color:var(--bad)">■</span> llegaste al límite` : ''}</span></div>` : ''}
      <p class="plan-note">Estimación: lo que habías consumido justo antes de cada corte real${h5.samples || week.samples ? ` (${h5.samples} de 5 h, ${week.samples} semanal${week.samples === 1 ? '' : 'es'})` : ''}. Si usas Claude en la web o el móvil, también cuenta y aquí no se ve.</p>`;
  }

  /** Suma en vivo el consumo de cada respuesta al plan, sin esperar a la siguiente instantánea. */
  livePlan(ev) {
    const pl = this.snap?.plan;
    if (!pl || !ev.c) return;
    const h5 = pl.h5;
    if (!h5.end || ev.ts >= h5.end) { h5.start = ev.ts; h5.end = ev.ts + 5 * 3600e3; h5.used = 0; }
    h5.used += ev.c;
    if (!pl.week.end || ev.ts < pl.week.end) pl.week.used += ev.c;
    clearTimeout(this._planT);
    this._planT = setTimeout(() => { this.renderPlan(); this.renderNow(); }, 800);
  }

  // ================= ahora mismo =================
  renderNow() {
    const snap = this.snap;
    if (!snap) return;
    const now = Date.now();
    const items = [];
    const pname = (k) => snap.projects.find((p) => p.key === k)?.name || '';
    const pl = snap.plan;
    if (pl?.h5.budget && pl.h5.end) {
      const p = pl.h5.used / pl.h5.budget;
      if (p >= 0.75) items.push({ lvl: p >= 0.9 ? 'bad' : 'warn', ic: '%', title: `${pctTxt(p)} de tu ventana de 5 h`, text: `Se reinicia a las ${hm(pl.h5.end)} (${inTime(pl.h5.end)}).`, card: 'plan' });
    }
    if (pl?.week.budget) {
      const p = pl.week.used / pl.week.budget;
      if (p >= 0.75) items.push({ lvl: p >= 0.9 ? 'bad' : 'warn', ic: '%', title: `${pctTxt(p)} de tu límite semanal`, text: pl.week.end ? `Se reinicia el ${wday(pl.week.end)} a las ${hm(pl.week.end)}.` : '', card: 'plan' });
    }
    const act = snap.sessions.filter((s) => s.ctx && (s.live || now - (s.ctxTs || 0) < LIVE_MS)).sort((a, b) => b.ctx - a.ctx);
    for (const s of act.filter((x) => x.ctx >= CTX.high).slice(0, 2)) {
      items.push({ lvl: 'bad', ic: '↻', id: 'session:' + s.id, title: `«${s.title || 'Sesión sin título'}» relee ${tok(s.ctx)} por paso`, text: `${pname(s.project)} · escribe <code>/compact</code> en esa sesión o abre una nueva para la siguiente tarea.` });
    }
    const warm = act.find((x) => x.ctx >= CTX.warn && x.ctx < CTX.high);
    if (warm && items.length < 3) items.push({ lvl: 'warn', ic: '↻', id: 'session:' + warm.id, title: `«${warm.title || 'Sesión sin título'}» va por ${tok(warm.ctx)}`, text: `${pname(warm.project)} · cuando acabes esta tarea, <code>/compact</code>.` });
    const longTurn = act.find((x) => (x.turnSteps || 0) > 40);
    if (longTurn && items.length < 3) items.push({ lvl: 'warn', ic: '⋯', id: 'session:' + longTurn.id, title: `Petición larga: ${longTurn.turnSteps} pasos`, text: `«${longTurn.title || 'Sesión sin título'}». Cada paso relee todo el contexto; trocear el encargo ahorra.` });
    if (!items.length) {
      const p5 = pl?.h5.budget ? pl.h5.used / pl.h5.budget : null;
      items.push({ lvl: 'ok', ic: '✓', title: 'Todo en orden', text: `${act.length ? `${act.length} ${act.length === 1 ? 'sesión activa' : 'sesiones activas'}, ninguna pesada` : 'Ninguna sesión trabajando ahora'}${p5 != null ? ` · ${pctTxt(p5)} de la ventana de 5 h` : ''}.`, static: true });
    }
    $('#now-list').innerHTML = items.map((it, i) => `<li class="g-${it.lvl}${it.static ? ' static' : ''}" data-i="${i}"><span class="ic">${it.ic}</span><div><b>${esc(it.title)}</b><span>${it.text}</span></div></li>`).join('');
    $$('#now-list li').forEach((li) => {
      const it = items[+li.dataset.i];
      li.onclick = () => {
        if (it.id) this.cb.onFocus(it.id);
        else if (it.card) { const c = $(`.card[data-card="${it.card}"]`); c.classList.remove('folded'); if (matchMedia('(max-width: 760px)').matches) this.setTab('metab'); c.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
      };
    });
  }

  // ================= sesiones abiertas =================
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
    $$('#live-list li[data-id]').forEach((li) => { li.onclick = () => this.cb.onFocus(li.dataset.id); });
    this.updateCtxLabels();
  }

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
    try { navigator.vibrate?.([80, 60, 80]); } catch { /* sin vibración */ }
  }

  // ================= informe =================
  async openReport() {
    const box = $('#report');
    this.openModal('report');
    const r = await fetch('/api/report').then((x) => x.json());
    const snap = this.snap;
    const pct = (d, invert = false) => {
      if (d == null) return '<span>sin datos previos</span>';
      const up = d > 0;
      const cls = (invert ? !up : up) ? 'up' : 'down';
      return `<span class="${cls}">${up ? '▲' : '▼'} ${Math.abs(Math.round(d * 100))} %</span> <span>vs semana anterior</span>`;
    };
    const f = (ts) => new Date(ts).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
    $('#rep-range').textContent = `${f(r.from)} – ${f(r.to)} · equivalente API, no lo que pagas`;
    const effTot = Object.values(r.cur.effort).reduce((a, b) => a + b, 0) || 1;
    const eff = ['low', 'medium', 'high', 'xhigh', 'max'].filter((e) => r.cur.effort[e]).map((e) => `${e} ${Math.round((r.cur.effort[e] / effTot) * 100)} %`).join(' · ');

    // frase resumen
    const parts = [`<b>${r.cur.prompts} peticiones</b> esta semana${r.delta.prompts != null ? ` (${r.delta.prompts > 0 ? '+' : ''}${Math.round(r.delta.prompts * 100)} %)` : ''}`];
    if (r.delta.perPrompt != null) parts.push(`cada una consumió un <b>${Math.abs(Math.round(r.delta.perPrompt * 100))} % ${r.delta.perPrompt < 0 ? 'menos' : 'más'}</b> que la semana anterior`);
    const wk = snap?.plan?.week;
    if (wk?.budget) parts.push(`llevas el <b>${pctTxt(wk.used / wk.budget)}</b> de tu límite semanal`);
    const lead = parts.join('; ').replace(/; ([^;]*)$/, ' y $1') + '.';

    // barras por día
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const t = Date.now() - i * 86400e3;
      days.push({ t, d: snap?.daily[dayKey(t)] });
    }
    const dmax = Math.max(1e-6, ...days.map((x) => x.d?.cost || 0));
    const week = days.map(({ t, d }, i) => `<div class="${i === 6 ? 'today' : ''}" title="${d ? `${d.prompts || 0} peticiones · ${tok(sumTok(d.tok))}` : 'sin actividad'}"><em>${d ? money(d.cost) : '—'}</em><i style="height:${((d?.cost || 0) / dmax) * 78}%"></i><span>${new Date(t).toLocaleDateString('es-ES', { weekday: 'short' }).replace('.', '')}</span></div>`).join('');

    const hits = (snap?.plan?.hits || []).filter((h) => h.ts > Date.now() - 14 * 86400e3).reverse();
    const hitsHtml = hits.length ? `<ul class="hits">${hits.map((h) => `<li><b>${new Date(h.ts).toLocaleString('es-ES', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</b><span>${h.kind === '5h' ? 'límite de 5 h' : h.kind === 'week' ? 'límite semanal' : esc(h.label)}${h.resetTs ? ` · se reinició ${h.kind === '5h' ? 'a las ' + hm(h.resetTs) : 'el ' + wday(h.resetTs)}` : ''}${h.used ? ` · ≈${money(h.used)}` : ''}</span></li>`).join('')}</ul>` : '<p class="muted">No has llegado al límite en las dos últimas semanas.</p>';

    $('.content', box).innerHTML = `
      <p class="lead">${lead}</p>
      <div class="kpis">
        <div><small>Peticiones</small><b>${r.cur.prompts}</b>${pct(r.delta.prompts, true)}</div>
        <div><small>Por petición</small><b>${money(r.cur.perPrompt)}</b>${pct(r.delta.perPrompt)}</div>
        <div><small>Consumo semana</small><b>${money(r.cur.cost)}</b>${pct(r.delta.cost)}</div>
        <div><small>Leído / escrito</small><b>${Math.round(r.cur.read / Math.max(1, r.cur.out))} : 1</b><span>${tok(r.cur.read)} leídos · ${pctTxt(r.cur.cache)} de caché</span></div>
      </div>
      <div class="twocol">
        <div><h3>Por día</h3><div class="week">${week}</div></div>
        <div><h3>Límites del plan</h3>${hitsHtml}</div>
      </div>
      <h3>Qué cambiar</h3>
      <ul class="tips">${r.tips.map((t) => `<li class="t-${t.level}"><b>${esc(t.title)}</b><span>${esc(t.text)}</span></li>`).join('')}</ul>
      ${r.sessions.length ? `<h3>Sesiones más pesadas</h3><table><tr><th>Sesión</th><th>Proyecto</th><th class="n">Contexto medio</th><th class="n">Pasos</th><th class="n">Pasos/petición</th></tr>
        ${r.sessions.map((s) => `<tr class="click" data-id="session:${esc(s.id)}"><td>${esc(s.title || 'Sin título')}</td><td>${esc(s.project)}</td><td class="n ${s.avgCtx > CTX.high ? 'up' : ''}">${tok(s.avgCtx)}</td><td class="n">${s.steps}</td><td class="n">${Math.round(s.stepsPerPrompt)}</td></tr>`).join('')}</table>` : ''}
      ${r.projects.length ? `<h3>Por proyecto</h3><table><tr><th>Proyecto</th><th class="n">Peticiones</th><th class="n">Por petición</th><th class="n">Tendencia</th><th class="n">Consumo</th></tr>
        ${r.projects.map((p) => `<tr class="click" data-id="project:${esc(p.key)}"><td>${esc(p.name)}</td><td class="n">${p.prompts}</td><td class="n">${p.perPrompt != null ? money(p.perPrompt) : '—'}</td><td class="n">${p.trend == null ? '—' : `<span class="${p.trend > 0 ? 'up' : 'down'}">${p.trend > 0 ? '▲' : '▼'} ${Math.abs(Math.round(p.trend * 100))} %</span>`}</td><td class="n">${money(p.cost)}</td></tr>`).join('')}</table>` : ''}
      ${eff ? `<h3>Esfuerzo usado</h3><p class="muted">${eff}</p>` : ''}`;
    $$('tr.click', box).forEach((tr) => { tr.onclick = () => { this.closeModal('report'); this.cb.onFocus(tr.dataset.id); }; });
  }

  // ================= consumo =================
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
  }

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
  }

  // ================= proyectos =================
  projWeek(snap, offset) {
    const acc = {};
    for (let i = 0; i < 7; i++) {
      const d = snap.daily[dayKey(Date.now() - (i + offset) * 86400e3)];
      if (!d) continue;
      for (const [k, c] of Object.entries(d.byProject || {})) (acc[k] ||= { c: 0, n: 0 }).c += c;
      for (const [k, n] of Object.entries(d.byProjectPrompts || {})) (acc[k] ||= { c: 0, n: 0 }).n += n;
    }
    return acc;
  }

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
  }

  // ================= anatomía del último pensamiento =================
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
  }

  trackTurn(ev) {
    if (ev.a) return;
    let arr = this.turns.get(ev.s);
    if (ev.k === 'prompt' || !arr) { arr = []; this.turns.set(ev.s, arr); }
    if (ev.k === 'result') return;
    arr.push(ev);
    if (arr.length > 60) arr.shift();
  }

  // ================= impulsos =================
  onPulse(ev, fromReplay) {
    this.pushEeg({ ...ev, ts: fromReplay ? Date.now() : Math.max(ev.ts, Date.now() - 500) });
    if (ev.k === 'result' && !ev.err) return;
    this.trackTurn(ev);
    this.feed.unshift(ev);
    if (this.feed.length > 60) this.feed.length = 60;
    const ul = $('#feed');
    ul.insertAdjacentHTML('afterbegin', this.feedItem(ev));
    while (ul.children.length > 40) ul.lastElementChild.remove();
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
  }

  renderFeed() {
    $('#feed').innerHTML = this.feed.slice(0, 40).map((e) => this.feedItem(e, true)).join('');
  }

  feedItem(e, quiet = false) {
    const projName = (k) => this.snap?.projects.find((p) => p.key === k)?.name || '';
    let kind = e.k, txt = '';
    if (e.k === 'prompt') txt = `<q>${esc(e.text)}</q>`;
    else if (e.k === 'thought') txt = `${esc(prettyM(e.m))} piensa <b>${tok(e.u[3])}</b> tok · lee ${tok(e.u[0] + e.u[1] + e.u[2])}`;
    else if (e.k === 'tool') { kind = e.tgt.split(':')[0]; txt = `<b>${esc(e.tgt.startsWith('mcp:') ? e.tgt.slice(4).replace(/^claude_ai_/, '') + ' · ' + e.d : e.tgt.startsWith('tool:') ? e.n : e.tgt.split(':').slice(1).join(':'))}</b> ${e.tgt.startsWith('mcp:') ? '' : esc(e.d || '')}`; }
    else if (e.k === 'result') { kind = 'error'; txt = `error en <b>${esc(e.n)}</b>`; }
    const who = e.a ? `<span class="who agent">${esc(e.at)}</span>` : '';
    return `<li class="k-${kind}${quiet ? ' quiet' : ''}"><time>${hhmm(e.ts)}</time><i></i><div><small>${esc(projName(e.p))}${who}</small>${txt}</div></li>`;
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
  }

  // ================= inventario =================
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
  }

  // ================= búsqueda (⌘K) =================
  openPalette() {
    this.palSel = 0;
    $('#pal-input').value = '';
    this.openModal('palette');
    this.renderPalette();
    this.coachDone?.();
  }

  paletteSource() {
    const snap = this.snap;
    const A = (label, key, run, sub = '') => ({ group: 'Acciones', label, key, run, sub });
    const out = [
      A('Informe de la semana', 'R', () => this.openReport(), 'qué ha pasado y qué cambiar'),
      A('Inventario', 'I', () => this.toggleInventory(true), 'skills, agentes, herramientas…'),
      A('Centrar el cerebro', 'H', () => { this.hideDetail(); this.cb.onHome?.(); }),
      A(this.replaying ? 'Detener la reproducción' : 'Reproducir las últimas 24 h', 'P', () => this.toggleReplay()),
      A('Rotación automática', '␣', () => $('#btn-rotate').click()),
      A('Mostrar u ocultar etiquetas', 'L', () => $('#btn-labels').click()),
      A('Qué es real y atajos', '?', () => this.openModal('info')),
    ];
    if (this.mobileInfo) out.push(A('Ver en el móvil', '', () => this.openMobile(), 'código QR'));
    if (!snap) return out;
    const pname = (k) => snap.projects.find((p) => p.key === k)?.name || k;
    const node = (id, group, label, sub, extra = 0) => {
      const n = this.nodes.get(id);
      if (!n) return null;
      return { group, label, sub, id, color: cssColor(n.color), last: n.data?.last || 0, boost: extra };
    };
    for (const p of snap.projects) out.push(node('project:' + p.key, 'Proyectos', p.name || p.key, `${p.sessions.length} sesiones · ${ago(p.last)}`, p.live ? 2 : 0));
    for (const s of snap.sessions) out.push(node('session:' + s.id, 'Sesiones', s.title || 'Sesión sin título', `${pname(s.project)} · ${ago(s.last)}${s.live ? ' · abierta' : ''}`, s.live ? 2 : 0));
    for (const m of snap.models) out.push(node('model:' + m.name, 'Modelos', m.label, money(m.cost)));
    for (const s of snap.skills) out.push(node('skill:' + s.name, 'Skills', s.name, s.last ? ago(s.last) : 'nunca usada'));
    for (const a of snap.agents) out.push(node('agent:' + a.name, 'Agentes', a.name, a.spawns ? `${a.spawns} lanzados` : 'nunca usado'));
    for (const t of snap.tools) if (!t.name.startsWith('mcp__')) out.push(node('tool:' + t.name, 'Herramientas', t.name, `${t.uses.toLocaleString('es-ES')} usos`));
    for (const m of snap.mcps) out.push(node('mcp:' + m.name, 'Conectores', m.label, `${m.uses} llamadas`));
    return out.filter(Boolean);
  }

  renderPalette(keepScroll) {
    const q = norm($('#pal-input').value.trim());
    const src = this.paletteSource();
    let items;
    if (!q) {
      const recent = src.filter((x) => x.group === 'Proyectos').sort((a, b) => b.last - a.last).slice(0, 5);
      const live = src.filter((x) => x.group === 'Sesiones').sort((a, b) => b.boost - a.boost || b.last - a.last).slice(0, 4);
      items = [...src.filter((x) => x.group === 'Acciones'), ...recent, ...live];
    } else {
      const scored = [];
      for (const it of src) {
        const L = norm(it.label);
        let s = 0;
        if (L.startsWith(q)) s = 5;
        else if (L.split(/[\s\-_:/·]+/).some((w) => w.startsWith(q))) s = 4;
        else if (L.includes(q)) s = 3;
        else if (norm(it.sub).includes(q)) s = 1.5;
        else {
          let j = 0;
          for (const ch of L) if (ch === q[j]) j++;
          if (j === q.length && q.length > 1) s = 1;
        }
        if (s) scored.push({ it, s: s + (it.boost || 0) * 0.3 + (it.last > Date.now() - 86400e3 ? 0.4 : 0) });
      }
      scored.sort((a, b) => b.s - a.s);
      const order = ['Acciones', 'Proyectos', 'Sesiones', 'Modelos', 'Skills', 'Agentes', 'Herramientas', 'Conectores'];
      items = scored.slice(0, 40).map((x) => x.it).sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
    }
    this.palItems = items;
    const sel = Math.min(this.palSel || 0, items.length - 1);
    const hl = (label) => {
      if (!q) return esc(label);
      const i = norm(label).indexOf(q);
      return i < 0 ? esc(label) : esc(label.slice(0, i)) + '<mark>' + esc(label.slice(i, i + q.length)) + '</mark>' + esc(label.slice(i + q.length));
    };
    let html = '', g = null;
    items.forEach((it, i) => {
      if (it.group !== g) { g = it.group; html += `<li class="grp">${g}</li>`; }
      const icon = it.run ? `<i class="act">${esc(it.key || '›')}</i>` : `<i style="--c:${it.color}"></i>`;
      html += `<li class="it${i === sel ? ' sel' : ''}" data-i="${i}">${icon}<b>${hl(it.label)}</b><small>${esc(it.sub || '')}</small></li>`;
    });
    $('#pal-list').innerHTML = html || `<li class="none">Nada coincide con «${esc($('#pal-input').value)}».</li>`;
    $$('#pal-list li.it').forEach((li) => {
      li.onclick = () => this.runItem(items[+li.dataset.i]);
      li.onmousemove = () => { if (this.palSel !== +li.dataset.i) { this.palSel = +li.dataset.i; $$('#pal-list li.it').forEach((x) => x.classList.toggle('sel', x === li)); } };
    });
    if (keepScroll) $('#pal-list li.sel')?.scrollIntoView({ block: 'nearest' });
  }

  runItem(it) {
    this.closeModal('palette');
    if (it.run) it.run();
    else if (it.id) this.cb.onFocus(it.id);
  }

  // ================= etiquetas y tooltip =================
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
  }

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
  }

  positionTip() {
    const tip = $('#tip');
    if (!this.mouse) return;
    const x = Math.min(window.innerWidth - 300, this.mouse.x + 16);
    const y = Math.min(window.innerHeight - tip.offsetHeight - 12, this.mouse.y + 14);
    tip.style.transform = `translate(${x}px, ${y}px)`;
  }

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
  }

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
  }

  showDetail(n, snap) {
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
        + (d.cwd ? `<h5>Abrir en la terminal</h5>${cmd(`cd ${q(d.cwd)} && claude`)}` : '')
        + `<h5>Sesiones</h5><ul class="mini click">${ss.slice(0, 12).map((s) => `<li data-id="session:${s.id}"><span>${s.live ? '● ' : ''}${esc(s.title || s.id.slice(0, 8))}</span><b>${s.ctx && Date.now() - (s.ctxTs || 0) < LIVE_MS ? tok(s.ctx) + ' · ' : ''}${money(s.cost)}</b></li>`).join('')}</ul>`
        + list('Agentes que trabajan aquí', d.agents) + list('Skills', d.skills) + list('Herramientas', d.tools, (k) => k, 6) + list('Conectores', d.mcps, (k) => k.replace(/^claude_ai_/, '')) + list('Modelos (respuestas)', d.models, prettyM);
    } else if (n.type === 'session') {
      const p = snap.projects.find((x) => x.key === d.project);
      const recent = d.ctx && Date.now() - (d.ctxTs || 0) < LIVE_MS;
      const l = d.ctx ? ctxLevel(d.ctx) : 'ok';
      head = tiles([['Contexto por paso', d.ctx ? tok(d.ctx) : '—'], ['Consumo', money(d.cost)], ['Peticiones', d.prompts], ['Proyecto', esc(pname(d.project))]]);
      if (recent && l !== 'ok') head += `<div class="advice lvl-${l}">${l === 'high' ? `Cada paso relee <b>${tok(d.ctx)}</b>. Escribe <code>/compact</code> en esta sesión, o abre una nueva para la siguiente tarea.` : `Va creciendo: cuando termines lo que estás haciendo, <code>/compact</code>.`}</div>`;
      extra = (p?.cwd ? `<h5>Retomar esta sesión</h5>${cmd(`cd ${q(p.cwd)} && claude --resume ${d.id}`, d.live ? 'Está abierta ahora mismo en otra terminal.' : '')}` : '')
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
    if (matchMedia('(max-width: 760px)').matches && document.body.dataset.tab !== 'brain') this.setTab('brain');
  }

  hideDetail() { $('#detail').classList.remove('open'); }

  setReplay(ts, frac) {
    this.replaying = ts != null;
    $('#btn-replay').classList.toggle('on', this.replaying);
    $('#btn-replay span').textContent = this.replaying ? 'Detener' : 'Reproducir 24 h';
    const r = $('#replay');
    r.hidden = !this.replaying;
    if (this.replaying) {
      $('b', r).textContent = new Date(ts).toLocaleString('es-ES', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
      $('i', r).style.width = (frac * 100).toFixed(1) + '%';
    }
  }
}

const STOP = { end_turn: 'terminó el turno', tool_use: 'usar una herramienta', max_tokens: 'límite de tokens', refusal: 'rechazo', pause_turn: 'pausa' };
function prettyM(m = '') {
  const s = m.replace(/^claude-/, '');
  const [f, ...v] = s.split('-');
  return f ? f[0].toUpperCase() + f.slice(1) + (v.length ? ' ' + v.join('.') : '') : m;
}

const REGION_OF = { session: 'corteza', model: 'tálamo', tool: 'corteza motora', skill: 'cerebelo', agent: 'giro cingulado', mcp: 'lóbulo parietal', memory: 'hipocampo', input: 'tronco encefálico' };
const REGIONS = [
  { name: 'Corteza prefrontal', sub: 'proyectos que planifican', pos: new THREE.Vector3(0, 3.6, 6.9) },
  { name: 'Corteza premotora', sub: 'proyectos que ejecutan', pos: new THREE.Vector3(4.4, 5.1, 3.2) },
  { name: 'Corteza motora', sub: 'herramientas', pos: new THREE.Vector3(0, 6.0, 0.6) },
  { name: 'Lóbulo temporal izq.', sub: 'proyectos de lenguaje', pos: new THREE.Vector3(-6.6, -2.4, 0.4) },
  { name: 'Lóbulo occipital', sub: 'proyectos visuales', pos: new THREE.Vector3(0, 1.6, -7.6) },
  { name: 'Lóbulo parietal', sub: 'conectores', pos: new THREE.Vector3(0, 5.2, -3.6) },
  { name: 'Cerebelo', sub: 'skills', pos: new THREE.Vector3(0, -4.4, -5.6) },
  { name: 'Tálamo', sub: 'modelos', pos: new THREE.Vector3(0, 0.2, 0.2) },
  { name: 'Giro cingulado', sub: 'subagentes', pos: new THREE.Vector3(0, 3.6, -1.2) },
  { name: 'Hipocampo', sub: 'memoria', pos: new THREE.Vector3(2.6, -2.3, -0.4) },
  { name: 'Tronco encefálico', sub: 'tus peticiones', pos: new THREE.Vector3(0, -7.7, -2.5) },
];
