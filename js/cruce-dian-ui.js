// ============================================================
//  cruce-dian-ui.js  -  MODULO "CRUCE DIAN"  (19/09/2026)
//  Pantalla operacional: responde "¿Que documentos tengo que ingresar hoy?". Solo muestra lo que requiere accion:
//    Facturas pendientes · Notas credito pendientes · Por revisar.   (lo ya ingresado, apartado, anulado, etc. queda en "Otros", cerrado)
//  El cruce DIAN / Web / ERP no ocupa columnas: esta en "Ver detalle del cruce".
//  NO hace calculos: usa el servicio de js/conciliacion-ui.js (lecturas, carga, SUBIR) y la logica pura de js/conciliacion.js. Sin IA.
//  Usa las globales de index.html: $, escAg, money.
// ============================================================
const CRUCE_ESTADO_CLS = { 'PENDIENTE DE INGRESO': 'st-pool', 'POR REVISAR': 'st-asignada', 'ERROR DE CONSULTA': '', INGRESADA: 'st-sellada', ANULADA: '', 'PROVEEDOR APARTADO': '', 'NOTA DÉBITO': '' };

function cruceSedeNombre(f) { const s = (conc.sedes || []).find((x) => x.id === f.sede_id); return s ? s.nombre : 'Sin sede'; }
const cruceNorm = (s) => Conciliacion.sinTildes(String(s == null ? '' : s)).toLowerCase().trim();

// Aplica los filtros (fecha de emision, proveedor, sede, documento) a una lista
function cruceFiltrar(lista) {
  const F = conc.filtro || {}, prov = cruceNorm(F.proveedor), q = cruceNorm(F.q);
  return lista.filter((f) => {
    if (F.desde && (!f.fecha || f.fecha < F.desde)) return false;
    if (F.hasta && (!f.fecha || f.fecha > F.hasta)) return false;
    if (prov && !(cruceNorm(f.proveedor).includes(prov) || String(f.nit || '').includes(prov.replace(/\D/g, '') || '@@'))) return false;
    if (F.sede === 'none' && f.sede_id != null) return false;
    if (F.sede && F.sede !== 'none' && String(f.sede_id) !== String(F.sede)) return false;
    if (q && !(cruceNorm(f.documento).includes(q) || cruceNorm(f.cufe).includes(q))) return false;
    return true;
  });
}
function cruceCambiaFiltro(campo, valor) { conc.filtro[campo] = valor; cruceDianTabla(); }
function cruceLimpiarFiltros() { conc.filtro = { desde: '', hasta: '', proveedor: '', sede: '', q: '' }; concPintar(); }
function cruceCambiaTab(t) { conc.tab = t; concPintar(); }
function cruceToggleOtros() { conc.verOtros = !conc.verOtros; concPintar(); }
function cruceOtrosTab(t) { conc.tabOtros = t; concPintar(); }

// ---------------------------------------------------------------- detalle del cruce
function cruceVerDetalle(i, deOtros) { conc.detalle = (deOtros ? conc.vistaOtros : conc.vista)[i] || null; concPintar(); }
function cruceCerrarDetalle() { conc.detalle = null; concPintar(); }
async function cruceAccionDetalle(accion) {
  const f = conc.detalle; if (!f) return;
  await concAccion(-1, accion, f);
  conc.detalle = null; concPintar();
}
function cruceMarca(ok, aviso) { return ok === true ? '<b style="color:#166534">✓</b>' : (aviso ? '<b style="color:#b45309">⚠</b>' : '<b style="color:#991b1b">✕</b>'); }
function cruceDetalleHtml() {
  const f = conc.detalle; if (!f) return '';
  const w = f.web || {}, e = f.erp || {}, R = Conciliacion.RESULTADO;
  const web = w.estado === 'EN_WEB' ? [true, 'EN WEB — el PDF ya está' + (f.web.pedido ? ' · pedido ' + f.web.pedido : '')]
    : w.estado === 'NO_ESTA_EN_WEB' ? [false, 'NO ESTÁ EN LA WEB — falta subir el PDF']
    : w.estado === 'DUPLICADA' ? [null, 'CUFE DISTINTO — hay otra factura con el mismo NIT y número'] : w.estado === 'ERROR' ? [null, 'ERROR DE CONSULTA — no se pudo leer la web'] : [null, '—'];
  const erp = e.estado === 'EN_ERP' ? [true, 'EN ERP · ' + (e.causacion || '') + ' (' + (e.fuente || '') + ')']
    : e.estado === 'NO_ESTA_EN_ERP' ? [false, 'NO ESTÁ EN EL ERP']
    : e.estado === 'PROBABLE' ? [null, 'PROBABLE · ' + (e.causacion || '') + ' — no es seguro']
    : e.estado === 'DESACTUALIZADO' ? [null, 'NO SE PUEDE CONFIRMAR — ' + (e.detalle || 'reporte desactualizado')]
    : e.estado === 'SIN_COBERTURA' ? [null, 'SIN COBERTURA — ' + (e.detalle || '')] : e.estado === 'ERROR' ? [null, 'ERROR DE CONSULTA — ' + (e.detalle || '')] : [null, '—'];
  const fila = (nombre, par, sub) => `<tr><td style="width:70px"><b>${nombre}</b></td><td style="width:34px;text-align:center;font-size:18px">${cruceMarca(par[0], par[0] === null)}</td><td>${escAg(par[1])}${sub ? `<div class="mut">${escAg(sub)}</div>` : ''}</td></tr>`;
  const b = (txt, acc, cls) => `<button class="${cls || ''}" style="margin:2px" onclick="cruceAccionDetalle('${acc}')">${txt}</button>`;
  let acc = '';
  if (f.resultado === R.REVISAR && f.candidatos.length) acc += b('✔ Es esa', 'es_esa', 's') + b('✖ No está en el ERP', 'no_esta');
  else if (f.resultado === R.REVISAR && f.causa !== 'ERP_DESACTUALIZADO') acc += b('✖ No está en el ERP', 'no_esta') + b('Marcar como ya ingresada…', 'ya_esta');
  else if (f.resultado === R.PENDIENTE && f.tipo !== 'nota_debito') acc += b('Marcar como ya ingresada…', 'ya_esta');
  else if (f.resultado === R.INGRESADA && e.fuente === 'confirmada a mano') acc += b('↩ Deshacer', 'deshacer');
  if (f.tipo === 'nota_credito' && [R.PENDIENTE, R.INGRESADA, R.REVISAR].includes(f.resultado)) acc += b('✏ Factura relacionada y causación', 'control');
  if (f.resultado === R.APARTADO) acc += b('↩ Volver a incluir', 'incluir');
  else if ([R.PENDIENTE, R.REVISAR].includes(f.resultado) && f.tipo !== 'nota_debito') acc += b('🚫 No lo manejo', 'apartar');
  const rel = f.tipo === 'nota_credito' ? `<div class="mut" style="margin-top:6px">↳ Factura relacionada: <b>${escAg(f.factura_relacionada || 'sin indicar')}</b> · Causación ERP: <b>${escAg(f.causacion || 'sin ingresar')}</b></div>` : '';
  const cls = CRUCE_ESTADO_CLS[f.estado] || '';
  return `<div style="position:fixed;inset:0;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;z-index:60;padding:12px" onclick="if(event.target===this)cruceCerrarDetalle()">
    <div class="card" style="max-width:660px;width:100%;max-height:90vh;overflow:auto;margin:0">
      <div class="row"><b style="font-size:16px">Detalle del cruce · ${escAg(f.documento)}</b><span class="sp"></span><button onclick="cruceCerrarDetalle()">Cerrar</button></div>
      <div class="mut" style="margin:6px 0">${escAg(f.clase || '')} · ${escAg(f.proveedor || '—')} · NIT ${escAg(f.nit || '—')} · ${escAg(f.fecha || '')} · ${f.total == null ? '' : escAg(money(f.total))} · Sede: ${escAg(cruceSedeNombre(f))}</div>
      <table style="margin:8px 0"><tbody>${fila('DIAN', [true, 'EN DIAN' + (f.r && f.r.estado ? ' — estado: ' + f.r.estado : '')])}${fila('WEB', web)}${fila('ERP', erp)}</tbody></table>
      <div style="margin:8px 0">Resultado: ${concBadge(f.estado, cls, f.estado === 'ERROR DE CONSULTA' ? CONC_ROJO : '')}</div>
      <div class="mut">${escAg(f.motivo || '')}</div>${rel}
      ${f.candidatos && f.candidatos.length ? `<div class="mut" style="margin-top:6px">Posible coincidencia: ${escAg(f.candidatos[0].detalle)}</div>` : ''}
      <div class="mut" style="margin-top:6px;font-size:11px;word-break:break-all">CUFE: ${escAg(f.cufe)}</div>
      <div class="row" style="margin-top:10px;gap:6px;flex-wrap:wrap">${acc}</div>
    </div></div>`;
}

// ---------------------------------------------------------------- piezas de la pantalla
function cruceBannerErp() {
  const fr = conc.res && conc.res.frescura, e = conc.erpInfo;
  const caja = (color, fondo, txt) => `<div style="border:1px solid ${color};background:${fondo};color:${color};border-radius:10px;padding:8px 12px;margin:8px 0">${txt}</div>`;
  if (!conc.res) return '';
  if (!e) return caja('#991b1b', '#fef2f2', '<b>Falta el reporte del ERP.</b> Sin él no se puede saber qué está ingresado: nada se muestra como pendiente. Carga el reporte “Documentos” de Hiopos.');
  const hace = fr && fr.horas != null ? 'hace ' + (fr.horas < 1 ? 'menos de 1' : Math.round(fr.horas)) + ' h' : 'de fecha desconocida';
  const cuando = fr && fr.datosA ? ' (' + new Date(fr.datosA).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) + ')' : '';
  if (fr && fr.aplica && !fr.ok) return caja('#991b1b', '#fef2f2', `<b>ERP desactualizado:</b> el reporte es ${hace}${cuando} y el máximo es ${fr.maxHoras} h. Si otra persona ya ingresó facturas, el cruce no lo sabe, así que nada se muestra como pendiente hasta que cargues un reporte nuevo de Hiopos.`);
  return caja('#166534', '#f0fdf4', `<b>ERP al día:</b> reporte ${hace}${cuando} · ${e.total} documentos del ${escAg(e.desde || '?')} al ${escAg(e.hasta || '?')}.`);
}
function cruceTarjeta(titulo, n, tab, color) {
  const on = conc.tab === tab;
  return `<div onclick="cruceCambiaTab('${tab}')" style="cursor:pointer;flex:1;min-width:130px;border:2px solid ${on ? color : 'var(--line)'};border-radius:12px;padding:10px 14px;background:${on ? 'rgba(0,0,0,.02)' : '#fff'}">
    <div class="mut" style="font-size:12px">${titulo}</div><div style="font-size:28px;font-weight:800;color:${color}">${n}</div></div>`;
}
function cruceFilaTabla(f, i, deOtros) {
  const R = Conciliacion.RESULTADO;
  const rel = f.tipo === 'nota_credito' ? `<div class="mut">↳ factura: <b>${escAg(f.factura_relacionada || 'sin indicar')}</b> · causación ERP: <b>${escAg(f.causacion || 'sin ingresar')}</b></div>` : '';
  const sinPdf = f.resultado === R.PENDIENTE && f.falta_pdf ? '<div class="mut">sin PDF en la web</div>' : '';
  const porQue = f.estado === 'POR REVISAR' || f.estado === 'ERROR DE CONSULTA' ? `<div class="mut">${escAg(f.motivo)}</div>` : '';
  return `<tr><td><b>${escAg(f.documento || '—')}</b>${sinPdf}${rel}${porQue}</td><td>${escAg(f.proveedor || '—')}<div class="mut">NIT ${escAg(f.nit || '—')}</div></td><td>${escAg(f.fecha || '')}</td>
    <td class="num">${f.total == null ? '' : escAg(money(f.total))}</td><td>${escAg(cruceSedeNombre(f))}</td>
    <td>${concBadge(f.estado, CRUCE_ESTADO_CLS[f.estado] || '', 'white-space:nowrap;' + (f.estado === 'ERROR DE CONSULTA' ? CONC_ROJO : ''))}</td>
    <td><button style="padding:3px 10px" onclick="cruceVerDetalle(${i}${deOtros ? ',true' : ''})">Ver detalle del cruce</button></td></tr>`;
}
function cruceTablaHtml(lista, vacio, deOtros) {
  const mostrar = lista.slice(0, 300);
  if (deOtros) conc.vistaOtros = mostrar; else conc.vista = mostrar;
  if (!lista.length) return `<div class="vacio">${vacio}</div>`;
  return `<div style="overflow-x:auto"><table><thead><tr><th>Documento</th><th>Proveedor</th><th>Fecha</th><th class="num">Total</th><th>Sede</th><th>Estado</th><th>Acción</th></tr></thead><tbody>${mostrar.map((f, i) => cruceFilaTabla(f, i, deOtros)).join('')}</tbody></table></div>${lista.length > 300 ? `<div class="mut">… y ${lista.length - 300} más: afina los filtros (o descarga el CSV).</div>` : ''}`;
}
const CRUCE_VACIO = { factura: 'No hay facturas pendientes de ingreso. ✅', nota_credito: 'No hay notas crédito pendientes de ingreso. ✅', revisar: 'Nada por revisar. ✅' };

// Solo la parte que cambia al filtrar (no se vuelve a dibujar todo: asi no se pierde el cursor al escribir)
function cruceDianTabla() {
  const el = $('cruceLista'); if (!el || !conc.res) return;
  const lista = cruceFiltrar(concFilasDeTab(conc.tab)), total = concFilasDeTab(conc.tab).length;
  el.innerHTML = `<div class="mut" style="margin:6px 0">${lista.length === total ? total + ' documento(s)' : lista.length + ' de ' + total + ' documento(s) con los filtros'}</div>` + cruceTablaHtml(lista, CRUCE_VACIO[conc.tab] || 'Nada por aquí.', false);
  const btn = $('cruceBtnSubir');
  if (btn) { const n = Conciliacion.seleccionarParaCarga(lista, conc.tab).length; btn.textContent = '⬆ SUBIR ' + (conc.tab === 'nota_credito' ? 'NOTAS CRÉDITO' : 'FACTURAS') + ' (' + n + ')'; }
}

function cruceDianPintar() {
  const raiz = $('cruceRaiz'); if (!raiz) return;
  const res = conc.res, s = res ? res.resumen : null, T = s ? s.porTipo : null, E = Conciliacion.ESTADO;
  const hora = (t) => (t ? new Date(t).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : '');
  let h = `<div class="card" style="margin:0 0 16px">
    <div class="row" style="gap:10px;flex-wrap:wrap"><div><h2 style="margin:0">🧾 Cruce DIAN</h2><div class="mut">¿Qué documentos tengo que ingresar hoy?</div></div><span class="sp"></span>
      <button onclick="concOtroDian()">📂 ${conc.tabla ? 'Otro Excel de la DIAN' : 'Cargar Excel de la DIAN'}</button>
      <label style="background:#0f766e;color:#fff;font-weight:700;padding:6px 12px;border-radius:9px;cursor:pointer;font-size:13px">📥 Cargar reporte del ERP<input type="file" accept=".csv,.xlsx,.xls" style="display:none" onchange="concLeerErp(event)"></label>
      <button onclick="concEjecutar({tipoLog:'conciliar'})" ${conc.tabla ? '' : 'disabled'}>🔄 Actualizar</button>
      <button onclick="concVerExcluidos()">🚫 Proveedores que no manejo (${conc.fuentes ? conc.fuentes.excluidos.length : '…'})</button></div>
    <div class="mut" id="concMsg" style="margin:6px 0">${escAg(conc.msg || '')}</div>${concPintarExcluidos()}`;
  if (!res) {
    h += `<div class="vacio" style="padding:28px 8px">${conc.ocupado ? '⏳ Leyendo la web, los pedidos y el reporte del ERP…' : 'Carga el <b>Excel de la DIAN</b> (documentos recibidos) y el <b>reporte “Documentos” del ERP</b> para ver qué facturas faltan por ingresar.'}</div></div>${cruceDetalleHtml()}`;
    raiz.innerHTML = h; return;
  }
  h += `<div class="mut" style="margin:2px 0">DIAN: <b>${conc.tabla.registros.length}</b> documentos leídos${conc.archivo ? ' (' + escAg(conc.archivo) + ')' : ''} · Web: <b>${conc.nFacturas}</b> facturas · última actualización ${escAg(hora(new Date()))}</div>`;
  h += cruceBannerErp();
  for (const k of Object.keys(conc.errores || {}).filter((x) => ['web', 'erp', 'pedidos', 'excluidos', 'alias', 'decisiones'].includes(x))) h += `<div style="color:#991b1b;margin:2px 0">⛔ No se pudo leer ${escAg(k)}: ${escAg(conc.errores[k])}. Esos documentos quedan como ERROR DE CONSULTA (no se suben).</div>`;
  if (conc.avisoAuditoria) h += `<div style="color:#b45309;margin:2px 0">⚠️ ${escAg(conc.avisoAuditoria)}</div>`;
  const nF = concFilasDeTab('factura').length, nN = concFilasDeTab('nota_credito').length, nR = concFilasDeTab('revisar').length;
  h += `<div class="row" style="gap:10px;margin:10px 0;align-items:stretch">${cruceTarjeta('Pendientes', nF + nN, 'factura', '#b45309')}${cruceTarjeta('Facturas', nF, 'factura', '#166534')}${cruceTarjeta('Notas crédito', nN, 'nota_credito', '#1e3a8a')}${cruceTarjeta('Por revisar', nR, 'revisar', '#7c3aed')}</div></div>`;
  h += concPintarCarga();
  const sedesPresentes = [...new Set(concFilasDeTab(conc.tab).map((f) => f.sede_id))];
  const F = conc.filtro;
  h += `<div class="card" style="margin:0 0 16px">
    <div class="row" style="gap:6px;margin-bottom:8px">${[['factura', 'Facturas pendientes', nF], ['nota_credito', 'Notas crédito pendientes', nN], ['revisar', 'Por revisar', nR]].map(([k, t, n]) => `<button class="chip ${conc.tab === k ? 'on' : ''}" onclick="cruceCambiaTab('${k}')">${t} (${n})</button>`).join('')}<span class="sp"></span>
      ${conc.tab === 'revisar' ? '' : `<button class="p" id="cruceBtnSubir" style="background:${conc.tab === 'nota_credito' ? '#1e3a8a' : '#166534'};border-color:${conc.tab === 'nota_credito' ? '#1e3a8a' : '#166534'};font-weight:800" onclick="concSubir('${conc.tab}')">⬆ SUBIR ${conc.tab === 'nota_credito' ? 'NOTAS CRÉDITO' : 'FACTURAS'} (${Conciliacion.seleccionarParaCarga(cruceFiltrar(concFilasDeTab(conc.tab)), conc.tab).length})</button>`}</div>
    <div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:6px">
      <label class="mut">Desde <input type="date" value="${escAg(F.desde)}" style="width:auto;margin:0" oninput="cruceCambiaFiltro('desde',this.value)"></label>
      <label class="mut">Hasta <input type="date" value="${escAg(F.hasta)}" style="width:auto;margin:0" oninput="cruceCambiaFiltro('hasta',this.value)"></label>
      <input placeholder="🔎 Proveedor o NIT" value="${escAg(F.proveedor)}" style="width:190px;margin:0" oninput="cruceCambiaFiltro('proveedor',this.value)">
      <select style="width:auto;margin:0" onchange="cruceCambiaFiltro('sede',this.value)"><option value="">Todas las sedes</option><option value="none" ${F.sede === 'none' ? 'selected' : ''}>Sin sede</option>${(conc.sedes || []).filter((x) => sedesPresentes.includes(x.id)).map((x) => `<option value="${x.id}" ${String(F.sede) === String(x.id) ? 'selected' : ''}>${escAg(x.nombre)}</option>`).join('')}</select>
      <input placeholder="🔎 Buscar documento" value="${escAg(F.q)}" style="width:170px;margin:0" oninput="cruceCambiaFiltro('q',this.value)">
      <button class="mut" style="padding:4px 10px" onclick="cruceLimpiarFiltros()">limpiar</button><span class="sp"></span><button onclick="concDescargarCsv()">⬇ CSV</button></div>
    <div id="cruceLista"></div></div>`;
  // Lo que NO requiere accion: cerrado por defecto
  const nIng = concFilasDeTab('ingresadas').length, nOtras = concFilasDeTab('otras').length, na = res.noAplica;
  h += `<div class="card" style="margin:0 0 16px"><div class="row"><div class="mut">Sin acción (no aparecen en la bandeja): <b>${nIng}</b> ya ingresadas · <b>${nOtras}</b> apartadas/anuladas/notas débito · <b>${na.emitidasPropias.length + na.otraEmpresa.length}</b> emitidas por nosotros o para otra empresa · <b>${na.otrosDocumentos.length}</b> otros documentos</div><span class="sp"></span>
    <button onclick="cruceToggleOtros()">${conc.verOtros ? 'Ocultar ▴' : 'Ver ingresadas y apartadas ▾'}</button></div>`;
  if (conc.verOtros) {
    const lista = concFilasDeTab(conc.tabOtros);
    h += `<div class="row" style="margin:8px 0;gap:6px"><button class="chip ${conc.tabOtros === 'ingresadas' ? 'on' : ''}" onclick="cruceOtrosTab('ingresadas')">Ingresadas (${nIng})</button><button class="chip ${conc.tabOtros === 'otras' ? 'on' : ''}" onclick="cruceOtrosTab('otras')">Apartadas, anuladas y notas débito (${nOtras})</button></div>${cruceTablaHtml(cruceFiltrar(lista), 'Nada por aquí.', true)}`;
  }
  h += `</div>${cruceDetalleHtml()}`;
  raiz.innerHTML = h;
  cruceDianTabla();
}
