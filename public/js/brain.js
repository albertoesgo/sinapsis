// Anatomía procedural del cerebro: corteza con circunvoluciones, cerebelo, tronco encefálico.
// Ejes: x = izquierda/derecha, y = arriba, z = frente (+) / nuca (−).
import * as THREE from 'three';

// ---------- utilidades deterministas ----------
export function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function rng(seed) {
  let a = typeof seed === 'string' ? hash(seed) : seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function gauss(r) {
  const u = Math.max(1e-9, r()), v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---------- ruido de Perlin 3D ----------
const perm = new Uint8Array(512);
{
  const r = rng(1337);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
}
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + t * (b - a);
function grad(h, x, y, z) {
  const hh = h & 15;
  const u = hh < 8 ? x : y;
  const v = hh < 4 ? y : hh === 12 || hh === 14 ? x : z;
  return ((hh & 1) ? -u : u) + ((hh & 2) ? -v : v);
}
export function noise3(x, y, z) {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
  x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
  const u = fade(x), v = fade(y), w = fade(z);
  const A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z;
  const B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z;
  return lerp(
    lerp(lerp(grad(perm[AA], x, y, z), grad(perm[BA], x - 1, y, z), u), lerp(grad(perm[AB], x, y - 1, z), grad(perm[BB], x - 1, y - 1, z), u), v),
    lerp(lerp(grad(perm[AA + 1], x, y, z - 1), grad(perm[BA + 1], x - 1, y, z - 1), u), lerp(grad(perm[AB + 1], x, y - 1, z - 1), grad(perm[BB + 1], x - 1, y - 1, z - 1), u), v),
    w,
  );
}

// ---------- forma ----------
export const HEMI = { rx: 3.5, ry: 4.1, rz: 6.6, cx: 2.35, cy: 1.0 };

/** Punto de la superficie cortical (sin circunvoluciones) para un hemisferio h (−1 izq., 1 der.) y una dirección. */
export function cortexBase(h, dir, out = new THREE.Vector3()) {
  const d = dir.clone().normalize();
  const ry = d.y > 0 ? HEMI.ry : HEMI.ry * 0.7;
  const rx = HEMI.rx * (1 - 0.12 * Math.max(0, d.z)) * (1 - 0.06 * Math.max(0, -d.z));
  out.set(h * HEMI.cx + d.x * rx, HEMI.cy + d.y * ry, d.z * HEMI.rz);
  // lóbulo temporal: abultamiento lateral e inferior
  const lat = Math.max(0, d.x * h);
  const tz = Math.exp(-((d.z - 0.12) ** 2) / 0.1);
  if (d.y < 0.15) out.y -= 1.35 * lat * tz * Math.min(1, (0.15 - d.y) * 2.2);
  // polo frontal algo más bajo, occipital más redondo
  if (d.z > 0.6) out.y -= (d.z - 0.6) * 0.9;
  // cara medial plana (cisura interhemisférica)
  if (out.x * h < 0.2) out.x = h * (0.2 + Math.max(0, out.x * h - 0.2) * 0.1);
  return out;
}

export function hemiCenter(h) { return new THREE.Vector3(h * HEMI.cx, HEMI.cy - 0.4, 0); }

/** Punto dentro de la corteza, "depth" unidades bajo la superficie. */
export function cortexAt(h, dir, depth = 0.3) {
  const p = cortexBase(h, dir);
  const c = hemiCenter(h);
  const n = p.clone().sub(c).normalize();
  return p.addScaledVector(n, -depth);
}

export const CEREB = { rx: 2.25, ry: 1.45, rz: 1.85, cx: 1.7, cy: -2.45, cz: -4.4 };
export function cerebAt(h, dir, depth = 0.1) {
  const d = dir.clone().normalize();
  const p = new THREE.Vector3(h * CEREB.cx + d.x * CEREB.rx, CEREB.cy + d.y * CEREB.ry, CEREB.cz + d.z * CEREB.rz);
  if (p.x * h < 0.15) p.x = h * 0.15;
  const c = new THREE.Vector3(h * CEREB.cx, CEREB.cy, CEREB.cz);
  return p.addScaledVector(p.clone().sub(c).normalize(), -depth);
}

export const STEM = { top: new THREE.Vector3(0, -0.8, -1.5), bottom: new THREE.Vector3(0, -6.6, -2.5) };

// ---------- nube de partículas ----------
function randomDir(r) {
  const z = r() * 2 - 1, t = r() * Math.PI * 2, s = Math.sqrt(1 - z * z);
  return new THREE.Vector3(s * Math.cos(t), z, s * Math.sin(t));
}

export function buildBrainCloud() {
  const r = rng(42);
  const pos = [], col = [], size = [], seed = [];
  const push = (p, c, s) => { pos.push(p.x, p.y, p.z); col.push(c[0], c[1], c[2]); size.push(s); seed.push(r()); };
  const tmp = new THREE.Vector3();

  // Corteza: dos hemisferios con surcos (ruido "ridged") y surco central marcado
  for (const h of [-1, 1]) {
    const c = hemiCenter(h);
    let n = 0;
    while (n < 46000) {
      const d = randomDir(r);
      const p = cortexBase(h, d, tmp).clone();
      const nrm = p.clone().sub(c).normalize();
      const q = p.clone().multiplyScalar(0.62);
      const v = noise3(q.x + h * 7, q.y, q.z) + 0.45 * noise3(q.x * 2.1, q.y * 2.1 + 3, q.z * 2.1);
      const ridge = Math.min(1, Math.abs(v) / 0.22);
      let groove = 1 - ridge;
      // surco central (separa lóbulo frontal y parietal)
      const cs = Math.abs(d.z - 0.04 - 0.16 * d.y + 0.05 * Math.sin(d.y * 9));
      if (d.y > -0.1 && cs < 0.03) groove = Math.max(groove, 1 - cs / 0.03);
      // cisura lateral (de Silvio)
      const sy = Math.abs(d.y + 0.08 - 0.3 * (d.z - 0.1));
      if (d.x * h > 0.35 && d.z > -0.35 && d.z < 0.75 && sy < 0.04) groove = Math.max(groove, 1 - sy / 0.04);
      if (r() < Math.pow(groove, 1.2) * 0.9) continue; // los surcos quedan oscuros
      p.addScaledVector(nrm, -0.42 * groove + 0.012 * gauss(r));
      const b = 0.1 + 0.9 * Math.pow(1 - groove, 1.5);
      // tono por lóbulo: frontal, parietal, occipital, temporal
      const cz = d.z - 0.04 - 0.16 * d.y;
      let lc = cz > 0 ? [0.42, 0.6, 1.0] : [0.62, 0.5, 1.0];
      if (d.z < -0.55) lc = [0.38, 0.72, 0.9];
      if (d.y < -0.05 && d.x * h > 0.3 && d.z > -0.5) lc = [0.5, 0.68, 0.86];
      push(p, [lc[0] * b * 0.85, lc[1] * b * 0.85, lc[2] * b * 0.85], 0.65 + r() * 0.75);
      n++;
    }
  }
  // Cerebelo: láminas finas (folias)
  for (const h of [-1, 1]) {
    let n = 0;
    while (n < 8000) {
      const d = randomDir(r);
      if (d.z > 0.35 && d.y > 0.1) continue;
      const p = cerebAt(h, d, 0);
      const fol = Math.sin(d.y * 30 + noise3(d.x * 3, d.y * 3, d.z * 3) * 2.5);
      p.y += fol * 0.05;
      const b = 0.35 + 0.65 * (0.5 + 0.5 * fol);
      push(p, [0.55 * b, 0.45 * b, 0.85 * b], 0.75 + r() * 0.6);
      n++;
    }
  }
  // Tronco encefálico (con la protuberancia)
  for (let i = 0; i < 6000; i++) {
    const t = r();
    const axis = STEM.top.clone().lerp(STEM.bottom, t);
    const rad = 1.05 - 0.4 * t + 0.4 * Math.exp(-((t - 0.28) ** 2) / 0.01);
    const a = r() * Math.PI * 2;
    const p = axis.add(new THREE.Vector3(Math.cos(a) * rad, 0, Math.sin(a) * rad * 0.85));
    const b = 0.4 + 0.3 * r();
    push(p, [0.4 * b, 0.5 * b, 0.8 * b], 0.8 + r() * 0.5);
  }
  // Polvo interior (sustancia blanca)
  for (let i = 0; i < 9000; i++) {
    const h = r() < 0.5 ? -1 : 1;
    const d = randomDir(r);
    const p = cortexBase(h, d, tmp).clone();
    const c = hemiCenter(h);
    p.lerp(c, 0.15 + r() * 0.8);
    push(p, [0.25, 0.3, 0.5], 0.5 + r() * 0.6);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
  return g;
}

export const MAX_WAVES = 10;

export function brainMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
    uniforms: {
      uTime: { value: 0 },
      uPR: { value: Math.min(2, window.devicePixelRatio) },
      uWaves: { value: Array.from({ length: MAX_WAVES }, () => new THREE.Vector4(0, 0, 0, -99)) },
      uWaveCol: { value: Array.from({ length: MAX_WAVES }, () => new THREE.Vector3()) },
      uDim: { value: 1 },
    },
    vertexShader: /* glsl */ `
      #define MAX_WAVES ${MAX_WAVES}
      attribute float aSize; attribute float aSeed;
      uniform float uTime; uniform float uPR; uniform float uDim;
      uniform vec4 uWaves[MAX_WAVES]; uniform vec3 uWaveCol[MAX_WAVES];
      varying vec3 vCol; varying float vA;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float tw = 0.78 + 0.22 * sin(uTime * (0.6 + aSeed) + aSeed * 60.0);
        vec3 add = vec3(0.0);
        float grow = 0.0;
        for (int i = 0; i < MAX_WAVES; i++) {
          float age = uTime - uWaves[i].w;
          if (age > 0.0 && age < 1.8) {
            float rad = age * 3.6;
            float d = distance(position, uWaves[i].xyz);
            float ring = exp(-pow((d - rad) / 0.55, 2.0)) * pow(1.0 - age / 1.8, 2.0);
            float core = exp(-d * d / 1.2) * exp(-age * 3.0);
            add += uWaveCol[i] * (ring * 0.75 + core * 0.6);
            grow += ring + core;
          }
        }
        vCol = color * tw * 0.55 * uDim + add;
        vA = 0.55;
        gl_PointSize = aSize * (1.0 + min(grow, 1.5) * 0.6) * uPR * (26.0 / -mv.z);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vCol; varying float vA;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vCol * a, a * vA);
      }`,
  });
}
