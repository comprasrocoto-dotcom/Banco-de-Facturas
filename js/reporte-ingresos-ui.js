// ============================================================
//  reporte-ingresos-ui.js  -  «📊 Rendimiento del agente» en Administración → Agente (solo administrador)  (03/11/2026)
//  Cuántos ingresos hizo el agente y cuántos terminó el analista, por analista, por semana, por proveedor y los motivos de
//  falla del agente (para saber qué mejorar). Datos: rpc reporte_ingresos (supabase/reporte_ingresos.sql). Cálculos:
//  js/reporte-ingresos.js. Excel con ExcelJS (mismo cargador que el resto de la web).
// ============================================================
var REPING = { desde: '', hasta: '', filas: null, cargando: false, error: '' };

function repIngHoy() { return new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10); }
function repIngMenos(d, dias) { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() - dias); return x.toISOString().slice(0, 10); }
function repIngEsc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function reporteIngPintar() {
  const caja = document.getElementById('reporteIngCaja'); if (!caja) return;
  if (!REPING.desde) { REPING.hasta = repIngHoy(); REPING.desde = repIngMenos(REPING.hasta, 30); }
  caja.innerHTML = reporteIngHtml();
}

function reporteIngHtml() {
  const R = ReporteIngresos, e = repIngEsc;
  let h = `<div class="card" style="border-left:5px solid #1d4ed8;margin:8px 0"><div style="font-weight:700;color:#1d4ed8">📊 Rendimiento del agente: ¿quién ingresa, el agente o el analista?</div>
    <div class="mut">Cada pedido con factura, según cómo quedó en el ERP: lo ingresó el <b>agente</b>, lo terminó el <b>analista</b> porque el agente falló, lo ingresó el analista <b>sin pasar por el agente</b>, o sigue <b>pendiente</b>. El analista es el responsable de la sede del pedido.</div>
    <div class="row" style="gap:8px;margin-top:8px;flex-wrap:wrap;align-items:center">
      <span class="mut">Desde</span><input type="date" id="repIngDesde" value="${e(REPING.desde)}" style="width:auto;margin:0">
      <span class="mut">hasta</span><input type="date" id="repIngHasta" value="${e(REPING.hasta)}" style="width:auto;margin:0">
      <button class="p" onclick="reporteIngCargar()" ${REPING.cargando ? 'disabled' : ''}>${REPING.cargando ? '⏳ Calculando…' : '🔍 Ver reporte'}</button>
      ${REPING.filas && REPING.filas.length ? '<button onclick="reporteIngExcel()">⬇ Excel</button>' : ''}</div>`;
  if (REPING.error) h += `<div style="color:#991b1b;margin-top:6px">${e(REPING.error)}</div>`;
  const F = REPING.filas;
  if (F) {
    if (!F.length) return h + '<div class="mut" style="margin-top:8px">No hay pedidos con factura en esas fechas.</div></div>';
    const r = R.resumen(F);
    const kpi = (titulo, valor, sub, color) => `<div style="flex:1;min-width:150px;border:1px solid var(--line);border-radius:10px;padding:8px 10px"><div class="mut" style="font-size:12px">${titulo}</div><div style="font-size:22px;font-weight:800;color:${color}">${valor}</div><div class="mut" style="font-size:12px">${sub}</div></div>`;
    h += `<div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap">
      ${kpi('Ingresados al ERP', r.ingresados.toLocaleString('es-CO'), `${r.pendiente} pendiente(s)`, 'inherit')}
      ${kpi('🤖 Los hizo el agente', r.pct_agente + '%', `${r.agente} documento(s)${r.reintentos ? ` · ${r.reintentos} necesitaron reintentos` : ''}`, '#15803d')}
      ${kpi('👤 Los terminó el analista', r.pct_analista + '%', `${r.tras_fallo} tras falla del agente · ${r.directo} sin pasar por el agente`, '#b45309')}
      ${kpi('Falla del agente', r.pct_falla_agente + '%', 'de lo que el agente intentó, lo que tuvo que terminar el analista', '#b91c1c')}</div>`;
    const tabla = (cols, filas) => `<div style="overflow-x:auto;margin-top:6px"><table style="border-collapse:collapse;font-size:13px;min-width:100%"><tr class="mut" style="text-align:left">${cols.map((c, i) => `<th style="padding:3px 8px;${i ? 'text-align:right' : ''}">${c}</th>`).join('')}</tr>${filas.map((f) => `<tr style="border-top:1px solid var(--line)">${f.map((v, i) => `<td style="padding:3px 8px;${i ? 'text-align:right' : ''}">${v}</td>`).join('')}</tr>`).join('')}</table></div>`;
    const barra = (p) => `<span style="display:inline-block;width:60px;height:8px;background:#fee2e2;border-radius:4px;vertical-align:middle;margin-right:6px"><span style="display:block;height:8px;width:${Math.min(100, p)}%;background:#16a34a;border-radius:4px"></span></span>${p}%`;
    h += `<h4 style="margin:14px 0 2px">Por analista</h4>` + tabla(['Analista', 'Ingresados', '🤖 Agente', '👤 Tras falla', '👤 Directo', 'Pendientes', '% agente'],
      R.porAnalista(F).map((a) => [e(a.nombre), a.ingresados, a.agente, a.tras_fallo, a.directo, a.pendiente, barra(a.pct_agente)]));
    const mot = R.motivos(F);
    h += `<h4 style="margin:14px 0 2px">Por qué no lo terminó el agente <span class="mut" style="font-weight:400">(lo que mejorar primero)</span></h4>` + (mot.length ? tabla(['Etapa · motivo', 'Veces', 'Ejemplos'],
      mot.slice(0, 15).map((m) => [`<b>${e(m.etapa)}</b><div class="mut" style="font-size:12px">${e(m.detalle)}</div>`, m.cantidad, `<span class="mut" style="font-size:12px">${e(m.pedidos.join(', '))}</span>`])) : '<div class="mut">Sin fallas del agente en esas fechas. ✅</div>');
    const prov = R.porProveedor(F, 2);
    if (prov.length) h += `<h4 style="margin:14px 0 2px">Proveedores donde más termina el analista</h4>` + tabla(['Proveedor', 'Ingresados', '🤖 Agente', '👤 Analista', '% agente'],
      prov.slice(0, 10).map((p) => [e(p.proveedor), p.ingresados, p.agente, p.analista, barra(p.pct_agente)]));
    h += `<h4 style="margin:14px 0 2px">Por semana</h4>` + tabla(['Semana (lunes)', 'Ingresados', '🤖 Agente', '👤 Analista', '% agente'],
      R.porSemana(F).map((s) => [e(s.semana), s.ingresados, s.agente, s.analista, barra(s.pct_agente)]));
  }
  return h + '</div>';
}

async function reporteIngCargar() {
  const d = (document.getElementById('repIngDesde') || {}).value, a = (document.getElementById('repIngHasta') || {}).value;
  if (!d || !a || a < d) { REPING.error = 'Elige un rango de fechas válido.'; reporteIngPintar(); return; }
  Object.assign(REPING, { desde: d, hasta: a, cargando: true, error: '' }); reporteIngPintar();
  try {
    const r = await SB.rpc('reporte_ingresos', { p_desde: d, p_hasta: a });
    if (r.error) throw new Error(r.error.message);
    REPING.filas = (r.data || []).map((f) => (f.como === 'AGENTE' ? Object.assign(f, { error: null }) : f));   // en los del agente «error» es solo una nota
  } catch (e) { REPING.error = 'No pude armar el reporte: ' + e.message; REPING.filas = null; }
  REPING.cargando = false; reporteIngPintar();
}

async function reporteIngExcel() {
  const F = REPING.filas; if (!F || !F.length) return;
  const R = ReporteIngresos;
  try {
    const ExcelJS = await new Promise((res, rej) => { if (window.ExcelJS) return res(window.ExcelJS); const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js'; s.onload = () => (window.ExcelJS ? res(window.ExcelJS) : rej(new Error('ExcelJS no cargó'))); s.onerror = () => rej(new Error('No se pudo cargar ExcelJS')); document.head.appendChild(s); });
    const wb = new ExcelJS.Workbook(); wb.creator = 'Banco de Facturas';
    const hoja = (nombre, cols, filas, anchos) => {
      const ws = wb.addWorksheet(nombre, { views: [{ state: 'frozen', ySplit: 1 }] }); ws.addRow(cols);
      const t = ws.getRow(1); t.font = { bold: true, color: { argb: 'FFFFFFFF' } }; t.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } }; });
      filas.forEach((f) => ws.addRow(f)); cols.forEach((c, i) => { ws.getColumn(i + 1).width = (anchos && anchos[i]) || 14; if (/^%/.test(c)) ws.getColumn(i + 1).numFmt = '0.0"%"'; if (/Total/.test(c)) ws.getColumn(i + 1).numFmt = '#,##0'; });
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
    };
    const r = R.resumen(F);
    hoja('Resumen', ['Concepto', 'Cantidad', '% sobre ingresados'], [
      ['Período', `${REPING.desde} a ${REPING.hasta}`, null], ['Ingresados al ERP', r.ingresados, 100], ['Los hizo el agente', r.agente, r.pct_agente],
      ['  de ellos con reintentos', r.reintentos, null], ['Los terminó el analista (el agente falló)', r.tras_fallo, R.pct(r.tras_fallo, r.ingresados)],
      ['Los ingresó el analista sin pasar por el agente', r.directo, R.pct(r.directo, r.ingresados)], ['Pendientes de ingresar', r.pendiente, null],
      ['% de falla del agente (de lo que intentó)', null, r.pct_falla_agente]], [48, 22, 20]);
    hoja('Por analista', ['Analista', 'Ingresados', 'Agente', 'Analista tras falla', 'Analista directo', 'Pendientes', '% agente'],
      R.porAnalista(F).map((a) => [a.nombre, a.ingresados, a.agente, a.tras_fallo, a.directo, a.pendiente, a.pct_agente]), [30, 12, 10, 18, 16, 12, 10]);
    hoja('Motivos de falla', ['Etapa', 'Motivo', 'Veces', 'Ejemplos'], R.motivos(F).map((m) => [m.etapa, m.detalle, m.cantidad, m.pedidos.join(', ')]), [26, 70, 8, 50]);
    hoja('Por proveedor', ['Proveedor', 'Ingresados', 'Agente', 'Analista', '% agente'], R.porProveedor(F, 1).map((p) => [p.proveedor, p.ingresados, p.agente, p.analista, p.pct_agente]), [42, 12, 10, 10, 10]);
    hoja('Por semana', ['Semana (lunes)', 'Ingresados', 'Agente', 'Analista', 'Pendientes', '% agente'], R.porSemana(F).map((s) => [s.semana, s.ingresados, s.agente, s.analista, s.pendiente, s.pct_agente]), [16, 12, 10, 10, 12, 10]);
    hoja('Detalle', ['Fecha', 'Pedido', 'Cómo quedó', 'Analista de la sede', 'Lanzó el agente', 'Anotó el ingreso a mano', 'Marca', 'Sede', 'Proveedor', 'Factura', 'N° ingreso ERP', 'Total', 'Intentos del agente', 'Etapa del error', 'Error del agente'],
      F.map((f) => [f.dia, f.pedido, R.COMO[f.como] || f.como, f.analista || R.SIN_ANALISTA, f.lanzo || '', f.anoto || '', f.marca || '', f.sede || '', f.proveedor || '', f.factura || '', f.num_ingreso || '', Number(f.total || 0) || null, f.intentos || null, f.etapa_error || '', f.error || '']),
      [11, 10, 30, 26, 22, 22, 12, 22, 34, 14, 14, 13, 10, 24, 70]);
    const buf = await wb.xlsx.writeBuffer(); const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    a.download = `Rendimiento_agente_${REPING.desde}_a_${REPING.hasta}.xlsx`;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  } catch (e) { alert('No pude armar el Excel: ' + e.message); }
}
