// Capa de datos de la interfaz: paneles, plan, búsqueda, diálogos, EEG, inventario, etiquetas y detalle.
// La clase Hud reúne el estado; cada área vive en su módulo de ./hud/ y se mezcla en el prototipo.
import { isMobile } from './ui.js';
import { $, $$, CH, FOLD_KEY, REGIONS, cssColor, dayKey, esc } from './hud/format.js';
import { swipeToClose } from './hud/gestures.js';
import { planMethods } from './hud/plan.js';
import { panelsMethods } from './hud/panels.js';
import { reportMethods } from './hud/report.js';
import { feedMethods } from './hud/feed.js';
import { paletteMethods } from './hud/palette.js';
import { detailMethods } from './hud/detail.js';

export { tok, ago } from './hud/format.js';

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
    this.replaySpeed = 1;
    $('#replay .speed').onclick = (e) => { this.replaySpeed = this.replaySpeed >= 4 ? 1 : this.replaySpeed * 2; e.currentTarget.textContent = this.replaySpeed + '×'; };
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

    // barra inferior (móvil): su altura real (con la zona segura del iPhone) coloca el EEG y las hojas
    document.body.dataset.tab = 'brain';
    new ResizeObserver(() => {
      const h = $('#tabbar').getBoundingClientRect().height;
      document.documentElement.style.setProperty('--tabbar-h', h ? h + 'px' : '');
    }).observe($('#tabbar'));
    $$('#tabbar button').forEach((b) => {
      b.onclick = () => this.setTab(b.dataset.tab === document.body.dataset.tab ? 'brain' : b.dataset.tab);
    });

    // QR para el móvil (solo desde el propio ordenador)
    this.cb.api('api/mobile').then((m) => {
      if (!m || m.remote) { this.remote = !!m?.remote; $('#btn-mobile').remove(); return; }
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

    // móvil: deslizar hacia abajo cierra hojas y diálogos
    const toBrain = () => this.setTab('brain');
    for (const id of ['left', 'right', 'inventory', 'detail']) $('#' + id).classList.add('sheetable');
    swipeToClose($('#left'), toBrain);
    swipeToClose($('#right'), toBrain);
    swipeToClose($('#inventory'), toBrain);
    swipeToClose($('#detail'), () => { this.hideDetail(); this.cb.onHome?.(); });
    $$('[data-modal]').forEach((m) => { if (m.id !== 'palette') swipeToClose($('article', m), () => this.closeModal(m.id), $('.mbody', m)); });

    // escritorio: sombra al pie de un panel cuando queda contenido por debajo
    for (const el of [$('#left'), $('#right')]) {
      const upd = () => el.classList.toggle('more', !isMobile() && el.scrollTop + el.clientHeight < el.scrollHeight - 6);
      el.addEventListener('scroll', upd, { passive: true });
      new ResizeObserver(upd).observe(el);
      this.panelChecks = [...(this.panelChecks || []), upd];
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
    if (isMobile()) { this.setTab('inv'); return; }
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

  /** En el móvil: marca si hay una hoja abierta (para subir el cerebro) y avisa al 3D. */
  syncSheet() {
    const open = document.body.dataset.tab !== 'brain' || $('#detail').classList.contains('open');
    document.body.classList.toggle('sheet-open', open);
    this.cb.onLayout?.();
  }

  setTab(tab) {
    document.body.dataset.tab = tab;
    setTimeout(() => this.syncSheet(), 0);
    $$('#tabbar button').forEach((x) => x.classList.toggle('on', x.dataset.tab === tab));
    if (tab !== 'brain') this.hideDetail();
    else $$('.sheetable.expanded').forEach((x) => x.classList.remove('expanded'));
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
      this.feed = snap.recent.filter((e) => e.k !== 'result' || e.err).slice(-400).reverse();
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
    requestAnimationFrame(() => this.panelChecks?.forEach((f) => f()));
  }
}

Object.assign(Hud.prototype, planMethods, panelsMethods, reportMethods, feedMethods, paletteMethods, detailMethods);
