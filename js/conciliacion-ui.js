// ============================================================
//  conciliacion-ui.js  -  pantalla de la conciliacion DIAN <-> Web <-> ERP  (18/09/2026)
//  Botones SUBIR FACTURAS / SUBIR NOTAS CRÉDITO y la vista "Pendientes de ingreso".
//  La logica de decidir (que esta ingresado y que no) vive en js/conciliacion.js: pura, determinista y probada con node.
//  Este archivo solo lee las tablas, pinta y manda a la cola. NO usa IA. Usa las globales de index.html (SB, perfil, usuario, escAg, $, cargar, cr).
// ============================================================
let conc = { tabla: null, archivo: '', fuentes: null, res: null, tab: 'factura', carga: null, ocupado: false, msg: '', errores: {}, erpInfo: null, marcas: [], quiere: null, vista: [], nFacturas: 0, nPedidos: 0 };

const concUsuario = () => (typeof perfil !== 'undefined' && perfil && perfil.nombre) || (typeof usuario !== 'undefined' && usuario && usuario.email) || 'admin';
const concBadge = (txt, cls, st) => `<span class="badge ${cls || ''}" style="${st || ''}">${escAg(txt)}</span>`;
const CONC_ROJO = 'color:#991b1b;border-color:#fca5a5;background:#fef2f2';
const CONC_NOMBRE_TIPO = { factura: 'facturas', nota_credito: 'notas crédito' };

// ---------------------------------------------------------------- lectura de archivos
async function concFilas(file) {
  const nombre = file.name.toLowerCase();
  if (nombre.endsWith('.xlsx') || nombre.endsWith('.xls')) {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false });
  }
  const buf = await file.arrayBuffer(); let txt;
  try { txt = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { txt = new TextDecoder('windows-1252').decode(buf); }   // el CSV de Hiopos viene en Windows-1252 (tildes y Ñ)
  return Conciliacion.csvATabla(txt);
}
async function concLeerDian(ev) {
  const file = ev.target.files[0]; if (!file) return;
  try {
    conc.msg = 'Leyendo el Excel de la DIAN...'; concMsg();
    const t = BancoUtils.interpretarTablaDian(await concFilas(file));
    if (t.error) { alert(t.error); conc.quiere = null; return; }
    conc.tabla = t; conc.archivo = file.name;
    const q = conc.quiere; conc.quiere = null;
    if (q) await concSubir(q); else await concEjecutar({ tipoLog: 'conciliar' });
  } catch (e) { alert('No se pudo leer el archivo de la DIAN: ' + e.message); }
  finally { ev.target.value = ''; }
}
function concOtroDian() { conc.quiere = null; $('fileConcDian').click(); }

// Reporte "Documentos" de Hiopos -> copia en la base (solo agrega o actualiza por N. de causacion; nunca borra)
async function concLeerErp(ev) {
  const file = ev.target.files[0]; if (!file) return;
  try {
    conc.msg = 'Leyendo el reporte del ERP...'; concMsg();
    const t = Conciliacion.interpretarTablaErp(await concFilas(file));
    if (t.error) { alert(t.error); conc.msg = ''; concMsg(); return; }
    const s = t.resumen;
    if (!confirm('Reporte del ERP: ' + s.total + ' documentos (' + s.facturas + ' facturas y ' + s.notas + ' notas crédito) del ' + s.desde + ' al ' + s.hasta + '.' + (s.sinNumero ? '\n' + s.sinNumero + ' no traen número de factura en "Su Doc" (se comparan por proveedor y monto).' : '') +
      '\n\nSe guardan en la web como copia del ERP. Solo agrega o actualiza por N° de causación: no borra nada.\n\n¿Cargar?')) { conc.msg = ''; concMsg(); return; }
    const { data: id, error } = await SB.rpc('erp_carga_iniciar', { p_archivo: file.name, p_usuario: concUsuario() });
    if (error) throw new Error(error.message);
    const docs = t.docs.map((d) => ({ causacion: d.causacion, serie: d.serie, numero: d.numero, fecha: d.fecha, su_doc: d.su_doc, contacto: d.contacto, contacto_norm: d.contacto_norm, almacen: d.almacen, base: d.base, impuestos: d.impuestos, neto: d.neto, tipo: d.tipo, procesado: d.procesado }));
    for (let i = 0; i < docs.length; i += 500) {
      conc.msg = 'Guardando el reporte del ERP... ' + Math.min(i + 500, docs.length) + ' de ' + docs.length; concMsg();
      const r = await SB.rpc('erp_cargar_lote', { p_carga: id, p_docs: docs.slice(i, i + 500) });
      if (r.error) throw new Error(r.error.message);
    }
    const c = await SB.rpc('erp_carga_cerrar', { p_carga: id }); if (c.error) throw new Error(c.error.message);
    conc.msg = '';
    if (conc.tabla) await concEjecutar({ tipoLog: 'conciliar' }); else { conc.msg = '✅ Reporte del ERP cargado (' + s.total + ' documentos). Ahora sube el Excel de la DIAN con "SUBIR FACTURAS".'; concPintar(); }
  } catch (e) { conc.msg = ''; alert('No se pudo cargar el reporte del ERP: ' + e.message + '\n\n(Si dice que no existe la tabla, falta ejecutar banco_web/supabase/conciliacion.sql en Supabase.)'); concMsg(); }
  finally { ev.target.value = ''; }
}

// ---------------------------------------------------------------- lectura de las fuentes (Web, Pedidos, ERP)
async function concPaginar(fn) {
  const out = [];
  for (let d = 0; ; d += 1000) {
    const { data, error } = await fn(d, d + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}
const concIntentar = async (fn, errores, clave) => { try { return await fn(); } catch (e) { errores[clave] = String(e.message || e).slice(0, 200); return null; } };
const concNumErp = (d) => Object.assign({}, d, { base: Number(d.base) || 0, impuestos: Number(d.impuestos) || 0, neto: Number(d.neto) || 0 });

async function concCargarFuentes() {
  const errores = {};
  const [facturas, pedidos, erpDocs, cargas, alias, decisiones, marcas] = await Promise.all([
    concIntentar(() => concPaginar((a, b) => SB.from('facturas').select('cufe,nit_emisor,prefijo,folio,documento,tipo,estado,num_ingreso').order('cufe').range(a, b)), errores, 'web'),
    concIntentar(() => concPaginar((a, b) => SB.from('pedidos').select('numero,proveedor_texto,nit_proveedor,factura_cufe,pedido_erp,numero_factura').or('numero_factura.not.is.null,factura_cufe.not.is.null').order('id').range(a, b)), errores, 'pedidos'),
    concIntentar(() => concPaginar((a, b) => SB.from('erp_documento').select('causacion,serie,numero,fecha,su_doc,su_doc_clave,contacto,contacto_norm,almacen,base,impuestos,neto,tipo,procesado').order('causacion').range(a, b)), errores, 'erp'),
    concIntentar(async () => { const r = await SB.from('erp_carga').select('id,archivo,cargado_en,total,desde,hasta,cargado_por').not('total', 'is', null).order('id', { ascending: false }).limit(100); if (r.error) throw new Error(r.error.message); return r.data || []; }, errores, 'erp'),
    concIntentar(async () => { const r = await SB.from('proveedor_alias').select('nit,nombre_erp_norm'); if (r.error) throw new Error(r.error.message); return r.data || []; }, errores, 'alias'),
    concIntentar(async () => { const r = await SB.from('conciliacion_decision').select('cufe,decision,causacion_erp,factura_relacionada,nota'); if (r.error) throw new Error(r.error.message); return r.data || []; }, errores, 'decisiones'),
    concIntentar(async () => { const r = await SB.from('marcas').select('id,nombre,nit'); if (r.error) throw new Error(r.error.message); return r.data || []; }, errores, 'marcas'),
  ]);
  if (errores.alias) errores.erp = errores.erp || ('alias: ' + errores.alias);            // sin los alias confirmados no se puede juzgar el ERP con seguridad
  if (errores.decisiones) errores.erp = errores.erp || ('decisiones: ' + errores.decisiones);
  const docs = (erpDocs || []).map(concNumErp);
  const desdes = (cargas || []).map((c) => c.desde).filter(Boolean).sort();
  const hastas = (cargas || []).map((c) => c.hasta).filter(Boolean).sort();
  const erp = docs.length ? { docs, desde: desdes[0] || null, hasta: hastas[hastas.length - 1] || null, cargadoEn: cargas && cargas[0] ? cargas[0].cargado_en : null, archivo: cargas && cargas[0] ? cargas[0].archivo : '' } : null;
  return {
    marcas: marcas || [], nFacturas: (facturas || []).length, nPedidos: (pedidos || []).length,
    fuentes: { facturasWeb: facturas || [], pedidos: pedidos || [], erp, alias: (alias || []).map((a) => ({ nit: a.nit, nombre_norm: a.nombre_erp_norm })), decisiones: decisiones || [], errores },
  };
}

// ---------------------------------------------------------------- conciliar
async function concEjecutar(o) {
  o = o || {};
  if (conc.ocupado) return;
  conc.ocupado = true; conc.msg = 'Leyendo la web, los pedidos y el reporte del ERP...'; concPintar();
  try {
    const f = await concCargarFuentes();
    conc.fuentes = f.fuentes; conc.marcas = f.marcas; conc.nFacturas = f.nFacturas; conc.nPedidos = f.nPedidos; conc.errores = f.fuentes.errores;
    conc.erpInfo = f.fuentes.erp ? { desde: f.fuentes.erp.desde, hasta: f.fuentes.erp.hasta, cargadoEn: f.fuentes.erp.cargadoEn, total: f.fuentes.erp.docs.length, archivo: f.fuentes.erp.archivo } : null;
    concRecalcular();
    conc.msg = '';
    if (!o.silencioso) await concAuditoria(o.tipoLog || 'conciliar');
  } catch (e) { conc.msg = 'Error: ' + e.message; }
  finally { conc.ocupado = false; concPintar(); }
}
function concRecalcular() {
  conc.res = Conciliacion.conciliar(conc.tabla.registros, conc.fuentes, { nitsPropios: BancoUtils.nitsPropios(conc.marcas) });
}
// Auditoria: en "subir" se guarda TODO lo del tipo; en una simple revision, solo lo que no esta ingresado
async function concAuditoria(tipoLog) {
  try {
    const subir = tipoLog !== 'conciliar', tp = tipoLog === 'subir_notas_credito' ? 'nota_credito' : 'factura';
    const filas = conc.res.filas.filter((f) => (f.tipo === 'factura' || f.tipo === 'nota_credito') && (subir ? f.tipo === tp : f.resultado !== 'INGRESADA' && f.resultado !== 'ANULADA'));
    const rows = filas.map((f) => Conciliacion.filaAuditoria(f, 'conciliacion'));
    let id = null;
    for (let i = 0; i < Math.max(rows.length, 1); i += 500) {
      const r = await SB.rpc('conciliacion_registrar', { p_tipo: tipoLog, p_resumen: conc.res.resumen, p_filas: rows.slice(i, i + 500), p_corrida: id, p_usuario: concUsuario(), p_carga: null });
      if (r.error) throw new Error(r.error.message); id = r.data;
    }
    conc.corrida = id; conc.avisoAuditoria = '';
  } catch (e) { conc.avisoAuditoria = 'No se pudo guardar el registro de auditoría: ' + e.message; }
}

// ---------------------------------------------------------------- botones de la barra
async function concSubir(tipoDoc) {
  if (conc.ocupado) return;
  conc.tab = tipoDoc === 'nota_credito' ? 'nota_credito' : 'factura';
  if (!conc.tabla && typeof cr !== 'undefined' && cr && cr.tabla) { conc.tabla = cr.tabla; conc.archivo = 'el Excel de la DIAN ya leído'; }
  if (!conc.tabla) { conc.quiere = tipoDoc; conc.msg = ''; alert('Para buscar lo pendiente, elige el Excel que bajaste de la DIAN (el de "Documentos recibidos").'); $('fileConcDian').click(); return; }
  await concEjecutar({ tipoLog: tipoDoc === 'nota_credito' ? 'subir_notas_credito' : 'subir_facturas' });
  if (conc.res && !String(conc.msg).startsWith('Error')) concPreguntarCarga(tipoDoc);
}
async function concRevisar() {
  if (conc.ocupado) return;
  if (!conc.tabla && typeof cr !== 'undefined' && cr && cr.tabla) { conc.tabla = cr.tabla; conc.archivo = 'el Excel de la DIAN ya leído'; }
  if (!conc.tabla) { conc.quiere = null; alert('Elige el Excel que bajaste de la DIAN (el de "Documentos recibidos").'); $('fileConcDian').click(); return; }
  await concEjecutar({ tipoLog: 'conciliar' });
}
function concCerrar() { concDetenerTimer(); conc.carga = null; const p = $('panelConc'); if (p) p.remove(); }
function concDetenerTimer() { if (conc.carga && conc.carga.timer) { clearInterval(conc.carga.timer); conc.carga.timer = null; } }

// ---------------------------------------------------------------- correcciones de una persona (conocimiento estructurado, no IA)
async function concDecidir(f, decision, causacion, facturaRel, nota, candidato) {
  const nit = f.nit || '';
  const alias = candidato && candidato.doc ? Conciliacion.normalizarNombre(candidato.doc.contacto) : '';
  const { error } = await SB.rpc('conciliacion_decidir', { p_cufe: f.cufe, p_decision: decision, p_causacion: causacion || null, p_factura_rel: facturaRel || null, p_nota: nota || null,
    p_nit: decision === 'en_erp' ? nit : null, p_contacto_erp: candidato && candidato.doc ? candidato.doc.contacto : null, p_contacto_norm: decision === 'en_erp' ? alias : null,
    p_usuario: concUsuario(), p_documento: f.documento, p_proveedor: f.proveedor });
  if (error) throw new Error(error.message);
  const dec = conc.fuentes.decisiones.filter((d) => String(d.cufe).toLowerCase() !== f.cufe);
  const nueva = { cufe: f.cufe, decision: decision === 'ninguna' ? null : decision, causacion_erp: causacion ? String(causacion).replace(/[^A-Za-z0-9]/g, '').toUpperCase() : null, factura_relacionada: facturaRel || null, nota: nota || null };
  if (nueva.decision || nueva.factura_relacionada) dec.push(nueva);
  conc.fuentes.decisiones = dec;
  if (decision === 'en_erp' && alias && nit) conc.fuentes.alias.push({ nit, nombre_norm: alias });
  concRecalcular(); concPintar();
}
async function concAccion(i, accion) {
  const f = conc.vista[i]; if (!f) return;
  try {
    if (accion === 'es_esa') { const c = f.candidatos[0]; await concDecidir(f, 'en_erp', c.causacion, null, 'confirmada como la misma factura', c); }
    else if (accion === 'no_esta') { if (!confirm('Confirmas que ' + f.documento + ' (' + f.proveedor + ') NO está en el ERP?\nDeja de aparecer como dudosa y queda como pendiente de ingreso.')) return; await concDecidir(f, 'no_esta', null, f.factura_relacionada, 'confirmada como pendiente'); }
    else if (accion === 'ya_esta') {
      const c = prompt('¿Con qué número de causación quedó ' + f.documento + ' en el ERP? (ej. FCRC3423)\nDéjalo vacío para cancelar.'); if (!c || !c.trim()) return;
      await concDecidir(f, 'en_erp', c, f.factura_relacionada, 'confirmada a mano');
    } else if (accion === 'deshacer') { await concDecidir(f, 'ninguna', null, f.factura_relacionada, null); }
    else if (accion === 'control') {
      const rel = prompt('Nota crédito ' + f.documento + ' (' + f.proveedor + ')\n\n¿A qué factura corresponde? (ej. FE-9000)\nDéjalo vacío si no lo sabes: no se inventa.', f.factura_relacionada || ''); if (rel === null) return;
      const caus = prompt('¿Con qué número de causación quedó en el ERP? (ej. AAR18)\nDéjalo vacío si todavía no la has ingresado.', f.causacion || ''); if (caus === null) return;
      await concDecidir(f, caus.trim() ? 'en_erp' : 'ninguna', caus, rel.trim(), 'control de nota crédito');
    }
  } catch (e) { alert('No se pudo guardar: ' + e.message); }
}

// ---------------------------------------------------------------- SUBIR: confirmar, cargar con progreso, terminar
const CONC_EST = {
  PENDIENTE: ['PENDIENTE', ''], EN_PROCESO: ['EN PROCESO', 'st-asignada'], ESPERANDO_PDF: ['ESPERANDO EL PDF', 'st-pool'], SUBIENDO_PDF: ['SUBIENDO PDF', 'st-asignada'],
  PDF_SUBIDO: ['PDF SUBIDO', 'st-sellada'], ERROR: ['ERROR', 'ROJO'], OMITIDA: ['OMITIDA — YA EXISTE', ''],
};
function concMarcaDe(r) {
  const n = BancoUtils.soloDigitos(r.nitReceptor), m = conc.marcas.find((x) => BancoUtils.soloDigitos(x.nit) && BancoUtils.soloDigitos(x.nit) === n);
  return m ? m.id : null;
}
function concPreguntarCarga(tipoDoc) {
  const errs = Object.keys(conc.errores || {}).filter((k) => ['web', 'erp', 'pedidos'].includes(k));
  const lista = Conciliacion.seleccionarParaCarga(conc.res.filas, tipoDoc);
  const nombre = CONC_NOMBRE_TIPO[tipoDoc];
  conc.carga = { tipo: tipoDoc, fase: 'confirmar', items: lista.map((f) => ({ fila: f, estado: 'PENDIENTE', detalle: '' })), idx: 0, cancelar: false, marca: '', timer: null, audit: [], bloqueo: '' };
  if (errs.length || !conc.fuentes.erp) conc.carga.bloqueo = !conc.fuentes.erp && !errs.includes('erp') ? 'No hay reporte del ERP cargado. Carga el reporte "Documentos" de Hiopos (botón "Cargar reporte del ERP") y vuelve a intentar.' : 'No se pudo consultar: ' + errs.map((k) => k + ' (' + conc.errores[k] + ')').join(', ') + '. Una consulta que falla NO significa que el documento no exista, así que no se sube nada.';
  concPintar();
  const el = $('concCargaBox'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function concCancelar() {
  const c = conc.carga; if (!c) return;
  if (c.fase === 'procesando') { c.cancelar = true; c.msg = 'Se detiene después del documento en curso...'; concPintar(); return; }
  concDetenerTimer(); conc.carga = null; concPintar();
}
async function concIniciarCarga() {
  const c = conc.carga; if (!c || c.fase !== 'confirmar' || c.bloqueo || !c.items.length) return;
  const sinMarca = c.items.filter((it) => !concMarcaDe(it.fila.r));
  const sel = $('concMarca'); c.marca = sel ? sel.value : c.marca;
  if (sinMarca.length && !c.marca) { alert('Elige la marca a la que se suben los documentos cuyo receptor no coincide con ninguna marca (' + sinMarca.length + ').'); return; }
  c.fase = 'procesando'; c.cancelar = false; concPintar();
  await concProcesar(c.items);
}
// Fuentes RECIEN LEIDAS para UN documento (consultas puntuales), justo antes de cargarlo
async function concFuentesFrescas(f) {
  const k = Conciliacion.criteriosConsulta(f.r), errores = {};
  const uniq = (arr, key) => { const m = new Map(); arr.flat().filter(Boolean).forEach((x) => m.set(key(x), x)); return [...m.values()]; };
  const q = async (fn) => { const r = await fn(); if (r.error) throw new Error(r.error.message); return r.data || []; };
  const colsF = 'cufe,nit_emisor,prefijo,folio,documento,tipo,estado,num_ingreso', colsE = 'causacion,serie,numero,fecha,su_doc,su_doc_clave,contacto,contacto_norm,almacen,base,impuestos,neto,tipo,procesado', colsP = 'numero,proveedor_texto,nit_proveedor,factura_cufe,pedido_erp,numero_factura';
  const [fa, fb, ea, eb, pa, pb, alias, dec, carga] = await Promise.all([
    concIntentar(() => q(() => SB.from('facturas').select(colsF).eq('cufe', k.cufe)), errores, 'web'),
    concIntentar(() => q(() => SB.from('facturas').select(colsF).eq('nit_emisor', k.nit)), errores, 'web'),
    concIntentar(() => (k.digitos ? q(() => SB.from('erp_documento').select(colsE).ilike('su_doc_clave', '*' + k.digitos + '*')) : Promise.resolve([])), errores, 'erp'),
    concIntentar(() => (k.contactoNorm ? q(() => SB.from('erp_documento').select(colsE).eq('contacto_norm', k.contactoNorm)) : Promise.resolve([])), errores, 'erp'),
    concIntentar(() => (k.digitos ? q(() => SB.from('pedidos').select(colsP).ilike('numero_factura', '*' + k.digitos + '*')) : Promise.resolve([])), errores, 'pedidos'),
    concIntentar(() => q(() => SB.from('pedidos').select(colsP).eq('factura_cufe', k.cufe)), errores, 'pedidos'),
    concIntentar(() => q(() => SB.from('proveedor_alias').select('nit,nombre_erp_norm').eq('nit', k.nit)), errores, 'erp'),
    concIntentar(() => q(() => SB.from('conciliacion_decision').select('cufe,decision,causacion_erp,factura_relacionada,nota').eq('cufe', k.cufe)), errores, 'erp'),
    concIntentar(() => q(() => SB.from('erp_carga').select('desde,cargado_en').not('total', 'is', null).order('desde', { ascending: true }).limit(1)), errores, 'erp'),
  ]);
  const desde = carga && carga[0] ? carga[0].desde : null;
  return {
    facturasWeb: uniq([fa || [], fb || []], (x) => x.cufe), pedidos: uniq([pa || [], pb || []], (x) => x.numero + '|' + x.numero_factura),
    erp: desde ? { docs: uniq([ea || [], eb || []], (x) => x.causacion).map(concNumErp), desde } : null,
    alias: (alias || []).map((a) => ({ nit: a.nit, nombre_norm: a.nombre_erp_norm })), decisiones: dec || [], errores,
  };
}
async function concProcesar(items) {
  const c = conc.carga, total = c.items.length, opciones = { nitsPropios: BancoUtils.nitsPropios(conc.marcas) };
  for (const it of items) {
    if (c.cancelar) break;
    c.idx = c.items.indexOf(it) + 1; it.estado = 'EN_PROCESO'; it.detalle = 'volviendo a comprobar en la web y el ERP...'; concPintar();
    try {
      const v = Conciliacion.verificarAntesDeCargar(it.fila, await concFuentesFrescas(it.fila), opciones);
      const fv = v.fila || it.fila;
      if (!v.ok) {
        const etiqueta = { YA_EXISTE_EN_ERP: 'YA EXISTE EN EL ERP', YA_EXISTE_EN_WEB: 'YA EXISTE EN LA WEB', ERROR_DE_CONSULTA: 'ERROR DE CONSULTA' }[v.estado] || v.estado;
        it.estado = v.estado === 'ERROR_DE_CONSULTA' ? 'ERROR' : 'OMITIDA'; it.detalle = etiqueta + ' · ' + (v.motivo || '');
        c.audit.push(Object.assign(Conciliacion.filaAuditoria(fv, 'reverificacion'), { motivo: (etiqueta + ': ' + (v.motivo || '')).slice(0, 900) }));
      } else {
        const item = Object.assign(BancoUtils.itemsParaDescarga([{ r: it.fila.r }])[0], { tipo: it.fila.tipo });
        const marcaId = concMarcaDe(it.fila.r) || Number(c.marca);
        const { data, error } = await SB.rpc('dian_encolar', { p_items: [item], p_marca: marcaId, p_usuario: concUsuario() });
        if (error) throw new Error(error.message);
        const d = Array.isArray(data) ? data[0] : data;
        if (d && Number(d.ya_en_sistema)) { it.estado = 'OMITIDA'; it.detalle = 'YA EXISTE EN LA WEB (el banco ya la tiene)'; }
        else if (d && Number(d.invalidos)) { it.estado = 'ERROR'; it.detalle = 'sin CUFE o NIT válido'; }
        else { it.estado = 'ESPERANDO_PDF'; it.detalle = d && Number(d.ya_en_cola) ? 'ya estaba en la lista de descargas' : 'en la lista de descargas'; }
        c.audit.push(Object.assign(Conciliacion.filaAuditoria(fv, 'reverificacion'), { motivo: 'Re-verificada: sigue pendiente. ' + it.estado + ' — ' + it.detalle }));
      }
    } catch (e) { it.estado = 'ERROR'; it.detalle = String(e.message || e).slice(0, 300); }   // un error NO detiene el resto
    concPintar();
  }
  c.detenida = c.cancelar; c.fase = 'esperando'; c.cancelar = false; c.msg = '';
  await concGuardarAuditoriaCarga();
  concPintar();
  await concRefrescarCarga();
  if (!c.timer && c.fase === 'esperando') c.timer = setInterval(() => { concRefrescarCarga().catch((e) => console.warn('progreso carga:', e)); }, 10000);
}
async function concGuardarAuditoriaCarga() {
  const c = conc.carga; if (!c || !c.audit.length) return;
  try {
    const rows = c.audit.splice(0, c.audit.length);
    for (let i = 0; i < rows.length; i += 500) {
      const r = await SB.rpc('conciliacion_registrar', { p_tipo: c.tipo === 'nota_credito' ? 'subir_notas_credito' : 'subir_facturas', p_resumen: null, p_filas: rows.slice(i, i + 500), p_corrida: conc.corrida || null, p_usuario: concUsuario(), p_carga: null });
      if (r.error) throw new Error(r.error.message); if (!conc.corrida) conc.corrida = r.data;
    }
  } catch (e) { conc.avisoAuditoria = 'No se pudo guardar el registro de auditoría de la carga: ' + e.message; }
}
async function concRefrescarCarga() {
  const c = conc.carga; if (!c || c.fase === 'confirmar' || c.fase === 'procesando') return;
  const vivos = c.items.filter((it) => ['ESPERANDO_PDF', 'SUBIENDO_PDF'].includes(it.estado));
  for (let i = 0; i < vivos.length; i += 100) {
    const lote = vivos.slice(i, i + 100);
    const { data } = await SB.from('dian_descarga').select('cufe,estado,ultimo_error').in('cufe', lote.map((it) => it.fila.cufe));
    const por = Object.fromEntries((data || []).map((x) => [x.cufe, x]));
    for (const it of lote) {
      const x = por[it.fila.cufe];
      if (!x) { const w = await SB.from('facturas').select('cufe').eq('cufe', it.fila.cufe).limit(1); if (w.data && w.data.length) { it.estado = 'PDF_SUBIDO'; it.detalle = 'ya está en la web'; } continue; }
      if (x.estado === 'subida') { it.estado = 'PDF_SUBIDO'; it.detalle = 'subido a la web (Sin asignar)'; }
      else if (x.estado === 'bajando') { it.estado = 'SUBIENDO_PDF'; it.detalle = 'el robot lo está subiendo'; }
      else if (x.estado === 'error' || x.estado === 'agotado') { it.estado = 'ERROR'; it.detalle = (x.ultimo_error || 'error al subir el PDF').slice(0, 300); }
    }
  }
  const pendientes = c.items.some((it) => ['EN_PROCESO', 'ESPERANDO_PDF', 'SUBIENDO_PDF'].includes(it.estado) || (it.estado === 'PENDIENTE' && !c.detenida));
  if (!pendientes && c.fase !== 'fin') {
    c.fase = 'fin'; concDetenerTimer();
    c.items.forEach((it) => c.audit.push(Object.assign(Conciliacion.filaAuditoria(it.fila, 'carga'), { motivo: ((CONC_EST[it.estado] || [it.estado])[0] + ' · ' + it.detalle).slice(0, 900), resultado: it.estado })));
    await concGuardarAuditoriaCarga();
    try { if (typeof cargar === 'function') await cargar(); } catch (e) { /* refresco opcional */ }
    conc.fuentes && await concEjecutar({ silencioso: true });
    return;
  }
  concPintar();
}
async function concReintentar() {
  const c = conc.carga; if (!c) return;
  const otra = c.items.filter((it) => it.estado === 'ERROR' || it.estado === 'PENDIENTE'); if (!otra.length) return;
  otra.forEach((it) => { it.estado = 'PENDIENTE'; it.detalle = ''; });
  c.fase = 'procesando'; c.cancelar = false; c.detenida = false; c.audit = []; concPintar();
  await concProcesar(otra);
}

// ---------------------------------------------------------------- pintar
function concMsg() { const el = $('concMsg'); if (el) el.textContent = conc.msg || ''; }
function concFilasDeTab(tab) {
  const fs = conc.res ? conc.res.filas : [], R = Conciliacion.RESULTADO;
  if (tab === 'factura') return fs.filter((f) => f.tipo === 'factura' && f.resultado === R.PENDIENTE);
  if (tab === 'nota_credito') return fs.filter((f) => f.tipo === 'nota_credito' && f.resultado === R.PENDIENTE);
  if (tab === 'revisar') return fs.filter((f) => [R.REVISAR, R.DUPLICADA, R.ERROR].includes(f.resultado));
  if (tab === 'ingresadas') return fs.filter((f) => f.resultado === R.INGRESADA);
  return fs.filter((f) => f.resultado === R.ANULADA || (f.tipo === 'nota_debito' && f.resultado === R.PENDIENTE));
}
function concDescargarCsv() {
  const fs = concFilasDeTab(conc.tab); if (!fs.length) return;
  const q = (s) => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
  const filas = ['Documento;Tipo;Proveedor;NIT;Fecha;Total;DIAN;Web;ERP;Causacion ERP;Factura relacionada;Resultado;Motivo;CUFE'];
  for (const f of fs) filas.push([f.documento, f.tipo, q(f.proveedor), f.nit, f.fecha || '', f.total == null ? '' : f.total, 'EN DIAN', f.web.estado, f.erp.estado, f.causacion || '', f.factura_relacionada || '', f.resultado, q(f.motivo), f.cufe].join(';'));
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + filas.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' }));
  a.download = 'conciliacion_' + conc.tab + '_' + BancoUtils.hoyColombia() + '.csv'; document.body.appendChild(a); a.click(); a.remove();
}
function concCambiarTab(t) { conc.tab = t; concPintar(); }
function concCeldaWeb(f) {
  const w = f.web || {};
  if (w.estado === 'EN_WEB') return concBadge('EN WEB', 'st-sellada') + (f.web.pedido ? `<div class="mut">pedido ${escAg(f.web.pedido)}</div>` : '');
  if (w.estado === 'NO_ESTA_EN_WEB') return concBadge('NO — falta PDF', 'st-pool') + (f.web.pedido ? `<div class="mut">pedido ${escAg(f.web.pedido)}</div>` : '');
  if (w.estado === 'DUPLICADA') return concBadge('CUFE DISTINTO', '', CONC_ROJO);
  if (w.estado === 'ERROR') return concBadge('ERROR DE CONSULTA', '', CONC_ROJO);
  return '<span class="mut">—</span>';
}
function concCeldaErp(f) {
  const e = f.erp || {};
  if (e.estado === 'EN_ERP') return concBadge('EN ERP', 'st-sellada') + `<div class="mut">${escAg(e.causacion || '')} · ${escAg(e.fuente || '')}</div>`;
  if (e.estado === 'NO_ESTA_EN_ERP') return concBadge('NO ESTÁ', 'st-pool');
  if (e.estado === 'PROBABLE') return concBadge('PROBABLE', 'st-asignada') + `<div class="mut">${escAg(e.causacion || '')}</div>`;
  if (e.estado === 'SIN_COBERTURA') return concBadge('SIN COBERTURA', 'st-asignada');
  if (e.estado === 'ERROR') return concBadge('ERROR DE CONSULTA', '', CONC_ROJO);
  return '<span class="mut">—</span>';
}
function concCeldaResultado(f) {
  const R = Conciliacion.RESULTADO, et = Conciliacion.ETIQUETA[f.resultado] || f.resultado;
  const cls = { [R.INGRESADA]: 'st-sellada', [R.PENDIENTE]: 'st-pool', [R.REVISAR]: 'st-asignada', [R.DUPLICADA]: 'st-asignada' }[f.resultado] || '';
  return concBadge(et + (f.tipo === 'nota_credito' ? ' · NC' : f.tipo === 'nota_debito' ? ' · ND' : ''), cls, f.resultado === R.ERROR ? CONC_ROJO : '');
}
function concAcciones(f, i) {
  const R = Conciliacion.RESULTADO, b = (txt, acc, extra) => `<button class="${extra || ''}" style="padding:2px 8px;margin:1px" onclick="concAccion(${i},'${acc}')">${txt}</button>`;
  let h = '';
  if (f.resultado === R.REVISAR && f.candidatos.length) h += b('✔ Es esa', 'es_esa', 's') + b('✖ No está', 'no_esta');
  else if (f.resultado === R.REVISAR) h += b('✖ No está', 'no_esta') + b('Ya está…', 'ya_esta');
  else if (f.resultado === R.PENDIENTE) h += b('Ya está en el ERP…', 'ya_esta');
  else if (f.resultado === R.INGRESADA && f.erp.fuente === 'confirmada a mano') h += b('↩ Deshacer', 'deshacer');
  if (f.tipo === 'nota_credito' && [R.PENDIENTE, R.INGRESADA, R.REVISAR].includes(f.resultado)) h += b('✏ Control', 'control');
  return h;
}
function concFila(f, i) {
  const rel = f.tipo === 'nota_credito' ? `<div class="mut">↳ factura: <b>${escAg(f.factura_relacionada || 'sin indicar')}</b> · causación ERP: <b>${escAg(f.causacion || 'sin ingresar')}</b></div>` : '';
  const cand = f.candidatos && f.candidatos.length && f.resultado === 'REVISAR' ? `<div class="mut">${escAg(f.candidatos[0].detalle)}</div>` : '';
  return `<tr><td><b>${escAg(f.documento || '—')}</b>${rel}${f.resultado === 'REVISAR' || f.resultado === 'DUPLICADA' || f.resultado === 'ERROR_DE_CONCILIACION' ? (cand || `<div class="mut">${escAg(f.motivo)}</div>`) : ''}</td>
    <td>${escAg(f.proveedor || '—')}<div class="mut">NIT ${escAg(f.nit || '—')}</div></td><td>${escAg(f.fecha || '')}</td><td class="num">${f.total == null ? '' : escAg(money(f.total))}</td>
    <td>${concBadge('EN DIAN', 'st-sellada')}</td><td>${concCeldaWeb(f)}</td><td>${concCeldaErp(f)}</td><td>${concCeldaResultado(f)}</td><td>${concAcciones(f, i)}</td></tr>`;
}
function concPintarCarga() {
  const c = conc.carga; if (!c) return '';
  const nombre = CONC_NOMBRE_TIPO[c.tipo], uno = c.tipo === 'nota_credito' ? 'Nota crédito' : 'Factura';
  const est = (it) => { const e = CONC_EST[it.estado] || [it.estado, '']; return concBadge(e[0], e[1] === 'ROJO' ? '' : e[1], e[1] === 'ROJO' ? CONC_ROJO : ''); };
  const cuenta = (...es) => c.items.filter((it) => es.includes(it.estado)).length;
  let h = `<div id="concCargaBox" class="card" style="background:#f8fafc;border:2px solid var(--accent);margin:10px 0">`;
  if (c.fase === 'confirmar') {
    const enWeb = conc.res.filas.filter((f) => f.tipo === c.tipo && f.resultado === 'PENDIENTE_DE_INGRESO' && !f.falta_pdf).length, rev = conc.res.filas.filter((f) => f.tipo === c.tipo && ['REVISAR', 'DUPLICADA', 'ERROR_DE_CONCILIACION'].includes(f.resultado)).length;
    const sinMarca = c.items.filter((it) => !concMarcaDe(it.fila.r)).length;
    const viejo = conc.erpInfo && conc.erpInfo.cargadoEn && (Date.now() - new Date(conc.erpInfo.cargadoEn).getTime()) > 24 * 3600 * 1000;
    h += `<div style="font-size:16px"><b>${c.items.length ? 'Se encontraron ' + c.items.length + ' ' + nombre + ' pendientes de ingreso.' : 'No hay ' + nombre + ' pendientes por subir. ✅'}</b></div>`;
    h += `<div class="mut" style="margin:6px 0">Comparadas la DIAN, la web y el ERP: ya se descartaron las que <b>ya están en el ERP</b>. Estas están en la DIAN pero no en la web ni en el ERP.${enWeb ? ` Además ${enWeb} ya tienen su PDF en la web pero no están en el ERP (no necesitan subirse).` : ''}${rev ? ` ${rev} quedan <b>por revisar</b> (pestaña “Por revisar”): no se suben.` : ''}</div>`;
    if (c.bloqueo) h += `<div style="color:#991b1b;font-weight:700;margin:8px 0">⛔ ${escAg(c.bloqueo)}</div>`;
    if (viejo) h += `<div style="color:#b45309;margin:6px 0">⚠️ El reporte del ERP tiene más de 24 horas. Si ya ingresaron cosas hoy, carga uno nuevo antes de subir.</div>`;
    if (c.items.length && !c.bloqueo) {
      h += `<table><thead><tr><th>N°</th><th>Proveedor</th><th>Fecha</th><th class="num">Total</th></tr></thead><tbody>${c.items.slice(0, 12).map((it) => `<tr><td><b>${escAg(it.fila.documento)}</b></td><td>${escAg(it.fila.proveedor)}</td><td>${escAg(it.fila.fecha || '')}</td><td class="num">${it.fila.total == null ? '' : escAg(money(it.fila.total))}</td></tr>`).join('')}</tbody></table>${c.items.length > 12 ? `<div class="mut">… y ${c.items.length - 12} más (están en la pestaña).</div>` : ''}`;
      if (sinMarca) h += `<div class="row" style="margin:8px 0;gap:8px"><span class="mut">${sinMarca} no coinciden con ninguna marca por su NIT receptor. Súbelas como:</span><select id="concMarca" style="width:auto;margin:0"><option value="">— elige la marca —</option>${conc.marcas.map((m) => `<option value="${m.id}">${escAg(m.nombre)}</option>`).join('')}</select></div>`;
      h += `<div class="mut" style="margin:6px 0">Cómo sigue: cada ${uno.toLowerCase()} se vuelve a comprobar en la web y el ERP justo antes de cargarla. Las que sigan pendientes quedan en la lista de descargas y aparece un botón “Abrir en DIAN”: escribe el NIT, marca la verificación, Buscar y Descargar PDF. El PDF queda en <b>Descargas</b> y el robot (vigilante encendido) lo sube solo a la web.</div>`;
    }
    h += `<div class="row" style="gap:8px;margin-top:8px"><button onclick="concCancelar()">Cancelar</button>${c.items.length && !c.bloqueo ? `<button class="p" style="background:#166534;border-color:#166534" onclick="concIniciarCarga()">▶ Iniciar carga (${c.items.length})</button>` : ''}</div>`;
  } else {
    const hechas = c.items.filter((it) => it.estado !== 'PENDIENTE' && it.estado !== 'EN_PROCESO').length, pct = Math.round(100 * hechas / Math.max(c.items.length, 1));
    const actual = c.items.find((it) => it.estado === 'EN_PROCESO');
    if (c.fase === 'procesando') {
      h += `<div><b>${uno} ${Math.min(c.idx || 1, c.items.length)} de ${c.items.length}</b>${actual ? ' · ' + escAg(actual.fila.documento) + ' · ' + escAg(actual.fila.proveedor) : ''}</div>`;
      if (c.msg) h += `<div class="mut">${escAg(c.msg)}</div>`;
    } else if (c.fase === 'esperando') h += `<div><b>Esperando los PDF</b> · ${cuenta('PDF_SUBIDO')} de ${c.items.length - cuenta('OMITIDA', 'ERROR')} subidos</div>`;
    else h += `<div style="font-size:16px"><b>Carga terminada.</b></div>`;
    h += `<div style="background:#e2e8f0;border-radius:99px;height:10px;margin:8px 0;overflow:hidden"><div style="background:#166534;height:10px;width:${pct}%"></div></div>`;
    const errores = cuenta('ERROR');
    h += `<div class="mut" style="margin-bottom:6px">${cuenta('PDF_SUBIDO')} cargadas · ${cuenta('OMITIDA')} ya existían · ${errores} con error${cuenta('ESPERANDO_PDF', 'SUBIENDO_PDF') ? ' · ' + cuenta('ESPERANDO_PDF', 'SUBIENDO_PDF') + ' esperando el PDF' : ''}${cuenta('PENDIENTE') ? ' · ' + cuenta('PENDIENTE') + ' sin procesar' : ''}</div>`;
    h += c.items.map((it) => `<div class="row" style="border-bottom:1px solid var(--line);padding:5px 0;gap:8px"><div style="flex:3"><b>${escAg(it.fila.documento)}</b> · ${escAg(it.fila.proveedor)}<div class="mut">${escAg(it.detalle || '')}</div></div>${est(it)}${it.estado === 'ESPERANDO_PDF' ? `<button title="Copiar el NIT" onclick="copiarTexto('${escAg(it.fila.nit)}',this)">📋 NIT</button><a href="${escAg(BancoUtils.urlDian(it.fila.cufe))}" target="_blank" rel="noopener noreferrer"><button class="s">Abrir en DIAN ↗</button></a>` : ''}</div>`).join('');
    h += `<div class="row" style="gap:8px;margin-top:8px">${c.fase === 'procesando' ? '<button onclick="concCancelar()">Detener</button>' : `<button onclick="concCancelar()">Cerrar</button>`}${(errores || (c.detenida && cuenta('PENDIENTE'))) && c.fase !== 'procesando' ? `<button class="p" onclick="concReintentar()">↻ ${c.detenida && cuenta('PENDIENTE') ? 'Continuar y reintentar' : 'Reintentar los ' + errores + ' con error'}</button>` : ''}</div>`;
  }
  return h + '</div>';
}
function concPintar() {
  let p = $('panelConc');
  if (!p) { p = document.createElement('div'); p.id = 'panelConc'; p.className = 'card'; p.style.margin = '0 0 16px'; $('barraDescarga').insertAdjacentElement('afterend', p); }
  const res = conc.res, s = res ? res.resumen : null, R = Conciliacion.RESULTADO;
  let h = `<div class="row"><b>Conciliación DIAN ↔ Web ↔ ERP</b><span class="sp"></span><button onclick="concCerrar()">Cerrar</button></div>`;
  h += `<div class="mut" id="concMsg" style="margin:4px 0">${escAg(conc.msg || '')}</div>`;
  const e = conc.erpInfo, hora = (t) => (t ? new Date(t).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : '');
  h += `<div class="mut" style="margin:4px 0">DIAN: <b>${conc.tabla ? conc.tabla.registros.length : 0}</b> documentos leídos${conc.archivo ? ' (' + escAg(conc.archivo) + ')' : ''} · Web: <b>${conc.nFacturas}</b> facturas y <b>${conc.nPedidos}</b> pedidos con factura · ERP: ${e ? `<b>${e.total}</b> documentos del ${escAg(e.desde || '?')} al ${escAg(e.hasta || '?')} (reporte cargado ${escAg(hora(e.cargadoEn))})` : '<b style="color:#991b1b">sin reporte cargado</b>'}</div>`;
  for (const k of Object.keys(conc.errores || {})) h += `<div style="color:#991b1b;margin:2px 0">⛔ No se pudo leer ${escAg(k)}: ${escAg(conc.errores[k])}. Lo que dependa de eso queda como ERROR DE CONCILIACIÓN (no se sube).</div>`;
  if (!e && res) h += `<div style="color:#991b1b;margin:4px 0"><b>Falta el reporte del ERP.</b> Sin él no se puede saber qué está ingresado: nada se sube. Usa “📥 Cargar reporte del ERP” (el reporte “Documentos” de Hiopos, en CSV).</div>`;
  if (conc.avisoAuditoria) h += `<div style="color:#b45309;margin:2px 0">⚠️ ${escAg(conc.avisoAuditoria)}</div>`;
  h += `<div class="row" style="margin:8px 0;gap:8px"><label style="background:#0f766e;color:#fff;font-weight:700;padding:6px 12px;border-radius:9px;cursor:pointer;font-size:13px">📥 Cargar reporte del ERP<input type="file" accept=".csv,.xlsx,.xls" style="display:none" onchange="concLeerErp(event)"></label>
    <button onclick="concEjecutar({tipoLog:'conciliar'})">🔄 Volver a conciliar</button><button onclick="concOtroDian()">📂 Otro Excel de la DIAN</button><button onclick="concDescargarCsv()">⬇ CSV de esta lista</button></div>`;
  if (s) {
    const T = s.porTipo;
    const tarjeta = (tp, tit, col) => `<div style="flex:1;min-width:260px;border:1px solid var(--line);border-radius:10px;padding:10px"><b>${tit}</b><div class="mut" style="margin:4px 0"><b>${T[tp].porSubir}</b> por subir (falta el PDF) · <b>${T[tp].enWebSinIngreso}</b> en la web sin ingresar al ERP · <b>${T[tp].revisar + T[tp].duplicadas + T[tp].errores}</b> por revisar · <b>${T[tp].ingresadas}</b> ya ingresadas</div>
      <button class="p" style="background:${col};border-color:${col};font-weight:800" ${T[tp].porSubir && e ? '' : 'disabled'} onclick="concSubir('${tp}')">⬆ SUBIR ${tp === 'factura' ? 'FACTURAS' : 'NOTAS CRÉDITO'} (${T[tp].porSubir})</button></div>`;
    h += `<div class="row" style="gap:10px;align-items:stretch">${tarjeta('factura', 'Facturas', '#166534')}${tarjeta('nota_credito', 'Notas crédito', '#1e3a8a')}</div>`;
    h += `<div class="mut" style="margin:6px 0">Se apartaron: ${s.emitidasPropias} emitidas por nosotros (ventas) · ${s.otrosDocumentos} otros documentos (eventos, etc.)${T.nota_debito.total ? ` · ${T.nota_debito.total} nota(s) débito` : ''}.</div>`;
  }
  h += concPintarCarga();
  if (res) {
    const tabs = [['factura', 'Facturas pendientes'], ['nota_credito', 'Notas crédito pendientes'], ['revisar', 'Por revisar'], ['ingresadas', 'Ingresadas'], ['otras', 'Otros']];
    h += `<div class="row" style="margin:10px 0;gap:6px">${tabs.map(([k, t]) => `<button class="chip ${conc.tab === k ? 'on' : ''}" onclick="concCambiarTab('${k}')">${t} (${concFilasDeTab(k).length})</button>`).join('')}</div>`;
    const lista = concFilasDeTab(conc.tab); conc.vista = lista.slice(0, 300);
    h += lista.length ? `<table><thead><tr><th>Documento</th><th>Proveedor</th><th>Fecha</th><th class="num">Total</th><th>DIAN</th><th>Web</th><th>ERP</th><th>Resultado</th><th></th></tr></thead><tbody>${conc.vista.map((f, i) => concFila(f, i)).join('')}</tbody></table>${lista.length > 300 ? `<div class="mut">… y ${lista.length - 300} más (todas van en el CSV).</div>` : ''}` : '<div class="vacio">Nada en esta lista. ✅</div>';
  }
  p.innerHTML = h;
}
