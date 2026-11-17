// Precios públicos de la API de Anthropic en USD por millón de tokens.
// Sirven para ESTIMAR el coste equivalente: con un plan de suscripción no pagas esto.
// Escritura en caché: 1,25× la entrada (TTL 5 min) y 2× (TTL 1 h), salvo que el modelo tenga precio propio.
const PRICES = {
  'claude-fable-5-2':  { in: 8,    out: 40,   read: 0.20, w5: 10,  w1h: 16 },
  'claude-mythos-5-2': { in: 8,    out: 40,   read: 0.20, w5: 10,  w1h: 16 },
  'claude-fable-5-1':  { in: 10,   out: 50,   read: 0.25 },
  'claude-mythos-5-1': { in: 10,   out: 50,   read: 0.25 },
  'claude-fable-5':    { in: 10,   out: 50,   read: 1.00 },
  'claude-opus-5-5':   { in: 4,    out: 20,   read: 0.20 },
  'claude-opus-5':     { in: 5,    out: 25,   read: 0.50 },
  'claude-opus-4-8':   { in: 5,    out: 25,   read: 0.50 },
  'claude-opus-4-7':   { in: 5,    out: 25,   read: 0.50 },
  'claude-opus-4-6':   { in: 5,    out: 25,   read: 0.50 },
  'claude-sonnet-5-5': { in: 2,    out: 10,   read: 0.10 },
  'claude-sonnet-5':   { in: 2,    out: 10,   read: 0.20 },
  'claude-sonnet-4-6': { in: 3,    out: 15,   read: 0.30 },
  'claude-haiku-5-5':  { in: 0.10, out: 0.50, read: 0.01 },
  'claude-haiku-4-5':  { in: 1,    out: 5,    read: 0.10 },
};

function priceFor(model = '') {
  const base = model.replace(/\[.*\]$/, '').replace(/-\d{8}$/, '');
  if (PRICES[base]) return PRICES[base];
  const fam = Object.keys(PRICES).find((k) => base.startsWith(k));
  if (fam) return PRICES[fam];
  if (base.includes('haiku')) return PRICES['claude-haiku-5-5'];
  if (base.includes('sonnet')) return PRICES['claude-sonnet-5-5'];
  if (base.includes('fable') || base.includes('mythos')) return PRICES['claude-fable-5-2'];
  return PRICES['claude-opus-5-5'];
}

/** Coste estimado (USD) de un mensaje a partir de su bloque `usage` real. */
export function costOf(model, usage = {}) {
  const p = priceFor(model);
  const M = 1e6;
  const cc = usage.cache_creation || {};
  const w1h = cc.ephemeral_1h_input_tokens || 0;
  const w5 = cc.ephemeral_5m_input_tokens ?? Math.max(0, (usage.cache_creation_input_tokens || 0) - w1h);
  const mult = usage.speed === 'fast' ? 2 : 1;
  return mult * (
    (usage.input_tokens || 0) * p.in / M +
    (usage.cache_read_input_tokens || 0) * p.read / M +
    w5 * (p.w5 ?? p.in * 1.25) / M +
    w1h * (p.w1h ?? p.in * 2) / M +
    (usage.output_tokens || 0) * p.out / M
  );
}

export function prettyModel(model = '') {
  const m = model.replace(/^claude-/, '').replace(/\[.*\]$/, '');
  const [fam, ...v] = m.split('-');
  if (!fam) return model;
  return fam.charAt(0).toUpperCase() + fam.slice(1) + (v.length ? ' ' + v.join('.') : '');
}
