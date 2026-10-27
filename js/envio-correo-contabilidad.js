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
    <div class="mut" style="flex-basis:100%">Sale del correo del banco con copia a ${CONT_COPIA}. Si el ZIP pesa mucho, se manda en varias partes. Queda registrado en el lote: a qué correo, cuándo y si salió.</div></div>`;
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

// ---- armar y poner en la cola los correos de un grupo de documentos -> { ids, archivos, fallCufes, enZip }
async function contEnviarPorCorreo(docs, o) {
  const res = o.res || { textContent: '' }, ref = o.ref, carpeta = 'contabilidad/' + ref + '/';
  const base = 'Envio_contabilidad_' + ref.replace(/^ENV-/, '');
  // 1. ZIP (en partes si pesa mucho)
  const z = await bajarPdfsEnZip(docs, BancoUtils.nombreArchivoCiclo, base + '.zip', res, { foto: true, devolver: true, maxBytes: CONT_MAX_ZIP });
  const fall = new Set(z.fallCufes || []);
  const enZip = docs.filter((f) => !fall.has(f.cufe));
  if (!enZip.length) throw new Error('no pude bajar ningún PDF de estos documentos');
  // 2. Excel de contabilidad y Excel organizado de Hiopos (este ultimo si se puede: nunca frena el envio)
  res.textContent = 'Armando el Excel de contabilidad...';
  const x1 = await descargarContabilidad(enZip, base + '.xlsx', { devolver: true });
  if (!x1 || !x1.blob) throw new Error('no pude armar el Excel de contabilidad');
  let x2 = null;
  try { res.textContent = 'Armando el Excel organizado de Hiopos...'; x2 = await contOrganizadoHiopos(enZip, base, { devolver: true }); } catch (e) { x2 = null; }
  // 3. guardar los archivos en el banco (bucket facturas) -> la cola los adjunta desde ahi
  const archivos = [{ nombre: base + '.xlsx', blob: x1.blob, que: 'Excel de contabilidad' }];
  if (x2 && x2.blob) archivos.push({ nombre: base + '_ORGANIZADO_HIOPOS.xlsx', blob: x2.blob, que: 'Excel organizado de Hiopos' });
  const nZ = z.partes.length;
  z.partes.forEach((p, i) => archivos.push({ nombre: base + (nZ > 1 ? '_parte' + (i + 1) + 'de' + nZ : '') + '.zip', blob: p.blob, que: 'ZIP de PDFs' + (nZ > 1 ? ' (parte ' + (i + 1) + ' de ' + nZ + ', ' + p.n + ' documento(s))' : ' (' + p.n + ' documento(s))') }));
  for (let i = 0; i < archivos.length; i++) {
    const a = archivos[i]; res.textContent = 'Guardando en el banco ' + (i + 1) + ' de ' + archivos.length + ': ' + a.nombre + '...';
    const up = await SB.storage.from('facturas').upload(carpeta + a.nombre, a.blob, { upsert: true, contentType: /\.zip$/.test(a.nombre) ? 'application/zip' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    if (up.error) throw new Error('no pude guardar ' + a.nombre + ' en el banco: ' + up.error.message);
    a.ruta = carpeta + a.nombre;
  }
  // 4. cuerpo: resumen + lista de documentos (asi el correo solo ya sirve de constancia)
  const money0 = (n) => '$' + Math.round(Number(n || 0)).toLocaleString('es-CO');
  const sedeN = (id) => { const s = (typeof sedes !== 'undefined' ? sedes : []).find((x) => x.id === id); return s ? s.nombre : 'Sin sede'; };
  const total = enZip.reduce((s, f) => s + Number(f.total || 0), 0);
  const lineas = enZip.map((f) => [(f.documento || ((f.prefijo || '') + (f.folio || ''))), f.emisor || '', sedeN(f.sede_id), f.num_ingreso || '', money0(f.total)].join(' | '));
  const cab = 'Envío a contabilidad desde el Banco de Facturas\nReferencia: ' + ref + (o.lote ? '  ·  Lote ' + o.lote : '') + '\nDocumentos: ' + enZip.length + '  ·  Total: ' + money0(total) +
    '\nEnviado por: ' + ((typeof perfil !== 'undefined' && perfil && perfil.nombre) || (typeof usuario !== 'undefined' && usuario && usuario.email) || '') +
    '\n\nEste envío va en ' + archivos.length + ' correo(s), uno por archivo:\n' + archivos.map((a, i) => '  ' + (i + 1) + '. ' + a.nombre + ' — ' + a.que).join('\n');
  const lista = '\n\nDocumentos (Factura | Proveedor | Sede | Ingreso ERP | Total):\n' + lineas.join('\n');
  // 5. a la cola: un correo por archivo
  const ids = [];
  for (let i = 0; i < archivos.length; i++) {
    const a = archivos[i];
    const asunto = '📤 Contabilidad ' + ref + (o.lote ? ' · lote ' + o.lote : '') + ' · ' + (i + 1) + ' de ' + archivos.length + ' · ' + a.que + ' · ' + enZip.length + ' doc(s)';
    const cuerpo = cab + '\n\nEste correo: ' + a.nombre + ' — ' + a.que + (i === 0 ? lista : '');
    const r = await SB.rpc('correo_encolar', { p_para: o.para, p_asunto: asunto, p_cuerpo: cuerpo, p_cufe: null, p_pedido: null, p_orden: null, p_archivo_pdf: a.ruta, p_cc: o.para.includes(CONT_COPIA) ? null : CONT_COPIA });
    if (r.error) throw new Error('no pude poner en la cola el correo ' + (i + 1) + ' de ' + archivos.length + ': ' + r.error.message + (ids.length ? ' (' + ids.length + ' ya quedaron en la cola)' : ''));
    const fila = Array.isArray(r.data) ? r.data[0] : r.data; if (fila && fila.correo_id != null) ids.push(Number(fila.correo_id));
  }
  if (typeof csEnviarCola === 'function') csEnviarCola(true);   // que el servidor los mande ya (si no, el vigilante)
  return { ids, archivos: archivos.map((a) => a.ruta), fallCufes: [...fall], enZip, nArchivos: archivos.length };
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
  let r;
  try { r = await contEnviarPorCorreo(sel, { para: val.texto, ref, res }); }
  catch (e) { if (b) b.disabled = false; res.textContent = '❌ No se envió ni se marcó nada: ' + e.message; alert('No se envió ni se marcó nada: ' + e.message); return; }
  // marcar SOLO lo que fue en el ZIP; lo que no se pudo bajar sigue pendiente
  const quien = (perfil && perfil.nombre) || (usuario && usuario.email) || null;
  const m = await SB.rpc('contabilidad_marcar', { p_cufes: r.enZip.map((f) => f.cufe), p_nota: '📧 ' + val.texto + ' · ' + ref, p_usuario: quien });
  if (m.error) { res.textContent = '⚠️ Los correos SÍ quedaron en la cola (' + ref + '), pero no se pudieron marcar como enviados: ' + m.error.message; alert(res.textContent); return; }
  const d = m.data || {};
  await SB.rpc('contabilidad_lote_correo', { p_lote: d.lote, p_para: val.texto, p_ids: r.ids, p_archivos: r.archivos, p_ref: ref }).then(() => {}, () => {});
  CONT_PREP = null; contPrepGuardar();
  await cargarEnvioContabilidad(); pintar();
  alert('✅ Lote ' + d.lote + ' (' + ref + '): ' + d.marcadas + ' documento(s) enviados a ' + val.texto + ' en ' + r.nArchivos + ' correo(s), con copia a ' + CONT_COPIA + '.' +
    (r.fallCufes.length ? '\n\n⚠️ ' + r.fallCufes.length + ' PDF no se pudieron bajar: NO se mandaron y siguen pendientes.' : '') +
    '\n\nEn «📦 Enviadas a contabilidad» ves si los correos ya salieron.');
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
    const r = await contEnviarPorCorreo(docs, { para: val.texto, ref, res, lote });
    await SB.rpc('contabilidad_lote_correo', { p_lote: lote, p_para: val.texto, p_ids: r.ids, p_archivos: r.archivos, p_ref: ref }).then(() => {}, () => {});
    await cargarEnvioContabilidad(); pintar();
    alert('✅ Lote ' + lote + ' mandado a ' + val.texto + ' (' + ref + ') en ' + r.nArchivos + ' correo(s).' + (r.fallCufes.length ? '\n⚠️ ' + r.fallCufes.length + ' PDF no se pudieron bajar y no fueron.' : ''));
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
