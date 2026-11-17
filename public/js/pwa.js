// Funciones de PWA para el usuario final (copia de la plantilla de la skill pwa-completa).
// La navegación «atrás» por capas vive en hud/nav.js.

export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// ---------- service worker y actualizaciones ----------
/**
 * Registra el service worker y avisa cuando hay una versión nueva esperando.
 * `onUpdate(apply)`: muestra un aviso; `apply()` activa la versión nueva y recarga una sola vez.
 */
export async function registerSW(url = 'sw.js', { onUpdate } = {}) {
  if (!('serviceWorker' in navigator) || !isSecureContext) return null;
  const reg = await navigator.serviceWorker.register(url);
  const offer = (worker) => onUpdate?.(() => worker.postMessage({ type: 'SKIP_WAITING' }));
  if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const w = reg.installing;
    w?.addEventListener('statechange', () => {
      if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
    });
  });
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    location.reload();
  });
  // las apps instaladas casi nunca se recargan: buscar versión nueva al volver a ellas
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  return reg;
}

// ---------- instalar ----------
/** Estado de instalación: `canPrompt` (Android o escritorio), `iosHint` (Safari de iOS sin instalar), `installed`. */
export function installer({ onChange } = {}) {
  let deferred = null;
  const state = { canPrompt: false, iosHint: isIOS() && !isStandalone(), installed: isStandalone() };
  const emit = () => onChange?.({ ...state });
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; state.canPrompt = true; emit(); });
  addEventListener('appinstalled', () => { deferred = null; Object.assign(state, { canPrompt: false, iosHint: false, installed: true }); emit(); });
  queueMicrotask(emit);
  return {
    get state() { return { ...state }; },
    /** Muestra el diálogo del sistema. Devuelve 'accepted', 'dismissed' o null. */
    async prompt() {
      if (!deferred) return null;
      deferred.prompt();
      const { outcome } = await deferred.userChoice;
      deferred = null; state.canPrompt = false; emit();
      return outcome;
    },
  };
}

// ---------- red, almacenamiento, compartir, pantalla, insignia ----------
/** Llama a `cb(online)` ahora y en cada cambio de conexión. */
export function onNetwork(cb) {
  const f = () => cb(navigator.onLine);
  addEventListener('online', f); addEventListener('offline', f); f();
}

/** Pide que el navegador no borre los datos locales (IndexedDB, caché). Mejor tras una acción de valor. */
export async function persistStorage() {
  if (!navigator.storage?.persist) return false;
  return (await navigator.storage.persisted()) || navigator.storage.persist();
}

/** Comparte con el menú del sistema o, si no existe, copia el enlace. Devuelve 'shared', 'copied' o null. */
export async function share({ title, text, url = location.href }) {
  if (navigator.share) {
    try { await navigator.share({ title, text, url }); return 'shared'; } catch (e) { if (e.name === 'AbortError') return null; }
  }
  try { await navigator.clipboard.writeText(url); return 'copied'; } catch { return null; }
}

/** Mantiene la pantalla encendida mientras la vista está visible. Devuelve una función para soltarla. */
export async function keepAwake() {
  if (!('wakeLock' in navigator)) return () => {};
  let lock = null;
  const take = async () => { try { lock = await navigator.wakeLock.request('screen'); } catch { lock = null; } };
  const onVis = () => { if (document.visibilityState === 'visible') take(); };
  await take();
  document.addEventListener('visibilitychange', onVis);
  return () => { document.removeEventListener('visibilitychange', onVis); lock?.release(); };
}

/** Insignia en el icono instalado (pendientes, avisos). 0 la quita. */
export function setBadge(n) {
  if (!('setAppBadge' in navigator)) return;
  (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
}

/** Vibración corta solo si el usuario ya ha interactuado (si no, el navegador la bloquea). */
export function haptic(pattern = 12) {
  if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(pattern);
}

/** Abre la pantalla pedida por un acceso directo o un enlace (`?open=…`) y limpia la URL. */
export function consumeOpenParam(handlers) {
  const u = new URL(location.href);
  const what = u.searchParams.get('open');
  if (!what) return;
  u.searchParams.delete('open');
  history.replaceState(history.state, '', u.pathname + u.search + u.hash);
  handlers[what]?.();
}
