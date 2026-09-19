// ============================================================
//  pdf-subida-web.js  -  desbloqueo de PDF en la carga manual "Subir PDFs"  (18/09/2026)
//  Los PDF de la DIAN vienen protegidos con el NIT de la marca. ANTES de leerlos y subirlos se desbloquean y VALIDAN aqui, en el navegador
//  (mismo nucleo que el agente). Si no se puede desbloquear, ese PDF NO se sube. Sin IA. Nunca se muestra la clave ni el NIT completo.
//  Usa las globales de index.html: SB, $, PdfClave, PdfDesbloqueoCore, crearDesbloqueadorWeb.
// ============================================================
let _pdfDesbloqueadorWeb = null;
const _pdfMetaManual = new Map();     // nombre del archivo -> datos del proceso, para registrar la subida
let _pdfNotaManual = '';
const pdfNotaManual = () => _pdfNotaManual;

async function pdfRegistrarEventos(eventos) {
  if (!eventos.length) return;
  try { const r = await SB.rpc('pdf_proceso_registrar', { p_eventos: eventos.slice(0, 200) }); if (r.error) console.warn('registro de PDF:', r.error.message); } catch (e) { console.warn('registro de PDF:', e.message); }
}
// Despues de subir (o fallar al subir) un PDF ya desbloqueado
async function pdfRegistrarSubida(nombreArchivo, cufe, documento, error) {
  const m = _pdfMetaManual.get(nombreArchivo); if (!m) return;
  await pdfRegistrarEventos([Object.assign({ cufe: cufe || null, documento: documento || null, tipo: m.tipo || 'factura', etapa: error ? 'ERROR SUBIENDO' : 'PDF SUBIDO', resultado: error ? 'error' : 'ok',
    codigo_error: error ? 'SUBIDA_FALLIDA' : null, error: error ? String(error).slice(0, 300) : 'carga manual desde la web', marca: m.marca, nit_enmascarado: m.nit_enmascarado, origen_marca: m.origen_marca,
    nombre_pdf_original: nombreArchivo, nombre_pdf_desbloqueado: nombreArchivo }, {})]);
}

// files: File[] elegidos. marcaId: la marca escogida en pantalla (respaldo si el PDF no dice a que empresa va).
// Devuelve { listos: File[] (sin contraseña), errores: string[] }
async function desbloquearParaSubir(files, marcaId, tipoDoc) {
  const listos = [], errores = [], eventos = []; let desbloqueados = 0, yaAbiertos = 0;
  let marcas = [], marcasError = null, formato = PdfClave.FORMATO_POR_DEFECTO;
  try { const r = await SB.from('marcas').select('id,nombre,nit'); if (r.error) throw new Error(r.error.message); marcas = r.data || []; } catch (e) { marcasError = e.message; }
  try { const c = await SB.from('pdf_config').select('valor').eq('clave', 'formato_clave').limit(1); if (c.data && c.data[0] && c.data[0].valor) formato = c.data[0].valor; } catch (e) { /* formato por defecto */ }
  if (!_pdfDesbloqueadorWeb) _pdfDesbloqueadorWeb = crearDesbloqueadorWeb();
  let i = 0;
  for (const f of files) {
    i++;
    try { $('res').innerHTML = '🔓 Revisando la protección de los PDF... ' + i + ' de ' + files.length + ' · ' + PdfClave.nombreSeguro(f.name); } catch (e) { /* pantalla */ }
    const bytes = new Uint8Array(await f.arrayBuffer());
    const cufeNombre = ((f.name.match(/[0-9a-fA-F]{96}/) || [])[0] || '').toLowerCase() || null;
    // ¿de que empresa es? Datos estructurados primero: si el archivo se llama como el CUFE, la fila de la DIAN ya trae el NIT receptor
    let doc = { marca_id: marcaId, nit_receptor: null, documento: null, tipo: tipoDoc || 'factura' };
    if (cufeNombre) {
      try { const r = await SB.from('dian_descarga').select('cufe,nit_receptor,marca_id,documento,tipo').eq('cufe', cufeNombre).limit(1); if (r.data && r.data[0]) doc = Object.assign({}, r.data[0], { marca_id: r.data[0].marca_id || marcaId }); } catch (e) { /* se usa la marca elegida */ }
    }
    const id = PdfClave.identificarMarca(doc, marcas);
    const nombre = id.marca ? id.marca.nombre : null, nitMasc = id.marca ? PdfClave.enmascararNit(id.marca.nit) : '';
    const clave = id.marca ? PdfClave.claveDesdeNit(id.marca.nit, formato) : '';
    const base = { cufe: cufeNombre, documento: doc.documento || null, tipo: doc.tipo || 'factura', marca: nombre, nit_enmascarado: nitMasc || null, origen_marca: id.origen, nombre_pdf_original: f.name };
    eventos.push(Object.assign({ etapa: 'PDF DESCARGADO', resultado: 'ok' }, base));
    const etapas = [];
    try {
      const r = await _pdfDesbloqueadorWeb.procesar(bytes, { clave, alEtapa: (e) => etapas.push(e) });
      etapas.forEach((e) => eventos.push(Object.assign({ etapa: e, resultado: 'ok', cantidad_intentos: e === 'DESBLOQUEANDO' ? 1 : 0 }, base)));
      if (r.estado === 'SIN_CLAVE') { yaAbiertos++; eventos.push(Object.assign({ etapa: 'PDF SIN CLAVE', resultado: 'ok' }, base), Object.assign({ etapa: 'PDF VALIDADO', resultado: 'ok' }, base)); listos.push(f); }
      else { desbloqueados++; listos.push(new File([r.bytes], f.name, { type: 'application/pdf' })); }
      _pdfMetaManual.set(f.name, base);
    } catch (e) {
      etapas.forEach((x) => eventos.push(Object.assign({ etapa: x, resultado: 'ok' }, base)));
      let codigo = e.codigo || 'PDF_CORRUPTO';
      if (codigo === 'CLAVE_INVALIDA' && !id.marca) codigo = 'MARCA_NO_IDENTIFICADA';
      else if (codigo === 'CLAVE_INVALIDA' && !clave) codigo = 'MARCA_SIN_NIT';
      const motivo = marcasError && !id.marca ? 'no se pudieron leer las marcas (' + marcasError + ')' : (PdfClave.MENSAJE_ERROR[codigo] || codigo);
      eventos.push(Object.assign({ etapa: 'ERROR DESBLOQUEANDO', resultado: 'error', cantidad_intentos: codigo === 'CLAVE_INVALIDA' ? 1 : 0, codigo_error: codigo, error: String(e.message || codigo).slice(0, 300) }, base));
      errores.push(f.name + ': ERROR — PDF NO DESBLOQUEADO · Marca: ' + (nombre || 'sin identificar') + (nitMasc ? ' · NIT utilizado: ' + nitMasc : '') + ' · Resultado: ' + motivo + ' (no se subió)');
    }
  }
  await pdfRegistrarEventos(eventos);
  _pdfNotaManual = (desbloqueados || yaAbiertos) ? '<br>🔓 ' + desbloqueados + ' PDF desbloqueado(s) y validado(s)' + (yaAbiertos ? ' · ' + yaAbiertos + ' ya venían sin contraseña' : '') + '.' : '';
  return { listos, errores };
}
