import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildBrainCloud, brainMaterial, MAX_WAVES, rng } from './brain.js';
import { layout, somaMaterial, lineMaterial, buildDendrites, buildAxons, curvePoints, Pulses, TYPE_COLOR } from './neurons.js';
import { Hud } from './hud.js';
import { isMobile, isLandscapePhone, STATIC } from './ui.js';
import * as Static from './static.js';
import { registerSW, installer, consumeOpenParam } from './pwa.js';

// ---------- escena ----------
const canvas = document.getElementById('scene');
// Dispositivos modestos: menos partículas y menos resolución
const LOW = matchMedia('(pointer: coarse)').matches || window.innerWidth < 760;
const MOBILE = LOW;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(MOBILE ? 1.5 : 2, window.devicePixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x030409, 1);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x030409, 0.012);
const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 400);
// Centro del cerebro (incluido el tronco) y distancia a la que cabe entero
const HOME = new THREE.Vector3(0, -0.7, -0.7);
const BRAIN = { w: 15.5, h: 15 }; // tamaño aparente del cerebro con margen (unidades de escena)
function homeDistance() {
  const W = window.innerWidth, H = window.innerHeight;
  const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  let free = W;
  if (!isMobile()) {
    const left = document.getElementById('left'), right = document.getElementById('right');
    if (left && right) free = Math.max(320, right.getBoundingClientRect().left - left.getBoundingClientRect().right);
  }
  const dW = (BRAIN.w * W) / (free * 2 * t * (W / H)); // que quepa a lo ancho en el hueco libre
  const dH = BRAIN.h / (2 * t * (isLandscapePhone() ? 0.78 : H > 760 ? 0.82 : 0.66)); // y a lo alto, dejando sitio a la cabecera y al EEG
  return Math.max(dW, dH);
}
camera.position.copy(HOME).add(new THREE.Vector3(-17.5, 6.5, 15.5).setLength(homeDistance()));

// En escritorio, centra el cerebro en el hueco libre entre los paneles, no en el centro de la ventana.
// En el móvil, cuando se abre una hoja inferior, sube el cerebro para que siga viéndose encima.
const view = { dx: 0, dy: 0, tx: 0, ty: 0 };
function updateViewOffset() {
  const W = window.innerWidth, H = window.innerHeight;
  const left = document.getElementById('left'), right = document.getElementById('right');
  if (isMobile()) {
    const open = document.body.classList.contains('sheet-open');
    // en horizontal las hojas salen por la derecha: el cerebro se aparta a la izquierda; en vertical, sube
    if (isLandscapePhone()) { view.tx = open ? W * 0.22 : 0; view.ty = 0; }
    else { view.tx = 0; view.ty = open ? H * 0.27 : 0; }
    return;
  }
  if (!left || !right) { view.tx = view.ty = 0; return; }
  const L = left.getBoundingClientRect().right;
  const R = right.getBoundingClientRect().left;
  view.tx = -((L + R) / 2 - W / 2);
  view.ty = 0;
}
function applyViewOffset(snap) {
  const k = snap ? 1 : 0.12;
  view.dx += (view.tx - view.dx) * k;
  view.dy += (view.ty - view.dy) * k;
  if (Math.abs(view.dx) < 0.5 && Math.abs(view.dy) < 0.5 && !view.tx && !view.ty) { camera.clearViewOffset(); return; }
  camera.setViewOffset(window.innerWidth, window.innerHeight, view.dx, view.dy, window.innerWidth, window.innerHeight);
}

/** Recoloca la cámara a la distancia justa, sin cambiar el ángulo de vista. */
function refit() {
  const dir = camera.position.clone().sub(HOME);
  if (dir.lengthSq() < 1e-6) dir.set(-17.5, 6.5, 15.5);
  camera.position.copy(HOME).add(dir.setLength(homeDistance()));
}

const controls = new OrbitControls(camera, canvas);
controls.target.copy(HOME);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.35;
controls.minDistance = 7;
controls.maxDistance = 60;

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.85, 0.55, 0.12);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// polvo de fondo
let dustMat = null;
{
  const r = rng(7);
  const n = 1800, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), sz = new Float32Array(n), gl = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const d = 40 + r() * 120, a = r() * Math.PI * 2, z = r() * 2 - 1;
    pos.set([Math.cos(a) * Math.sqrt(1 - z * z) * d, z * d * 0.6, Math.sin(a) * Math.sqrt(1 - z * z) * d], i * 3);
    const b = 0.15 + r() * 0.25; col.set([b * 0.8, b * 0.9, b * 1.2], i * 3); sz[i] = 0.4 + r() * 0.8;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
  g.setAttribute('aGlow', new THREE.BufferAttribute(gl, 1));
  dustMat = somaMaterial();
  scene.add(new THREE.Points(g, dustMat));
}

/** Las partículas se dimensionan con la resolución real del lienzo (también cuando se ajusta sola). */
function syncPixelRatio() {
  const pr = renderer.getPixelRatio();
  for (const m of [brainMat, somaMat, pulses.points.material, dustMat]) if (m?.uniforms?.uPR) m.uniforms.uPR.value = pr;
}
const brainMat = brainMaterial();
const brainCloud = new THREE.Points(buildBrainCloud(MOBILE ? 0.55 : 1), brainMat);
scene.add(brainCloud);

const somaMat = somaMaterial();
const lineMatD = lineMaterial();
const lineMatA = lineMaterial();
const pulses = new Pulses(800);
scene.add(pulses.points);
syncPixelRatio();

let state = { snap: null, nodes: new Map(), curves: new Map(), soma: null, dendrites: null, axons: null };
let waveSlot = 0;
const clock = new THREE.Clock();

// ---------- construcción ----------
function rebuild(snap) {
  const prev = state.nodes;
  const { nodes } = layout(snap);
  for (const n of nodes.values()) {
    const old = prev.get(n.id);
    if (old) n.act = old.act;
    else if (prev.size) n.act = 1.2; // neurona recién nacida
  }
  for (const k of ['soma', 'dendrites', 'axons']) {
    if (state[k]) { scene.remove(state[k]); state[k].geometry.dispose(); }
  }
  const N = nodes.size;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), size = new Float32Array(N), glow = new Float32Array(N);
  for (const n of nodes.values()) {
    pos.set([n.pos.x, n.pos.y, n.pos.z], n.idx * 3);
    const c = n.dormant ? n.color.clone().multiplyScalar(0.28) : n.color;
    col.set([c.r, c.g, c.b], n.idx * 3);
    size[n.idx] = n.size;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1));
  const soma = new THREE.Points(g, somaMat);
  soma.renderOrder = 3;
  const dendrites = new THREE.LineSegments(buildDendrites(nodes), lineMatD);
  const ax = buildAxons(nodes, snap.edges, snap.generatedAt);
  const axons = new THREE.LineSegments(ax.geometry, lineMatA);
  scene.add(axons, dendrites, soma);
  state = { snap, nodes, list: [...nodes.values()], glowByIdx: new Float32Array(nodes.size), curves: ax.curves, soma, dendrites, axons, axonGlow: new Map() };
  hud.setNodes(nodes);
}

function path(a, b) {
  const A = state.nodes.get(a), B = state.nodes.get(b);
  if (!A || !B) return null;
  const k = a + '|' + b;
  if (state.curves.has(k)) return { pts: state.curves.get(k), reverse: false, key: k };
  const kr = b + '|' + a;
  if (state.curves.has(kr)) return { pts: state.curves.get(kr), reverse: true, key: kr };
  const pts = curvePoints(A.pos, B.pos, k, 28);
  state.curves.set(k, pts);
  return { pts, reverse: false, key: k };
}

const rippleTimes = [];
function ripple(pos, color, strength = 1) {
  // si hay mucha actividad a la vez, cada onda pesa menos (evita que todo se sature)
  const t = clock.elapsedTime;
  while (rippleTimes.length && t - rippleTimes[0] > 1.2) rippleTimes.shift();
  rippleTimes.push(t);
  strength /= 1 + Math.max(0, rippleTimes.length - 2) * 0.45;
  const i = waveSlot++ % MAX_WAVES;
  brainMat.uniforms.uWaves.value[i].set(pos.x, pos.y, pos.z, clock.elapsedTime);
  brainMat.uniforms.uWaveCol.value[i].set(color.r * strength, color.g * strength, color.b * strength);
}

function excite(id, amount = 1, wave = true) {
  const n = state.nodes.get(id);
  if (!n) return;
  n.act = Math.min(2.2, n.act + amount);
  if (wave) ripple(n.pos, n.color, Math.min(1.2, 0.4 + amount * 0.5));
}

function fire(a, b, color, opts = {}) {
  const p = path(a, b);
  if (!p) return false;
  pulses.spawn({ pts: p.pts, reverse: p.reverse, color, size: opts.size ?? 0.6, dur: opts.dur ?? 1.0, delay: opts.delay ?? 0, onArrive: () => { excite(b, opts.amount ?? 1, opts.wave ?? true); opts.onArrive?.(); } });
  const g = state.axonGlow.get(p.key) || 0;
  state.axonGlow.set(p.key, Math.min(1.5, g + 0.9));
  return true;
}

// ---------- traducción de eventos reales a actividad ----------
const busyUntil = new Map(); // secuencia causal por emisor: pensar → actuar → resultado
const WHITE = new THREE.Color('#ffffff');
const RED = new THREE.Color('#ff4d5e');

function nodeOf(ev) { return ev.a ? 'agent:' + ev.at : 'session:' + ev.s; }

function onPulse(ev, { fromReplay = false } = {}) {
  if (!state.snap) return;
  const from = nodeOf(ev);
  const now = clock.elapsedTime;
  const start = Math.max(0, (busyUntil.get(from) || 0) - now);
  const projColor = state.nodes.get('project:' + ev.p)?.color || WHITE;
  hud.onPulse(ev, fromReplay);
  if (!fromReplay && recentBuf && state.snap.recent === recentBuf) recentBuf.push(ev);
  ensureNode(ev);

  if (ev.k === 'prompt') {
    fire('input', from, WHITE, { size: 0.9, dur: 1.5, amount: 1.4, onArrive: () => excite('project:' + ev.p, 0.8) });
    busyUntil.set(from, now + 1.5);
  } else if (ev.k === 'thought') {
    const model = 'model:' + ev.m;
    const th = ev.u?.[4] || 0, out = ev.u?.[3] || 0;
    fire(from, model, projColor, {
      size: 0.75, dur: 0.9, delay: start, amount: 1.2,
      onArrive: () => {
        // cada chispa ≈ 120 tokens de razonamiento real; vuelve al contexto del proyecto
        const sparks = Math.min(26, Math.round(th / 120));
        const targets = [...state.nodes.values()].filter((n) => n.project === ev.p && n.type === 'session');
        for (let i = 0; i < sparks; i++) {
          const t = targets[i % Math.max(1, targets.length)];
          if (t) fire(model, t.id, TYPE_COLOR.model, { size: 0.32, dur: 0.7 + Math.random() * 0.6, delay: i * 0.06, amount: 0.15, wave: false });
        }
        if (out > 0 && ev.stop === 'end_turn') fire(model, from, TYPE_COLOR.model, { size: 0.5 + Math.min(0.6, out / 4000), dur: 1.1, delay: 0.3, amount: 0.8 });
      },
    });
    busyUntil.set(from, now + start + 0.9);
  } else if (ev.k === 'tool') {
    const model = 'model:' + (ev.m || '');
    const color = colorFor(ev.tgt);
    const via = state.nodes.has(model) ? model : from;
    const d0 = start;
    fire(via, ev.tgt, color, { size: ev.tgt.startsWith('agent:') ? 0.9 : 0.65, dur: 1.0, delay: d0, amount: 1 });
    if (ev.mem) fire(via, 'memory:' + ev.mem, TYPE_COLOR.memory, { size: 0.7, dur: 1.2, delay: d0, amount: 1 });
    busyUntil.set(from, now + d0 + 0.5);
  } else if (ev.k === 'result') {
    fire(ev.tgt, from, ev.err ? RED : colorFor(ev.tgt).clone().multiplyScalar(0.7), { size: 0.42, dur: 1.0, delay: start * 0.5, amount: 0.4, wave: !!ev.err });
  }
}

function colorFor(id = '') {
  const t = id.split(':')[0];
  return TYPE_COLOR[t] || WHITE;
}

let refetchTimer = null;
function ensureNode(ev) {
  const need = [nodeOf(ev), ev.tgt, ev.m && 'model:' + ev.m].filter(Boolean);
  if (need.some((id) => !state.nodes.has(id))) scheduleRefetch(400);
}
function scheduleRefetch(ms = 1000) {
  clearTimeout(refetchTimer);
  refetchTimer = setTimeout(load, ms);
}

// ---------- datos ----------
let recentBuf = null; // eventos de 24 h: llegan una vez y luego se mantienen aquí con los nuevos
async function load() {
  let snap;
  if (STATIC) snap = await Static.snapshot();
  else snap = await fetch(recentBuf ? 'api/snapshot?lite=1' : 'api/snapshot').then((r) => r.json());
  if (snap.recent) recentBuf = snap.recent;
  else {
    const cut = Date.now() - 24 * 3600e3;
    if (recentBuf.length && recentBuf[0].ts < cut) recentBuf = recentBuf.filter((e) => e.ts >= cut);
    snap.recent = recentBuf;
  }
  rebuild(snap);
  hud.render(snap);
}
const api = (path) => (STATIC ? Static.api(path) : fetch(path).then((r) => (r.ok ? r.json() : null)));

const hud = new Hud({
  api: (path) => api(path),
  onFocus: (id, opts) => focusNode(id, opts),
  onReplay: (events) => replay(events),
  onToggleRotate: (v) => { rotateOn = v; if (!focused) controls.autoRotate = v; },
  onHome: () => goHome(),
  onLayout: () => updateViewOffset(),
  onBloom: (v) => { bloom.strength = v; },
});

let replayTimer = null;
function replay(events) {
  clearTimeout(replayTimer);
  if (!events) { hud.setReplay(null); return; }
  const evs = [...events].sort((a, b) => a.ts - b.ts);
  let i = 0;
  const step = () => {
    if (i >= evs.length) { hud.setReplay(null); return; }
    const ev = evs[i++];
    onPulse(ev, { fromReplay: true });
    hud.setReplay(ev.ts, i / evs.length);
    const next = evs[i];
    const gap = next ? Math.min(1800, Math.max(40, (next.ts - ev.ts) / 30)) / (hud.replaySpeed || 1) : 0;
    replayTimer = setTimeout(step, gap);
  };
  step();
}

// ---------- enfoque e interacción ----------
let focusAnim = null;
let focused = false;
let rotateOn = true;
/** Vuelve a encuadrar el cerebro entero, manteniendo el ángulo de vista actual. */
function goHome() {
  const dir = camera.position.clone().sub(controls.target).normalize();
  focusAnim = { t: 0, from: controls.target.clone(), to: HOME.clone(), camFrom: camera.position.clone(), camTo: HOME.clone().addScaledVector(dir, homeDistance()) };
  focused = false;
  controls.autoRotate = rotateOn;
}
function focusNode(id, opts = {}) {
  focused = true;
  controls.autoRotate = false;
  const n = state.nodes.get(id);
  if (!n) return;
  const from = controls.target.clone();
  const to = n.pos.clone();
  const camFrom = camera.position.clone();
  const dir = camFrom.clone().sub(from).normalize();
  const camTo = to.clone().addScaledVector(dir, MOBILE ? 18 : 13);
  focusAnim = { t: 0, from, to, camFrom, camTo };
  excite(id, 1.2);
  hud.showDetail(n, state.snap, opts);
  return true;
}

const mouse = new THREE.Vector2(-9, -9);
let hovered = null;
canvas.addEventListener('pointermove', (e) => { mouse.set(e.clientX, e.clientY); });
canvas.addEventListener('pointerleave', () => mouse.set(-9, -9));
let downAt = null;
canvas.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
let lastTap = { t: 0, x: 0, y: 0 };
canvas.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > (e.pointerType === 'touch' ? 12 : 5)) return;
  if (e.pointerType !== 'mouse') {
    mouse.set(e.clientX, e.clientY); pick(36); mouse.set(-9, -9); hud.hover(null);
    // doble toque en el vacío: volver a ver el cerebro entero
    const now = performance.now();
    const dbl = now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40;
    lastTap = { t: now, x: e.clientX, y: e.clientY };
    if (dbl && !hovered) { hud.goHome(); return; }
  }
  if (hovered) focusNode(hovered.id);
  else { hud.hideDetail(); if (focused) goHome(); }
});

const v = new THREE.Vector3();
function pick(radius = 22) {
  if (mouse.x < 0) { hovered = null; hud.hover(null); return; }
  let best = null, bd = radius;
  for (const n of state.nodes.values()) {
    v.copy(n.pos).project(camera);
    if (v.z > 1) continue;
    const x = (v.x * 0.5 + 0.5) * window.innerWidth, y = (-v.y * 0.5 + 0.5) * window.innerHeight;
    const d = Math.hypot(x - mouse.x, y - mouse.y) - n.size * 2;
    if (d < bd) { bd = d; best = n; }
  }
  hovered = best;
  canvas.style.cursor = best ? 'pointer' : 'grab';
  hud.hover(best, mouse);
}

// ---------- bucle ----------
const liveSet = () => new Set(state.snap?.liveSessions || []);
let live = new Set();
function frame() {
  const dt = Math.min(0.05, clock.getDelta());
  const t = clock.elapsedTime;
  brainMat.uniforms.uTime.value = t;
  somaMat.uniforms.uTime.value = t;

  if (focusAnim) {
    focusAnim.t = Math.min(1, focusAnim.t + dt / 1.4);
    const e = 1 - Math.pow(1 - focusAnim.t, 3);
    controls.target.lerpVectors(focusAnim.from, focusAnim.to, e);
    camera.position.lerpVectors(focusAnim.camFrom, focusAnim.camTo, e);
    if (focusAnim.t >= 1) focusAnim = null;
  }
  applyViewOffset();
  controls.update();
  pulses.update(dt);

  if (state.soma) {
    const glow = state.soma.geometry.attributes.aGlow;
    const now = Date.now();
    for (const n of state.list) {
      n.act *= Math.exp(-dt * 1.6);
      let base = 0;
      const last = n.data?.last || 0;
      if (last) base = 0.35 * Math.exp(-(now - last) / (20 * 60e3)); // reciente: sigue "caliente"
      if (n.type === 'session' && live.has(n.data.id)) base += 0.22 + 0.18 * Math.sin(t * 2.2 + n.idx);
      if (n.type === 'project' && n.data.live) base += 0.15 + 0.1 * Math.sin(t * 1.6 + n.idx);
      if (n.type === 'input') base += 0.15 + 0.1 * Math.sin(t * 1.2);
      n.glow = base + n.act;
      glow.array[n.idx] = n.glow;
      state.glowByIdx[n.idx] = n.glow;
    }
    glow.needsUpdate = true;
    const dg = state.dendrites.geometry.attributes.aGlow, owner = state.dendrites.geometry.userData.owner;
    const byIdx = state.glowByIdx;
    for (let i = 0; i < owner.length; i++) dg.array[i] = byIdx[owner[i]];
    dg.needsUpdate = true;
    if (state.axonGlow.size) {
      const ag = state.axons.geometry.attributes.aGlow, keys = state.axons.geometry.userData.keys;
      for (const [k, g] of state.axonGlow) { const ng = g * Math.exp(-dt * 1.2); if (ng < 0.01) state.axonGlow.delete(k); else state.axonGlow.set(k, ng); }
      for (let i = 0; i < keys.length; i++) ag.array[i] = state.axonGlow.get(keys[i]) || 0;
      ag.needsUpdate = true;
    }
  }
  if (!LOW) pick();
  hud.frame(camera, state.nodes, t);
  composer.render();
  adaptQuality(dt);
  requestAnimationFrame(frame);
}

const perf = { acc: 0, n: 0, checks: 0 };
function adaptQuality(dt) {
  if (perf.checks > 6 || document.hidden) return;
  perf.acc += dt; perf.n++;
  if (perf.acc < 2.5) return;
  const fps = perf.n / perf.acc;
  perf.acc = 0; perf.n = 0; perf.checks++;
  const pr = renderer.getPixelRatio();
  if (fps < 40 && pr > 1) {
    const next = Math.max(1, pr - 0.5);
    renderer.setPixelRatio(next);
    composer.setPixelRatio(next);
    syncPixelRatio();
  }
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  updateViewOffset();
  applyViewOffset(true);
  if (!focused && !focusAnim) { controls.target.copy(HOME); refit(); }
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- tiempo real ----------
function connect() {
  if (STATIC) { hud.setConnection(true); Static.play((ev) => onPulse(ev), (a) => hud.onAlert(a)); return; }
  const es = new EventSource('events');
  es.addEventListener('pulse', (e) => onPulse(JSON.parse(e.data)));
  es.addEventListener('topology', () => { if (!STATIC) scheduleRefetch(600); });
  es.addEventListener('alert', (e) => hud.onAlert(JSON.parse(e.data)));
  es.onopen = () => hud.setConnection(true);
  es.onerror = () => hud.setConnection(false);
}

canvas.addEventListener('dblclick', () => hud.goHome());
updateViewOffset();
applyViewOffset(true);
await load();
updateViewOffset();
applyViewOffset(true);
refit();
live = liveSet();
setInterval(() => { live = liveSet(); }, 2000);
if (!STATIC) setInterval(() => scheduleRefetch(0), 60000);
const origRender = hud.render.bind(hud);
hud.render = (snap) => { origRender(snap); live = new Set(snap.liveSessions); };
connect();
frame();

// PWA: versión nueva → aviso; instalar → botón o instrucciones; accesos directos → ?open=…
registerSW('sw.js', { onUpdate: (apply) => hud.offerUpdate(apply) }).catch(() => {});
hud.setInstaller(installer({ onChange: (s) => hud.onInstallState(s) }));
consumeOpenParam({
  report: () => hud.openReport(),
  search: () => hud.openPalette(),
  plan: () => hud.showCard('plan'),
  feed: () => hud.showCard('impulses'),
  inventory: () => hud.toggleInventory(true),
});
window.__sinapsis = { get state() { return state; }, focusNode, onPulse, camera, controls, view };
