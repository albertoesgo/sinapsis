// Utilidades compartidas por la escena y los paneles.

/** Diseño táctil (hojas inferiores y barra de pestañas): móviles, tabletas en vertical y móviles en horizontal. */
export const MOBILE_MQ = '(max-width: 900px), (max-height: 520px) and (pointer: coarse)';
export const isMobile = () => matchMedia(MOBILE_MQ).matches;
/** Móvil en horizontal: las hojas salen por la derecha en vez de por abajo. */
export const isLandscapePhone = () => matchMedia('(max-height: 520px) and (pointer: coarse)').matches;

/** Demo estática (GitHub Pages): no hay servidor, los datos vienen de ficheros grabados. */
export const STATIC = document.documentElement.hasAttribute('data-static');
