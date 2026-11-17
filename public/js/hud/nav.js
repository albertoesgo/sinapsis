// Navegación «atrás»: cada pantalla que se abre (diálogo, hoja del móvil, ficha, inventario) es una capa.
// El botón atrás del navegador, el gesto de Android, Esc y la × cierran solo la capa de arriba y dejan
// la interfaz como estaba justo antes. Con el historial se usa una única entrada «guarda»: mientras haya
// capas abiertas, «atrás» no sale de la app, sino que cierra la capa superior.
export class Nav {
  constructor() {
    this.stack = [];
    this.ignore = 0;
    history.replaceState({ sinapsisBase: true }, ''); // al recargar no queda ninguna capa abierta
    addEventListener('popstate', () => this.onPop());
  }

  get top() { return this.stack[this.stack.length - 1]; }
  is(kind) { return this.top?.kind === kind; }
  has(kind) { return this.stack.some((l) => l.kind === kind); }

  /** Abre una capa. `close` deja la interfaz como estaba antes de abrirla. */
  push(kind, close) {
    this.stack.push({ kind, close });
    this.guard();
  }

  /** Cierra la capa de arriba ahora mismo. Devuelve false si no había ninguna. */
  back() {
    const layer = this.stack.pop();
    if (!layer) return false;
    layer.close();
    this.sync();
    return true;
  }

  /** Cierra de una vez las capas de arriba que cumplan `match` (p. ej. una cadena de fichas). */
  unwind(match) {
    let oldest = null;
    while (this.top && match(this.top)) oldest = this.stack.pop();
    oldest?.close(); // la más antigua sabe cómo estaba la interfaz antes de toda la cadena
    this.sync();
    return !!oldest;
  }

  /** Cierra una capa concreta aunque no esté arriba del todo. */
  remove(kind) {
    const i = this.stack.findLastIndex((l) => l.kind === kind);
    if (i < 0) return false;
    const [layer] = this.stack.splice(i, 1);
    layer.close();
    this.sync();
    return true;
  }

  guard() {
    if (this.stack.length && !history.state?.sinapsisGuard) history.pushState({ sinapsisGuard: true }, '');
  }

  /** Sin capas abiertas, retira la entrada guarda para que «atrás» vuelva a salir de la app. */
  sync() {
    if (!this.stack.length && history.state?.sinapsisGuard) { this.ignore++; history.back(); }
  }

  onPop() {
    if (this.ignore) { this.ignore--; this.guard(); return; }
    const layer = this.stack.pop();
    layer?.close();
    this.guard();
  }
}
