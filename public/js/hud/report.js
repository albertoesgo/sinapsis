// Informe semanal: resumen, días, límites, ritmo y consejos.
import { $, $$, CTX, dayKey, esc, hm, money, pctTxt, sumTok, tok, wday } from './format.js';

export const reportMethods = {
  // ---------- informe ----------
  async openReport() {
    const box = $('#report');
    this.openModal('report');
    const r = await this.cb.api('api/report');
    if (!r) return;
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
      ${this.rhythmHtml(r.rhythm)}
      <h3>Qué cambiar</h3>
      <ul class="tips">${r.tips.map((t) => `<li class="t-${t.level}"><b>${esc(t.title)}</b><span>${esc(t.text)}</span></li>`).join('')}</ul>
      ${r.sessions.length ? `<h3>Sesiones más pesadas</h3><table><tr><th>Sesión</th><th>Proyecto</th><th class="n">Contexto medio</th><th class="n">Pasos</th><th class="n">Pasos/petición</th></tr>
        ${r.sessions.map((s) => `<tr class="click" data-id="session:${esc(s.id)}"><td>${esc(s.title || 'Sin título')}</td><td>${esc(s.project)}</td><td class="n ${s.avgCtx > CTX.high ? 'up' : ''}">${tok(s.avgCtx)}</td><td class="n">${s.steps}</td><td class="n">${Math.round(s.stepsPerPrompt)}</td></tr>`).join('')}</table>` : ''}
      ${r.projects.length ? `<h3>Por proyecto</h3><table><tr><th>Proyecto</th><th class="n">Peticiones</th><th class="n">Por petición</th><th class="n">Tendencia</th><th class="n">Consumo</th></tr>
        ${r.projects.map((p) => `<tr class="click" data-id="project:${esc(p.key)}"><td>${esc(p.name)}</td><td class="n">${p.prompts}</td><td class="n">${p.perPrompt != null ? money(p.perPrompt) : '—'}</td><td class="n">${p.trend == null ? '—' : `<span class="${p.trend > 0 ? 'up' : 'down'}">${p.trend > 0 ? '▲' : '▼'} ${Math.abs(Math.round(p.trend * 100))} %</span>`}</td><td class="n">${money(p.cost)}</td></tr>`).join('')}</table>` : ''}
      ${eff ? `<h3>Esfuerzo usado</h3><p class="muted">${eff}</p>` : ''}`;
    $$('tr.click', box).forEach((tr) => { tr.onclick = () => { this.closeModal('report'); this.cb.onFocus(tr.dataset.id); }; });
  },

  /** Mapa de calor: consumo por día de la semana y hora (últimas 4 semanas). */
  rhythmHtml(rh) {
    if (!rh) return '';
    const flat = rh.flat();
    const max = Math.max(...flat);
    if (!max) return '';
    const DAYS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
    const LONG = ['los lunes', 'los martes', 'los miércoles', 'los jueves', 'los viernes', 'los sábados', 'los domingos'];
    const iMax = flat.indexOf(max);
    const byHour = Array.from({ length: 24 }, (_, h) => rh.reduce((a, row) => a + row[h], 0));
    const byDay = rh.map((row) => row.reduce((a, b) => a + b, 0));
    const hPeak = byHour.indexOf(Math.max(...byHour));
    const dPeak = byDay.indexOf(Math.max(...byDay));
    const night = byHour.slice(0, 7).reduce((a, b) => a + b, 0) / Math.max(1e-9, byHour.reduce((a, b) => a + b, 0));
    const cells = rh.map((row, d) => `<span class="d">${DAYS[d]}</span>` + row.map((v, h) => `<i style="--a:${v ? (0.12 + 0.88 * Math.sqrt(v / max)).toFixed(2) : 0}" title="${DAYS[d]} ${h}:00 · ${money(v)}"></i>`).join('')).join('');
    const hours = '<span></span>' + Array.from({ length: 24 }, (_, h) => `<span class="h">${h % 6 === 0 ? h : ''}</span>`).join('');
    return `<h3>Tu ritmo · últimas 4 semanas</h3>
      <p class="muted rh-sum">Trabajas sobre todo <b>${LONG[dPeak]}</b>, con el pico hacia las <b>${hPeak}:00</b>. El momento más intenso: ${DAYS[Math.floor(iMax / 24)]} a las ${iMax % 24}:00.${night > 0.15 ? ` Un ${Math.round(night * 100)} % del consumo es de madrugada (0–7 h).` : ''}</p>
      <div class="rhythm">${cells}${hours}</div>`;
  },
};
