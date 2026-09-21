// ============================================================
//  decisiones-agente.js  -  QUE "DECISIONES RECIENTES DEL AGENTE" NO SE LLENE DE LO YA REVISADO  (21/09/2026)   (Admin -> Agente)
//  Cada corrida del agente deja un evento por cada linea que decide. Antes la lista mostraba TODO: aunque la persona corrigiera o confirmara la unidad,
//  la decision seguia ahi (y repetida por cada corrida). Ahora solo queda lo que TODAVIA necesita ojo:
//   - se quita lo que la persona ya "quito" de la lista (oculto_en);
//   - se quita la decision cuya unidad la persona YA corrigio o confirmo para ese mismo producto (unidad_usuario = lo que decidio el agente);
//   - una linea que el agente decidio varias veces con la misma unidad sale UNA vez (la mas reciente).
//  Si el agente decide DISTINTO a lo que la persona dejo firme, si se muestra (algo cambio).
//  Logica PURA y determinista (sin red, sin IA). La usa index.html y se prueba con node.
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DecisionesAgente = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const t = (d) => { const n = Date.parse(d); return isFinite(n) ? n : 0; };

  // validaciones: eventos 'correccion_usuario' / 'confirmacion_admin' { clave, unidad_usuario }  ->  { clave: Set(unidades que la persona dejo firmes) }
  function validadas(validaciones) {
    const m = {};
    for (const v of (validaciones || [])) { if (!v || !v.clave || !v.unidad_usuario) continue; (m[v.clave] = m[v.clave] || new Set()).add(v.unidad_usuario); }
    return m;
  }

  // eventos: decisiones 'decision_agente' (mas recientes primero o no: se ordena)  ->  [{ e, i, ids }]  i = posicion original en `eventos`, ids = todas las decisiones de esa linea
  function visibles(eventos, validaciones) {
    const firmes = validadas(validaciones), vistos = new Map();
    const orden = (eventos || []).map((e, i) => ({ e, i })).filter((x) => x.e && !x.e.oculto_en).sort((a, b) => t(b.e.creado_en) - t(a.e.creado_en) || b.i - a.i);
    const out = [];
    for (const x of orden) {
      const f = firmes[x.e.clave];
      if (f && f.has(x.e.unidad_agente)) continue;                        // ya revisada: la persona dejo firme justo esa unidad
      const k = x.e.clave + '|' + x.e.unidad_agente;
      if (vistos.has(k)) { vistos.get(k).ids.push(x.e.id); continue; }    // repetida (otra corrida): se junta con la mas reciente
      const item = { e: x.e, i: x.i, ids: [x.e.id] }; vistos.set(k, item); out.push(item);
    }
    return out;
  }

  // Todas las decisiones (no ocultas) de un producto: son las que se sacan de la lista al corregirlo o quitarlo
  function idsDeClave(eventos, clave) {
    return (eventos || []).filter((e) => e && e.clave === clave && !e.oculto_en && e.id != null).map((e) => e.id);
  }

  return { validadas, visibles, idsDeClave };
});
