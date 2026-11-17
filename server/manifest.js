// Manifest de la PWA, compartido por el servidor local y la demo estática.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function manifest({ startUrl = './' } = {}) {
  const shortcut = (name, short_name, open) => ({ name, short_name, url: `./?open=${open}`, icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }] });
  return {
    id: './',
    name: 'Sinapsis · el sistema nervioso de Claude Code',
    short_name: 'Sinapsis',
    description: 'Un cerebro 3D en tiempo real con la actividad de Claude Code: proyectos, modelos, herramientas, consumo y límites del plan.',
    lang: 'es',
    dir: 'ltr',
    start_url: startUrl,
    scope: './',
    display: 'standalone',
    display_override: ['standalone'],
    orientation: 'any',
    background_color: '#030409',
    theme_color: '#030409',
    categories: ['developer', 'productivity', 'utilities'],
    icons: [
      { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    screenshots: [
      { src: 'screens/wide.png', sizes: '1600x960', type: 'image/png', form_factor: 'wide', label: 'El cerebro con el plan, el consumo y lo que pasa ahora' },
      { src: 'screens/narrow.png', sizes: '687x1170', type: 'image/png', form_factor: 'narrow', label: 'Sinapsis en el móvil' },
    ],
    shortcuts: [
      shortcut('Informe de la semana', 'Informe', 'report'),
      shortcut('Tu plan', 'Plan', 'plan'),
      shortcut('Buscar', 'Buscar', 'search'),
      shortcut('Impulsos en directo', 'Impulsos', 'feed'),
    ],
  };
}

/** Huella de una carpeta (rutas, tamaños y fechas): cambia con cada versión y obliga a actualizar el service worker. */
export function folderVersion(dir) {
  const h = crypto.createHash('sha1');
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { const s = fs.statSync(p); h.update(`${path.relative(dir, p)}:${s.size}:${s.mtimeMs}`); }
    }
  };
  walk(dir);
  return h.digest('hex').slice(0, 12);
}
