// Límites del plan (Pro / Max): ventana de 5 horas y límite semanal.
// Anthropic no publica el tamaño exacto de los límites, pero Claude Code deja escrito en el historial
// cada vez que te quedas sin margen («You've hit your 5-hour limit · resets 10:50pm»). Con esos cortes
// reales y el consumo registrado justo antes, Sinapsis estima tu presupuesto y cuánto llevas gastado.
// El consumo se mide en su equivalente a precios de la API: es la mejor aproximación local a cómo
// cuentan los límites (Opus gasta más que Sonnet, la caché gasta menos), aunque no la exacta.

const SLOT = 10 * 60e3;
const H5 = 5 * 3600e3;
const WEEK = 7 * 86400e3;

function sumSlots(slots, from, to) {
  let t = 0;
  for (let k = Math.floor(from / SLOT); k <= Math.floor((to - 1) / SLOT); k++) t += slots[k] || 0;
  return t;
}
const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Reconstruye las ventanas de 5 h: empiezan con el primer mensaje tras acabar la anterior. */
function windows5h(slots, since, hits) {
  const keys = Object.keys(slots).map(Number).filter((k) => k * SLOT >= since && slots[k] > 0).sort((a, b) => a - b);
  const known = hits.filter((h) => h.kind === '5h' && h.resetTs).map((h) => ({ start: h.resetTs - H5, end: h.resetTs }));
  const out = [];
  let w = null;
  for (const k of keys) {
    const ts = k * SLOT;
    if (w && ts < w.end) continue;
    // si un corte real marca dónde empezó esta ventana, se usa ese dato
    const kw = known.find((x) => ts >= x.start - SLOT && ts < x.end);
    w = kw ? { ...kw } : { start: ts, end: ts + H5 };
    out.push(w);
  }
  for (const x of out) x.used = sumSlots(slots, x.start, x.end);
  return out;
}

/**
 * Corrige la estimación con lecturas reales del porcentaje que da Anthropic (la línea de estado de
 * Claude Code, lo que tú mismos escribes al calibrar o, si lo activas, la consulta directa).
 * Con una lectura de esta ventana: % real de entonces + lo consumido después, al presupuesto que
 * implica esa lectura (lo visto en local ÷ % real: incluye lo que gastas en la web o el móvil).
 * Con lecturas de ventanas pasadas: aprende el presupuesto real (mediana).
 */
export function applyReadings(plan, readings, slots, now = Date.now()) {
  if (!readings?.length) return plan;
  const fix = (key, span) => {
    const w = plan[key];
    const all = readings.filter((r) => r[key] && r[key].pct != null && r[key].reset).sort((a, b) => a.ts - b.ts);
    // presupuestos implícitos en lecturas con señal suficiente (≥ 10 %)
    const implied = all.filter((r) => r[key].pct >= 10 && r.ts <= now).map((r) => sumSlots(slots, r[key].reset - span, r.ts + 1) / (r[key].pct / 100)).filter((b) => b > 0);
    const learned = median(implied.slice(-6));
    const cur = [...all].reverse().find((r) => r[key].reset > now && r.ts > r[key].reset - span && r.ts <= now);
    if (!cur) {
      if (learned) { w.budget = learned; w.pct = w.used / learned; w.learned = implied.length; }
      return;
    }
    const end = cur[key].reset, start = end - span;
    const pct0 = cur[key].pct / 100;
    const before = sumSlots(slots, start, cur.ts + 1);
    const after = sumSlots(slots, cur.ts + 1, now + 1);
    const budget = pct0 >= 0.05 && before > 0 ? before / pct0 : learned || w.budget || null;
    const pct = pct0 + (budget ? after / budget : 0);
    Object.assign(w, { start, end, budget: budget || 1, used: pct * (budget || 1), pct, anchored: true, real: { ts: cur.ts, src: cur.src, pct: pct0 } });
    delete w.eta;
    const rate = key === 'h5' ? plan.rate / 3600e3 : sumSlots(slots, now - 3 * 86400e3, now + 1) / (3 * 86400e3);
    if (budget && rate > 0) { const eta = now + Math.max(0, budget - w.used) / rate; if (eta < end) w.eta = eta; }
  };
  fix('h5', H5);
  fix('week', WEEK);
  return plan;
}

export function planStatus(state, now = Date.now(), readings = []) {
  const slots = state.slots || {};
  const hits = Object.values(state.limits || {}).sort((a, b) => a.ts - b.ts);
  const oldest = Math.min(now, ...Object.keys(slots).map((k) => k * SLOT));

  // consumo real hasta cada corte = presupuesto que tenías en esa ventana
  for (const h of hits) {
    if (h.used != null || !h.resetTs || h.ts > now - 60e3) continue;
    const span = h.kind === '5h' ? H5 : h.kind === 'week' || h.kind === 'model-week' ? WEEK : 0;
    if (!span || h.resetTs - span < oldest) continue;
    h.used = sumSlots(slots, h.resetTs - span, h.ts + 1);
  }
  const recentHits = (kind) => hits.filter((h) => h.kind === kind && h.used > 0).slice(-5);
  const b5 = recentHits('5h'), bw = recentHits('week');

  const wins = windows5h(slots, now - 8 * 86400e3, hits);
  const last = wins[wins.length - 1];
  const cur = last && now < last.end ? last : null;
  const peak = Math.max(0, ...wins.filter((w) => w !== cur).map((w) => w.used));
  const rate = sumSlots(slots, now - 3600e3, now + 1) / 3600e3; // consumo por ms en la última hora

  const budget5 = median(b5.map((h) => h.used));
  const h5 = {
    start: cur?.start || null,
    end: cur?.end || null,
    used: cur?.used || 0,
    budget: budget5,
    samples: b5.length,
    peak,
  };
  if (budget5) h5.pct = h5.used / budget5;
  if (cur && budget5 && rate > 0) {
    const eta = now + Math.max(0, budget5 - h5.used) / rate;
    if (eta < cur.end) h5.eta = eta;
  }

  // semana: anclada al último corte semanal conocido (el límite se reinicia siempre el mismo día y hora)
  const anchor = [...hits].reverse().find((h) => h.kind === 'week' && h.resetTs)?.resetTs;
  let wEnd = null, wStart = now - WEEK;
  if (anchor) {
    wEnd = anchor + Math.ceil((now - anchor) / WEEK) * WEEK;
    if (wEnd <= now) wEnd += WEEK;
    wStart = wEnd - WEEK;
  }
  const budgetW = median(bw.map((h) => h.used));
  const week = { start: wStart, end: wEnd, used: sumSlots(slots, wStart, now + 1), budget: budgetW, samples: bw.length, anchored: !!anchor };
  if (budgetW) week.pct = week.used / budgetW;
  // ritmo semanal: media diaria de los últimos 3 días
  const day3 = sumSlots(slots, now - 3 * 86400e3, now + 1) / (3 * 86400e3);
  if (budgetW && wEnd && day3 > 0) {
    const eta = now + Math.max(0, budgetW - week.used) / day3;
    if (eta < wEnd) week.eta = eta;
  }

  return applyReadings({
    h5,
    week,
    rate: rate * 3600e3, // por hora
    hits: hits.slice(-10).map(({ kind, label, ts, resetTs, used }) => ({ kind, label, ts, resetTs, used: used ?? null })),
    windows: wins.slice(-12).map(({ start, end, used }) => ({ start, end, used, hit: hits.some((h) => h.kind === '5h' && h.ts >= start && h.ts < end) })),
  }, readings, slots, now);
}
