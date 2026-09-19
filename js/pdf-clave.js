// ============================================================
//  pdf-clave.js  -  clave de los PDF protegidos de la DIAN  (18/09/2026)
//  Logica PURA y DETERMINISTA (sin IA, sin red, sin archivos). La usan el agente (Node) y la web (navegador).
//
//  Regla: la clave del PDF es el NIT de la marca/empresa RECEPTORA del documento.
//  El NIT NUNCA va escrito aqui: sale de la tabla marcas (columna nit). Este modulo solo lo normaliza y lo arma.
//  Formato verificado con los PDF reales de la DIAN: NIT solo digitos, SIN digito de verificacion ("nit_sin_dv").
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PdfClave = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FORMATOS = ['nit_sin_dv', 'nit_con_dv', 'nit_con_guion'];
  const FORMATO_POR_DEFECTO = 'nit_sin_dv';
  const ETAPAS = ['PDF DESCARGADO', 'PDF PROTEGIDO', 'PDF SIN CLAVE', 'DESBLOQUEANDO', 'PDF DESBLOQUEADO', 'PDF VALIDADO', 'PDF SUBIDO', 'ERROR DESBLOQUEANDO', 'ERROR SUBIENDO'];
  const MENSAJE_ERROR = {
    CLAVE_INVALIDA: 'contraseña no válida', MARCA_NO_IDENTIFICADA: 'no se pudo identificar la marca', MARCA_SIN_NIT: 'la marca no tiene NIT configurado',
    PDF_CORRUPTO: 'el PDF está dañado', VALIDACION_FALLIDA: 'el PDF desbloqueado no pasó la validación', SIN_HERRAMIENTA: 'falta la herramienta de desbloqueo',
    SUBIDA_FALLIDA: 'no se pudo subir a la web',
  };

  const soloDigitos = (s) => String(s == null ? '' : s).replace(/\D/g, '');

  // Digito de verificacion del NIT colombiano (modulo 11, pesos DIAN).
  function digitoVerificacion(nit) {
    const d = soloDigitos(nit); if (!d || d.length > 15) return null;
    const pesos = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
    let s = 0; d.split('').reverse().forEach((x, i) => { s += Number(x) * pesos[i]; });
    const r = s % 11; return r > 1 ? 11 - r : r;
  }

  // "900123456-7" / "900.123.456-7" / "900123456" / "9001234567" (NIT + DV pegado) -> { nit, dv, dvDetectado }
  // Solo quita el DV cuando SE PUEDE COMPROBAR: viene con guion, o son 10 digitos y el ultimo coincide con el DV calculado.
  // Un NIT de 9 digitos se toma tal cual (no se le quita nada).
  function normalizarNit(texto) {
    const t = String(texto == null ? '' : texto).trim();
    if (!t) return { nit: '', dv: null, dvDetectado: false };
    const g = t.match(/^([\d.\s]+)\s*-\s*(\d)\s*$/);
    if (g) return { nit: soloDigitos(g[1]), dv: Number(g[2]), dvDetectado: true };
    const d = soloDigitos(t);
    if (d.length === 10 && Number(d[9]) === digitoVerificacion(d.slice(0, 9))) return { nit: d.slice(0, 9), dv: Number(d[9]), dvDetectado: true };
    return { nit: d, dv: null, dvDetectado: false };
  }

  // Clave del PDF a partir del NIT guardado en marcas.nit. formato configurable (tabla pdf_config).
  function claveDesdeNit(nitGuardado, formato) {
    const n = normalizarNit(nitGuardado).nit; if (!n) return '';
    const f = FORMATOS.includes(formato) ? formato : FORMATO_POR_DEFECTO;
    if (f === 'nit_con_dv') return n + digitoVerificacion(n);
    if (f === 'nit_con_guion') return n + '-' + digitoVerificacion(n);
    return n;
  }

  // Para pantallas y logs: nunca el NIT completo. ******083
  function enmascararNit(nit) {
    const d = normalizarNit(nit).nit; if (!d) return '';
    return '*'.repeat(Math.max(d.length - 3, 3)) + d.slice(-3);
  }

  // ¿A que marca pertenece el documento? Solo datos estructurados, en este orden:
  //   1) el NIT RECEPTOR de la fila DIAN coincide con marcas.nit  -> esa marca
  //   2) si no, la marca asignada al documento (marca_id)
  // Si el NIT receptor apunta a una marca y la asignada es otra, se avisa (discrepancia) y manda el NIT receptor.
  function identificarMarca(doc, marcas) {
    marcas = marcas || [];
    const rec = normalizarNit(doc && doc.nit_receptor).nit;
    const porNit = rec ? marcas.find((m) => normalizarNit(m.nit).nit === rec) : null;
    const asignada = doc && doc.marca_id != null ? marcas.find((m) => Number(m.id) === Number(doc.marca_id)) : null;
    if (porNit) return { marca: porNit, origen: 'nit_receptor', discrepancia: !!(asignada && asignada.id !== porNit.id), asignada: asignada || null };
    if (asignada) return { marca: asignada, origen: 'marca_asignada', discrepancia: false, asignada };
    return { marca: null, origen: null, discrepancia: false, asignada: null };
  }

  // Nombre de archivo seguro (sin rutas ni caracteres raros)
  const nombreSeguro = (s) => String(s == null ? '' : s).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 150) || 'sin-nombre';

  // Eventos del proceso de un documento (tabla pdf_proceso, en orden) -> pasos para la pantalla.
  // paso.estado: 'ok' | 'error' | 'pendiente' | 'aviso'
  function pasosDesdeEventos(eventos) {
    const todos = eventos || [], ini = todos.map((e) => e.etapa).lastIndexOf('PDF DESCARGADO');   // solo cuenta el ultimo intento
    const ev = ini >= 0 ? todos.slice(ini) : todos, tiene = (e) => ev.some((x) => x.etapa === e), ultimo = ev[ev.length - 1] || null;
    const falloDesb = ev.slice().reverse().find((x) => x.etapa === 'ERROR DESBLOQUEANDO'), falloSub = ev.slice().reverse().find((x) => x.etapa === 'ERROR SUBIENDO');
    const marca = (ev.slice().reverse().find((x) => x.marca) || {}).marca || '';
    const pasos = [];
    pasos.push({ texto: 'Descargada', estado: tiene('PDF DESCARGADO') ? 'ok' : 'pendiente' });
    pasos.push({ texto: marca ? 'Marca identificada: ' + marca : 'Marca identificada', estado: marca ? 'ok' : (falloDesb && falloDesb.codigo_error === 'MARCA_NO_IDENTIFICADA' ? 'error' : 'pendiente') });
    if (tiene('PDF SIN CLAVE')) pasos.push({ texto: 'El PDF ya venía sin contraseña', estado: 'ok' });
    else if (falloDesb) pasos.push({ texto: 'No se pudo desbloquear', estado: 'error' });
    else pasos.push({ texto: 'PDF desbloqueado', estado: tiene('PDF DESBLOQUEADO') ? 'ok' : 'pendiente' });
    if (falloDesb) pasos.push({ texto: 'Requiere revisión', estado: 'aviso' });
    else {
      pasos.push({ texto: 'PDF validado', estado: tiene('PDF VALIDADO') ? 'ok' : 'pendiente' });
      pasos.push({ texto: falloSub ? 'No se pudo subir a la web' : 'PDF subido', estado: falloSub ? 'error' : (tiene('PDF SUBIDO') ? 'ok' : 'pendiente') });
    }
    return { pasos, error: falloDesb || falloSub || null, ultimo };
  }

  return { FORMATOS, FORMATO_POR_DEFECTO, ETAPAS, MENSAJE_ERROR, soloDigitos, digitoVerificacion, normalizarNit, claveDesdeNit, enmascararNit, identificarMarca, nombreSeguro, pasosDesdeEventos };
});
