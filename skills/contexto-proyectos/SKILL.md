---
name: contexto-proyectos
description: Antes de buscar o explorar código en uno de tus proyectos para una tarea (arreglar, añadir, cambiar, «dónde está…»), consulta el mapa que Sinapsis aprende del historial real de Claude Code. Así va directo a los ficheros y a las órdenes correctas y gasta menos tokens. Úsala al empezar cualquier tarea de código.
---

# Contexto de proyectos (mapa de Sinapsis)

Buscar a ciegas (Glob, Grep, abrir ficheros enteros «por si acaso») es lo que más tokens gasta: cada paso relee todo el contexto. Sinapsis registra, en cada petición pasada, qué ficheros se leyeron y editaron, con qué órdenes se probó y cuántos pasos se dedicaron a buscar. Este mapa evita repetir esa búsqueda.

## Cómo usarlo

0. **Si en el contexto ya hay un bloque «[Sinapsis]»** (lo añade el hook al abrir o compactar la sesión y al escribir una tarea con pista clara), úsalo directamente: no repitas la consulta. Si la tarea es de un proyecto concreto y el bloque no la cubre, sigue con el paso 1.
1. **Antes de explorar**, con la tarea resumida en pocas palabras:
   ```bash
   node __SINAPSIS__/scripts/donde.mjs --dir "$PWD" "<la tarea>"
   ```
   Si la tarea es de una subcarpeta (p. ej. `~/Proyectos/sinapsis`), pasa esa ruta en `--dir`: el resultado se limita a ella y las rutas salen relativas.
2. **Lee primero los 2 o 3 ficheros mejor puntuados (★★★), y solo lo que haga falta.** En los ficheros grandes, busca dentro con Grep o lee un rango de líneas, no el fichero entero.
3. **Para probar, usa las órdenes de «Cómo se ejecuta»** (tests, build, servidor) en lugar de adivinarlas.
4. **Es una pista, no la verdad.** Si no hay historial, si nada se parece o si un fichero ya no encaja, explora como siempre. No insistas con el mapa.
5. **Visión general** (primera tarea de la sesión en un proyecto): `donde.mjs --dir "$PWD" --mapa` devuelve los ficheros clave, las órdenes y las tareas recientes con sus ficheros. Hay más detalle en la nota del vault `~/.sinapsis/vault/Proyectos/<nombre>.md`: líneas de cada fichero y consejos para gastar menos.

## Si el proyecto tiene grafo de código (Graphify)

Lo verás en el bloque «[Sinapsis]» o porque existe `graphify-out/graph.json` en el proyecto. Antes de abrir ficheros grandes o de buscar quién usa algo:
```bash
graphify query "<pregunta>" --graph <proyecto>/graphify-out/graph.json --budget 800   # qué está relacionado, con fichero y línea
graphify affected "<símbolo>" --graph <proyecto>/graphify-out/graph.json             # qué se rompe si lo cambias
```
Después lee solo las líneas que indica (`sed -n 290,320p fichero`), no el fichero entero. No ejecutes `/graphify` ni `graphify extract` sin `--code-only`: con documentos e imágenes usa un modelo de IA y gasta del plan.

## No hacer

- No leas el vault entero ni varias notas «por contexto»: abre solo la del proyecto en el que trabajas, si de verdad hace falta.
- No edites el vault: se regenera solo cada 10 minutos.
- No la uses en tareas que no tocan código (redacción, preguntas generales).
