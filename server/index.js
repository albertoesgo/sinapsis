#!/usr/bin/env node
// Sinapsis · servidor local. Por defecto solo escucha en 127.0.0.1: tus datos nunca salen del ordenador.
// Con --lan también responde en tu red local (para verlo en el móvil), protegido con una clave secreta.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import QRCode from 'qrcode';
import { Brain } from './ingest.js';
import { startDemo } from './demo.js';
import { weeklyReport } from './report.js';
import { loadConfig, notify } from './notify.js';
import { planStatus } from './plan.js';
import { manifest, folderVersion } from './manifest.js';
import { buildVault } from './vault.js';
import { findProject, where } from './where.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf('--' + name);
  if (i === -1) return def;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : true;
};
const DEMO = !!flag('demo', false);
const PORT = Number(flag('port', process.env.SINAPSIS_PORT || 7420));
const LAN = !!flag('lan', process.env.SINAPSIS_LAN === '1');
const HOST = flag('host', LAN ? '0.0.0.0' : '127.0.0.1');
const CLAUDE_DIR = flag('claude-dir', process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'));
const CACHE = path.join(os.homedir(), '.sinapsis', 'state.json');

// ---------- acceso desde otros dispositivos ----------
const TOKEN_FILE = path.join(os.homedir(), '.sinapsis', 'token');
function loadToken() {
  try { const t = fs.readFileSync(TOKEN_FILE, 'utf8').trim(); if (t.length >= 20) return t; } catch { /* se crea */ }
  const t = crypto.randomBytes(18).toString('base64url');
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
  fs.writeFileSync(TOKEN_FILE, t, { mode: 0o600 });
  return t;
}
const TOKEN = loadToken();
const isLoopback = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
function cookieToken(req) {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)sinapsis_k=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}
function lanUrls() {
  const ips = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) ips.push(a.address);
  }
  ips.sort((a, b) => (/^192\.168\./.test(b) - /^192\.168\./.test(a)));
  const host = os.hostname().replace(/\.local$/, '') + '.local';
  return [...ips.map((ip) => `http://${ip}:${PORT}/?k=${TOKEN}`), `http://${host}:${PORT}/?k=${TOKEN}`];
}
const DENIED = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sinapsis</title>
<body style="background:#030409;color:#ebe7df;font:15px/1.5 -apple-system,sans-serif;display:grid;place-items:center;height:100vh;margin:0;text-align:center;padding:24px">
<div><h1 style="font:400 30px Georgia,serif">Sinapsis</h1><p style="color:#8a8f9d">Para entrar desde este dispositivo, abre Sinapsis en tu ordenador,<br>pulsa <b>Móvil</b> y escanea el código QR.</p></div>`;

// Protección frente a DNS rebinding: una web maliciosa podría resolver su dominio a 127.0.0.1 y leer
// la API desde tu navegador. Solo se aceptan nombres de host conocidos.
function hostAllowed(req) {
  const host = String(req.headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
  if (['localhost', '127.0.0.1', '::1', os.hostname().toLowerCase(), os.hostname().replace(/\.local$/i, '').toLowerCase() + '.local'].includes(host)) return true;
  if (!LAN) return false;
  return Object.values(os.networkInterfaces()).flat().some((a) => a && a.address.toLowerCase() === host);
}

/** JSON comprimido con gzip si el navegador lo acepta (la instantánea pasa de ~600 KB a ~60 KB). */
function sendJson(req, res, data) {
  const body = Buffer.from(typeof data === 'string' ? data : JSON.stringify(data));
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Accept-Encoding' };
  if (body.length > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip' });
    res.end(zlib.gzipSync(body, { level: 6 }));
  } else {
    res.writeHead(200, headers);
    res.end(body);
  }
}

const clients = new Set();
const send = (res, type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
const broadcast = (type, data) => { for (const c of clients) send(c, type, data); };

let topoTimer = null;
let config = loadConfig();
const alerts = [];
function raise(alert) {
  alerts.unshift(alert);
  if (alerts.length > 30) alerts.length = 30;
  broadcast('alert', alert);
  if (!DEMO) notify(config, alert.title, alert.body);
}
const brain = new Brain({
  claudeDir: CLAUDE_DIR,
  cacheFile: DEMO ? null : CACHE,
  onEvent: (ev) => broadcast('pulse', ev),
  onTopology: () => {
    clearTimeout(topoTimer);
    topoTimer = setTimeout(() => broadcast('topology', { at: Date.now() }), 800);
  },
  onAlert: raise,
});

const VAULT_DIR = path.join(os.homedir(), '.sinapsis', 'vault');
let vaultInfo = null;
let lastVaultMark = '';
let rebuildVault = () => {};
/** Cambia cuando hay peticiones o ficheros nuevos (para no regenerar el vault sin motivo). */
const vaultMark = () => Object.values(brain.s.projects).map((p) => `${p.turns?.length || 0}:${p.last}`).join('|');

function boot() {
  const t = Date.now();
  if (DEMO) {
    startDemo(brain);
    console.log('· Modo demostración (datos sintéticos)');
    return;
  }
  const cached = brain.load();
  brain.scan();
  brain.refreshInventory();
  brain.refreshLiveSessions();
  brain.save();
  console.log(`· Historial ${cached ? 'actualizado desde caché' : 'leído desde cero'} en ${Date.now() - t} ms · ${Object.keys(brain.s.sessions).length} sesiones · ${Object.keys(brain.s.projects).length} proyectos`);
  brain.live = true;

  // Lectura incremental: cada 1,2 s mira qué ficheros han crecido y procesa solo lo nuevo.
  setInterval(() => { try { brain.scan(); } catch (e) { console.error('scan', e.message); } }, 1200);
  setInterval(() => { if (brain.refreshLiveSessions()) broadcast('topology', { at: Date.now() }); }, 4000);
  setInterval(() => brain.refreshInventory(), 60000);
  // Informe semanal (por defecto, lunes a las 9:00) y recarga de la configuración
  setInterval(() => {
    config = loadConfig();
    const now = new Date();
    if (!config.weeklyReport || now.getDay() !== config.weeklyDay || now.getHours() < config.weeklyHour) return;
    const week = now.toLocaleDateString('sv-SE');
    if (brain.s.lastReport === week) return;
    brain.s.lastReport = week; brain.dirty = true;
    const r = weeklyReport(brain.s, brain.snapshot({ recent: false }).lastShape);
    const pp = r.delta.perPrompt;
    const trend = pp == null ? '' : ` (${pp > 0 ? '+' : ''}${Math.round(pp * 100)} % por petición)`;
    raise({ kind: 'weekly', ts: Date.now(), title: 'Tu semana con Claude Code', body: `${r.cur.prompts} peticiones · ≈${r.cur.perPrompt.toFixed(2)} US$ por petición${trend}. ${r.tips[0].title}: ${r.tips[0].text}` });
  }, 60000);
  setInterval(() => { try { brain.save(); } catch (e) { console.error('save', e.message); } }, 30000);
  // Vault de Obsidian con el mapa de cada proyecto (~/.sinapsis/vault): al arrancar y cada 10 min si hay novedades
  const vault = () => {
    if (!config.vault) return;
    try {
      const r = buildVault(brain.s, brain.inventory, config.vaultDir || VAULT_DIR);
      vaultInfo = { ...r, at: Date.now() };
      lastVaultMark = vaultMark();
    } catch (e) { console.error('vault', e.message); }
  };
  vault();
  setInterval(() => { if (vaultMark() !== lastVaultMark) vault(); }, 10 * 60e3);
  rebuildVault = vault;
  // Avisos del plan: al pasar del 75 % y del 90 % del presupuesto estimado de la ventana de 5 h o de la semana
  setInterval(() => {
    const pl = planStatus(brain.s);
    const hhmm = (t) => new Date(t).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    const check = (w, key, name) => {
      if (!w.pct || !w.start) return;
      const lvl = w.pct >= 0.9 ? 90 : w.pct >= 0.75 ? 75 : 0;
      const id = `${key}:${w.start}`;
      brain.s.planAlerted ||= {};
      if (!lvl || (brain.s.planAlerted[id] || 0) >= lvl) return;
      brain.s.planAlerted[id] = lvl; brain.dirty = true;
      const when = w.end ? ` Se reinicia ${key === 'week' ? new Date(w.end).toLocaleDateString('es-ES', { weekday: 'long' }) + ' a las ' : 'a las '}${hhmm(w.end)}.` : '';
      raise({ kind: 'plan', ts: Date.now(), level: lvl, title: `Llevas ≈${Math.round(w.pct * 100)} % de ${name}`, body: `Estimación según tus cortes anteriores.${when}${w.eta ? ` Al ritmo actual llegarías al límite hacia las ${hhmm(w.eta)}.` : ''}` });
    };
    check(pl.h5, 'h5', 'tu ventana de 5 horas');
    check(pl.week, 'week', 'tu límite semanal');
  }, 30000);
  const bye = () => { try { brain.save(); } catch { /* nada */ } process.exit(0); };
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
}

// Versión de la interfaz para el service worker: cambia si cambia cualquier fichero de public/
const UI_VERSION = folderVersion(path.join(ROOT, 'public'));

const MIME = { '.webmanifest': 'application/manifest+json; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2' };

function serveFile(res, base, rel) {
  const file = path.resolve(base, '.' + path.posix.normalize('/' + rel));
  if (!file.startsWith(base + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404).end('No encontrado'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let p;
  try { p = decodeURIComponent(url.pathname); } catch { res.writeHead(400).end(); return; }
  if (!hostAllowed(req)) { res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Host no permitido'); return; }
  if (!isLoopback(req)) {
    const k = url.searchParams.get('k');
    if (k && same(k, TOKEN)) {
      res.setHeader('Set-Cookie', `sinapsis_k=${encodeURIComponent(TOKEN)}; Max-Age=31536000; Path=/; HttpOnly; SameSite=Lax`);
    } else if (!same(cookieToken(req), TOKEN)) {
      res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' }).end(DENIED);
      return;
    }
  }
  if (p === '/manifest.webmanifest') {
    res.writeHead(200, { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify(manifest({ startUrl: isLoopback(req) ? './' : './?k=' + TOKEN })));
    return;
  }
  if (p === '/sw.js') {
    // el service worker solo funciona en contexto seguro: aquí, en localhost (por la wifi es http y el navegador no lo activa)
    fs.readFile(path.join(ROOT, 'public', 'sw.js'), 'utf8', (err, txt) => {
      if (err) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(txt.replace('__VERSION__', UI_VERSION));
    });
    return;
  }
  if (p === '/api/mobile') {
    if (!isLoopback(req)) { sendJson(req, res, { remote: true }); return; }
    const urls = lanUrls();
    QRCode.toString(urls[0], { type: 'svg', margin: 1, color: { dark: '#030409', light: '#ebe7df' } }).then((qr) => {
      sendJson(req, res, { lan: LAN, urls, qr });
    });
    return;
  }
  if (p === '/api/report') {
    sendJson(req, res, weeklyReport(brain.s, brain.snapshot({ recent: false }).lastShape));
    return;
  }
  if (p === '/api/where') {
    // «dónde mirar»: ficheros con los que empezar una tarea en un proyecto, aprendidos del historial
    const proj = findProject(brain.s, url.searchParams.get('p') || '');
    if (!proj) { sendJson(req, res, { error: 'proyecto desconocido' }); return; }
    sendJson(req, res, { project: proj.name, ...where(proj, url.searchParams.get('q') || '', { limit: 8 }) });
    return;
  }
  if (p === '/api/vault') {
    if (url.searchParams.get('rebuild') === '1' && isLoopback(req)) rebuildVault();
    sendJson(req, res, vaultInfo ? { ...vaultInfo, dir: isLoopback(req) ? vaultInfo.dir : undefined } : { disabled: DEMO || !config.vault });
    return;
  }
  if (p === '/api/alerts') {
    sendJson(req, res, alerts);
    return;
  }
  if (p === '/api/snapshot') {
    // ?lite=1: sin los eventos de 24 h (el navegador ya los tiene y recibe los nuevos en directo)
    sendJson(req, res, { ...brain.snapshot({ recent: url.searchParams.get('lite') !== '1' }), demo: DEMO });
    return;
  }
  if (p === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('retry: 2000\n\n');
    clients.add(res);
    const hb = setInterval(() => res.write(': latido\n\n'), 15000);
    req.on('close', () => { clearInterval(hb); clients.delete(res); });
    return;
  }
  if (p.startsWith('/vendor/three/')) return serveFile(res, path.join(ROOT, 'node_modules', 'three'), p.slice('/vendor/three/'.length));
  return serveFile(res, path.join(ROOT, 'public'), p === '/' ? 'index.html' : p.slice(1));
});

boot();
server.listen(PORT, HOST, () => {
  console.log(`· Sinapsis en http://localhost:${PORT}`);
  if (LAN) console.log(`· También en tu red (${lanUrls()[0].replace(/\?k=.*/, '')}). Para el móvil, abre Sinapsis en el ordenador y pulsa «Móvil».`);
});
