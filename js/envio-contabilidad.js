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

  return { indexar, pendientes, diasSinEnviar, porLote, etiqueta };
});
