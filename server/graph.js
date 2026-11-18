// Grafo de código de Graphify (https://github.com/Graphify-Labs/graphify), si el proyecto lo tiene.
// Sinapsis sabe por tu historial QUÉ ficheros tocar; el grafo sabe QUÉ funciones hay dentro y en qué
// línea. Juntos, la pista dice «en shopify.ts, sortedSizes() en la línea 294», y Claude lee ese trozo
// en vez del fichero entero. Sinapsis también lo mantiene al día (solo código, en local, sin IA).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { tokenize, stem } from './where.js';

// el servicio de launchd no hereda tu PATH: se busca el ejecutable donde suele instalarse
const BIN = process.env.GRAPHIFY_BIN || [path.join(os.homedir(), '.local', 'bin', 'graphify'), path.join(os.homedir(), '.sinapsis', 'graphify-venv', 'bin', 'graphify'), '/opt/homebrew/bin/graphify', '/usr/local/bin/graphify'].find((f) => fs.existsSync(f)) || 'graphify';
const cache = new Map(); // raíz → grafo resumido (se recarga si cambia graph.json)
export const graphFile = (root) => path.join(root, 'graphify-out', 'graph.json');

/** Grafo de un proyecto: por fichero, sus símbolos con línea y nº de conexiones. null si no tiene. */
export function loadGraph(root) {
  let st;
  try { st = fs.statSync(graphFile(root)); } catch { return null; }
  const c = cache.get(root);
  if (c && c.mtime === st.mtimeMs) return c;
  try {
    const g = JSON.parse(fs.readFileSync(graphFile(root), 'utf8'));
    const deg = new Map();
    for (const l of g.links || []) { deg.set(l.source, (deg.get(l.source) || 0) + 1); deg.set(l.target, (deg.get(l.target) || 0) + 1); }
    const byFile = new Map();
    for (const n of g.nodes || []) {
      const line = Number(String(n.source_location || '').replace(/^L/, ''));
      if (!n.source_file || !line || n.label === path.basename(n.source_file)) continue;
      const list = byFile.get(n.source_file) || byFile.set(n.source_file, []).get(n.source_file);
      list.push({ label: n.label, line, deg: deg.get(n.id) || 0, w: symbolWords(n.label) });
    }
    const v = { root, mtime: st.mtimeMs, nodes: (g.nodes || []).length, byFile };
    cache.set(root, v);
    return v;
  } catch { return null; }
}

// Pides en español y el código está en inglés: un diccionario corto de palabras de desarrollo.
const ES_EN = {
  talla: 'size', tallas: 'size', precio: 'price', producto: 'product', carrito: 'cart', boton: 'button', imagen: 'image',
  foto: 'photo', usuario: 'user', pago: 'payment pay checkout', pagar: 'pay payment checkout', tienda: 'store shop', marca: 'brand',
  pedido: 'order', buscar: 'search', busqueda: 'search', buscador: 'search', filtro: 'filter', idioma: 'lang locale i18n',
  aviso: 'alert notification', alerta: 'alert', notificacion: 'notification', mapa: 'map', categoria: 'category', rebaja: 'sale discount',
  rebajas: 'sale discount', descuento: 'discount', oferta: 'offer deal', portada: 'home hero', inicio: 'home', cabecera: 'header',
  pie: 'footer', menu: 'menu nav', enlace: 'link', correo: 'email mail', registro: 'signup register', sesion: 'session login',
  contrasena: 'password', fecha: 'date', hora: 'time', fondo: 'background', texto: 'text', titulo: 'title', lista: 'list',
  tarjeta: 'card', galeria: 'gallery', video: 'video', cerrada: 'closed', cerrado: 'closed', variante: 'variant', genero: 'gender',
  tema: 'theme', oscuro: 'dark', cargar: 'load', guardar: 'save', enviar: 'send submit', seguir: 'follow', favorito: 'favorite',
  compartir: 'share', movil: 'mobile', ordenar: 'sort order', orden: 'sort order', pagina: 'page', ficha: 'detail', detalle: 'detail',
  stock: 'stock available', agotado: 'soldout stock', disponible: 'available', calendario: 'calendar', semana: 'week',
  coste: 'cost', consumo: 'usage cost', grafico: 'chart', tabla: 'table', formulario: 'form', modal: 'modal dialog', ventana: 'modal window',
  icono: 'icon', subir: 'upload', descargar: 'download', traduccion: 'translation i18n', unica: 'one single', ajustes: 'settings config',
};
const symbolWords = (label) => tokenize(String(label).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[()_.-]+/g, ' '), 10).map(stem);
function queryWords(query) {
  const out = new Set();
  for (const w of tokenize(query, 30)) {
    out.add(stem(w));
    for (const en of (ES_EN[w] || ES_EN[w.replace(/s$/, '')] || '').split(' ')) if (en) { out.add(stem(en)); out.add(stem(en + 's')); }
  }
  return out;
}

/** Símbolos de un fichero que tienen que ver con la tarea (por nombre), los más conectados primero. */
export function symbolsFor(graph, rel, query, max = 3) {
  const list = graph?.byFile.get(rel);
  if (!list) return [];
  const qs = queryWords(query);
  const match = (w) => qs.has(w) || [...qs].some((q) => q.length >= 4 && w.length >= 4 && (w.startsWith(q) || q.startsWith(w)));
  return list.map((s) => ({ ...s, hit: s.w.filter(match).length }))
    .filter((s) => s.hit)
    .sort((a, b) => b.hit - a.hit || b.deg - a.deg)
    .slice(0, max)
    .map(({ label, line }) => ({ label, line }));
}

/** Rehace el grafo con lo que haya cambiado: solo código, en local y sin ningún modelo de IA. */
export function updateGraph(root, done = () => {}) {
  execFile(BIN, ['update', root], { cwd: root, timeout: 180e3, env: { ...process.env, GRAPHIFY_BACKEND: 'none', GRAPHIFY_QUERY_LOG_DISABLE: '1' } }, (err) => {
    cache.delete(root);
    done(err);
  });
}
