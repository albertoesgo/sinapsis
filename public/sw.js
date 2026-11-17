// Service worker de Sinapsis (plantilla de la skill pwa-completa): la app abre sin conexión y se actualiza sin dejar a nadie en una versión vieja.
//
// · VERSION tiene que cambiar en cada despliegue (hash del build, fecha o número de versión).
//   Si no cambia, el navegador no instala la versión nueva.
// · La versión nueva espera a que el usuario acepte («Hay una versión nueva · Actualizar»): pwa.js le manda SKIP_WAITING.
// · Las páginas van «red primero» (siempre lo último si hay conexión); los recursos, desde caché refrescándose por detrás.
const VERSION = '__VERSION__';
const PREFIX = 'sinapsis-';
const CACHE = PREFIX + VERSION;
const PRECACHE = ['./', './offline.html'];   // lo mínimo para abrir sin red; lo demás se guarda al usarse
// Nunca a caché: datos en vivo o personales, autenticación y streams
const BYPASS = [/\/api\//, /\/events(\/|$)/]; // datos en vivo: siempre del servidor

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (BYPASS.some((re) => re.test(url.pathname))) return;
  if ((req.headers.get('accept') || '').includes('text/event-stream')) return;
  if (req.mode === 'navigate') event.respondWith(networkFirst(event));
  else event.respondWith(staleWhileRevalidate(event));
});

async function networkFirst(event) {
  const cache = await caches.open(CACHE);
  try {
    const res = (await event.preloadResponse) || (await fetch(event.request));
    if (res.ok) cache.put(event.request, res.clone());
    return res;
  } catch {
    return (await cache.match(event.request, { ignoreSearch: true }))
      || (await cache.match('./'))
      || (await cache.match('./offline.html'))
      || Response.error();
  }
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(event.request);
  const net = fetch(event.request)
    .then((res) => { if (res.ok && res.type === 'basic') cache.put(event.request, res.clone()); return res; })
    .catch(() => hit || Response.error());
  if (hit) { event.waitUntil(net); return hit; }
  return net;
}
