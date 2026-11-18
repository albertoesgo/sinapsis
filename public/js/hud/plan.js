// Tu plan (ventana de 5 h y semana), «Ahora mismo» y el vistazo del móvil.
import { isMobile, STATIC } from '../ui.js';
import { $, $$, CTX, LIVE_MS, esc, hm, inTime, levelOf, money, pctTxt, tok, wday } from './format.js';

const SRC = { 'claude-code': 'línea de estado de Claude Code', manual: 'lo escribiste tú', anthropic: 'consulta a Anthropic' };
const ago = (ts) => { const m = Math.round((Date.now() - ts) / 60e3); return m < 1 ? 'ahora' : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} d`; };

export const planMethods = {
  // ---------- tu plan ----------
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
    const realTip = (w) => `Dato real de Anthropic: ${Math.round(w.real.pct * 100)} % a las ${hm(w.real.ts)} (${SRC[w.real.src] || w.real.src}), más lo gastado en este Mac desde entonces`;
    const tip5 = h5.real ? realTip(h5) : h5.budget ? `≈${money(h5.used)} de ≈${money(h5.budget)} equivalentes (estimado con ${h5.samples} cortes reales)` : `${money(h5.used)} en esta ventana · aún no has llegado nunca al límite de 5 h`;
    const tipW = week.real ? realTip(week) : week.budget ? `≈${money(week.used)} de ≈${money(week.budget)} equivalentes (estimado con ${week.samples} corte${week.samples === 1 ? '' : 's'} real${week.samples === 1 ? '' : 'es'})` : `${money(week.used)} esta semana`;

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
    const real = [h5.real, week.real].filter(Boolean).sort((a, b) => b.ts - a.ts)[0];
    $('#plan-aside').textContent = real ? `dato real · ${ago(real.ts)}` : h5.budget || week.budget ? 'estimado' : '';
    $('.body', card).innerHTML = `
      <div class="rings">${ring('Ventana de 5 h', h5, sub5, tip5)}${ring('Semana', week, subW, tipW)}</div>
      <div class="verdict g-${lvl}">${v}</div>
      ${wins.length ? `<div class="wins g-${levelOf(p5)}">${bars}</div><div class="wins-cap"><span>tus últimas ventanas de 5 h</span><span>${hits ? `<span style="color:var(--bad)">■</span> llegaste al límite` : ''}</span></div>` : ''}
      <p class="plan-note">${real
        ? `Parte del <b>dato real</b> que dio Anthropic a las ${hm(real.ts)} (${SRC[real.src] || real.src}) y suma lo que gastas en este Mac desde entonces. Lo de la web o el móvil se verá en la próxima lectura.`
        : `Estimación con lo consumido antes de cada corte real${h5.samples || week.samples ? ` (${h5.samples} de 5 h, ${week.samples} semanal${week.samples === 1 ? '' : 'es'})` : ''}. No ve lo que gastas en la web o el móvil.`}
        ${STATIC ? '' : '<button class="calib">¿No cuadra con Claude → Uso? Corrígelo</button>'}</p>
      <form class="calib-form" hidden>
        <label>5 h <input name="h5" inputmode="decimal" placeholder="${h5.pct != null ? Math.round(h5.pct * 100) : '—'}" /> %</label>
        <label>Semana <input name="week" inputmode="decimal" placeholder="${week.pct != null ? Math.round(week.pct * 100) : '—'}" /> %</label>
        <button type="submit">Guardar</button>
      </form>`;
    const btn = $('.calib', card), form = $('.calib-form', card);
    if (btn) btn.onclick = () => { form.hidden = !form.hidden; if (!form.hidden) $('input', form).focus(); };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const r = await this.cb.post?.('api/usage', { h5: fd.get('h5'), week: fd.get('week') });
      if (r?.plan) { this.snap.plan = r.plan; this.renderPlan(); this.renderNow(); }
    };
  },

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
  },

  // ---------- ahora mismo ----------
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
    this.renderGlance(items);
    $('#now-list').innerHTML = items.map((it, i) => `<li class="g-${it.lvl}${it.static ? ' static' : ''}" data-i="${i}"><span class="ic">${it.ic}</span><div><b>${esc(it.title)}</b><span>${it.text}</span></div></li>`).join('');
    $$('#now-list li').forEach((li) => {
      const it = items[+li.dataset.i];
      li.onclick = () => {
        if (it.id) this.cb.onFocus(it.id);
        else if (it.card) { const c = $(`.card[data-card="${it.card}"]`); c.classList.remove('folded'); if (isMobile()) this.setTab('metab'); c.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
      };
    });
  },

  /** Móvil: lo esencial encima del cerebro, sin abrir nada. */
  renderGlance(items) {
    const pl = this.snap?.plan;
    const C = 2 * Math.PI * 7;
    const mini = (label, w, sub, tab) => {
      if (!w?.budget) return '';
      const p = w.used / w.budget;
      return `<button class="gl g-${levelOf(p)}" data-tab="${tab}"><svg viewBox="0 0 18 18"><circle cx="9" cy="9" r="7" class="trk"/><circle cx="9" cy="9" r="7" class="val" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - Math.min(1, p))).toFixed(1)}"/></svg><b>${label} ${Math.round(p * 100)} %</b>${sub ? `<span>${sub}</span>` : ''}</button>`;
    };
    const warn = items.filter((i) => (i.lvl === 'bad' || i.lvl === 'warn') && !i.card);
    const worst = warn.some((i) => i.lvl === 'bad') ? 'bad' : 'warn';
    const nowChip = warn.length
      ? `<button class="gl g-${worst}" data-tab="thought"><i></i><b>${warn.length} ${warn.length === 1 ? 'aviso' : 'avisos'}</b><span>${esc(warn[0].title)}</span></button>`
      : `<button class="gl g-ok" data-tab="thought"><i></i><b>Todo en orden</b></button>`;
    $('#glance').innerHTML = mini('5 h', pl?.h5, pl?.h5.end ? '· ' + hm(pl.h5.end) : '', 'metab') + mini('Semana', pl?.week, '', 'metab') + nowChip;
    $$('#glance .gl').forEach((b) => { b.onclick = () => this.setTab(b.dataset.tab); });
    const badge = $('#tabbar .badge');
    const n = items.filter((i) => i.lvl === 'bad' || i.lvl === 'warn').length;
    badge.hidden = !n;
    badge.textContent = n;
    badge.className = 'badge ' + (items.some((i) => i.lvl === 'bad') ? 'bad' : 'warn');
  },
};
