// ============================================================
//  ingreso-panel.js  -  PANEL DEL AGENTE DE INGRESOS (progreso en vivo, DETENER, errores)  (26/09/2026)
//  Arma el HTML del bloque de progreso que se ve en la pantalla de Pedidos, a partir de ordenes.progreso (lo que escribe el agente) y de los documentos en ERROR (ingreso_documento).
//  Logica pura (sin red ni DOM): la usa index.html y se prueba con node.
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IngresoPanel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MIN_SIN_LATIDO = 5;   // el agente da latido en cada paso: 5 min sin señales ya es raro

  function titulo(p) {
    if (!p) return '';
    if (p.fase === 'terminado') return p.errores > 0 ? '🟠 PROCESO FINALIZADO CON NOVEDADES' : '✅ PROCESO COMPLETADO';
    if (p.fase === 'detenido') return '🛑 PROCESO DETENIDO';
    return '🟢 PROCESANDO';
  }
  const porcentaje = (p) => (p && p.total > 0 ? Math.min(100, Math.round(((p.completadas + p.errores) / p.total) * 100)) : 0);

  // o = fila de ordenes (estado, detener, progreso). opciones = { puede: ¿tiene el permiso ingresos.iniciar?, ahoraMs }
  function bloqueProgreso(o, opciones) {
    opciones = opciones || {};
    const p = o && o.progreso;
    if (!p) return '';
    const activa = o.estado === 'corriendo';
    const actual = p.actual ? `<div>Actual: <b>${esc(p.actual.pedido)}</b>${p.actual.factura ? ' · Factura <b>' + esc(p.actual.factura) + '</b>' : ''}${p.actual.etapa ? ' · Etapa: <b>' + esc(p.actual.etapa) + '</b>' : ''}</div>` : '';
    const lat = p.latido ? new Date(p.latido).getTime() : 0, ahora = opciones.ahoraMs || Date.now();
    const sinSenal = activa && lat && (ahora - lat) > MIN_SIN_LATIDO * 60000
      ? `<div style="color:#b45309">⚠️ El agente no da señales hace ${Math.round((ahora - lat) / 60000)} min (¿está encendido el vigilante?).</div>` : '';
    const detener = activa && opciones.puede
      ? (o.detener ? '<span class="badge st-asignada">🛑 Deteniendo: termina el documento en curso y se para</span>' : `<button class="d" onclick="detenerIngreso(${Number(o.id)})">🛑 DETENER PROCESO</button>`) : '';
    return `<div style="margin-top:8px">
      <div style="font-weight:700">AGENTE DE INGRESOS · ${titulo(p)}</div>
      <div style="height:10px;background:#e2e8f0;border-radius:6px;overflow:hidden;margin:6px 0"><div style="height:10px;width:${porcentaje(p)}%;background:${p.errores > 0 ? '#f59e0b' : '#16a34a'}"></div></div>
      <div>Progreso: <b>${Number(p.indice) || 0} / ${Number(p.total) || 0}</b></div>${actual}
      <div>Completadas: <b>${Number(p.completadas) || 0}</b> · Con error: <b>${Number(p.errores) || 0}</b> · Pendientes: <b>${Number(p.pendientes) || 0}</b></div>
      ${p.resumen && !activa ? `<div class="mut">${esc(p.resumen)}</div>` : ''}${sinSenal}
      ${detener ? `<div class="row" style="margin-top:8px">${detener}</div>` : ''}</div>`;
  }

  // docs = filas de ingreso_documento en ERROR o PENDIENTE_REINTENTO
  function bloqueErrores(docs, opciones) {
    opciones = opciones || {};
    const l = (docs || []).filter((d) => d.estado === 'ERROR' || d.estado === 'PENDIENTE_REINTENTO');
    if (!l.length) return '';
    const errores = l.filter((d) => d.estado === 'ERROR');
    const filas = l.slice(0, 30).map((d) => `<div style="border-top:1px solid var(--line);padding:5px 0"><b>${esc(d.numero || d.pedido_id)}</b> · ${d.estado === 'ERROR' ? '<span style="color:#b91c1c">ERROR</span>' : '<span style="color:#b45309">PENDIENTE DE REINTENTO</span>'}
      ${d.error_etapa ? ' · ' + esc(d.error_etapa) : ''}<div class="mut">${esc(d.etapa || '')}${d.error ? ' — ' + esc(d.error) : ''}</div></div>`).join('');
    return `<div class="card" style="border-left:5px solid #b45309;margin-top:8px"><div style="font-weight:700;color:#b45309">Documentos con novedad (${l.length})</div>
      <div class="mut">Los COMPLETADOS no se vuelven a procesar. Corrige lo que indica cada uno y pulsa reintentar.</div>${filas}
      ${errores.length && opciones.puede ? `<div class="row" style="margin-top:8px"><button class="p" onclick="reintentarErroresIngreso()">🔁 REINTENTAR ERRORES (${errores.length})</button></div>` : ''}</div>`;
  }

  return { esc, titulo, porcentaje, bloqueProgreso, bloqueErrores, MIN_SIN_LATIDO };
});
