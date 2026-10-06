// ============================================================
//  nota-credito.js  -  NOTAS CREDITO AMARRADAS A SUS FACTURAS (trazabilidad)  (21/09/2026)
//  Una nota credito corrige o anula (total o en parte) facturas del MISMO proveedor. Aqui se decide, sin tocar la base:
//   - que facturas se le pueden ofrecer a una nota (mismo NIT emisor, solo facturas), la mas reciente primero;
//   - que notas tiene amarradas cada factura y que facturas cada nota (indices sobre la tabla nota_credito_factura);
//   - cuanto queda de una factura despues de sus notas.
//  Logica PURA y determinista (sin red, sin IA). La usa index.html (js/nota-credito-ui.js) y se prueba con node.
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NotaCredito = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const digitos = (t) => String(t == null ? '' : t).replace(/\D/g, '');
  // El numero como lo muestra la tarjeta del banco: documento, o prefijo + folio
  const numero = (f) => String((f && (f.documento || ((f.prefijo || '') + (f.folio || '')))) || '').trim();
  const esNota = (f) => !!f && f.tipo === 'nota_credito';
  const esFactura = (f) => !!f && f.tipo === 'factura';
  const suma = (l) => Math.round(l.reduce((s, x) => s + (Number(x) || 0), 0) * 100) / 100;

  // links: filas de nota_credito_factura { nota_cufe, factura_cufe } -> { porNota: { cufeNota: [cufeFactura] }, porFactura: { cufeFactura: [cufeNota] } }
  // (06/10/2026) anula: { 'nota>factura': true } para los amarres que el agente marco porque el PDF de la nota dice que ANULA la factura
  function indexar(links) {
    const porNota = {}, porFactura = {}, anula = {}, vistos = new Set();
    for (const l of (links || [])) {
      if (!l || !l.nota_cufe || !l.factura_cufe) continue;
      const k = l.nota_cufe + '>' + l.factura_cufe; if (l.anula === true) anula[k] = true; if (vistos.has(k)) continue; vistos.add(k);
      (porNota[l.nota_cufe] = porNota[l.nota_cufe] || []).push(l.factura_cufe);
      (porFactura[l.factura_cufe] = porFactura[l.factura_cufe] || []).push(l.nota_cufe);
    }
    return { porNota, porFactura, anula };
  }

  // Facturas que se le pueden ofrecer a la nota: solo facturas del MISMO proveedor (NIT emisor), la mas reciente primero.
  // -> [{ f, ya, cubre }]   ya = ya esta amarrada a esta nota; cubre = el total de la nota no pasa del de la factura
  function candidatas(nota, facturas, idx) {
    if (!esNota(nota)) return [];
    const nit = digitos(nota.nit_emisor); if (!nit) return [];
    const ya = new Set((idx && idx.porNota && idx.porNota[nota.cufe]) || []);
    const tn = Number(nota.total) || 0;
    return (facturas || []).filter((f) => esFactura(f) && digitos(f.nit_emisor) === nit)
      .map((f) => ({ f, ya: ya.has(f.cufe), cubre: tn > 0 && (Number(f.total) || 0) >= tn }))
      .sort((a, b) => String(b.f.fecha_emision || '').localeCompare(String(a.f.fecha_emision || '')) || String(b.f.cufe).localeCompare(String(a.f.cufe)));
  }

  const buscar = (facturas) => { const m = new Map(); for (const f of (facturas || [])) if (f && f.cufe) m.set(f.cufe, f); return m; };

  // Facturas a las que esta amarrada una nota -> [factura]  (las que ya no estan en la lista cargada se ignoran)
  function facturasDeNota(nota, facturas, idx) {
    const m = buscar(facturas); return ((idx && idx.porNota && idx.porNota[nota && nota.cufe]) || []).map((c) => m.get(c)).filter(Boolean);
  }
  // Notas amarradas a una factura -> [nota]
  function notasDeFactura(factura, facturas, idx) {
    const m = buscar(facturas); return ((idx && idx.porFactura && idx.porFactura[factura && factura.cufe]) || []).map((c) => m.get(c)).filter(Boolean);
  }
  // Lo que queda de la factura despues de sus notas (una nota amarrada a varias facturas se cuenta completa en cada una: no se sabe como se reparte)
  function netoFactura(factura, notas) { return Math.round(((Number(factura && factura.total) || 0) - suma((notas || []).map((n) => n.total))) * 100) / 100; }
  // Una nota sin ninguna factura amarrada (por trazabilidad conviene amarrarla)
  const sinAmarrar = (nota, idx) => esNota(nota) && !((idx && idx.porNota && idx.porNota[nota.cufe] || []).length);

  // (06/10/2026) ¿La factura quedo ANULADA por sus notas?  -> { anulada, motivo, notas: [nota], neto }
  //  - el amarre dice anula (el PDF de la nota lo dice: "se anula esta factura", "ANULACION DE MF448629"), o
  //  - las notas amarradas SOLO a esta factura suman su total (con $1 de tolerancia). Una nota repartida entre varias
  //    facturas no cuenta para esto: no se sabe cuanto le toca a cada una.
  // Una factura anulada no se ingresa sola al ERP: va con su nota o no va.
  function anulacion(factura, facturas, idx) {
    const notas = notasDeFactura(factura, facturas, idx);
    const neto = netoFactura(factura, notas);
    const marcada = notas.find((n) => idx && idx.anula && idx.anula[n.cufe + '>' + factura.cufe]);
    if (marcada) return { anulada: true, motivo: 'la nota crédito ' + numero(marcada) + ' dice que la anula', notas, neto };
    const solas = notas.filter((n) => ((idx && idx.porNota && idx.porNota[n.cufe]) || []).length === 1);
    const total = Number(factura && factura.total) || 0;
    if (solas.length && total > 0 && suma(solas.map((n) => n.total)) >= total - 1)
      return { anulada: true, motivo: solas.length === 1 ? 'la nota crédito ' + numero(solas[0]) + ' cubre todo su total' : 'las notas crédito ' + solas.map(numero).join(', ') + ' cubren todo su total', notas, neto };
    return { anulada: false, motivo: '', notas, neto };
  }

  return { digitos, numero, esNota, esFactura, indexar, candidatas, facturasDeNota, notasDeFactura, netoFactura, sinAmarrar, anulacion };
});
