// «Memoria común»: lo que Claude sabe de tus proyectos (el atlas) y si de verdad le ahorra búsqueda.
import { $, esc } from './format.js';

const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)} %`);
const n1 = (x) => (x == null ? '—' : x.toLocaleString('es-ES', { maximumFractionDigits: 1 }));

export const atlasMethods = {
  async loadAtlas() {
    const a = await this.cb.api('api/atlas');
    const card = $('#atlas');
    if (!a?.regions?.length) { card.hidden = true; return; }
    card.hidden = false;
    this.atlas = a;
    const r = a.replay, l = a.live;
    $('#atlas-aside').textContent = `${a.regions.length} proyectos`;
    let live;
    if (a.demo) {
      live = '<p class="atl-live">Con tu historial real y el hook instalado, aquí se compara en vivo cuánto busca Claude con pista y sin ella.</p>';
    } else if (l.with.n && l.enough) {
      live = `<p class="atl-live"><b>En vivo</b> (${l.days} días): con pista, Claude busca <b>${n1(l.with.x)} pasos</b> antes de editar; sin pista, <b>${n1(l.without.x)}</b>. Acierta el fichero en ${pct(l.with.hitRate)} de ${l.with.n} tareas.</p>`;
    } else if (a.hooks) {
      live = `<p class="atl-live">Midiendo en vivo: ${l.with.n} tarea${l.with.n === 1 ? '' : 's'} con pista de 5 necesarias para comparar con las ${l.without.n} sin pista.</p>`;
    } else {
      live = '<p class="atl-live">Conecta Sinapsis con Claude Code para que reciba las pistas solo: <code>npm run hooks:install</code>.</p>';
    }
    const usd = (x) => (x == null ? '—' : x.toLocaleString('es-ES', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }));
    const day = (ts) => new Date(ts).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
    const exps = (a.experiments || []).map((e) => {
      const side = (s, label) => `<div><small>${label}</small><b>${s.n ? `${n1(s.x)} pasos` : '—'}</b><span>${s.n ? `${usd(s.c)} por tarea · ${s.n} tarea${s.n === 1 ? '' : 's'}` : 'sin tareas aún'}</span></div>`;
      const verdict = !e.enough ? `Midiendo: ${e.after.n} de 5 tareas para comparar.` : e.after.x < e.before.x ? `<b>Busca ${pct(1 - e.after.x / e.before.x)} menos</b> antes de editar.` : '<b>No reduce la búsqueda</b> por ahora.';
      return `<div class="atl-exp"><p><b>Experimento: ${esc(e.label)} en ${esc(e.project)}</b> · desde el ${day(e.since)}. Búsqueda antes de editar y coste por tarea (se usó en ${e.after.used} de ${e.after.n}).</p>
        <div class="grid3 atl-ab">${side(e.before, '30 días antes')}${side(e.after, 'después')}<div><small>resultado</small><span>${verdict}</span></div></div></div>`;
    }).join('');
    const graphsTxt = a.graphs?.length ? `<p class="atl-note">Grafo de código (Graphify): ${a.graphs.map((g) => `<b>${esc(g.name)}</b> (${g.nodes.toLocaleString('es-ES')} símbolos)`).join(', ')}. Las pistas dicen qué función y en qué línea.</p>` : '';
    const conns = a.connections.slice(0, 4).map((c) => `<li><span><b>${esc(c.a)}</b> ↔ <b>${esc(c.b)}</b></span><small>${esc(c.why[0] || '')}</small></li>`).join('');
    $('.body', card).innerHTML = `
      <div class="atl-hero"><b>${pct(r.hitRate)}</b><span>de tus tareas: el mapa habría señalado el fichero que se editó entre sus 3 primeras pistas (repitiendo ${r.tasks} tareas a ciegas).</span></div>
      <p class="atl-note">Solo da pista cuando está seguro: en ${pct(r.coverage)} de las tareas, y ahí acierta ${pct(r.precision)}. Cada acierto evita ≈${n1(r.stepsSavable)} pasos de búsqueda.</p>
      ${live}
      ${graphsTxt}${exps}
      ${conns ? `<h3>Conexiones reales</h3><ul class="atl-conn">${conns}</ul>` : ''}`;
  },
};
