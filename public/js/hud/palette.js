// Búsqueda con ⌘K: proyectos, sesiones, skills, herramientas y acciones.
import { $, $$, ago, cssColor, esc, money, norm } from './format.js';

export const paletteMethods = {
  // ---------- búsqueda (⌘K) ----------
  openPalette() {
    this.palSel = 0;
    $('#pal-input').value = '';
    this.openModal('palette');
    this.renderPalette();
    this.coachDone?.();
  },

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
  },

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
  },

  runItem(it) {
    this.closeModal('palette');
    if (it.run) it.run();
    else if (it.id) this.cb.onFocus(it.id);
  },
};
