#!/usr/bin/env node
// Hook de Claude Code para Sinapsis (lo instala `npm run hooks:install`).
//   SessionStart      → al abrir, reanudar, limpiar o compactar: dónde está cada cosa (≈250 tokens).
//   UserPromptSubmit  → al escribir una tarea: por qué ficheros empezar, solo si hay una pista clara.
// Pregunta al servidor local de Sinapsis (127.0.0.1) con un límite de 1,5 s. Si no responde o no hay
// nada útil, no añade nada: nunca bloquea ni rompe la sesión.
const PORT = Number(process.env.SINAPSIS_PORT || 7420);

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', async () => {
  try {
    const j = JSON.parse(raw || '{}');
    const event = j.hook_event_name;
    if (event !== 'SessionStart' && event !== 'UserPromptSubmit') return;
    const r = await fetch(`http://127.0.0.1:${PORT}/api/context`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ev: event === 'SessionStart' ? 'start' : 'prompt', cwd: j.cwd || process.cwd(), sid: j.session_id || '', prompt: j.prompt || '', source: j.source || '' }),
      signal: AbortSignal.timeout(1500),
    });
    if (!r.ok) return;
    const { text } = await r.json();
    if (text) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } }));
  } catch { /* sin Sinapsis o sin respuesta: la sesión sigue igual */ }
});
