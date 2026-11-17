// Informe semanal: qué ha pasado en los últimos 7 días frente a los 7 anteriores y qué cambiar.
import { CTX_LEVELS } from './ingest.js';

const dayKey = (ts) => new Date(ts).toLocaleDateString('sv-SE');
const k = (n) => `${Math.round(n / 1000)} k`;

function sumRange(daily, from, to) {
  const out = { cost: 0, read: 0, out: 0, cr: 0, prompts: 0, msgs: 0, agentCost: 0, effort: {}, byProject: {}, byProjectPrompts: {} };
  for (let t = from; t < to; t += 86400e3) {
    const d = daily[dayKey(t)];
    if (!d) continue;
    out.cost += d.cost; out.msgs += d.msgs;
    out.read += d.tok.in + d.tok.cr + d.tok.cw; out.cr += d.tok.cr; out.out += d.tok.out;
    out.prompts += d.prompts || 0; out.agentCost += d.agentCost || 0;
    for (const [e, n] of Object.entries(d.effort || {})) out.effort[e] = (out.effort[e] || 0) + n;
    for (const [p, c] of Object.entries(d.byProject || {})) out.byProject[p] = (out.byProject[p] || 0) + c;
    for (const [p, c] of Object.entries(d.byProjectPrompts || {})) out.byProjectPrompts[p] = (out.byProjectPrompts[p] || 0) + c;
  }
  out.perPrompt = out.prompts ? out.cost / out.prompts : 0;
  return out;
}

export function weeklyReport(state, lastShape) {
  const now = Date.now();
  // días completos: de hace 6 días a hoy incluido
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const wStart = start.getTime() - 6 * 86400e3;
  const cur = sumRange(state.daily, wStart, now + 1);
  const prev = sumRange(state.daily, wStart - 7 * 86400e3, wStart);
  const delta = (a, b) => (b > 0 ? (a - b) / b : null);
  const pname = (key) => state.projects[key]?.name || key;

  const sessions = Object.values(state.sessions)
    .filter((s) => s.last >= wStart && s.mainMsgs)
    .map((s) => ({ id: s.id, title: s.title, project: pname(s.project), avgCtx: s.mainRead / s.mainMsgs, maxCtx: s.ctxMax || 0, steps: s.mainMsgs, prompts: s.prompts, stepsPerPrompt: s.prompts ? s.mainMsgs / s.prompts : s.mainMsgs, cost: s.cost }))
    .sort((a, b) => b.avgCtx * b.steps - a.avgCtx * a.steps);

  const projects = Object.entries(cur.byProject).map(([key, cost]) => {
    const pr = cur.byProjectPrompts[key] || 0;
    const ppr = prev.byProjectPrompts[key] || 0;
    const perPrompt = pr ? cost / pr : null;
    const prevPer = ppr ? (prev.byProject[key] || 0) / ppr : null;
    return { key, name: pname(key), cost, prompts: pr, perPrompt, trend: perPrompt != null && prevPer ? (perPrompt - prevPer) / prevPer : null };
  }).sort((a, b) => b.cost - a.cost);

  const tips = [];
  const heavy = sessions.filter((s) => s.avgCtx > CTX_LEVELS.high);
  if (heavy.length) {
    tips.push({ level: 'alto', title: 'Sesiones demasiado largas', text: `${heavy.length} ${heavy.length === 1 ? 'sesión ha trabajado' : 'sesiones han trabajado'} con más de ${k(CTX_LEVELS.high)} de contexto medio (la más pesada, «${heavy[0].title || heavy[0].project}», con ${k(heavy[0].avgCtx)} en cada paso). Abre una sesión nueva por tarea y usa /compact cuando pase de ${k(CTX_LEVELS.high)}.` });
  }
  const long = sessions.filter((s) => s.stepsPerPrompt > 40 && s.steps > 80);
  if (long.length) tips.push({ level: 'medio', title: 'Peticiones muy largas', text: `En «${long[0].title || long[0].project}» cada petición desencadena unos ${Math.round(long[0].stepsPerPrompt)} pasos. Dividir el encargo en partes más pequeñas hace que cada paso relea menos.` });
  const effTot = Object.values(cur.effort).reduce((a, b) => a + b, 0);
  const hi = (cur.effort.high || 0) + (cur.effort.xhigh || 0) + (cur.effort.max || 0);
  if (effTot > 20 && hi / effTot > 0.8) tips.push({ level: 'medio', title: 'Casi todo en esfuerzo alto', text: `El ${Math.round((hi / effTot) * 100)} % de los pasos va en esfuerzo high o superior. Para cambios pequeños (textos, estilos, ajustes) baja el nivel de esfuerzo a medium o low: piensa menos y suele bastar.` });
  if (cur.cost > 0 && cur.agentCost / cur.cost > 0.2) tips.push({ level: 'medio', title: 'Subagentes', text: `Los subagentes suponen el ${Math.round((cur.agentCost / cur.cost) * 100)} % del consumo de la semana. Cada uno arranca desde cero: úsalos para investigar en paralelo, no para tareas cortas.` });
  const toolsTok = lastShape ? lastShape.toolsChars / 3.6 : 0;
  if (toolsTok > 15000) tips.push({ level: 'bajo', title: 'Herramientas cargadas', text: `Las definiciones de herramientas ocupan ≈${k(toolsTok)} en cada paso (${lastShape.nTools} herramientas). Desactiva los conectores que no uses.` });
  if (cur.prompts >= 5 && prev.prompts >= 5) {
    const d = delta(cur.perPrompt, prev.perPrompt);
    if (d != null && d > 0.25) tips.push({ level: 'medio', title: 'Cada petición sale más cara', text: `El valor medio por petición ha subido un ${Math.round(d * 100)} % respecto a la semana anterior.` });
    if (d != null && d < -0.15) tips.push({ level: 'bien', title: 'Vas mejorando', text: `Cada petición consume un ${Math.round(-d * 100)} % menos que la semana anterior.` });
  }
  if (!tips.length) tips.push({ level: 'bien', title: 'Todo en orden', text: 'No hay nada destacable que corregir esta semana.' });

  return {
    from: wStart, to: now,
    cur: { cost: cur.cost, prompts: cur.prompts, read: cur.read, out: cur.out, perPrompt: cur.perPrompt, cache: cur.read ? cur.cr / cur.read : 0, effort: cur.effort, agentCost: cur.agentCost },
    prev: { cost: prev.cost, prompts: prev.prompts, perPrompt: prev.perPrompt },
    delta: { cost: delta(cur.cost, prev.cost), perPrompt: delta(cur.perPrompt, prev.perPrompt), prompts: delta(cur.prompts, prev.prompts) },
    sessions: sessions.slice(0, 6),
    projects,
    tips,
  };
}
