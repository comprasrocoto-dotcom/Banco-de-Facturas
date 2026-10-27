// ============================================================
//  envio-contabilidad.js  -  QUE YA SE ENVIO A CONTABILIDAD Y QUE NO (16/10/2026, pedido del usuario)
// ============================================================
// Antes se enviaba a contabilidad por rango de FECHA DE INGRESO: un documento sellado despues de su dia de ingreso no salia en
// ninguna descarga, y bajar "desde el 8" repetia documentos ya enviados (riesgo de pago doble). Ahora cada documento con el
// proceso terminado queda "por enviar" hasta que sale en un envio (lote), sin importar su fecha, y nunca sale dos veces.
// Tablas: contabilidad_lote / contabilidad_envio (supabase/envio_contabilidad.sql). Puro (sin red): lo usan la web y las pruebas.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EnvioContabilidad = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // filas de contabilidad_envio -> Map(cufe -> { lote, en })
  function indexar(filas) {
    const m = new Map();
    for (const f of filas || []) if (f && f.factura_cufe) m.set(f.factura_cufe, { lote: Number(f.lote_id), en: f.enviada_en || null });
    return m;
  }

  // documentos por enviar: proceso terminado (esTerminada) y sin envio. -> { lista (con PDF), sinPdf: [...] }
  function pendientes(facturas, enviados, esTerminada) {
    const lista = [], sinPdf = [];
    for (const f of facturas || []) {
      if (!f || !esTerminada(f) || (enviados && enviados.has(f.cufe))) continue;
      (f.archivo_pdf || f.archivo_pdf_sellado ? lista : sinPdf).push(f);
    }
    return { lista, sinPdf };
  }

  // dias entre la fecha de ingreso al ERP y hoy (YYYY-MM-DD) -> numero (0 si es de hoy o no hay fecha)
  function diasSinEnviar(f, hoy) {
    const fi = f && f.fecha_ingreso && f.fecha_ingreso !== 'null' ? String(f.fecha_ingreso).slice(0, 10) : '';
    if (!fi || !hoy) return 0;
    const d = Math.round((Date.parse(hoy + 'T00:00:00Z') - Date.parse(fi + 'T00:00:00Z')) / 86400000);
    return d > 0 ? d : 0;
  }

  // documentos enviados agrupados por lote (del mas reciente al mas antiguo) -> [{ lote, en, docs: [...] }]
  function porLote(facturas, enviados) {
    const m = new Map();
    for (const f of facturas || []) {
      const e = enviados && enviados.get(f.cufe); if (!e) continue;
      if (!m.has(e.lote)) m.set(e.lote, { lote: e.lote, en: e.en, docs: [] });
      const g = m.get(e.lote); g.docs.push(f); if (e.en && (!g.en || e.en > g.en)) g.en = e.en;
    }
    return [...m.values()].sort((a, b) => b.lote - a.lote);
  }

  // texto de la etiqueta de un documento enviado
  function etiqueta(e) {
    if (!e) return '';
    const t = e.en ? Date.parse(e.en) : NaN;
    const co = isNaN(t) ? '' : new Date(t - 5 * 3600000).toISOString();   // hora de Colombia (UTC-5)
    const f = co ? co.slice(8, 10) + '/' + co.slice(5, 7) : '';
    return '📤 Enviada a contabilidad' + (f ? ' ' + f : '') + ' · lote ' + e.lote;
  }

  // ---------------------------------------------------------------- ENVIO PREPARADO (16/10/2026, pedido del usuario)
  // La lista del envio se CONGELA al prepararla: lo que el agente termine despues no se cuela (queda para el proximo envio).
  // Cada documento tiene su casilla: lo que se desmarca no se envia y sigue pendiente. Solo se marca como enviado lo que se
  // bajo en el ZIP + Excel con esa misma seleccion.
  const firma = (cufes) => [...new Set(cufes || [])].sort().join('|');
  function preparar(lista, ahora) {
    const cufes = (lista || []).map((f) => f.cufe);
    const marcados = {}; cufes.forEach((c) => { marcados[c] = true; });
    return { cufes, marcados, creado: ahora || Date.now(), bajado: false, firmaBajada: '' };
  }
  // -> { docs: los del envio que siguen pendientes (en su orden), salieron: cuantos ya no estan (se enviaron por otro lado),
  //      nuevos: pendientes que llegaron despues de preparar }
  function vigentes(prep, pendientesLista) {
    const pend = new Map((pendientesLista || []).map((f) => [f.cufe, f]));
    const enPrep = new Set((prep && prep.cufes) || []);
    const docs = ((prep && prep.cufes) || []).filter((c) => pend.has(c)).map((c) => pend.get(c));
    return { docs, salieron: enPrep.size - docs.length, nuevos: (pendientesLista || []).filter((f) => !enPrep.has(f.cufe)) };
  }
  const seleccion = (prep, docs) => (docs || []).filter((f) => prep && prep.marcados && prep.marcados[f.cufe]);
  function marcar(prep, cufe, valor) {
    const p = Object.assign({}, prep, { marcados: Object.assign({}, prep.marcados) });
    p.marcados[cufe] = !!valor;
    return p;
  }
  function marcarTodos(prep, docs, valor) {
    const p = Object.assign({}, prep, { marcados: Object.assign({}, prep.marcados) });
    (docs || []).forEach((f) => { p.marcados[f.cufe] = !!valor; });
    return p;
  }
  // ¿se puede marcar como enviado? solo si lo seleccionado es exactamente lo que se bajo
  function puedeConfirmar(prep, sel) {
    if (!sel || !sel.length) return { ok: false, motivo: 'No hay documentos marcados.' };
    if (!prep || !prep.bajado) return { ok: false, motivo: 'Primero baja el ZIP + Excel de los documentos marcados.' };
    if (prep.firmaBajada !== firma(sel.map((f) => f.cufe))) return { ok: false, motivo: 'Cambiaste la selección después de bajar: vuelve a bajar el ZIP + Excel para que coincida con lo que se va a marcar.' };
    return { ok: true, motivo: '' };
  }

  // ---------------------------------------------------------------- (27/10/2026, pedido del usuario)
  // «Todas ya estan ingresadas al ERP y se supone que estan enviadas»: 48 documentos con ingreso ERP seguian «asignada» (sin sellar)
  // y por eso NUNCA salian en «Por enviar». Ahora basta el ingreso al ERP: va lo terminado de siempre (sellado o nota credito)
  // y tambien lo ingresado que aun no se sello, si ya tiene sede (asi no entran las de 123 Wok «Sin asignar», que van aparte).
  const conIngreso = (f) => !!f && !!f.num_ingreso && String(f.num_ingreso).trim() !== '' && String(f.num_ingreso) !== 'null';
  function listoParaEnviar(f, esTerminada) {
    if (!conIngreso(f) || f.estado === 'rechazada') return false;
    if (esTerminada && esTerminada(f)) return true;
    return f.estado === 'asignada' && f.sede_id != null;
  }
  const sinSellar = (f, esTerminada) => listoParaEnviar(f, esTerminada) && !(esTerminada && esTerminada(f));

  // reparte archivos [{ tam }] en grupos que no pasen de max bytes (un correo de Gmail aguanta ~25 MB con el adjunto
  // en base64): -> [[indices]]. Un archivo mas grande que max va solo en su grupo.
  function partir(tamanos, max) {
    const grupos = []; let g = [], suma = 0;
    (tamanos || []).forEach((t, i) => {
      t = Number(t) || 0;
      if (g.length && suma + t > max) { grupos.push(g); g = []; suma = 0; }
      g.push(i); suma += t;
    });
    if (g.length) grupos.push(g);
    return grupos;
  }

  // referencia del envio por correo (hora Colombia, con segundos): ENV-20261027-093015
  // (27/10/2026) antes solo hora y minuto: dos envios en el mismo minuto compartian carpeta y uno pisaba los archivos del otro
  function referencia(ahoraMs) {
    const co = new Date((ahoraMs || Date.now()) - 5 * 3600000).toISOString();
    return 'ENV-' + co.slice(0, 10).replace(/-/g, '') + '-' + co.slice(11, 13) + co.slice(14, 16) + co.slice(17, 19);
  }

  // estado de los correos de un lote: filas de correo_cola -> { total, enviados, errores, pendientes, texto }
  function estadoCorreos(filas) {
    const l = filas || [];
    const enviados = l.filter((c) => c.estado === 'enviado').length, errores = l.filter((c) => c.estado === 'agotado' || c.estado === 'error').length;
    const pendientes = l.length - enviados - errores;
    const texto = !l.length ? '' : enviados === l.length ? '✅ ' + enviados + ' correo(s) enviados' :
      enviados + ' de ' + l.length + ' correo(s) enviados' + (pendientes ? ' · ' + pendientes + ' en cola' : '') + (errores ? ' · ⚠️ ' + errores + ' con error (se reintenta)' : '');
    return { total: l.length, enviados, errores, pendientes, texto };
  }

  // situacion de un documento para el Excel de TODOS los documentos
  function situacion(f, enviados, esTerminada) {
    if (!f) return '';
    if (enviados && enviados.has(f.cufe)) return 'Enviada a contabilidad';
    if (f.estado === 'rechazada') return 'Rechazada';
    if (!conIngreso(f)) return 'Sin ingreso ERP';
    if (listoParaEnviar(f, esTerminada)) {
      const pdf = f.archivo_pdf || f.archivo_pdf_sellado ? '' : ' (SIN PDF en la web)';
      return (sinSellar(f, esTerminada) ? 'Por enviar (ingresada, sin sellar)' : 'Por enviar') + pdf;
    }
    return f.sede_id == null ? 'Ingresada, sin sede en el banco' : 'Ingresada, sin sellar';
  }

  return { indexar, pendientes, diasSinEnviar, porLote, etiqueta, firma, preparar, vigentes, seleccion, marcar, marcarTodos, puedeConfirmar,
    listoParaEnviar, sinSellar, partir, referencia, estadoCorreos, situacion };
});
