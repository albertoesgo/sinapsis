// Neuronas (nodos reales del sistema), axones (conexiones reales) e impulsos (eventos reales).
import * as THREE from 'three';
import { cortexAt, cerebAt, STEM, rng, gauss, hash } from './brain.js';

export const TYPE_COLOR = {
  input: new THREE.Color('#f4f1ea'),
  model: new THREE.Color('#ffcf8a'),
  tool: new THREE.Color('#b993ff'),
  skill: new THREE.Color('#6ff0b0'),
  agent: new THREE.Color('#ff9a5c'),
  mcp: new THREE.Color('#ff6fae'),
  memory: new THREE.Color('#7fa2ff'),
};
export const TYPE_LABEL = {
  input: 'Entrada', project: 'Proyecto', session: 'Sesión', model: 'Modelo', tool: 'Herramienta', skill: 'Skill', agent: 'Agente', mcp: 'Conector', memory: 'Memoria',
};

export function projectColor(i) {
  const hues = [0.53, 0.47, 0.6, 0.12, 0.83, 0.38, 0.97, 0.68, 0.2, 0.56, 0.9, 0.3];
  return new THREE.Color().setHSL(hues[i % hues.length], 0.75, 0.64);
}

// Huecos de la corteza para proyectos (dirección relativa al centro de cada hemisferio)
// Funciones corticales reales → zona donde se coloca un proyecto según lo que más hace.
// Dirección relativa al centro de cada hemisferio (x se multiplica por el lado h).
export const FUNCTIONS = {
  plan:   { name: 'Planificar y razonar', lobe: 'Corteza prefrontal', why: 'planificación, decisiones y razonamiento', dir: (h) => [0.32 * h, 0.42, 0.86] },
  exec:   { name: 'Ejecutar y construir', lobe: 'Corteza premotora', why: 'preparar y encadenar acciones, junto a la corteza motora', dir: (h) => [0.52 * h, 0.72, 0.36] },
  lang:   { name: 'Leer, investigar y escribir', lobe: 'Lóbulo temporal izquierdo', why: 'comprensión del lenguaje (área de Wernicke), en el lado izquierdo en la mayoría de personas', dir: (h) => [0.93 * h, -0.32, 0.02] },
  vision: { name: 'Trabajar con imágenes', lobe: 'Lóbulo occipital', why: 'corteza visual; el procesamiento visoespacial tiende a la derecha', dir: (h) => [0.32 * h, 0.22, -0.93] },
};

/** Perfil real de un proyecto frente a la media de todos: cuánto destaca en cada función. */
export function projectProfile(p, global) {
  const t = Object.values(p.prof || {}).reduce((a, b) => a + b, 0);
  const gt = Object.values(global).reduce((a, b) => a + b, 0) || 1;
  const share = {}, lift = {};
  for (const k of Object.keys(FUNCTIONS)) {
    share[k] = t ? (p.prof[k] || 0) / t : 0;
    const g = (global[k] || 0) / gt;
    lift[k] = g ? share[k] / g : 0;
  }
  const main = t ? Object.keys(lift).sort((a, b) => lift[b] - lift[a])[0] : 'exec';
  return { share, lift, main, total: t, gshare: Object.fromEntries(Object.keys(FUNCTIONS).map((k) => [k, (global[k] || 0) / gt])) };
}

const log = (x) => Math.log10(1 + Math.max(0, x));

/** Construye el layout anatómico a partir de la instantánea del servidor. */
export function layout(snap) {
  const nodes = new Map();
  const add = (n) => { nodes.set(n.id, n); return n; };
  const maxCost = Math.max(1e-6, ...snap.projects.map((p) => p.cost));

  add({ id: 'input', type: 'input', label: 'Tú', pos: STEM.bottom.clone().add(new THREE.Vector3(0, -0.4, 0)), color: TYPE_COLOR.input, size: 1.6, data: { prompts: snap.totals.prompts } });

  // Modelos → tálamo (todo pensamiento pasa por aquí)
  const models = [...snap.models].sort((a, b) => b.msgs - a.msgs);
  const tpos = [[-0.95, 1.0, -0.2], [0.95, 1.0, -0.2], [0, 1.75, 0.5], [0, 0.35, -0.9], [-0.7, 1.8, -1.0], [0.7, 1.8, -1.0], [-0.6, 0.2, 0.6], [0.6, 0.2, 0.6]];
  models.forEach((m, i) => {
    const p = tpos[i % tpos.length];
    add({ id: 'model:' + m.name, type: 'model', label: m.label, pos: new THREE.Vector3(...p), color: TYPE_COLOR.model, size: 1.3 + 0.45 * log(m.cost), data: m });
  });

  // Proyectos → regiones de la corteza; sus sesiones → neuronas de esa región
  // Cada proyecto va a la zona de la corteza que hace lo que ese proyecto hace más que la media
  const projects = [...snap.projects].sort((a, b) => b.cost - a.cost);
  const projIndex = new Map();
  const global = { plan: 0, exec: 0, lang: 0, vision: 0 };
  for (const p of projects) for (const k in global) global[k] += p.prof?.[k] || 0;
  const placed = [];
  let bilateral = 0;
  projects.forEach((p) => {
    const prof = projectProfile(p, global);
    const L = prof.lift;
    // Hemisferio: el lenguaje está lateralizado a la izquierda y lo visoespacial tiende a la derecha.
    // Planificar y ejecutar son bilaterales: se reparten a ambos lados.
    const h = prof.main === 'lang' ? -1 : prof.main === 'vision' ? 1 : (bilateral++ % 2 ? 1 : -1);
    // Va a la zona en la que más destaca; si destaca también en otra, se desvía un poco hacia ella
    const dir = new THREE.Vector3(...FUNCTIONS[prof.main].dir(h)).normalize();
    const second = Object.keys(L).filter((k) => k !== prof.main).sort((a, b) => L[b] - L[a])[0];
    if (second && L[second] > 1.05) dir.lerp(new THREE.Vector3(...FUNCTIONS[second].dir(h)).normalize(), 0.16).normalize();
    placed.push({ p, h, dir, prof });
  });
  // separa los que caen demasiado cerca en el mismo hemisferio
  for (let it = 0; it < 40; it++) {
    for (const a of placed) for (const b of placed) {
      if (a === b || a.h !== b.h) continue;
      const ang = a.dir.angleTo(b.dir);
      if (ang < 0.34) {
        const push = a.dir.clone().sub(b.dir);
        if (push.lengthSq() < 1e-6) push.set(0, (hash(a.p.key) % 2 ? 1 : -1), 0);
        a.dir.addScaledVector(push.normalize(), (0.34 - ang) * 0.5).normalize();
      }
    }
  }
  placed.forEach(({ p, h, dir, prof }, i) => {
    const color = projectColor(i);
    projIndex.set(p.key, { h, dir, color });
    add({ id: 'project:' + p.key, type: 'project', label: p.name || p.key, pos: cortexAt(h, dir, 0.55), color, size: 1.0 + 0.8 * (p.cost / maxCost) + 0.25 * log(p.cost), data: p, h, dir, prof });
  });
  for (const s of snap.sessions) {
    const pi = projIndex.get(s.project);
    if (!pi) continue;
    const r = rng('s' + s.id);
    const spread = 0.12 + 0.05 * Math.min(4, snap.projects.find((p) => p.key === s.project)?.sessions.length || 1);
    const dir = pi.dir.clone().add(new THREE.Vector3(gauss(r), gauss(r), gauss(r)).multiplyScalar(spread)).normalize();
    add({ id: 'session:' + s.id, type: 'session', label: s.title || 'Sesión ' + s.id.slice(0, 6), pos: cortexAt(pi.h, dir, 0.2 + r() * 0.55), color: pi.color.clone().lerp(new THREE.Color('#ffffff'), 0.15), size: 0.7 + 0.55 * log(s.cost * 4), data: s, project: s.project });
  }

  // Herramientas → corteza motora (franja sobre el surco central)
  const tools = snap.tools.filter((t) => !['Skill', 'Agent', 'Task'].includes(t.name) && !t.name.startsWith('mcp__')).sort((a, b) => b.uses - a.uses).slice(0, 22);
  tools.forEach((t, i) => {
    const h = i % 2 === 0 ? -1 : 1;
    const k = Math.floor(i / 2);
    const a = -0.32 + k * 0.19;
    const dir = new THREE.Vector3(h * Math.sin(a), Math.cos(a), 0.07 + 0.1 * Math.sin(a));
    add({ id: 'tool:' + t.name, type: 'tool', label: t.name, pos: cortexAt(h, dir, 0.18), color: TYPE_COLOR.tool, size: 0.75 + 0.42 * log(t.uses), data: t });
  });

  // Conectores MCP → lóbulo parietal (integra la información que llega de fuera)
  [...snap.mcps].sort((a, b) => b.uses - a.uses).forEach((m, i) => {
    const h = i % 2 === 0 ? -1 : 1;
    const k = Math.floor(i / 2);
    const dir = new THREE.Vector3(h * 0.62, 0.62, -0.42 + k * 0.16);
    add({ id: 'mcp:' + m.name, type: 'mcp', label: m.label, pos: cortexAt(h, dir, 0.25), color: TYPE_COLOR.mcp, size: 0.8 + 0.45 * log(m.uses), data: m });
  });

  // Skills → cerebelo (memoria procedimental: lo que sabe hacer)
  const skills = [...snap.skills].sort((a, b) => (b.uses + b.attributed) - (a.uses + a.attributed) || a.name.localeCompare(b.name));
  const nSk = skills.length;
  skills.forEach((s, i) => {
    const h = i % 2 === 0 ? -1 : 1;
    const k = Math.floor(i / 2);
    const per = Math.ceil(nSk / 2);
    const g = (k + 0.5) / per;
    const theta = -0.95 + g * 1.9;
    const row = (k % 3) - 1;
    const dir = new THREE.Vector3(h * (0.55 + 0.3 * Math.cos(theta)), -0.15 + row * 0.38, -0.55 + 0.6 * Math.sin(theta) * 0.6 - 0.35);
    const used = (s.uses || 0) + (s.attributed || 0);
    add({ id: 'skill:' + s.name, type: 'skill', label: s.name, pos: cerebAt(h, dir, 0.12), color: TYPE_COLOR.skill, size: used ? 0.85 + 0.5 * log(used) : 0.5, data: s, dormant: !used });
  });

  // Agentes (tipos de subagente) → giro cingulado (medial, sobre el cuerpo calloso)
  const agents = [...snap.agents].sort((a, b) => (b.spawns || 0) - (a.spawns || 0));
  agents.forEach((a, i) => {
    const h = i % 2 === 0 ? -1 : 1;
    const k = Math.floor(i / 2);
    const per = Math.max(2, Math.ceil(agents.length / 2));
    const u = (k + 0.5) / per;
    const z = 3.0 - u * 6.0;
    const y = 2.2 + 1.1 * Math.sin(Math.PI * u);
    add({ id: 'agent:' + a.name, type: 'agent', label: a.name, pos: new THREE.Vector3(h * 0.75, y, z), color: TYPE_COLOR.agent, size: a.spawns ? 0.9 + 0.5 * log(a.spawns) : 0.5, data: a, dormant: !a.spawns });
  });

  // Memoria → hipocampo
  const mems = snap.memory.filter((m) => m.files || m.reads || m.writes);
  const side = { '-1': 0, 1: 0 };
  mems.forEach((m) => {
    const pi = projIndex.get(m.key);
    const h = pi ? pi.h : -1;
    const k = side[h]++;
    const pos = new THREE.Vector3(h * (2.0 + 0.25 * (k % 2)), -1.55 + 0.15 * k, 0.6 - k * 0.55);
    add({ id: 'memory:' + m.key, type: 'memory', label: 'Memoria · ' + (snap.projects.find((p) => p.key === m.key)?.name || m.key), pos, color: TYPE_COLOR.memory, size: 0.6 + 0.35 * log(m.files * 3 + m.writes), data: m, project: m.key });
  });

  let i = 0;
  for (const n of nodes.values()) { n.idx = i++; n.act = n.act || 0; }
  return { nodes, projIndex };
}

// ---------- curvas ----------
const CENTER = new THREE.Vector3(0, 0.6, -0.6);
export function curvePoints(a, b, key, seg = 40) {
  const r = rng(key);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const dist = a.distanceTo(b);
  const ctrl = mid.clone().lerp(CENTER, 0.32).add(new THREE.Vector3(gauss(r), gauss(r), gauss(r)).multiplyScalar(0.12 * dist));
  const c = new THREE.QuadraticBezierCurve3(a, ctrl, b);
  return c.getPoints(seg);
}

// ---------- materiales ----------
export function somaMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uPR: { value: Math.min(2, window.devicePixelRatio) }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute vec3 aColor; attribute float aSize; attribute float aGlow;
      uniform float uPR;
      varying vec3 vC; varying float vG;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * (1.0 + aGlow * 0.9) * uPR * (190.0 / -mv.z);
        vC = aColor; vG = aGlow;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vC; varying float vG;
      void main(){
        float d = length(gl_PointCoord - 0.5) * 2.0;
        if (d > 1.0) discard;
        float core = smoothstep(0.32, 0.0, d);
        float halo = exp(-d * d * 5.0) * 0.55;
        float ring = smoothstep(0.08, 0.0, abs(d - 0.36)) * 0.25;
        float i = core * (0.7 + vG * 1.8) + halo * (0.25 + vG * 1.6) + ring * (0.4 + vG);
        gl_FragColor = vec4(vC * i, i);
      }`,
  });
}

export function lineMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec3 aColor; attribute float aGlow;
      varying vec3 vC;
      void main(){ vC = aColor * (1.0 + aGlow * 2.5); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `varying vec3 vC; void main(){ gl_FragColor = vec4(vC, 1.0); }`,
  });
}

/** Dendritas: ramas cortas alrededor de cada soma, para que cada nodo parezca una neurona. */
export function buildDendrites(nodes) {
  const pos = [], col = [], owner = [];
  for (const n of nodes.values()) {
    const r = rng('d' + n.id);
    const branches = Math.round(4 + Math.min(6, n.size * 2.2));
    const len = 0.25 + n.size * 0.22;
    const c = n.color.clone().multiplyScalar(n.dormant ? 0.06 : 0.16);
    for (let b = 0; b < branches; b++) {
      let p = n.pos.clone();
      let dir = new THREE.Vector3(gauss(r), gauss(r), gauss(r)).normalize();
      let l = len * (0.6 + r() * 0.6);
      const depth = 3 + Math.floor(r() * 2);
      for (let s = 0; s < depth; s++) {
        dir.add(new THREE.Vector3(gauss(r), gauss(r), gauss(r)).multiplyScalar(0.45)).normalize();
        const q = p.clone().addScaledVector(dir, l);
        pos.push(p.x, p.y, p.z, q.x, q.y, q.z);
        const fade = 1 - s / depth;
        col.push(c.r * fade, c.g * fade, c.b * fade, c.r * fade * 0.7, c.g * fade * 0.7, c.b * fade * 0.7);
        owner.push(n.idx, n.idx);
        if (r() < 0.4 && s < depth - 1) {
          const d2 = dir.clone().add(new THREE.Vector3(gauss(r), gauss(r), gauss(r)).multiplyScalar(0.8)).normalize();
          const q2 = q.clone().addScaledVector(d2, l * 0.6);
          pos.push(q.x, q.y, q.z, q2.x, q2.y, q2.z);
          col.push(c.r * fade * 0.7, c.g * fade * 0.7, c.b * fade * 0.7, 0, 0, 0);
          owner.push(n.idx, n.idx);
        }
        p = q; l *= 0.72;
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aGlow', new THREE.Float32BufferAttribute(new Float32Array(owner.length), 1));
  g.userData.owner = Int32Array.from(owner);
  return g;
}

/** Axones: una curva por cada conexión real registrada (brillo ∝ nº de veces usada). */
export function buildAxons(nodes, edges, now) {
  const pos = [], col = [], keys = [];
  const maxN = Math.max(1, ...edges.map((e) => e.n));
  const curves = new Map();
  const extra = [];
  // conexiones estructurales: proyecto ↔ sus sesiones
  for (const n of nodes.values()) {
    if (n.type === 'session') extra.push({ a: 'project:' + n.project, b: n.id, n: Math.max(1, n.data.msgs), last: n.data.last });
    if (n.type === 'memory' && nodes.has('project:' + n.project)) extra.push({ a: 'project:' + n.project, b: n.id, n: 3, last: n.data.last });
  }
  for (const e of [...edges, ...extra]) {
    const A = nodes.get(e.a), B = nodes.get(e.b);
    if (!A || !B) continue;
    const key = e.a + '|' + e.b;
    const pts = curvePoints(A.pos, B.pos, key, 28);
    curves.set(key, pts);
    const w = Math.log(1 + e.n) / Math.log(1 + maxN);
    const recent = e.last && now - e.last < 3600e3 ? 0.25 : e.last && now - e.last < 86400e3 ? 0.1 : 0;
    const k = (0.035 + 0.2 * w + recent * 0.6) * (e.a === 'input' ? 0.35 : 1);
    for (let i = 0; i < pts.length - 1; i++) {
      const t0 = i / (pts.length - 1), t1 = (i + 1) / (pts.length - 1);
      pos.push(pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z);
      const c0 = A.color.clone().lerp(B.color, t0).multiplyScalar(k);
      const c1 = A.color.clone().lerp(B.color, t1).multiplyScalar(k);
      col.push(c0.r, c0.g, c0.b, c1.r, c1.g, c1.b);
      keys.push(key, key);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aGlow', new THREE.Float32BufferAttribute(new Float32Array(keys.length), 1));
  g.userData.keys = keys;
  return { geometry: g, curves };
}

// ---------- impulsos ----------
export const TRAIL = 10;
export class Pulses {
  constructor(max = 700) {
    this.max = max;
    this.list = [];
    const n = max * TRAIL;
    this.geometry = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    this.geometry.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(n).fill(0.6), 1));
    this.points = new THREE.Points(this.geometry, somaMaterial());
    this.points.frustumCulled = false;
  }

  spawn({ pts, color, size = 0.55, dur = 1.1, delay = 0, onArrive, reverse = false }) {
    if (this.list.length >= this.max) this.list.shift();
    this.list.push({ pts, color, size, dur, t: -delay, onArrive, reverse, done: false });
  }

  update(dt) {
    let w = 0;
    const alive = [];
    for (const p of this.list) {
      p.t += dt;
      if (p.t < 0) { alive.push(p); continue; }
      const u = p.t / p.dur;
      if (u >= 1 && !p.done) { p.done = true; p.onArrive?.(); }
      if (u > 1.35) continue;
      alive.push(p);
      for (let k = 0; k < TRAIL; k++) {
        if (w >= this.max * TRAIL) break;
        const uk = u - k * 0.028;
        if (uk < 0 || uk > 1) { this.size[w] = 0; w++; continue; }
        const e = 1 - Math.pow(1 - uk, 1.6); // acelera al salir, frena al llegar
        const f = (p.reverse ? 1 - e : e) * (p.pts.length - 1);
        const i0 = Math.floor(f), i1 = Math.min(p.pts.length - 1, i0 + 1), fr = f - i0;
        const a = p.pts[i0], b = p.pts[i1];
        this.pos[w * 3] = a.x + (b.x - a.x) * fr;
        this.pos[w * 3 + 1] = a.y + (b.y - a.y) * fr;
        this.pos[w * 3 + 2] = a.z + (b.z - a.z) * fr;
        const fall = 1 - k / TRAIL;
        this.col[w * 3] = p.color.r * fall; this.col[w * 3 + 1] = p.color.g * fall; this.col[w * 3 + 2] = p.color.b * fall;
        this.size[w] = p.size * (k === 0 ? 1 : 0.75 * fall);
        w++;
      }
    }
    for (let i = w; i < this.max * TRAIL; i++) this.size[i] = 0;
    this.list = alive;
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aColor.needsUpdate = true;
    this.geometry.attributes.aSize.needsUpdate = true;
    this.geometry.setDrawRange(0, Math.max(1, w));
  }
}

export { hash };
