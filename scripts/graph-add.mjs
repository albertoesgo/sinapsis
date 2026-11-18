#!/usr/bin/env node
// Añade el grafo de código de Graphify a un proyecto y empieza a medir si ahorra:
//   npm run graph:add -- ~/Proyectos/mi-proyecto
// 1. Construye graphify-out/graph.json solo con el código (análisis local, sin ningún modelo de IA).
// 2. Lo deja fuera de git (.git/info/exclude, sin tocar tu .gitignore).
// 3. Apunta el experimento en ~/.sinapsis/experiments.json: Sinapsis compara las tareas de ese proyecto
//    antes y después (pasos de búsqueda antes de editar y coste por tarea) en la tarjeta «Memoria común».
// Sinapsis mantiene el grafo al día y lo usa en las pistas (qué función y en qué línea).
// Requiere el ejecutable de Graphify: pipx install graphifyy (o uv tool install graphifyy).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = path.resolve(process.argv[2] || process.cwd());
const BIN = [path.join(os.homedir(), '.local', 'bin', 'graphify'), path.join(os.homedir(), '.sinapsis', 'graphify-venv', 'bin', 'graphify')].find((f) => fs.existsSync(f)) || 'graphify';
const env = { ...process.env, GRAPHIFY_BACKEND: 'none', GRAPHIFY_QUERY_LOG_DISABLE: '1' };
try {
  execFileSync(BIN, ['extract', '.', '--code-only'], { cwd: dir, env, stdio: 'inherit' });
  execFileSync(BIN, ['cluster-only', '.', '--no-label'], { cwd: dir, env, stdio: 'inherit' });
} catch (e) {
  console.error(`\nNo se pudo construir el grafo (${e.message}). ¿Está instalado Graphify? pipx install graphifyy`);
  process.exit(1);
}
const exclude = path.join(dir, '.git', 'info', 'exclude');
if (fs.existsSync(path.dirname(exclude)) && !(fs.existsSync(exclude) && fs.readFileSync(exclude, 'utf8').includes('graphify-out'))) fs.appendFileSync(exclude, '\ngraphify-out/\n');
const EXP = path.join(os.homedir(), '.sinapsis', 'experiments.json');
let list = [];
try { list = JSON.parse(fs.readFileSync(EXP, 'utf8')); } catch { /* primero */ }
if (!list.some((e) => e.root === dir && e.label === 'Graphify')) {
  list.push({ id: 'graphify-' + path.basename(dir).toLowerCase(), label: 'Graphify', root: dir, since: Date.now(), note: 'Grafo de código solo con AST (sin IA), consultado por las pistas de Sinapsis' });
  fs.mkdirSync(path.dirname(EXP), { recursive: true });
  fs.writeFileSync(EXP, JSON.stringify(list, null, 2));
}
console.log(`\nListo: grafo en ${path.join(dir, 'graphify-out')} (ábrelo en el navegador: graph.html).\nSinapsis lo usará en las pistas y medirá el antes y el después en «Memoria común».`);
