#!/usr/bin/env node
// Conecta Sinapsis con Claude Code (~/.claude/settings.json), sin tocar lo demás:
//   · hooks SessionStart y UserPromptSubmit → scripts/hook.mjs (contexto del atlas para Claude)
//   · statusLine → scripts/statusline.mjs (tus % reales del plan), solo si no tienes ya una propia
//   node scripts/install-hooks.mjs            instala (idempotente; guarda una copia settings.json.bak-sinapsis)
//   node scripts/install-hooks.mjs --remove   lo quita
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'settings.json');
const HOOK = `node "${path.join(ROOT, 'scripts', 'hook.mjs')}"`;
const LINE = `node "${path.join(ROOT, 'scripts', 'statusline.mjs')}"`;
const ours = (h) => JSON.stringify(h).includes('sinapsis') && JSON.stringify(h).includes('hook.mjs');
const remove = process.argv.includes('--remove');

let s = {};
try { s = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') { console.error(`No se puede leer ${FILE}: ${e.message}`); process.exit(1); } }
fs.mkdirSync(path.dirname(FILE), { recursive: true });
if (fs.existsSync(FILE)) fs.copyFileSync(FILE, FILE + '.bak-sinapsis');

s.hooks ||= {};
for (const ev of ['SessionStart', 'UserPromptSubmit']) {
  s.hooks[ev] = (s.hooks[ev] || []).filter((g) => !ours(g));
  if (!remove) s.hooks[ev].push(ev === 'SessionStart'
    ? { matcher: 'startup|resume|clear|compact', hooks: [{ type: 'command', command: HOOK, timeout: 5 }] }
    : { hooks: [{ type: 'command', command: HOOK, timeout: 5 }] });
  if (!s.hooks[ev].length) delete s.hooks[ev];
}
if (!Object.keys(s.hooks).length) delete s.hooks;
const lineIsOurs = s.statusLine?.command?.includes('statusline.mjs');
if (remove && lineIsOurs) delete s.statusLine;
let lineNote = '';
if (!remove) {
  if (!s.statusLine || lineIsOurs) s.statusLine = { type: 'command', command: LINE };
  else lineNote = ' Ya tenías una línea de estado propia: no se ha cambiado (los % reales no llegarán por ahí).';
}
fs.writeFileSync(FILE, JSON.stringify(s, null, 2) + '\n');
console.log(remove ? `Sinapsis desconectado de Claude Code (${FILE}).` : `Sinapsis conectado a Claude Code (${FILE}).${lineNote}\nSe aplica en las sesiones nuevas. Para quitarlo: npm run hooks:remove`);
