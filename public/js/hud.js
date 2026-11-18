// Capa de datos de la interfaz: paneles, plan, búsqueda, diálogos, EEG, inventario, etiquetas y detalle.
// La clase Hud reúne el estado; cada área vive en su módulo de ./hud/ y se mezcla en el prototipo.
import { isMobile } from './ui.js';
import { $, $$, CH, FOLD_KEY, REGIONS, cssColor, dayKey, esc } from './hud/format.js';
import { swipeToClose } from './hud/gestures.js';
import { Nav } from './hud/nav.js';
import { planMethods } from './hud/plan.js';
import { panelsMethods } from './hud/panels.js';
import { reportMethods } from './hud/report.js';
import { feedMethods } from './hud/feed.js';
import { paletteMethods } from './hud/palette.js';
import { detailMethods } from './hud/detail.js';
import { atlasMethods } from './hud/atlas.js';

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
    this.nav = new Nav();
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
    $('#btn-home').onclick = () => this.goHome();
    $('#brand h1').onclick = () => this.goHome();
    $('#btn-report').onclick = () => this.openReport();
    $('#btn-search').onclick = () => this.openPalette();
    $('#inv-toggle').onclick = () => this.toggleInventory();
    $('#inventory .close').onclick = () => this.toggleInventory(false);
    $('#detail .close').onclick = () => this.detailBack();

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
    // botones solo con icono: nombre accesible a partir del título; interruptores con su estado
    $$('button[title]').forEach((b) => { if (!b.textContent.trim() && !b.getAttribute('aria-label')) b.setAttribute('aria-label', b.title.replace(/ ·.*$/, '')); });
    $$('#btn-rotate, #btn-labels').forEach((b) => {
      b.setAttribute('aria-pressed', b.classList.contains('on'));
      b.addEventListener('click', () => b.setAttribute('aria-pressed', b.classList.contains('on')));
    });
    $$('.card').forEach((c) => {
      const f = $('header .fold', c);
      f?.setAttribute('aria-expanded', !c.classList.contains('folded'));
      $('header', c).addEventListener('click', () => f?.setAttribute('aria-expanded', !c.classList.contains('folded')));
    });
    for (const id of ['left', 'right', 'inventory', 'detail']) $('#' + id).classList.add('sheetable');
    swipeToClose($('#left'), toBrain);
    swipeToClose($('#right'), toBrain);
    swipeToClose($('#inventory'), toBrain);
    swipeToClose($('#detail'), () => this.detailBack());
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
    this.loadAtlas();
    setInterval(() => this.loadAtlas(), 5 * 60e3);
  }

  onKey(e) {
    const typing = e.target.matches?.('input, textarea');
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); this.isOpen('palette') ? this.closeModal('palette') : this.openPalette(); return; }
    // Esc = «atrás»: cierra solo la pantalla de arriba
    if (e.key === 'Escape') { if (!this.nav.back() && this.isOpen('detail')) this.detailBack(); return; }
    if (typing || e.metaKey || e.ctrlKey || e.altKey || $$('[data-modal].open').length) return;
    const k = e.key.toLowerCase();
    if (k === '/') { e.preventDefault(); this.openPalette(); }
    else if (k === 'r') this.openReport();
    else if (k === 'i') this.toggleInventory();
    else if (k === 'h') this.goHome();
    else if (k === 'l') $('#btn-labels').click();
    else if (k === 'p') this.toggleReplay();
    else if (k === ' ') { e.preventDefault(); $('#btn-rotate').click(); }
    else if (e.key === '?') this.openModal('info');
  }

  // ---------- PWA ----------
  /** Hay una versión nueva esperando: aviso que no desaparece solo hasta que se decida. */
  offerUpdate(apply) {
    if ($('#toasts .toast.update')) return;
    const el = document.createElement('div');
    el.className = 'toast update';
    el.innerHTML = '<b>Hay una versión nueva de Sinapsis</b><span>Actualiza cuando quieras: tarda un segundo.</span><div class="acts"><button class="go">Actualizar</button><button class="later">Más tarde</button></div>';
    $('.go', el).onclick = (e) => { e.stopPropagation(); e.currentTarget.textContent = 'Actualizando…'; apply(); };
    $('.later', el).onclick = (e) => { e.stopPropagation(); el.remove(); };
    $('#toasts').prepend(el);
  }

  setInstaller(inst) { this.installer = inst; }
  onInstallState(st) {
    this.installState = st;
    $('#install-row').hidden = !(st.canPrompt || st.iosHint);
    $('#btn-install').onclick = () => this.install();
  }
  async install() {
    const st = this.installState || {};
    if (st.iosHint) { this.closeModal('info'); this.openModal('install'); return; }
    const out = await this.installer?.prompt();
    if (out === 'accepted') this.closeModal('info');
  }

  /** Abre una tarjeta concreta (accesos directos): en el móvil, su pestaña; en escritorio, desplegada y a la vista. */
  showCard(card) {
    if (isMobile()) { this.setTab(card === 'plan' ? 'metab' : card === 'impulses' ? 'feed' : 'thought'); return; }
    const c = $(`.card[data-card="${card}"]`);
    c?.classList.remove('folded');
    c?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /** Vuelve a la vista inicial: cierra fichas y hojas y encuadra el cerebro entero. */
  goHome() {
    this.nav.unwind((l) => l.kind === 'detail' || l.kind === 'tab' || l.kind === 'inv');
    this._hideDetail();
    if (document.body.dataset.tab !== 'brain') this._setTab('brain');
    this.cb.onHome?.();
  }

  isOpen(id) { return $('#' + id).classList.contains('open'); }
  openModal(id) {
    if (this.isOpen(id)) return;
    const prevFocus = document.activeElement;
    $('#' + id).classList.add('open');
    $('#tip').classList.remove('show');
    $('#' + id + ' input')?.focus({ preventScroll: true }); // inmediato: lo que se teclee ya va al buscador
    this.nav.push('modal:' + id, () => {
      $('#' + id).classList.remove('open');
      if (prevFocus && document.contains(prevFocus)) prevFocus.focus?.({ preventScroll: true });
      else document.activeElement?.blur?.();
    });
  }
  closeModal(id) {
    if (this.nav.is('modal:' + id)) this.nav.back();
    else if (!this.nav.remove('modal:' + id)) $('#' + id).classList.remove('open');
  }

  toggleReplay() {
    if (this.replaying) { this.cb.onReplay(null); return; }
    if (!this.snap?.recent?.length) return;
    this.cb.onReplay(this.snap.recent);
  }

  toggleInventory(force) {
    if (isMobile()) { this.setTab('inv'); return; }
    const open = force ?? !this.isOpen('inventory');
    if (!open) { if (!this.nav.remove('inv')) this._hideInventory(); return; }
    if (this.isOpen('inventory')) return;
    $('#inventory').classList.add('open');
    $('#inv-toggle').classList.add('on');
    this.renderInventory();
    setTimeout(() => $('#inv-filter').focus({ preventScroll: true }), 30);
    this.nav.push('inv', () => this._hideInventory());
  }
  _hideInventory() {
    $('#inventory').classList.remove('open');
    $('#inv-toggle').classList.remove('on');
    if ($('#inventory').contains(document.activeElement)) document.activeElement.blur();
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

  /** Pestañas del móvil. Cambiar de pestaña no acumula historial: «atrás» siempre vuelve al cerebro. */
  setTab(tab) {
    if (tab === 'brain') {
      this.nav.unwind((l) => l.kind === 'tab' || l.kind === 'detail');
      if (document.body.dataset.tab !== 'brain') this._setTab('brain');
      return;
    }
    this.nav.unwind((l) => l.kind === 'detail');
    this._setTab(tab);
    if (!this.nav.is('tab')) this.nav.push('tab', () => this._setTab('brain'));
  }

  _setTab(tab) {
    document.body.dataset.tab = tab;
    setTimeout(() => this.syncSheet(), 0);
    $$('#tabbar button').forEach((x) => { x.classList.toggle('on', x.dataset.tab === tab); x.setAttribute('aria-current', x.dataset.tab === tab ? 'page' : 'false'); });
    if (tab === 'brain') $$('.sheetable.expanded').forEach((x) => x.classList.remove('expanded'));
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
    const canReplay = !!snap.recent?.length;
    $('#btn-replay').disabled = !canReplay;
    $('#btn-replay').title = canReplay ? 'Reproduce, acelerada, la actividad real de las últimas 24 horas · P' : 'No hay actividad en las últimas 24 horas';
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

Object.assign(Hud.prototype, planMethods, panelsMethods, reportMethods, feedMethods, paletteMethods, detailMethods, atlasMethods);
