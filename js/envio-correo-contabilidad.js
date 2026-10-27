// ============================================================
//  envio-correo-contabilidad.js  -  ENVIO A CONTABILIDAD POR CORREO DESDE EL BANCO + EXCEL DE TODOS LOS DOCUMENTOS (27/10/2026)
// ============================================================
// Pedido del usuario: «De contabilidad me dicen que faltan muchos por envios, pero todos ya estan ingresados al ERP. Quiero
// descargar un Excel con todos los documentos y, para mayor trazabilidad, enviar tanto el Excel como el ZIP desde el banco,
// directo al correo».
//   - «📧 Enviar por correo y marcar»: en el envio preparado. Arma el ZIP (partido si pesa mucho para un correo) y los Excel,
//     los guarda en el bucket «facturas» (carpeta contabilidad/<referencia>/), los pone en la cola de correos (correo_cola: los
//     manda el servidor o el vigilante, como los pedidos al proveedor) con copia a compras, y marca el lote como enviado con el
//     correo y la referencia. En «📦 Enviadas» cada lote muestra a que correo se mando y si los correos ya salieron.
//   - «📧 Enviar por correo» en un lote ya enviado: lo manda otra vez (no cambia nada de lo marcado).
//   - «📊 Excel de TODOS los documentos»: cada documento del banco con su ingreso ERP, si ya se envio (lote, fecha, quien,
//     correo) o por que no. 123 Wok va en su propia hoja.
// Logica pura en js/envio-contabilidad.js; tablas en supabase/envio_contabilidad_correo.sql. Nombres globales con prefijo cont.
var CONT_CORREOS = new Map();   // id de correo_cola -> { id, estado, ultimo_error, enviado_en }
var CONT_MAX_ZIP = 15 * 1024 * 1024;   // por correo: Gmail acepta ~25 MB y el adjunto crece un tercio al mandarlo
var CONT_COPIA = 'comprasrocoto@gmail.com';

function contCorreoValidar(texto) {
  const partes = String(texto || '').toLowerCase().split(/[,;\s]+/).filter(Boolean), ok = [], malos = [];
  for (const c of partes) { if (!/^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/.test(c)) malos.push(c); else if (!ok.includes(c)) ok.push(c); }
  if (!ok.length && !malos.length) return { ok: false, error: 'Escribe el correo de contabilidad.' };
  if (malos.length) return { ok: false, error: 'Correo no válido: ' + malos.join(', ') };
  if (ok.length > 5) return { ok: false, error: 'Máximo 5 correos.' };
  return { ok: true, texto: ok.join(', ') };
}
// el correo de contabilidad: el que se escribio en este navegador o, si no, el del ultimo lote mandado por correo
function contCorreoGuardado() {
  try { const v = localStorage.getItem('bf_correo_contabilidad'); if (v) return v; } catch (e) { /* sin storage */ }
  const l = (typeof CONT_LOTES !== 'undefined' ? CONT_LOTES : []).find((x) => x && x.correo_para && !x.anulado);
  return l ? l.correo_para : '';
}
function contCorreoRecordar(v) { try { localStorage.setItem('bf_correo_contabilidad', v); } catch (e) { /* sin storage */ } }

function contCorreoCajaHtml(n) {
  return `<div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap;align-items:center;padding:8px;border:1px dashed #93c5fd;border-radius:8px;background:#f8fbff">
    <span style="font-weight:700;color:#1e3a8a">📧 O mándalo directo desde el banco:</span>
    <input id="contCorreoPara" style="flex:1 1 240px;min-width:200px" placeholder="correo de contabilidad (varios: separados con coma)" value="${escAg(contCorreoGuardado())}">
    <button class="p" id="btnEnvioCorreo" onclick="contPrepEnviarCorreo()" ${n ? '' : 'disabled'} title="Manda el Excel y el ZIP de los marcados al correo (con copia a ${CONT_COPIA}) y los marca como enviados en un lote">📧 Enviar por correo y marcar (${n})</button>
    <div class="mut" style="flex-basis:100%">Sale del correo del banco con copia a ${CONT_COPIA}. Va UN correo con el Excel de contabilidad, el Excel organizado de Hiopos y el ZIP de PDF como adjuntos (solo si pesa demasiado, los PDF se parten en varios correos). Queda registrado en el lote: a qué correo, cuándo y si salió.</div></div>`;
}

async function contCargarEstadoCorreos() {
  const ids = [...new Set((CONT_LOTES || []).flatMap((l) => (l && l.correo_ids) || []))];
  CONT_CORREOS = new Map();
  for (let i = 0; i < ids.length; i += 200) {
    const r = await SB.from('correo_cola').select('id,estado,ultimo_error,enviado_en').in('id', ids.slice(i, i + 200));
    (r.data || []).forEach((c) => CONT_CORREOS.set(Number(c.id), c));
  }
}
function contCorreoLoteHtml(l) {
  if (!l || !l.correo_para) return '';
  const e = EnvioContabilidad.estadoCorreos((l.correo_ids || []).map((id) => CONT_CORREOS.get(Number(id))).filter(Boolean));
  const color = e.errores ? '#b45309' : e.total && e.enviados === e.total ? '#15803d' : '#1e3a8a';
  return ` <span class="badge" style="color:${color};border-color:${color}">📧 ${escAg(l.correo_para)}${l.referencia ? ' · ' + escAg(l.referencia) : ''}${e.texto ? ' · ' + escAg(e.texto) : ''}</span>`;
}

// ---- (27/10/2026) el envio en dos pasos: ARMAR (ZIP de PDF + Excel; asi se sabe que PDF no bajaron) y MANDAR (ya con el numero de lote,
// que va en el asunto: «Envío de Facturas Rocoto Provenza Lote 33 27 de Octubre»).
async function contArmarPaquete(docs, res) {
  const z = await bajarPdfsEnZip(docs, BancoUtils.nombreArchivoCiclo, 'envio.zip', res, { foto: true, devolver: true, maxBytes: CONT_MAX_ZIP });
  const fall = new Set(z.fallCufes || []);
  const enZip = docs.filter((f) => !fall.has(f.cufe));
  if (!enZip.length) throw new Error('no pude bajar ningún PDF de estos documentos');
  res.textContent = 'Armando el Excel de contabilidad...';
  const x1 = await descargarContabilidad(enZip, 'contabilidad.xlsx', { devolver: true });
  if (!x1 || !x1.blob) throw new Error('no pude armar el Excel de contabilidad');
  let x2 = null;
  try { res.textContent = 'Armando el Excel organizado de Hiopos...'; x2 = await contOrganizadoHiopos(enZip, 'envio', { devolver: true }); } catch (e) { x2 = null; }
  return { enZip, fallCufes: [...fall], partes: z.partes, xls: x1.blob, xlsHiopos: x2 && x2.blob ? x2.blob : null };
}

// Manda un paquete armado. UN correo con el Excel y el ZIP de PDF como adjuntos separados (pedido del usuario: «el excel y el zip
// en el mismo correo»). La cola adjunta UN archivo por correo, asi que se sube un «paquete» (…__adjuntos.zip) y el programa que
// envia (agent_factura_v2/enviar-correo.js) lo abre y adjunta cada archivo por separado. Si el ZIP pesa demasiado, las partes
// 2, 3… van en correos aparte. -> { ids, archivos }
async function contMandarPaquete(pq, o) {
  const res = o.res || { textContent: '' }, ref = o.ref, lote = o.lote;
  const nombreSede = (id) => { const s = (typeof sedes !== 'undefined' ? sedes : []).find((x) => x.id === id); return s ? { sede: s.nombre, marca: s.marcas && s.marcas.nombre ? s.marcas.nombre : '' } : { sede: 'Sin sede', marca: '' }; };
  const titulo = EnvioContabilidad.asuntoEnvio({ lote, fechaMs: Date.now(), sedes: pq.enZip.map((f) => nombreSede(f.sede_id)) });
  const base = EnvioContabilidad.nombreArchivo(titulo);
  const carpeta = 'contabilidad/' + ref + (lote ? '-lote' + lote : '') + '/';
  const nZ = pq.partes.length;
  // parte 1: paquete con los Excel + el ZIP de PDF (se guarda sin comprimir: lo de adentro ya viene comprimido)
  const pdfZip = (i) => base + (nZ > 1 ? ' - PDF parte ' + (i + 1) + ' de ' + nZ : ' - PDF') + '.zip';
  const paq = new JSZip();
  paq.file(base + ' - Contabilidad.xlsx', pq.xls);
  if (pq.xlsHiopos) paq.file(base + ' - Organizado Hiopos.xlsx', pq.xlsHiopos);
  paq.file(pdfZip(0), pq.partes[0].blob);
  const archivos = [{ nombre: base + '__adjuntos.zip', blob: await paq.generateAsync({ type: 'blob', compression: 'STORE' }),
    adentro: [base + ' - Contabilidad.xlsx'].concat(pq.xlsHiopos ? [base + ' - Organizado Hiopos.xlsx'] : [], [pdfZip(0) + ' (' + pq.partes[0].n + ' PDF)']) }];
  for (let i = 1; i < nZ; i++) archivos.push({ nombre: pdfZip(i), blob: pq.partes[i].blob, adentro: [pdfZip(i) + ' (' + pq.partes[i].n + ' PDF)'] });
  for (let i = 0; i < archivos.length; i++) {
    const a = archivos[i]; res.textContent = 'Guardando en el banco ' + (i + 1) + ' de ' + archivos.length + '...';
    const ruta = carpeta + EnvioContabilidad.nombreArchivo(a.nombre).replace(/ /g, '_');
    const up = await SB.storage.from('facturas').upload(ruta, a.blob, { upsert: false, contentType: 'application/zip' });
    if (up.error) throw new Error('no pude guardar ' + a.nombre + ' en el banco: ' + up.error.message);
    a.ruta = ruta;
  }
  const money0 = (n) => '$' + Math.round(Number(n || 0)).toLocaleString('es-CO');
  const total = pq.enZip.reduce((s, f) => s + Number(f.total || 0), 0);
  const lineas = pq.enZip.map((f) => [(f.documento || ((f.prefijo || '') + (f.folio || ''))), f.emisor || '', nombreSede(f.sede_id).sede, f.num_ingreso || '', money0(f.total)].join(' | '));
  const cab = titulo + '\nDocumentos: ' + pq.enZip.length + '  ·  Total: ' + money0(total) + '\nReferencia: ' + ref +
    '\nEnviado por: ' + ((typeof perfil !== 'undefined' && perfil && perfil.nombre) || (typeof usuario !== 'undefined' && usuario && usuario.email) || '') + ' desde el Banco de Facturas';
  const ids = [];
  for (let i = 0; i < archivos.length; i++) {
    const a = archivos[i];
    const asunto = titulo + (nZ > 1 ? ' (' + (i + 1) + ' de ' + nZ + ')' : '');
    const cuerpo = cab + '\n\nAdjuntos de este correo:\n' + a.adentro.map((x) => '  · ' + x).join('\n') + (nZ > 1 ? '\n\nEste envío pesa mucho para un solo correo: va en ' + nZ + ' correos.' : '') +
      (i === 0 ? '\n\nDocumentos (Factura | Proveedor | Sede | Ingreso ERP | Total):\n' + lineas.join('\n') : '');
    const r = await SB.rpc('correo_encolar', { p_para: o.para, p_asunto: asunto, p_cuerpo: cuerpo, p_cufe: null, p_pedido: null, p_orden: null, p_archivo_pdf: a.ruta, p_cc: o.para.includes(CONT_COPIA) ? null : CONT_COPIA });
    if (r.error) throw new Error('no pude poner en la cola el correo' + (nZ > 1 ? ' ' + (i + 1) + ' de ' + nZ : '') + ': ' + r.error.message + (ids.length ? ' (' + ids.length + ' ya quedaron en la cola)' : ''));
    const fila = Array.isArray(r.data) ? r.data[0] : r.data; if (fila && fila.correo_id != null) ids.push(Number(fila.correo_id));
  }
  if (typeof csEnviarCola === 'function') csEnviarCola(true);   // que el servidor los mande ya (si no, el vigilante)
  return { ids, archivos: archivos.map((a) => a.ruta), nCorreos: archivos.length, titulo };
}

async function contPrepEnviarCorreo() {
  if (!CONT_PREP) return;
  const v = EnvioContabilidad.vigentes(CONT_PREP, contPendientes().lista), sel = EnvioContabilidad.seleccion(CONT_PREP, v.docs);
  if (!sel.length) return;
  const val = contCorreoValidar(($('contCorreoPara') || {}).value);
  if (!val.ok) { alert(val.error); return; }
  if (!confirm('¿Mandar a ' + val.texto + ' (con copia a ' + CONT_COPIA + ') el Excel y el ZIP de estos ' + sel.length + ' documento(s), y marcarlos como ENVIADOS a contabilidad?\n\nLos desmarcados (' + (v.docs.length - sel.length) + ') siguen pendientes.')) return;
  contCorreoRecordar(val.texto);
  const res = $('envioRes') || $('resdesc'), b = $('btnEnvioCorreo'); if (b) b.disabled = true;
  const ref = EnvioContabilidad.referencia();
  // 1. armar (si falla, no se marca ni se manda nada)
  let pq;
  try { pq = await contArmarPaquete(sel, res); }
  catch (e) { if (b) b.disabled = false; res.textContent = '❌ No se envió ni se marcó nada: ' + e.message; alert('No se envió ni se marcó nada: ' + e.message); return; }
  // 2. marcar SOLO lo que fue en el ZIP (lo que no se pudo bajar sigue pendiente) -> numero de lote para el asunto
  const quien = (perfil && perfil.nombre) || (usuario && usuario.email) || null;
  const m = await SB.rpc('contabilidad_marcar', { p_cufes: pq.enZip.map((f) => f.cufe), p_nota: '📧 ' + val.texto + ' · ' + ref, p_usuario: quien });
  if (m.error) { if (b) b.disabled = false; res.textContent = '❌ No se envió ni se marcó nada: ' + m.error.message; alert(res.textContent); return; }
  const d = m.data || {};
  CONT_PREP = null; contPrepGuardar();
  // 3. mandar el correo con el lote en el asunto
  try {
    const r = await contMandarPaquete(pq, { para: val.texto, ref, res, lote: d.lote });
    await SB.rpc('contabilidad_lote_correo', { p_lote: d.lote, p_para: val.texto, p_ids: r.ids, p_archivos: r.archivos, p_ref: ref }).then(() => {}, () => {});
    await cargarEnvioContabilidad(); pintar();
    alert('✅ «' + r.titulo + '»: ' + d.marcadas + ' documento(s) enviados a ' + val.texto + (r.nCorreos > 1 ? ' en ' + r.nCorreos + ' correos' : ' en un correo') + ', con copia a ' + CONT_COPIA + '.' +
      (pq.fallCufes.length ? '\n\n⚠️ ' + pq.fallCufes.length + ' PDF no se pudieron bajar: NO se mandaron y siguen pendientes.' : '') +
      '\n\nEn «📦 Enviadas a contabilidad» ves si el correo ya salió.');
  } catch (e) {
    await cargarEnvioContabilidad(); pintar();
    alert('⚠️ Los documentos quedaron marcados en el lote ' + d.lote + ', pero el correo NO salió: ' + e.message + '\n\nVe a «📦 Enviadas a contabilidad» y pulsa «📧 Enviar por correo» en el lote ' + d.lote + '.');
  }
}

async function contReenviarLote(lote) {
  const docs = facturas.filter((f) => { const e = CONT_ENV.get(f.cufe); return e && e.lote === lote; });
  if (!docs.length) { alert('No encuentro los documentos de este lote con el filtro actual.'); return; }
  const para = prompt('¿A qué correo mando el Excel y el ZIP del lote ' + lote + ' (' + docs.length + ' documento(s))?\nVarios: sepáralos con coma. Va con copia a ' + CONT_COPIA + '. No cambia nada de lo marcado.', contCorreoGuardado());
  if (para === null) return;
  const val = contCorreoValidar(para); if (!val.ok) { alert(val.error); return; }
  contCorreoRecordar(val.texto);
  const res = $('envioRes') || $('resdesc'), ref = EnvioContabilidad.referencia();
  try {
    const pq = await contArmarPaquete(docs, res);
    const r = await contMandarPaquete(pq, { para: val.texto, ref, res, lote });
    await SB.rpc('contabilidad_lote_correo', { p_lote: lote, p_para: val.texto, p_ids: r.ids, p_archivos: r.archivos, p_ref: ref }).then(() => {}, () => {});
    await cargarEnvioContabilidad(); pintar();
    alert('✅ «' + r.titulo + '» mandado a ' + val.texto + (r.nCorreos > 1 ? ' en ' + r.nCorreos + ' correos.' : ' en un correo.') + (pq.fallCufes.length ? '\n⚠️ ' + pq.fallCufes.length + ' PDF no se pudieron bajar y no fueron.' : ''));
  } catch (e) { if (res) res.textContent = '❌ ' + e.message; alert('No se pudo mandar: ' + e.message); }
}

// ---------------------------------------------------------------- EXCEL DE TODOS LOS DOCUMENTOS
async function contTodas(tabla, cols, orden, filtro) {
  const out = [];
  for (let i = 0; ; i += 1000) {
    let q = SB.from(tabla).select(cols).order(orden).range(i, i + 999);
    if (filtro) q = filtro(q);
    const r = await q; if (r.error) throw new Error(tabla + ': ' + r.error.message);
    out.push(...(r.data || [])); if (!r.data || r.data.length < 1000) break;
  }
  return out;
}
async function contExcelTodos() {
  const res = $('envioRes') || $('resdesc'), aviso = (t) => { if (res) res.textContent = t; };
  try {
    aviso('Leyendo todos los documentos del banco...');
    const docs = await contTodas('facturas', 'cufe,prefijo,folio,documento,emisor,nit_emisor,fecha_emision,total,num_ingreso,fecha_ingreso,estado,tipo,sede_id,marca_id,archivo_pdf,archivo_pdf_sellado', 'cufe');
    const env = EnvioContabilidad.indexar(await contTodas('contabilidad_envio', 'factura_cufe,lote_id,enviada_en', 'factura_cufe'));
    const lotes = new Map((CONT_LOTES || []).map((l) => [Number(l.id), l]));
    const peds = await contTodas('pedidos', 'id,numero,factura_cufe,sede_id', 'id', (q) => q.not('factura_cufe', 'is', null));
    const pedDe = new Map(peds.map((p) => [p.factura_cufe, p]));
    const marcas = new Map(((await SB.from('marcas').select('id,nombre')).data || []).map((m) => [m.id, m.nombre]));
    const sedeN = (id) => { const s = (typeof sedes !== 'undefined' ? sedes : []).find((x) => x.id === id); return s ? s.nombre : ''; };
    const est = { pool: 'Sin asignar', asignada: 'Asignada (sin sellar)', sellada: 'Sellada', pagada: 'Pagada', rechazada: 'Rechazada' };
    const co = (t) => { const x = t ? Date.parse(t) : NaN; return isNaN(x) ? '' : new Date(x - 5 * 3600000).toISOString().slice(0, 16).replace('T', ' '); };
    const ExcelJS = await new Promise((ok, mal) => { if (window.ExcelJS) return ok(window.ExcelJS); const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js'; s.onload = () => window.ExcelJS ? ok(window.ExcelJS) : mal(new Error('ExcelJS no cargó')); s.onerror = () => mal(new Error('No se pudo cargar ExcelJS')); document.head.appendChild(s); });
    aviso('Armando el Excel de ' + docs.length + ' documento(s)...');
    const COLS = ['Marca', 'Sede', 'Tipo', 'Documento', 'Proveedor', 'NIT', 'Fecha factura', 'Total', 'Ingreso ERP', 'Fecha ingreso ERP', 'Estado en el banco', 'Situación contabilidad', 'Lote', 'Fecha envío', 'Enviado por', 'Enviado al correo', 'Pedido web', 'CUFE'];
    const wb = new ExcelJS.Workbook(); wb.creator = 'Banco de Facturas';
    const resumen = wb.addWorksheet('Resumen');
    const hojas = { rocoto: wb.addWorksheet('Documentos', { views: [{ state: 'frozen', ySplit: 1 }] }), wok: wb.addWorksheet('123 Wok', { views: [{ state: 'frozen', ySplit: 1 }] }) };
    Object.values(hojas).forEach((h) => h.addRow(COLS));
    const cuenta = new Map();
    const orden = docs.slice().sort((a, b) => String(a.fecha_ingreso || a.fecha_emision || '').localeCompare(String(b.fecha_ingreso || b.fecha_emision || '')));
    for (const f of orden) {
      const p = pedDe.get(f.cufe), sid = f.sede_id != null ? f.sede_id : p ? p.sede_id : null;
      const marca = marcas.get(f.marca_id) || '';
      const e = env.get(f.cufe), l = e ? lotes.get(e.lote) || {} : {};
      const sit = EnvioContabilidad.situacion(Object.assign({}, f, { sede_id: sid }), env, BancoUtils.esTerminada);
      const fila = [marca, sedeN(sid) || 'Sin sede', f.tipo === 'nota_credito' ? 'Nota crédito' : f.tipo === 'cuenta_cobro' ? 'Cuenta de cobro' : 'Factura',
        f.documento || ((f.prefijo || '') + (f.folio || '')), f.emisor || '', f.nit_emisor || '', f.fecha_emision ? String(f.fecha_emision).slice(0, 10) : '', Number(f.total || 0),
        f.num_ingreso && f.num_ingreso !== 'null' ? f.num_ingreso : '', f.fecha_ingreso && f.fecha_ingreso !== 'null' ? String(f.fecha_ingreso).slice(0, 10) : '', est[f.estado] || f.estado || '',
        sit, e ? e.lote : '', e ? co(e.en || l.creado_en) : '', l.creado_por || '', l.correo_para || '', p ? p.numero || '' : '', f.cufe];
      const wok = /123\s*wok/i.test(marca);
      const hoja = wok ? hojas.wok : hojas.rocoto, r = hoja.addRow(fila);
      const c = r.getCell(12);
      c.font = { bold: true, color: { argb: /^Enviada/.test(sit) ? 'FF15803D' : /^Por enviar/.test(sit) ? 'FFB91C1C' : /^Sin ingreso|^Rechazada/.test(sit) ? 'FF6B7280' : 'FFB45309' } };
      const k = (wok ? '123 Wok' : marca || 'Sin marca') + '|' + sit.replace(/ \(SIN PDF.*$/, '');
      const x = cuenta.get(k) || { n: 0, t: 0 }; x.n++; x.t += Number(f.total || 0); cuenta.set(k, x);
    }
    Object.values(hojas).forEach((h) => {
      const enc = h.getRow(1); enc.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      enc.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } }; });
      COLS.forEach((c, i) => { const col = h.getColumn(i + 1); col.width = c === 'CUFE' ? 30 : c === 'Proveedor' ? 34 : c === 'Situación contabilidad' ? 34 : Math.max(c.length + 2, 13); if (c === 'Total') col.numFmt = '#,##0'; });
      h.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLS.length } };
    });
    resumen.addRow(['Excel de TODOS los documentos del Banco de Facturas']).font = { bold: true, size: 14 };
    resumen.addRow(['Generado: ' + co(new Date().toISOString()) + ' (hora Colombia) · ' + docs.length + ' documento(s)']);
    resumen.addRow([]);
    const h = resumen.addRow(['Marca', 'Situación contabilidad', 'Documentos', 'Total']); h.font = { bold: true };
    [...cuenta.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([k, v]) => { const [m, s] = k.split('|'); resumen.addRow([m, s, v.n, Math.round(v.t)]); });
    resumen.addRow([]);
    resumen.addRow(['«Por enviar» = ya tiene ingreso al ERP y todavía no ha salido en un envío a contabilidad desde el banco.']);
    resumen.addRow(['«Enviada a contabilidad» = salió en un lote (columna Lote / Fecha envío / Enviado al correo).']);
    resumen.getColumn(1).width = 22; resumen.getColumn(2).width = 40; resumen.getColumn(3).width = 12; resumen.getColumn(4).width = 18; resumen.getColumn(4).numFmt = '#,##0';
    const buf = await wb.xlsx.writeBuffer();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    a.download = 'Banco_de_Facturas_TODOS_los_documentos_' + BancoUtils.hoyColombia() + '.xlsx';
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    aviso('✅ Excel con ' + docs.length + ' documento(s) (hoja «Documentos», hoja «123 Wok» y «Resumen»).');
  } catch (e) { aviso('❌ No pude armar el Excel: ' + e.message); alert('No pude armar el Excel: ' + e.message); }
}
