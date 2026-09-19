// ============================================================
//  conciliacion-ui.js  -  pantalla de la conciliacion DIAN <-> Web <-> ERP  (18/09/2026)
//  Botones SUBIR FACTURAS / SUBIR NOTAS CRÉDITO y la vista "Pendientes de ingreso".
//  La logica de decidir (que esta ingresado y que no) vive en js/conciliacion.js: pura, determinista y probada con node.
//  Este archivo solo lee las tablas, pinta y manda a la cola. NO usa IA. Usa las globales de index.html (SB, perfil, usuario, escAg, $, cargar, cr).
// ============================================================
let conc = { tabla: null, archivo: '', fuentes: null, res: null, tab: 'factura', carga: null, ocupado: false, msg: '', errores: {}, erpInfo: null, marcas: [], quiere: null, vista: [], nFacturas: 0, nPedidos: 0,
  filtro: { desde: '', hasta: '', proveedor: '', sede: '', q: '' }, sedes: [], maxHoras: 12, verOtros: false, tabOtros: 'ingresadas', detalle: null };

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
    const s = t.resumen, modif = new Date(file.lastModified || Date.now()), edadH = Math.max(0, (Date.now() - modif.getTime()) / 3600000);
    if (!confirm('Reporte del ERP: ' + s.total + ' documentos (' + s.facturas + ' facturas y ' + s.notas + ' notas crédito) del ' + s.desde + ' al ' + s.hasta + '.' + (s.sinNumero ? '\n' + s.sinNumero + ' no traen número de factura en "Su Doc" (se comparan por proveedor y monto).' : '') +
      '\n\nArchivo generado el ' + modif.toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) + ' (hace ' + Math.round(edadH) + ' h).' +
      (edadH > conc.maxHoras ? '\n⚠️ Tiene más de ' + conc.maxHoras + ' h: se guarda, pero los pendientes quedarán POR REVISAR hasta que cargues un reporte reciente de Hiopos.' : '') +
      '\n\nSe guardan en la web como copia del ERP. Solo agrega o actualiza por N° de causación: no borra nada.\n\n¿Cargar?')) { conc.msg = ''; concMsg(); return; }
    const { data: id, error } = await SB.rpc('erp_carga_iniciar', { p_archivo: file.name, p_usuario: concUsuario() });
    if (error) throw new Error(error.message);
    const docs = t.docs.map((d) => ({ causacion: d.causacion, serie: d.serie, numero: d.numero, fecha: d.fecha, su_doc: d.su_doc, contacto: d.contacto, contacto_norm: d.contacto_norm, almacen: d.almacen, hora: d.hora, base: d.base, impuestos: d.impuestos, neto: d.neto, tipo: d.tipo, procesado: d.procesado }));
    for (let i = 0; i < docs.length; i += 500) {
      conc.msg = 'Guardando el reporte del ERP... ' + Math.min(i + 500, docs.length) + ' de ' + docs.length; concMsg();
      const r = await SB.rpc('erp_cargar_lote', { p_carga: id, p_docs: docs.slice(i, i + 500) });
      if (r.error) throw new Error(r.error.message);
    }
    const c = await SB.rpc('erp_carga_cerrar', { p_carga: id }); if (c.error) throw new Error(c.error.message);
    const m = await SB.rpc('erp_carga_marcar_archivo', { p_carga: id, p_modificado: modif.toISOString() });   // de cuando es la foto del ERP (no de cuando se subio)
    if (m.error) throw new Error(m.error.message);
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
  const [facturas, pedidos, erpDocs, cargas, alias, decisiones, marcas, excluidos, config, sedes] = await Promise.all([
    concIntentar(() => concPaginar((a, b) => SB.from('facturas').select('cufe,nit_emisor,prefijo,folio,documento,tipo,estado,num_ingreso,sede_id').order('cufe').range(a, b)), errores, 'web'),
    concIntentar(() => concPaginar((a, b) => SB.from('pedidos').select('numero,proveedor_texto,nit_proveedor,factura_cufe,pedido_erp,numero_factura').or('numero_factura.not.is.null,factura_cufe.not.is.null').order('id').range(a, b)), errores, 'pedidos'),
    concIntentar(() => concPaginar((a, b) => SB.from('erp_documento').select('causacion,serie,numero,fecha,su_doc,su_doc_clave,contacto,contacto_norm,almacen,base,impuestos,neto,tipo,procesado').order('causacion').range(a, b)), errores, 'erp'),
    concIntentar(async () => { const r = await SB.from('erp_carga').select('id,archivo,cargado_en,total,desde,hasta,cargado_por,archivo_modificado,corte').not('total', 'is', null).order('id', { ascending: false }).limit(100); if (r.error) throw new Error(r.error.message); return r.data || []; }, errores, 'erp'),
    concIntentar(async () => { const r = await SB.from('proveedor_alias').select('nit,nombre_erp_norm'); if (r.error) throw new Error(r.error.message); return r.data || []; }, errores, 'alias'),
    concIntentar(async () => { const r = await SB.from('conciliacion_decision').select('cufe,decision,causacion_erp,factura_relacionada,nota'); if (r.error) throw new Error(r.error.message); return r.data || []; }, errores, 'decisiones'),
    concIntentar(async () => { const r = await SB.from('marcas').select('id,nombre,nit'); if (r.error) throw new Error(r.error.message); return r.data || []; }, errores, 'marcas'),
    concIntentar(async () => { const r = await SB.from('proveedor_excluido').select('id,nombre,nit').eq('activo', true); if (r.error) throw new Error(r.error.message); return r.data || []; }, errores, 'excluidos'),
    concIntentar(async () => { const r = await SB.from('cruce_config').select('clave,valor'); if (r.error) throw new Error(r.error.message); return r.data || []; }, errores, 'config'),
    concIntentar(async () => { const r = await SB.from('sedes').select('id,nombre'); if (r.error) throw new Error(r.error.message); return r.data || []; }, errores, 'sedes'),
  ]);
  if (errores.alias) errores.erp = errores.erp || ('alias: ' + errores.alias);            // sin los alias confirmados no se puede juzgar el ERP con seguridad
  if (errores.decisiones) errores.erp = errores.erp || ('decisiones: ' + errores.decisiones);
  const docs = (erpDocs || []).map(concNumErp);
  const desdes = (cargas || []).map((c) => c.desde).filter(Boolean).sort();
  const hastas = (cargas || []).map((c) => c.hasta).filter(Boolean).sort();
  const ultima = cargas && cargas[0] ? cargas[0] : {};
  const erp = docs.length ? { docs, desde: desdes[0] || null, hasta: hastas[hastas.length - 1] || null, cargadoEn: ultima.cargado_en || null, archivo: ultima.archivo || '', archivo_modificado: ultima.archivo_modificado || null, corte: ultima.corte || null } : null;
  const horas = Number(((config || []).find((c) => c.clave === 'erp_max_horas') || {}).valor);
  return {
    maxHoras: horas > 0 ? horas : 12, sedes: sedes || [],
    marcas: marcas || [], nFacturas: (facturas || []).length, nPedidos: (pedidos || []).length,
    fuentes: { facturasWeb: facturas || [], pedidos: pedidos || [], erp, alias: (alias || []).map((a) => ({ nit: a.nit, nombre_norm: a.nombre_erp_norm })), decisiones: decisiones || [], excluidos: excluidos || [], errores },
  };
}

// ---------------------------------------------------------------- conciliar
async function concEjecutar(o) {
  o = o || {};
  if (conc.ocupado) return;
  conc.ocupado = true; conc.msg = 'Leyendo la web, los pedidos y el reporte del ERP...'; concPintar();
  try {
    const f = await concCargarFuentes();
    if (!BancoUtils.nitsPropios(f.marcas).length) throw new Error('las marcas no tienen NIT en la base (tabla marcas, columna nit): sin ellos no se distingue una compra de una venta.');
    conc.fuentes = f.fuentes; conc.marcas = f.marcas; conc.nFacturas = f.nFacturas; conc.nPedidos = f.nPedidos; conc.errores = f.fuentes.errores;
    conc.maxHoras = f.maxHoras; conc.sedes = f.sedes;
    conc.erpInfo = f.fuentes.erp ? { desde: f.fuentes.erp.desde, hasta: f.fuentes.erp.hasta, cargadoEn: f.fuentes.erp.cargadoEn, total: f.fuentes.erp.docs.length, archivo: f.fuentes.erp.archivo, archivo_modificado: f.fuentes.erp.archivo_modificado, corte: f.fuentes.erp.corte } : null;
    concRecalcular();
    conc.msg = '';
    if (!o.silencioso) await concAuditoria(o.tipoLog || 'conciliar');
  } catch (e) { conc.msg = 'Error: ' + e.message; }
  finally { conc.ocupado = false; concPintar(); }
}
function concRecalcular() {
  conc.res = Conciliacion.conciliar(conc.tabla.registros, conc.fuentes, concOpciones());
}
// Opciones de la conciliacion: nuestros NIT (de la tabla marcas), la hora de ahora y las horas maximas del reporte del ERP (tabla cruce_config)
const concOpciones = () => ({ nitsPropios: BancoUtils.nitsPropios(conc.marcas), ahora: new Date(), erpMaxHoras: conc.maxHoras });
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
function concCerrar() { concDetenerTimer(); conc.carga = null; if (typeof setModulo === 'function') setModulo('banco'); }
function concDetenerTimer() { if (conc.carga && conc.carga.timer) { clearInterval(conc.carga.timer); conc.carga.timer = null; } }

// ---------------------------------------------------------------- correcciones de una persona (conocimiento estructurado, no IA)
async function concDecidir(f, decision, causacion, facturaRel, nota, candidato) {
  const nit = f.nit || '';
  // Si otra persona ya corrigió este documento mientras esta pantalla estaba abierta, se avisa antes de pisar su decisión
  try {
    const p = await SB.from('conciliacion_decision').select('cufe,decision,causacion_erp,factura_relacionada,decidido_por').eq('cufe', f.cufe).limit(1);
    const previo = (p.data && p.data[0]) || null, local = conc.fuentes.decisiones.find((d) => String(d.cufe).toLowerCase() === f.cufe) || null;
    const v = (o, k) => (o && o[k]) || null;
    if ((v(previo, 'decision') !== v(local, 'decision') || v(previo, 'causacion_erp') !== v(local, 'causacion_erp') || v(previo, 'factura_relacionada') !== v(local, 'factura_relacionada'))
      && !confirm('Otra persona' + (previo && previo.decidido_por ? ' (' + previo.decidido_por + ')' : '') + ' ya corrigió este documento mientras tenías la pantalla abierta.\n\nDecisión actual: ' + (v(previo, 'decision') || 'ninguna') + (previo && previo.causacion_erp ? ' · ' + previo.causacion_erp : '') + '\n\n¿Quieres reemplazarla con la tuya?')) return;
  } catch (e) { /* si no se puede comprobar, se sigue como antes */ }
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
async function concAccion(i, accion, fila) {
  const f = fila || conc.vista[i]; if (!f) return;
  try {
    if (accion === 'es_esa') { const c = f.candidatos[0]; await concDecidir(f, 'en_erp', c.causacion, null, 'confirmada como la misma factura', c); }
    else if (accion === 'no_esta') { if (!confirm('Confirmas que ' + f.documento + ' (' + f.proveedor + ') NO está en el ERP?\nDeja de aparecer como dudosa y queda como pendiente de ingreso.')) return; await concDecidir(f, 'no_esta', null, f.factura_relacionada, 'confirmada como pendiente'); }
    else if (accion === 'ya_esta') {
      const c = prompt('¿Con qué número de causación quedó ' + f.documento + ' en el ERP? (ej. FCRC3423)\nDéjalo vacío para cancelar.'); if (!c || !c.trim()) return;
      await concDecidir(f, 'en_erp', c, f.factura_relacionada, 'confirmada a mano');
    } else if (accion === 'deshacer') { await concDecidir(f, 'ninguna', null, f.factura_relacionada, null); }
    else if (accion === 'apartar') { if (!confirm('¿Apartar a ' + f.proveedor + ' (NIT ' + f.nit + ')?\n\nSe quitan de las listas y de SUBIR todos sus documentos porque los maneja otra persona. Puedes volver a incluirlo cuando quieras.')) return; await concApartar(f.proveedor, f.nit); }
    else if (accion === 'incluir') { if (!f.excluido_id) { alert('Este proveedor se aparta por su NIT o nombre; búscalo en “Proveedores que no manejo” y usa Volver a incluir.'); return; } await concIncluir(f.excluido_id); }
    else if (accion === 'control') {
      const rel = prompt('Nota crédito ' + f.documento + ' (' + f.proveedor + ')\n\n¿A qué factura corresponde? (ej. FE-9000)\nDéjalo vacío si no lo sabes: no se inventa.', f.factura_relacionada || ''); if (rel === null) return;
      const caus = prompt('¿Con qué número de causación quedó en el ERP? (ej. AAR18)\nDéjalo vacío si todavía no la has ingresado.', f.causacion || ''); if (caus === null) return;
      await concDecidir(f, caus.trim() ? 'en_erp' : 'ninguna', caus, rel.trim(), 'control de nota crédito');
    }
  } catch (e) { alert('No se pudo guardar: ' + e.message); }
}

// ---------------------------------------------------------------- proveedores que compras NO maneja
async function concApartar(nombre, nit) {
  const { data, error } = await SB.rpc('proveedor_excluir', { p_nombre: nombre, p_nombre_norm: Conciliacion.nombreOrdenado(nombre), p_nit: nit || null, p_motivo: 'los maneja otra persona', p_usuario: concUsuario() });
  if (error) throw new Error(error.message);
  const lista = conc.fuentes.excluidos.filter((e) => e.id !== data);
  lista.push({ id: data, nombre, nit: nit ? String(nit).replace(/\D/g, '') : null });
  conc.fuentes.excluidos = lista; concRecalcular(); concPintar();
}
async function concIncluir(id) {
  const { error } = await SB.rpc('proveedor_reincorporar', { p_id: id, p_usuario: concUsuario() });
  if (error) throw new Error(error.message);
  conc.fuentes.excluidos = conc.fuentes.excluidos.filter((e) => e.id !== id); concRecalcular(); concPintar();
}
async function concAgregarExcluido() {
  const n = prompt('Nombre del proveedor que compras NO maneja (como sale en la DIAN, sin importar mayúsculas ni S.A.S.):'); if (!n || !n.trim()) return;
  const nit = prompt('NIT (opcional, solo números; déjalo vacío si no lo sabes):', '');
  try { await concApartar(n.trim(), nit && nit.trim() ? nit.trim() : null); } catch (e) { alert('No se pudo guardar: ' + e.message); }
}
async function concQuitarExcluido(id) { try { await concIncluir(id); } catch (e) { alert('No se pudo guardar: ' + e.message); } }
function concVerExcluidos() { conc.verExcluidos = !conc.verExcluidos; concPintar(); }
function concPintarExcluidos() {
  const lista = (conc.fuentes && conc.fuentes.excluidos) || [];
  if (!conc.verExcluidos) return '';
  return `<div class="card" style="background:#f8fafc;margin:8px 0"><div class="row"><b>Proveedores que compras NO maneja (${lista.length})</b><span class="sp"></span><button onclick="concAgregarExcluido()">➕ Agregar proveedor</button></div><div class="mut" style="margin:4px 0">Sus documentos no aparecen en los listados ni se suben. Se reconocen por NIT o por nombre igual (no por parecido). “Volver a incluir” no borra nada.</div>${lista.length ? lista.slice().sort((a, b) => a.nombre.localeCompare(b.nombre)).map((e) => `<div class="row" style="border-bottom:1px solid var(--line);padding:4px 0;gap:8px"><div style="flex:3">${escAg(e.nombre)}${e.nit ? ` <span class="mut">· NIT ${escAg(e.nit)}</span>` : ''}</div><button onclick="concQuitarExcluido(${Number(e.id)})">↩ Volver a incluir</button></div>`).join('') : '<div class="vacio">No hay proveedores apartados.</div>'}</div>`;
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
  const errs = Object.keys(conc.errores || {}).filter((k) => ['web', 'erp', 'pedidos', 'excluidos'].includes(k));
  const lista = Conciliacion.seleccionarParaCarga(conc.res.filas, tipoDoc);
  const nombre = CONC_NOMBRE_TIPO[tipoDoc];
  conc.carga = { tipo: tipoDoc, fase: 'confirmar', items: lista.map((f) => ({ fila: f, estado: 'PENDIENTE', detalle: '' })), idx: 0, cancelar: false, marca: '', timer: null, audit: [], bloqueo: '' };
  if (errs.length || !conc.fuentes.erp) conc.carga.bloqueo = !conc.fuentes.erp && !errs.includes('erp') ? 'No hay reporte del ERP cargado. Carga el reporte "Documentos" de Hiopos (botón "Cargar reporte del ERP") y vuelve a intentar.' : 'No se pudo consultar: ' + errs.map((k) => k + ' (' + conc.errores[k] + ')').join(', ') + '. Una consulta que falla NO significa que el documento no exista, así que no se sube nada.';
  const fr = conc.res && conc.res.frescura;
  if (!conc.carga.bloqueo && fr && fr.aplica && !fr.ok) conc.carga.bloqueo = fr.desconocida ? 'No se sabe de cuándo es el reporte del ERP. Carga uno nuevo de Hiopos y vuelve a intentar.'
    : 'El reporte del ERP tiene ' + Math.round(fr.horas) + ' h (máximo ' + fr.maxHoras + ' h). Si otra persona ya ingresó facturas, el cruce no lo puede saber. Carga un reporte nuevo de Hiopos y vuelve a intentar.';
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
  const colsF = 'cufe,nit_emisor,prefijo,folio,documento,tipo,estado,num_ingreso,sede_id', colsE = 'causacion,serie,numero,fecha,su_doc,su_doc_clave,contacto,contacto_norm,almacen,base,impuestos,neto,tipo,procesado', colsP = 'numero,proveedor_texto,nit_proveedor,factura_cufe,pedido_erp,numero_factura';
  const [fa, fb, ea, eb, pa, pb, alias, dec, carga, ultimaCarga] = await Promise.all([
    concIntentar(() => q(() => SB.from('facturas').select(colsF).eq('cufe', k.cufe)), errores, 'web'),
    concIntentar(() => q(() => SB.from('facturas').select(colsF).eq('nit_emisor', k.nit)), errores, 'web'),
    concIntentar(() => (k.digitos ? q(() => SB.from('erp_documento').select(colsE).ilike('su_doc_clave', '*' + k.digitos + '*')) : Promise.resolve([])), errores, 'erp'),
    concIntentar(() => (k.contactoNorm ? q(() => SB.from('erp_documento').select(colsE).eq('contacto_norm', k.contactoNorm)) : Promise.resolve([])), errores, 'erp'),
    concIntentar(() => (k.digitos ? q(() => SB.from('pedidos').select(colsP).ilike('numero_factura', '*' + k.digitos + '*')) : Promise.resolve([])), errores, 'pedidos'),
    concIntentar(() => q(() => SB.from('pedidos').select(colsP).eq('factura_cufe', k.cufe)), errores, 'pedidos'),
    concIntentar(() => q(() => SB.from('proveedor_alias').select('nit,nombre_erp_norm').eq('nit', k.nit)), errores, 'erp'),
    concIntentar(() => q(() => SB.from('conciliacion_decision').select('cufe,decision,causacion_erp,factura_relacionada,nota').eq('cufe', k.cufe)), errores, 'erp'),
    concIntentar(() => q(() => SB.from('erp_carga').select('desde,cargado_en').not('total', 'is', null).order('desde', { ascending: true }).limit(1)), errores, 'erp'),
    concIntentar(() => q(() => SB.from('erp_carga').select('archivo_modificado,corte').not('total', 'is', null).order('id', { ascending: false }).limit(1)), errores, 'erp'),
  ]);
  const desde = carga && carga[0] ? carga[0].desde : null;
  return {
    facturasWeb: uniq([fa || [], fb || []], (x) => x.cufe), pedidos: uniq([pa || [], pb || []], (x) => x.numero + '|' + x.numero_factura),
    erp: desde ? { docs: uniq([ea || [], eb || []], (x) => x.causacion).map(concNumErp), desde, archivo_modificado: ultimaCarga && ultimaCarga[0] ? ultimaCarga[0].archivo_modificado : null, corte: ultimaCarga && ultimaCarga[0] ? ultimaCarga[0].corte : null } : null,
    alias: (alias || []).map((a) => ({ nit: a.nit, nombre_norm: a.nombre_erp_norm })), decisiones: dec || [], errores,
  };
}
async function concProcesar(items) {
  const c = conc.carga, total = c.items.length;
  for (const it of items) {
    if (c.cancelar) break;
    c.idx = c.items.indexOf(it) + 1; it.estado = 'EN_PROCESO'; it.detalle = 'volviendo a comprobar en la web y el ERP...'; concPintar();
    try {
      const v = Conciliacion.verificarAntesDeCargar(it.fila, await concFuentesFrescas(it.fila), concOpciones());
      const fv = v.fila || it.fila;
      if (!v.ok) {
        const etiqueta = { YA_EXISTE_EN_ERP: 'YA EXISTE EN EL ERP', YA_EXISTE_EN_WEB: 'YA EXISTE EN LA WEB', ERROR_DE_CONSULTA: 'ERROR DE CONSULTA', ERP_DESACTUALIZADO: 'REPORTE DEL ERP DESACTUALIZADO' }[v.estado] || v.estado;
        it.estado = (v.estado === 'ERROR_DE_CONSULTA' || v.estado === 'ERP_DESACTUALIZADO') ? 'ERROR' : 'OMITIDA'; it.detalle = etiqueta + ' · ' + (v.motivo || '');
        if (v.estado === 'ERP_DESACTUALIZADO') { c.cancelar = true; c.msg = 'El reporte del ERP se volvió viejo: carga uno nuevo y pulsa “Continuar y reintentar”.'; }
        c.audit.push(Object.assign(Conciliacion.filaAuditoria(fv, 'reverificacion'), { motivo: (etiqueta + ': ' + (v.motivo || '')).slice(0, 900) }));
      } else {
        const item = Object.assign(BancoUtils.itemsParaDescarga([{ r: it.fila.r }])[0], { tipo: it.fila.tipo, emisor_norm: Conciliacion.normalizarNombre(it.fila.proveedor) });
        const marcaId = concMarcaDe(it.fila.r) || Number(c.marca);
        // ULTIMA validacion en la BASE (bloqueo por CUFE + reporte del ERP reciente + no esta en la web ni en el ERP): dos usuarios a la vez no pasan los dos
        const { data, error } = await SB.rpc('cruce_encolar_verificado', { p_items: [item], p_marca: marcaId, p_usuario: concUsuario() });
        if (error) {
          if (/ERP_DESACTUALIZADO/.test(error.message)) { it.estado = 'ERROR'; it.detalle = 'REPORTE DEL ERP DESACTUALIZADO · carga un reporte nuevo'; c.cancelar = true; c.msg = 'El reporte del ERP se volvió viejo: carga uno nuevo y pulsa “Continuar y reintentar”.'; concPintar(); continue; }
          throw new Error(error.message);
        }
        const d = (Array.isArray(data) ? data[0] : data) || {}, res = d.o_resultado;
        if (res === 'YA_EXISTE_EN_WEB') { it.estado = 'OMITIDA'; it.detalle = 'YA EXISTE EN LA WEB (el banco ya la tiene)'; }
        else if (res === 'YA_EXISTE_EN_ERP') { it.estado = 'OMITIDA'; it.detalle = 'YA EXISTE EN EL ERP · ' + (d.o_motivo || ''); }
        else if (res === 'ENCOLADA' || res === 'YA_EN_COLA') { it.estado = 'ESPERANDO_PDF'; it.detalle = res === 'YA_EN_COLA' ? 'ya estaba en la lista de descargas' : 'en la lista de descargas'; }
        else { it.estado = 'ERROR'; it.detalle = d.o_motivo || 'sin CUFE o NIT válido'; }
        if (it.estado !== 'OMITIDA') c.audit.push(Object.assign(Conciliacion.filaAuditoria(fv, 'reverificacion'), { motivo: 'Re-verificada: sigue pendiente. ' + it.estado + ' — ' + it.detalle }));
        else c.audit.push(Object.assign(Conciliacion.filaAuditoria(fv, 'reverificacion'), { motivo: ('Verificacion final en la base: ' + it.detalle).slice(0, 900) }));
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
  await concCargarPasos(c);
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
// Paso a paso de cada PDF (descargada, marca, desbloqueado, validado, subido) a partir del registro pdf_proceso que escribe el robot
async function concCargarPasos(c) {
  if (typeof PdfClave === 'undefined') return;
  const con = c.items.filter((it) => ['ESPERANDO_PDF', 'SUBIENDO_PDF', 'PDF_SUBIDO', 'ERROR'].includes(it.estado));
  for (let i = 0; i < con.length; i += 100) {
    const lote = con.slice(i, i + 100);
    try {
      const r = await SB.from('pdf_proceso').select('cufe,etapa,marca,codigo_error,error,nit_enmascarado,creado_en').in('cufe', lote.map((it) => it.fila.cufe)).order('id', { ascending: true });
      if (r.error) return;
      const por = {}; (r.data || []).forEach((e) => { (por[e.cufe] = por[e.cufe] || []).push(e); });
      for (const it of lote) it.pasos = por[it.fila.cufe] ? PdfClave.pasosDesdeEventos(por[it.fila.cufe]) : null;
    } catch (e) { return; }
  }
}
function concPasosHtml(it) {
  const p = it.pasos; if (!p) return '';
  const ico = { ok: '✓', error: '✕', aviso: '⚠', pendiente: '○' }, col = { ok: '#166534', error: '#991b1b', aviso: '#b45309', pendiente: '#94a3b8' };
  let h = '<div style="margin-top:3px;line-height:1.5;font-size:12.5px">' + p.pasos.map((s) => `<div style="color:${col[s.estado]}">${ico[s.estado]} ${escAg(s.texto)}</div>`).join('') + '</div>';
  const e = p.error;
  if (e && e.etapa === 'ERROR DESBLOQUEANDO') h += `<div class="mut" style="margin-top:4px"><b>ERROR — PDF NO DESBLOQUEADO</b><br>${it.fila.tipo === 'nota_credito' ? 'Nota crédito' : 'Factura'}: ${escAg(it.fila.documento)} · Marca: ${escAg(e.marca || 'sin identificar')}${e.nit_enmascarado ? ' · NIT utilizado: ' + escAg(e.nit_enmascarado) : ''}<br>Resultado: ${escAg(PdfClave.MENSAJE_ERROR[e.codigo_error] || e.codigo_error || 'error')}</div>`;
  else if (e && e.etapa === 'ERROR SUBIENDO') h += `<div class="mut" style="margin-top:4px"><b>ERROR — no se pudo subir el PDF</b> (ya desbloqueado): ${escAg(String(e.error || '').slice(0, 160))}</div>`;
  return h;
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
  const fs = conc.res ? conc.res.filas : [], E = Conciliacion.ESTADO;
  if (tab === 'factura') return fs.filter((f) => f.tipo === 'factura' && f.estado === E.PENDIENTE);            // facturas pendientes de ingreso (con o sin PDF en la web)
  if (tab === 'nota_credito') return fs.filter((f) => f.tipo === 'nota_credito' && f.estado === E.PENDIENTE);
  if (tab === 'revisar') return fs.filter((f) => f.tipo !== 'nota_debito' && (f.estado === E.REVISAR || f.estado === E.ERROR_CONSULTA));
  if (tab === 'sin_erp') return fs.filter((f) => f.tipo === 'factura' && f.estado === E.PENDIENTE && !f.falta_pdf);   // ya tiene PDF en la web, falta ingresarla al ERP
  if (tab === 'ingresadas') return fs.filter((f) => f.estado === E.INGRESADA);
  return fs.filter((f) => [E.ANULADA, E.APARTADO, E.NOTA_DEBITO].includes(f.estado));                                // apartadas, anuladas, notas debito
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
    h += c.items.map((it) => `<div class="row" style="border-bottom:1px solid var(--line);padding:5px 0;gap:8px"><div style="flex:3"><b>${escAg(it.fila.documento)}</b> · ${escAg(it.fila.proveedor)}<div class="mut">${escAg(it.pasos && it.pasos.error ? '' : (it.detalle || ''))}</div>${concPasosHtml(it)}</div>${est(it)}${it.estado === 'ESPERANDO_PDF' ? `<button title="Copiar el NIT" onclick="copiarTexto('${escAg(it.fila.nit)}',this)">📋 NIT</button><a href="${escAg(BancoUtils.urlDian(it.fila.cufe))}" target="_blank" rel="noopener noreferrer"><button class="s">Abrir en DIAN ↗</button></a>` : ''}</div>`).join('');
    h += `<div class="row" style="gap:8px;margin-top:8px">${c.fase === 'procesando' ? '<button onclick="concCancelar()">Detener</button>' : `<button onclick="concCancelar()">Cerrar</button>`}${(errores || (c.detenida && cuenta('PENDIENTE'))) && c.fase !== 'procesando' ? `<button class="p" onclick="concReintentar()">↻ ${c.detenida && cuenta('PENDIENTE') ? 'Continuar y reintentar' : 'Reintentar los ' + errores + ' con error'}</button>` : ''}</div>`;
  }
  return h + '</div>';
}
function concPintar() { if (typeof cruceDianPintar === 'function') cruceDianPintar(); }
