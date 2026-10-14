// ============================================================
//  filtro-multiple.js  -  filtros de SELECCION MULTIPLE (13/10/2026, pedido del usuario)
// ============================================================
// Tipo de documento, Sedes y Categorias: un boton con el resumen ("Facturas + Cuentas de cobro", "Provenza +2") que abre una
// lista con casillas y «Todas». Seleccion vacia = todas. Logica pura (probada con node) + el HTML; los eventos los pone la pagina.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FiltroMultiple = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const S = (v) => String(v);

  // ¿pasa este valor el filtro? (vacio = todo pasa)
  const permite = (sel, valor) => !(sel && sel.length) || sel.map(S).includes(S(valor));

  // marcar / desmarcar un valor. Si quedan marcadas TODAS las opciones, equivale a «Todas» (vacio)
  function alternar(sel, valor, opciones) {
    const v = S(valor), actual = (sel || []).map(S);
    const nuevo = actual.includes(v) ? actual.filter((x) => x !== v) : actual.concat([v]);
    const todas = (opciones || []).map((o) => S(o.valor));
    return todas.length && todas.every((t) => nuevo.includes(t)) ? [] : nuevo;
  }

  // texto del boton
  function resumen(opciones, sel, textoTodos) {
    const s = (sel || []).map(S), elegidas = (opciones || []).filter((o) => s.includes(S(o.valor)));
    if (!elegidas.length) return textoTodos;
    if (elegidas.length <= 2) return elegidas.map((o) => o.texto).join(' + ');
    return elegidas[0].texto + ' +' + (elegidas.length - 1);
  }

  // HTML del filtro. opciones: [{ valor, texto, grupo? }]. fn = nombre global del manejador: fn('alternar'|'todas'|'abrir', id, valor)
  function html(id, opciones, sel, textoTodos, fn, abierto) {
    const s = (sel || []).map(S);
    let grupoActual = null, cuerpo = '';
    for (const o of opciones || []) {
      if (o.grupo && o.grupo !== grupoActual) { grupoActual = o.grupo; cuerpo += `<div class="fm-grupo">${esc(o.grupo)}</div>`; }
      cuerpo += `<label class="fm-op"><input type="checkbox" ${s.includes(S(o.valor)) ? 'checked' : ''} onchange="${fn}('alternar','${esc(id)}','${esc(o.valor)}')"> ${esc(o.texto)}</label>`;
    }
    return `<div class="fm" id="${esc(id)}"><button type="button" class="sel-chip fm-btn${s.length ? ' fm-activo' : ''}" onclick="${fn}('abrir','${esc(id)}')">${esc(resumen(opciones, s, textoTodos))} ▾</button>` +
      `<div class="fm-panel"${abierto ? '' : ' hidden'}><label class="fm-op fm-todas"><input type="checkbox" ${s.length ? '' : 'checked'} onchange="${fn}('todas','${esc(id)}')"> ${esc(textoTodos)}</label>${cuerpo}</div></div>`;
  }

  return { esc, permite, alternar, resumen, html };
});
