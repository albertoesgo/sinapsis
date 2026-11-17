// Gestos táctiles de las hojas del móvil.
import { isMobile } from '../ui.js';

/**
 * Hojas del móvil. Arrastrar hacia abajo cierra (o, si estaba ampliada, vuelve a media altura);
 * arrastrar hacia arriba desde el asa la amplía a pantalla completa; tocar el asa alterna.
 */
export function swipeToClose(el, onClose, scroller = el) {
  if (!el) return;
  const HANDLE = 30;
  let y0 = null, dy = 0, active = false, fromHandle = false;
  el.addEventListener('touchstart', (e) => {
    if (!isMobile() || e.touches.length !== 1) return;
    const top = e.touches[0].clientY - el.getBoundingClientRect().top;
    fromHandle = top < HANDLE;
    const nearTop = top < 56;
    if (!nearTop && scroller.scrollTop > 0) return;
    if (!nearTop && e.target.closest('input, canvas, #feed, #feed-filter, #glance, .tabs')) return;
    y0 = e.touches[0].clientY; dy = 0; active = false;
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    dy = e.touches[0].clientY - y0;
    if (!active && (dy > 8 || (fromHandle && dy < -8))) active = true;
    if (!active) { if (dy < -4) y0 = null; return; }
    e.preventDefault();
    el.style.transition = 'none';
    el.style.transform = `translateY(${Math.max(dy > 0 ? 0 : -40, dy > 0 ? dy : dy * 0.25)}px)`;
  }, { passive: false });
  el.addEventListener('touchend', () => {
    if (y0 == null) return;
    y0 = null;
    if (!active) {
      if (fromHandle && Math.abs(dy) < 6 && el.classList.contains('sheetable')) el.classList.toggle('expanded');
      return;
    }
    el.style.transition = 'transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)';
    const expanded = el.classList.contains('expanded');
    if (dy < -50 && el.classList.contains('sheetable')) {
      el.classList.add('expanded');
      el.style.transform = '';
    } else if (dy > 90 && expanded && dy < 260) {
      el.classList.remove('expanded');
      el.style.transform = '';
    } else if (dy > 90) {
      el.style.transform = 'translateY(100%)';
      setTimeout(() => { el.classList.remove('expanded'); onClose(); el.style.transform = ''; el.style.transition = ''; }, 200);
      return;
    } else {
      el.style.transform = '';
    }
    setTimeout(() => { el.style.transition = ''; }, 260);
  });
}
