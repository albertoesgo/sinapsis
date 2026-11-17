#!/usr/bin/env node
// Sinapsis · servidor local. Por defecto solo escucha en 127.0.0.1: tus datos nunca salen del ordenador.
// Con --lan también responde en tu red local (para verlo en el móvil), protegido con una clave secreta.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { Brain } from './ingest.js';
import { startDemo } from './demo.js';
import { weeklyReport } from './report.js';
import { loadConfig, notify } from './notify.js';

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
    const r = weeklyReport(brain.s, brain.snapshot().lastShape);
    const pp = r.delta.perPrompt;
    const trend = pp == null ? '' : ` (${pp > 0 ? '+' : ''}${Math.round(pp * 100)} % por petición)`;
    raise({ kind: 'weekly', ts: Date.now(), title: 'Tu semana con Claude Code', body: `${r.cur.prompts} peticiones · ≈${r.cur.perPrompt.toFixed(2)} US$ por petición${trend}. ${r.tips[0].title}: ${r.tips[0].text}` });
  }, 60000);
  setInterval(() => { try { brain.save(); } catch (e) { console.error('save', e.message); } }, 30000);
  const bye = () => { try { brain.save(); } catch { /* nada */ } process.exit(0); };
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2' };

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
  const p = decodeURIComponent(url.pathname);
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
    res.writeHead(200, { 'Content-Type': 'application/manifest+json' });
    res.end(JSON.stringify({
      name: 'Sinapsis', short_name: 'Sinapsis', description: 'El sistema nervioso de Claude Code',
      start_url: isLoopback(req) ? '/' : '/?k=' + TOKEN, display: 'standalone', orientation: 'any',
      background_color: '#030409', theme_color: '#030409',
      icons: [{ src: '/icon-512.png', sizes: '512x512', type: 'image/png' }, { src: '/icon-180.png', sizes: '180x180', type: 'image/png' }],
    }));
    return;
  }
  if (p === '/api/mobile') {
    if (!isLoopback(req)) { res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"remote":true}'); return; }
    const urls = lanUrls();
    QRCode.toString(urls[0], { type: 'svg', margin: 1, color: { dark: '#030409', light: '#ebe7df' } }).then((qr) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ lan: LAN, urls, qr }));
    });
    return;
  }
  if (p === '/api/report') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(weeklyReport(brain.s, brain.snapshot().lastShape)));
    return;
  }
  if (p === '/api/alerts') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(alerts));
    return;
  }
  if (p === '/api/snapshot') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ...brain.snapshot(), demo: DEMO }));
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
