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
    const todos = (docs || []).filter((d) => d.estado === 'ERROR' || d.estado === 'PENDIENTE_REINTENTO');
    if (!todos.length) return '';
    // (25/10/2026) pedido del usuario: filtrar por sede (opciones.filtroSede = texto «marca · sede» elegido; '' = todas)
    const sedeDe = (d) => (typeof opciones.sedeDe === 'function' ? opciones.sedeDe(d) : '') || 'Sin sede';
    const conteo = new Map(); todos.forEach((d) => conteo.set(sedeDe(d), (conteo.get(sedeDe(d)) || 0) + 1));
    const filtro = opciones.filtroSede && conteo.has(opciones.filtroSede) ? opciones.filtroSede : '';
    const l = filtro ? todos.filter((d) => sedeDe(d) === filtro) : todos;
    const selector = conteo.size > 1 || filtro ? `<div class="row" style="margin:6px 0;gap:6px;align-items:center"><span class="mut">Sede:</span>
      <select style="width:auto;margin:0" onchange="filtrarNovedadSede(this.value)"><option value="">Todas (${todos.length})</option>${[...conteo.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, n]) => `<option value="${esc(k)}"${k === filtro ? ' selected' : ''}>${esc(k)} (${n})</option>`).join('')}</select></div>` : '';
    const idsFiltro = filtro ? '[' + l.map((d) => Number(d.pedido_id)).filter(Boolean).join(',') + ']' : 'null';
    const errores = l.filter((d) => d.estado === 'ERROR');
    // (05/10/2026) "Quitar"/"Limpiar" = sacar de la cola (estado DESCARTADO, RPC ingreso_descartar): el agente deja de reintentarlo.
    const quitar = (d) => (opciones.puede && Number(d.pedido_id) ? `<button class="d" style="padding:3px 10px;font-size:12px" title="Sacar de la cola: el agente no lo vuelve a intentar" onclick="descartarIngreso([${Number(d.pedido_id)}])">✕ Quitar</button>` : '');
    // (25/10/2026) pedido del usuario: cada uno se puede lanzar SOLO (🤖 Lanzar este) y se ve de que sede es (opciones.sedeDe(d) -> texto)
    const lanzar = (d) => (opciones.puede && Number(d.pedido_id) ? `<button class="s" style="padding:3px 10px;font-size:12px;background:#1e3a8a;border-color:#1e3a8a;color:#fff" title="Pide una orden de ingreso al ERP solo para este pedido" onclick="ingresarSoloPedido(${Number(d.pedido_id)})">🤖 Lanzar este</button>` : '');
    const sedeTxt = (d) => { const t = typeof opciones.sedeDe === 'function' ? opciones.sedeDe(d) : ''; return t ? ` · <span class="badge" style="background:#e0e7ff;color:#1e3a8a">${esc(t)}</span>` : ''; };
    const filas = l.slice(0, 30).map((d) => `<div style="border-top:1px solid var(--line);padding:5px 0;display:flex;gap:10px;align-items:flex-start"><div style="flex:1"><b>${esc(d.numero || d.pedido_id)}</b>${sedeTxt(d)} · ${d.estado === 'ERROR' ? '<span style="color:#b91c1c">ERROR</span>' : '<span style="color:#b45309">PENDIENTE DE REINTENTO</span>'}
      ${d.error_etapa ? ' · ' + esc(d.error_etapa) : ''}<div class="mut">${esc(d.etapa || '')}${d.error ? ' — ' + esc(d.error) : ''}</div></div><div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">${lanzar(d)}${quitar(d)}</div></div>`).join('');
    const botones = [
      filtro && opciones.puede ? `<button class="p" onclick="reintentarErroresIngreso(${idsFiltro})" title="Lanza solo los de esta sede (los que tienen error vuelven a la cola)">🔁 LANZAR ESTA SEDE (${l.length})</button>`
        : errores.length && opciones.puede ? `<button class="p" onclick="reintentarErroresIngreso()">🔁 REINTENTAR ERRORES (${errores.length})</button>` : '',
      opciones.puede ? `<button onclick="descartarIngreso(${idsFiltro})" title="Sacar de la cola TODOS los de esta lista: el agente deja de intentarlos">🧹 LIMPIAR VENTANA (${l.length})</button>` : '',
    ].filter(Boolean).join(' ');
    return `<div class="card" style="border-left:5px solid #b45309;margin-top:8px"><div style="font-weight:700;color:#b45309">Documentos con novedad (${l.length}${filtro ? ' de ' + todos.length : ''})</div>
      <div class="mut">Los COMPLETADOS no se vuelven a procesar. Corrige lo que indica cada uno y pulsa reintentar, o sácalo de la cola si ya lo resolviste a mano.</div>${selector}${filas}
      ${botones ? `<div class="row" style="margin-top:8px">${botones}</div>` : ''}</div>`;
  }

  return { esc, titulo, porcentaje, bloqueProgreso, bloqueErrores, MIN_SIN_LATIDO };
});
