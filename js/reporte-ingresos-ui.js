// ============================================================
//  reporte-ingresos-ui.js  -  «📊 Rendimiento del agente» en Administración → Agente (solo administrador)  (03/11/2026)
//  Cuántos ingresos hizo el agente y cuántos terminó el analista, por analista, por semana, por proveedor y los motivos de
//  falla del agente (para saber qué mejorar). Datos: rpc reporte_ingresos (supabase/reporte_ingresos.sql). Cálculos:
//  js/reporte-ingresos.js. Excel con ExcelJS (mismo cargador que el resto de la web).
// ============================================================
var REPING = { desde: '', hasta: '', filas: null, cargando: false, error: '', ver: null };

// (04/11/2026, pedido del usuario) los numeros se pueden tocar: muestra cuales son esos documentos (pedido, factura, proveedor...)
// ver = { como: 'PENDIENTE' | 'AGENTE' | 'ANALISTA_TRAS_FALLO' | 'ANALISTA_DIRECTO', analista: nombre | null (todos) }
function reporteIngVer(como, analista) {
  const v = REPING.ver;
  REPING.ver = v && v.como === como && v.analista === (analista || null) ? null : { como, analista: analista || null };
  reporteIngPintar();
  setTimeout(() => { const e = document.getElementById('repIngLista'); if (e && REPING.ver) e.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50);
}
function repIngFiltrar(F, ver) {
  return (F || []).filter((f) => f.como === ver.como && (!ver.analista ||
    (ver.analista === ReporteIngresos.SIN_ANALISTA ? !String(f.analista || '').trim() : String(f.analista || '').split(',').map((x) => x.trim()).includes(ver.analista))));
}
// (04/11/2026, pedido del usuario) la lista que se abrio al tocar un numero se puede bajar en Excel o PDF
function repIngListaDatos() {
  const ver = REPING.ver; if (!ver || !REPING.filas) return null;
  const R = ReporteIngresos, L = repIngFiltrar(REPING.filas, ver);
  const motivo = (f) => (ver.como === 'AGENTE' || ver.como === 'ANALISTA_DIRECTO') ? (f.num_ingreso || '') :
    [f.estado_cola === 'PENDIENTE_REINTENTO' ? 'en cola (reintentando)' : f.estado_cola === 'ERROR' ? 'en cola con error' : (ver.como === 'PENDIENTE' && !f.estado_cola ? 'sin lanzar al agente' : ''), f.etapa_error, f.error].filter(Boolean).join(' · ');
  const titulo = `${R.COMO[ver.como] || ver.como}${ver.analista ? ' · ' + ver.analista : ''}`;
  const archivo = ('Documentos_' + titulo + '_' + REPING.desde + '_a_' + REPING.hasta).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/_+/g, '_');
  const col5 = (ver.como === 'AGENTE' || ver.como === 'ANALISTA_DIRECTO') ? 'N° ingreso ERP' : 'Estado / motivo';
  return { titulo, archivo, col5, filas: L.map((f) => ({ fecha: f.dia || '', pedido: f.pedido || '', factura: f.factura || '', proveedor: f.proveedor || '',
    donde: [f.marca, f.sede].filter(Boolean).join(' · '), total: f.total != null ? Number(f.total) : null, motivo: motivo(f), analista: f.analista || R.SIN_ANALISTA })) };
}
function repIngBajar(blob, nombre) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nombre;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
async function reporteIngListaExcel() {
  const d = repIngListaDatos(); if (!d || !d.filas.length) return;
  try {
    const ExcelJS = await new Promise((res, rej) => { if (window.ExcelJS) return res(window.ExcelJS); const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js'; s.onload = () => (window.ExcelJS ? res(window.ExcelJS) : rej(new Error('ExcelJS no cargó'))); s.onerror = () => rej(new Error('No se pudo cargar ExcelJS')); document.head.appendChild(s); });
    const wb = new ExcelJS.Workbook(); wb.creator = 'Banco de Facturas';
    const ws = wb.addWorksheet('Documentos', { views: [{ state: 'frozen', ySplit: 3 }] });
    ws.addRow([`${d.titulo} (${d.filas.length}) · ${REPING.desde} a ${REPING.hasta}`]).font = { bold: true, size: 13, color: { argb: 'FF1D4ED8' } };
    ws.addRow([]);
    const cols = ['Fecha', 'Pedido', 'Factura', 'Proveedor', 'Marca · sede', 'Analista de la sede', 'Total', d.col5];
    const t = ws.addRow(cols); t.font = { bold: true, color: { argb: 'FFFFFFFF' } }; t.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } }; });
    d.filas.forEach((f) => ws.addRow([f.fecha, f.pedido, f.factura, f.proveedor, f.donde, f.analista, f.total, f.motivo]));
    [11, 11, 14, 34, 24, 26, 14, 70].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    ws.getColumn(7).numFmt = '#,##0'; ws.getColumn(8).alignment = { wrapText: true, vertical: 'top' };
    ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: cols.length } };
    repIngBajar(new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), d.archivo + '.xlsx');
  } catch (e) { alert('No pude armar el Excel: ' + e.message); }
}
function reporteIngListaPdf() {
  const d = repIngListaDatos(); if (!d || !d.filas.length) return;
  try {
    const { jsPDF } = window.jspdf || {}; if (!jsPDF) throw new Error('no cargó el generador de PDF (recarga la página)');
    const pdf = new jsPDF('l', 'mm', 'a4'), W = 297, M = 10;
    const cols = [{ t: 'Fecha', w: 20 }, { t: 'Pedido', w: 22 }, { t: 'Factura', w: 24 }, { t: 'Proveedor', w: 55 }, { t: 'Marca · sede', w: 40 }, { t: 'Total', w: 24, der: true }, { t: d.col5, w: W - 2 * M - 185 }];
    let y = 0, pag = 0;
    const encabezado = () => {
      pag++; if (pag > 1) pdf.addPage();
      pdf.setFillColor(29, 78, 216); pdf.rect(0, 0, W, 16, 'F'); pdf.setTextColor(255); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(13);
      pdf.text(`${d.titulo} (${d.filas.length})`, M, 10.5); pdf.setFontSize(9); pdf.setFont('helvetica', 'normal');
      pdf.text(`Banco de Facturas · ${REPING.desde} a ${REPING.hasta} · página ${pag}`, W - M, 10.5, { align: 'right' });
      y = 23; pdf.setFillColor(241, 245, 249); pdf.rect(M, y - 4.5, W - 2 * M, 6.5, 'F'); pdf.setTextColor(30, 41, 59); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8.5);
      let x = M; cols.forEach((c) => { pdf.text(c.t, c.der ? x + c.w - 1.5 : x + 1.5, y, c.der ? { align: 'right' } : undefined); x += c.w; }); y += 6; pdf.setFont('helvetica', 'normal');
    };
    encabezado();
    for (const f of d.filas) {
      const vals = [f.fecha, f.pedido, f.factura, f.proveedor, f.donde, f.total != null ? '$' + f.total.toLocaleString('es-CO') : '', f.motivo];
      const lineas = vals.map((v, i) => pdf.splitTextToSize(String(v || ''), cols[i].w - 3).slice(0, 4));
      const alto = Math.max(...lineas.map((l) => l.length)) * 3.6 + 1.6;
      if (y + alto > 200) encabezado();
      let x = M; pdf.setFontSize(8); pdf.setTextColor(30, 41, 59);
      lineas.forEach((l, i) => { const c = cols[i]; if (i === 1 || i === 2) pdf.setFont('helvetica', 'bold'); pdf.text(l, c.der ? x + c.w - 1.5 : x + 1.5, y, c.der ? { align: 'right' } : undefined); pdf.setFont('helvetica', 'normal'); x += c.w; });
      y += alto; pdf.setDrawColor(226, 232, 240); pdf.line(M, y - 3, W - M, y - 3);
    }
    pdf.save(d.archivo + '.pdf');
  } catch (e) { alert('No pude armar el PDF: ' + e.message); }
}
function repIngListaHtml(F) {
  const ver = REPING.ver; if (!ver) return '';
  const e = repIngEsc, R = ReporteIngresos, L = repIngFiltrar(F, ver);
  const titulo = `${R.COMO[ver.como] || ver.como}${ver.analista ? ' · ' + ver.analista : ''}`;
  const filas = L.map((f) => `<tr style="border-top:1px solid var(--line)">
      <td style="padding:3px 8px;white-space:nowrap">${e(f.dia || '')}</td><td style="padding:3px 8px;white-space:nowrap"><b>${e(f.pedido || '')}</b></td>
      <td style="padding:3px 8px;white-space:nowrap"><b>${e(f.factura || '—')}</b></td><td style="padding:3px 8px">${e(f.proveedor || '')}</td>
      <td style="padding:3px 8px">${e([f.marca, f.sede].filter(Boolean).join(' · '))}</td>
      <td style="padding:3px 8px;text-align:right;white-space:nowrap">${f.total != null ? '$' + Number(f.total).toLocaleString('es-CO') : ''}</td>
      <td style="padding:3px 8px">${f.num_ingreso ? e(f.num_ingreso) : ''}${ver.como !== 'AGENTE' && (f.etapa_error || f.error || f.estado_cola) ? `<div class="mut" style="font-size:12px">${e([f.estado_cola === 'PENDIENTE_REINTENTO' ? 'en cola (reintentando)' : f.estado_cola === 'ERROR' ? 'en cola con error' : (ver.como === 'PENDIENTE' && !f.estado_cola ? 'sin lanzar al agente' : ''), f.etapa_error, f.error].filter(Boolean).join(' · ').slice(0, 220))}</div>` : (ver.como === 'PENDIENTE' && !f.estado_cola ? '<span class="mut" style="font-size:12px">sin lanzar al agente</span>' : '')}</td></tr>`).join('');
  return `<div id="repIngLista" style="margin-top:12px;border:2px solid #1d4ed8;border-radius:10px;padding:8px 10px">
    <div class="row" style="align-items:center;gap:8px"><b style="flex:1">📄 ${e(titulo)} (${L.length})</b>${L.length ? '<button class="s" onclick="reporteIngListaExcel()">⬇ Excel</button><button class="s" onclick="reporteIngListaPdf()">⬇ PDF</button>' : ''}<button class="s" onclick="REPING.ver=null;reporteIngPintar()">✕ Cerrar</button></div>
    ${L.length ? `<div style="overflow-x:auto;max-height:420px;overflow-y:auto;margin-top:6px"><table style="border-collapse:collapse;font-size:13px;min-width:100%"><tr class="mut" style="text-align:left"><th style="padding:3px 8px">Fecha</th><th style="padding:3px 8px">Pedido</th><th style="padding:3px 8px">Factura</th><th style="padding:3px 8px">Proveedor</th><th style="padding:3px 8px">Marca · sede</th><th style="padding:3px 8px;text-align:right">Total</th><th style="padding:3px 8px">${ver.como === 'AGENTE' || ver.como === 'ANALISTA_DIRECTO' ? 'N° ingreso ERP' : 'Estado / motivo'}</th></tr>${filas}</table></div>` : '<div class="mut">No hay documentos.</div>'}</div>`;
}

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
      ${kpi('Ingresados al ERP', r.ingresados.toLocaleString('es-CO'), r.pendiente ? `<a href="javascript:void 0" onclick="reporteIngVer('PENDIENTE',null)" style="color:#1d4ed8;font-weight:700">${r.pendiente} pendiente(s) — ver cuáles</a>` : '0 pendientes', 'inherit')}
      ${kpi('🤖 Los hizo el agente', r.pct_agente + '%', `${r.agente} documento(s)${r.reintentos ? ` · ${r.reintentos} necesitaron reintentos` : ''}`, '#15803d')}
      ${kpi('👤 Los terminó el analista', r.pct_analista + '%', `${r.tras_fallo} tras falla del agente · ${r.directo} sin pasar por el agente`, '#b45309')}
      ${kpi('Falla del agente', r.pct_falla_agente + '%', 'de lo que el agente intentó, lo que tuvo que terminar el analista', '#b91c1c')}</div>`;
    const tabla = (cols, filas) => `<div style="overflow-x:auto;margin-top:6px"><table style="border-collapse:collapse;font-size:13px;min-width:100%"><tr class="mut" style="text-align:left">${cols.map((c, i) => `<th style="padding:3px 8px;${i ? 'text-align:right' : ''}">${c}</th>`).join('')}</tr>${filas.map((f) => `<tr style="border-top:1px solid var(--line)">${f.map((v, i) => `<td style="padding:3px 8px;${i ? 'text-align:right' : ''}">${v}</td>`).join('')}</tr>`).join('')}</table></div>`;
    const barra = (p) => `<span style="display:inline-block;width:60px;height:8px;background:#fee2e2;border-radius:4px;vertical-align:middle;margin-right:6px"><span style="display:block;height:8px;width:${Math.min(100, p)}%;background:#16a34a;border-radius:4px"></span></span>${p}%`;
    h += `<h4 style="margin:14px 0 2px">Por analista</h4>` + tabla(['Analista', 'Ingresados', '🤖 Agente', '👤 Tras falla', '👤 Directo', 'Pendientes', '% agente'],
      R.porAnalista(F).map((a) => { const n = e(a.nombre).replace(/'/g, '&#39;'), lk = (como, v) => (v ? `<a href="javascript:void 0" onclick="reporteIngVer('${como}','${n}')" title="Ver cuáles son" style="color:#1d4ed8;font-weight:700;text-decoration:underline">${v}</a>` : '0');
        return [e(a.nombre), a.ingresados, lk('AGENTE', a.agente), lk('ANALISTA_TRAS_FALLO', a.tras_fallo), lk('ANALISTA_DIRECTO', a.directo), lk('PENDIENTE', a.pendiente), barra(a.pct_agente)]; }))
      + `<div class="mut" style="font-size:12px;margin-top:2px">Toca un número para ver cuáles son esos documentos.</div>` + repIngListaHtml(F);
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
    REPING.ver = null;
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
