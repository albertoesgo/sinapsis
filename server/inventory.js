// Inventario de lo que está INSTALADO (se use o no): skills, agentes personalizados y memorias.
import fs from 'node:fs';
import path from 'node:path';

function readFront(file) {
  try {
    const txt = fs.readFileSync(file, 'utf8').slice(0, 4000);
    const m = txt.match(/^---\s*\n([\s\S]*?)\n---/);
    const out = {};
    if (m) {
      for (const line of m[1].split('\n')) {
        const kv = line.match(/^([\w-]+):\s*(.*)$/);
        if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim();
      }
    }
    return out;
  } catch {
    return {};
  }
}

function listDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

function findSkillDirs(root, depth = 0, out = []) {
  if (depth > 5) return out;
  for (const d of listDirs(root)) {
    if (path.basename(d) === 'node_modules') continue;
    if (fs.existsSync(path.join(d, 'SKILL.md'))) out.push(d);
    else findSkillDirs(d, depth + 1, out);
  }
  return out;
}

export function scanInventory(claudeDir, projectCwds = []) {
  const skills = {};
  const addSkill = (dir, source) => {
    const fm = readFront(path.join(dir, 'SKILL.md'));
    const name = fm.name || path.basename(dir);
    if (skills[name]) return;
    skills[name] = { name, source, description: (fm.description || '').slice(0, 220) };
  };
  for (const d of findSkillDirs(path.join(claudeDir, 'skills'))) addSkill(d, d.includes('/synced/') ? 'cuenta' : 'personal');
  // Solo plugins instalados: «marketplaces» es el catálogo, no lo que tienes activo.
  for (const sub of ['synced', 'cache', 'installed']) {
    for (const d of findSkillDirs(path.join(claudeDir, 'plugins', sub))) addSkill(d, 'plugin');
  }
  for (const cwd of projectCwds) {
    for (const d of findSkillDirs(path.join(cwd, '.claude', 'skills'))) addSkill(d, 'proyecto');
  }

  const agents = {};
  const scanAgents = (dir, source) => {
    try {
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.md')) continue;
        const fm = readFront(path.join(dir, f));
        const name = fm.name || f.replace(/\.md$/, '');
        agents[name] = { name, source, description: (fm.description || '').slice(0, 220), model: fm.model || null };
      }
    } catch { /* no existe */ }
  };
  scanAgents(path.join(claudeDir, 'agents'), 'personal');
  for (const cwd of projectCwds) scanAgents(path.join(cwd, '.claude', 'agents'), 'proyecto');

  const memory = {};
  for (const pdir of listDirs(path.join(claudeDir, 'projects'))) {
    const mdir = path.join(pdir, 'memory');
    try {
      const files = fs.readdirSync(mdir).filter((f) => f.endsWith('.md'));
      let bytes = 0;
      for (const f of files) bytes += fs.statSync(path.join(mdir, f)).size;
      memory[path.basename(pdir)] = { files: files.length, bytes };
    } catch { /* sin memoria */ }
  }
  return { skills, agents, memory };
}
