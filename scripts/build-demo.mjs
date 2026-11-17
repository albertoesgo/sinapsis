#!/usr/bin/env node
// Construye la demo estática (GitHub Pages) en dist/: la interfaz, three.js y unos datos sintéticos
// grabados con el modo demostración. No lee nada de ~/.claude: no contiene ningún dato personal.
//
//   npm run build:demo            → dist/
//   SITE_URL=https://… npm run build:demo   (para la vista previa al compartir el enlace)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Brain } from '../server/ingest.js';
import { buildDemo } from '../server/demo.js';
import { weeklyReport } from '../server/report.js';
import { manifest, folderVersion } from '../server/manifest.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist');
const repo = process.env.GITHUB_REPOSITORY || '';
const [owner, name] = repo.split('/');
const SITE = process.env.SITE_URL || (owner ? `https://${owner}.github.io/${name}/` : '');
const REPO_URL = owner ? `https://github.com/${repo}` : '';

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'public'), OUT, { recursive: true });

// three.js: solo los módulos que usa la escena
const THREE = path.join(ROOT, 'node_modules', 'three');
for (const f of [
  'build/three.module.js',
  'examples/jsm/controls/OrbitControls.js',
  ...['EffectComposer', 'RenderPass', 'UnrealBloomPass', 'OutputPass', 'Pass', 'ShaderPass', 'MaskPass'].map((n) => `examples/jsm/postprocessing/${n}.js`),
  ...['CopyShader', 'LuminosityHighPassShader', 'OutputShader'].map((n) => `examples/jsm/shaders/${n}.js`),
]) {
  const dst = path.join(OUT, 'vendor', 'three', f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(THREE, f), dst);
}

// datos: 30 días de historia sintética y ~10 minutos de actividad grabada
const brain = new Brain({ cacheFile: null, claudeDir: path.join(os.tmpdir(), 'sinapsis-no-existe') });
const { all, turn, pick, R } = buildDemo(brain);
const snapshot = { ...brain.snapshot(), demo: true };
const report = weeklyReport(brain.s, snapshot.lastShape);
const events = [];
brain.onEvent = (ev) => events.push(ev);
brain.onTopology = () => {};
brain.onAlert = () => {};
brain.live = true;
let t = Date.now() + 1000;
const end = t + 10 * 60e3;
while (t < end) {
  const steps = turn(pick(all.slice(0, 4)), t, true).sort((a, b) => a[0] - b[0]);
  for (const [, fn] of steps) fn();
  t = steps[steps.length - 1][0] + R(6000, 16000);
}
fs.mkdirSync(path.join(OUT, 'demo'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'demo', 'snapshot.json'), JSON.stringify(snapshot));
fs.writeFileSync(path.join(OUT, 'demo', 'report.json'), JSON.stringify(report));
fs.writeFileSync(path.join(OUT, 'demo', 'events.json'), JSON.stringify(events));
// «dónde mirar» en el navegador: el mapa sintético de cada proyecto y el mismo código que usa el servidor
fs.writeFileSync(path.join(OUT, 'demo', 'maps.json'), JSON.stringify(Object.fromEntries(Object.values(brain.s.projects).map((p) => [p.key, { files: p.files, turns: p.turns, cmds: p.cmds }]))));
fs.copyFileSync(path.join(ROOT, 'server', 'where.js'), path.join(OUT, 'js', 'where.js'));

// página: modo estático, vista previa para redes y enlace al código
fs.copyFileSync(path.join(ROOT, 'docs', 'og.png'), path.join(OUT, 'og.png'));
const desc = 'Un cerebro 3D en tiempo real que muestra la actividad de Claude Code: proyectos, modelos, herramientas, skills, subagentes, consumo y límites del plan. Demo con datos sintéticos.';
let html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
html = html.replace('<html lang="es">', '<html lang="es" data-static>');
html = html.replace('</title>', `</title>
  <meta name="description" content="${desc}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="Sinapsis · el sistema nervioso de Claude Code" />
  <meta property="og:description" content="${desc}" />
  ${SITE ? `<meta property="og:url" content="${SITE}" />\n  <meta property="og:image" content="${SITE}og.png" />` : ''}
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />`);
if (REPO_URL) html = html.replace('<div id="toasts"></div>', `<div id="toasts"></div>\n  <a id="repo-link" href="${REPO_URL}" target="_blank" rel="noopener">Demo con datos sintéticos · <b>ver el código</b></a>`);
fs.writeFileSync(path.join(OUT, 'index.html'), html);
fs.writeFileSync(path.join(OUT, 'manifest.webmanifest'), JSON.stringify(manifest()));
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
// service worker con la huella de esta versión (al publicar otra, los usuarios reciben el aviso de actualizar)
const swFile = path.join(OUT, 'sw.js');
fs.writeFileSync(swFile, fs.readFileSync(swFile, 'utf8').replace('__VERSION__', folderVersion(OUT)));

const kb = (f) => Math.round(fs.statSync(path.join(OUT, f)).size / 1024);
console.log(`· Demo en dist/ · ${events.length} eventos grabados · snapshot ${kb('demo/snapshot.json')} KB · ${SITE || 'sin SITE_URL'}`);
