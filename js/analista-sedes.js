// ============================================================
//  analista-sedes.js  -  SEDES ASIGNADAS A LOS ANALISTAS  (26/09/2026)
//  ANALISTA = sus sedes asignadas + lo que aun no tiene sede.  ADMINISTRADOR = todo.  La regla real esta en la base (perfil_sede + politicas restrictivas)
//  y en el agente; esto solo arma la pantalla (casillas de sedes, resumen, selectores). Logica pura (sin red ni DOM): la usa index.html y se prueba con node.
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AnalistaSedes = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const marcaDe = (s) => (s && s.marcas && s.marcas.nombre) || '';
  const etiqueta = (s) => (marcaDe(s) ? marcaDe(s) + ' · ' : '') + s.nombre;

  // Un analista es un usuario de nivel "pagos" (perfil Analista)
  const esAnalista = (perfil) => !!perfil && perfil.nivel === 'pagos';

  // casillas agrupadas por marca. sedes = [{id, nombre, marca_id, marcas:{nombre}}]; seleccionadas = [ids]
  function casillas(sedes, seleccionadas, idBase) {
    const sel = new Set((seleccionadas || []).map(Number));
    const grupos = new Map();
    for (const s of sedes || []) { const m = marcaDe(s) || 'Sin marca'; if (!grupos.has(m)) grupos.set(m, []); grupos.get(m).push(s); }
    return [...grupos.entries()].map(([m, l]) => `<div style="margin:4px 0"><div class="mut" style="font-weight:700">${esc(m)}</div>` +
      l.map((s) => `<label style="display:inline-flex;gap:5px;align-items:center;margin:2px 14px 2px 0"><input type="checkbox" id="${esc(idBase)}_${Number(s.id)}" ${sel.has(s.id) ? 'checked' : ''} style="width:auto;margin:0"> ${esc(s.nombre)}</label>`).join('') + '</div>').join('');
  }
  // ids marcados: lee las casillas con un lector de DOM inyectado (leer(id) -> boolean)
  const marcadas = (sedes, idBase, leer) => (sedes || []).filter((s) => leer(idBase + '_' + s.id)).map((s) => s.id);

  // texto corto para la lista de usuarios
  function resumen(sedes, ids) {
    const l = (ids || []).map((id) => (sedes || []).find((s) => s.id === id)).filter(Boolean);
    return l.length ? l.map(etiqueta).join(' · ') : '';
  }
  const aviso = (ids) => (ids && ids.length ? '' : 'Sin sedes marcadas: este analista ve TODAS las sedes (como antes). Marca las suyas para restringirlo.');

  // sedes que se ofrecen en los selectores (encabezado, Nuevo pedido): un analista restringido solo ve las suyas; los demas, todas
  function permitidas(sedes, alcance) {
    if (!alcance || !alcance.restringido) return sedes || [];
    const ids = new Set((alcance.sedes || []).map(Number));
    return (sedes || []).filter((s) => ids.has(s.id));
  }

  // { user_id: [sede ids] } a partir de las filas de analista_sedes_listar
  function porUsuario(filas) { const o = {}; (filas || []).forEach((f) => { (o[f.user_id] = o[f.user_id] || []).push(f.sede_id); }); return o; }
  // ¿cambio algo? (para no llamar a la base sin necesidad)
  function cambio(antes, despues) { const a = [...new Set(antes || [])].sort((x, y) => x - y).join(','), b = [...new Set(despues || [])].sort((x, y) => x - y).join(','); return a !== b; }

  // ---- correo de avisos del agente: hasta 3 correos; los avisos SIEMPRE llevan copia a compras (eso lo garantiza el agente)
  const COMPRAS = 'comprasrocoto@gmail.com', RX_CORREO = /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/;
  function validarCorreos(texto) {
    const partes = String(texto == null ? '' : texto).toLowerCase().split(/[,;\s]+/).filter(Boolean), ok = [], malos = [];
    for (const c of partes) { if (!RX_CORREO.test(c)) malos.push(c); else if (!ok.includes(c)) ok.push(c); }
    if (malos.length) return { ok: false, correos: ok, error: 'Correo no válido: ' + malos.join(', ') + '.' };
    if (ok.length > 3) return { ok: false, correos: ok, error: 'Máximo 3 correos por analista.' };
    return { ok: true, correos: ok, texto: ok.join(', '), error: '' };
  }
  const textoAvisos = (correo) => (correo ? correo + ' (con copia a ' + COMPRAS + ')' : 'solo a ' + COMPRAS);

  return { COMPRAS, validarCorreos, textoAvisos, esc, etiqueta, esAnalista, casillas, marcadas, resumen, aviso, permitidas, porUsuario, cambio };
});
