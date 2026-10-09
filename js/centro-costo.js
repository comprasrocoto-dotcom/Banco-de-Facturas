// ============================================================
//  centro-costo.js  -  CENTRO DE COSTO (SERIE DEL ERP) AL AMARRAR  (09/10/2026)
//  En 123 Wok (San Agustin), Casa de Nadie y Sin Par la factura de compra entra al ERP con la serie del centro de costo
//  (FC.COCINA, FC.BAR, ...). La persona lo ELIGE al amarrar la factura con su pedido (obligatorio solo en esas marcas;
//  la lista sale de la tabla centro_costo_serie, ver supabase/centro_costo.sql). Logica pura: la usan index.html y las pruebas.
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CentroCosto = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // serie -> DETALLE (como en las planillas: FC.BAR = BAR). Se compara sin espacios: "FC. ASEO" (Casa de Nadie) = FC.ASEO
  const DETALLE = { 'FC.COCINA': 'COCINA', 'FC.BAR': 'BAR', 'FC.ASEO': 'MATERIAL DE ASEO', 'FC.EMPAQUES': 'MATERIAL DE EMPAQUE', 'FC.UTILESYPAPELERIA': 'UTENSILIOS Y PAPELERIA' };
  const sinEspacios = (s) => String(s == null ? '' : s).replace(/\s+/g, '').toUpperCase();
  // (09/10/2026) factura con productos de VARIOS centros: el ERP acepta una sola serie, asi que el agente la deja PENDIENTE DE REVISION
  const VARIOS = 'VARIOS';

  // filas de centro_costo_serie [{marca_id, centro, serie_erp, orden, activo}] -> las activas de esa marca, en orden
  function opciones(lista, marcaId) {
    return (lista || []).filter((x) => x && x.activo !== false && marcaId != null && Number(x.marca_id) === Number(marcaId))
      .sort((a, b) => (a.orden || 0) - (b.orden || 0) || String(a.centro).localeCompare(String(b.centro)));
  }
  const requiere = (lista, marcaId) => opciones(lista, marcaId).length > 0;

  // lo elegido -> { ok, serie } | { ok:false, error }. Marca sin centros: ok con serie null (no se manda nada)
  function validar(lista, marcaId, elegido) {
    const ops = opciones(lista, marcaId);
    if (!ops.length) return { ok: true, serie: null };
    const v = String(elegido == null ? '' : elegido).trim();
    if (!v) return { ok: false, error: 'Elige el centro de costo de la factura (' + ops.map((o) => o.centro).join(', ') + ').' };
    if (v === VARIOS) return { ok: true, serie: VARIOS };
    const o = ops.find((x) => x.serie_erp === v);
    if (!o) return { ok: false, error: 'El centro de costo "' + v + '" no existe para esta marca.' };
    return { ok: true, serie: o.serie_erp };
  }

  // DETALLE de una serie o de un N° de ingreso ("FC.BAR", "FC.BAR1890", "FC.BAR / 1890") -> 'BAR' ('' si no es de centro de costo)
  // (09/10/2026) tambien con espacios entre palabras: "FC. UTILES Y PAPELERIA / 9" -> FC.UTILESYPAPELERIA
  function serieDeIngreso(num) {
    const t = String(num == null ? '' : num).trim().replace(/\s*\/?\s*\d+$/, '');
    return /^FC\s*\.?\s*[A-Za-z][A-Za-z\s]*$/i.test(t) ? sinEspacios(t) : '';
  }
  const detalle = (serieOIngreso) => DETALLE[serieDeIngreso(serieOIngreso)] || '';

  // texto para mostrar: "FC.BAR · BAR"
  const etiqueta = (serie) => (serie === VARIOS ? 'VARIOS CENTROS (pendiente de revisión)' : (serie ? serie + (detalle(serie) ? ' · ' + detalle(serie) : '') : ''));

  // <select> del centro de costo (id dado). '' si la marca no usa centros
  function selectHtml(lista, marcaId, id, valor) {
    const ops = opciones(lista, marcaId);
    if (!ops.length) return '';
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    return '<select id="' + esc(id) + '" onclick="event.stopPropagation()" style="width:auto;margin:4px 0">' +
      '<option value="">— Elige el centro de costo —</option>' +
      ops.map((o) => '<option value="' + esc(o.serie_erp) + '"' + (o.serie_erp === valor ? ' selected' : '') + '>' + esc(o.centro) + ' (' + esc(o.serie_erp) + ')</option>').join('') +
      '<option value="' + VARIOS + '"' + (valor === VARIOS ? ' selected' : '') + '>VARIOS CENTROS (mixta) → queda pendiente de revisión</option>' +
      '</select>';
  }

  return { DETALLE, VARIOS, opciones, requiere, validar, serieDeIngreso, detalle, etiqueta, selectHtml };
});
