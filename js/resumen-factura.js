// ============================================================
//  resumen-factura.js  -  EL "OJITO": RESUMEN DE UNA FACTURA  (21/09/2026)
//   Arma, sin red y sin DOM, lo que se muestra al abrir el resumen de una factura Sin asignar:
//   datos clave, en que va (estado / sede / ingreso ERP), su pedido amarrado o los pedidos PENDIENTES del mismo proveedor, y avisos.
//   (IVA y fecha de recepcion no se muestran: hoy no vienen llenos en ninguna factura.)
//  Logica PURA y determinista (sin IA). La usa index.html (verResumenFactura) y se prueba con node.
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./sin-sellar.js'));
  else root.ResumenFactura = factory(root.SinSellar);
})(typeof self !== 'undefined' ? self : this, function (SS) {
  'use strict';

  const ESTADO = { pool: 'Sin asignar', asignada: 'Mía · sin sellar', sellada: 'Sellada y aprobada', pagada: 'En pagos', rechazada: 'Rechazada' };
  const TIPO = { factura: 'Factura', nota_credito: 'Nota crédito', cuenta_cobro: 'Cuenta de cobro', otro: 'Otro documento' };
  const MAX_CANDIDATOS = 3;

  const num = (v) => (v == null || v === '' || isNaN(Number(v)) ? null : Number(v));
  const txt = (v) => { const s = String(v == null ? '' : v).trim(); return s && s !== 'null' ? s : null; };

  // ctx: { pedidos, sedes, hoy, rol, sedeId }
  function armar(f, ctx) {
    ctx = ctx || {};
    const pedidos = ctx.pedidos || [], sedes = ctx.sedes || [];
    const numero = txt(f.documento) || txt((f.prefijo || '') + (f.folio || ''));
    const sede = f.sede_id != null ? (sedes.find((s) => s.id === f.sede_id) || {}).nombre || ('Sede ' + f.sede_id) : null;
    const dias = f.fecha_emision && ctx.hoy ? SS.diasEntre(f.fecha_emision, ctx.hoy) : null;

    // su pedido: el que ya tiene esta factura amarrada, o lo que diga la propia factura
    const pl = pedidos.find((p) => p.factura_cufe && p.factura_cufe === f.cufe) || null;
    const pedido = pl ? { id: pl.id, numero: txt(pl.numero), erp: txt(pl.pedido_erp), proveedor: txt(pl.proveedor_texto || pl.proveedor), sede: txt(pl.sede_texto), fecha: txt(pl.fecha) }
      : (txt(f.pedido_num) || txt(f.pedido_erp) ? { id: null, numero: txt(f.pedido_num), erp: txt(f.pedido_erp), proveedor: null, sede: null, fecha: null } : null);

    // sin pedido: los PENDIENTES de amarrar del mismo proveedor (la sede solo ve los suyos), del mas reciente al mas antiguo
    let candidatos = { total: 0, lista: [] };
    if (!pedido) {
      const visibles = (ctx.rol === 'sede' ? pedidos.filter((p) => p.sede_id === ctx.sedeId) : pedidos).filter(SS.pendienteDeAmarrar);
      const mios = SS.ordenarRecientes(visibles.filter((p) => SS.mismoProveedor(f, p)));
      candidatos = { total: mios.length, lista: mios.slice(0, MAX_CANDIDATOS).map((p) => ({ id: p.id, numero: txt(p.numero), fecha: txt(p.fecha), sede: txt(p.sede_texto), erp: txt(p.pedido_erp), mismo: SS.mismoProveedor(f, p) })) };
    }

    const avisos = [];
    if (!numero) avisos.push('La factura no trae número en el PDF.');
    if (!f.archivo_pdf) avisos.push('Esta factura no tiene PDF guardado.');
    if (num(f.total) == null) avisos.push('La factura no trae total.');

    return {
      cufe: f.cufe, cufeCorto: f.cufe ? String(f.cufe).slice(0, 8) + '…' + String(f.cufe).slice(-6) : null,
      emisor: txt(f.emisor), nit: txt(f.nit_emisor), numero, tipo: TIPO[f.tipo] || txt(f.tipo) || 'Documento',
      fechaEmision: txt(f.fecha_emision), diasDesdeEmision: dias, total: num(f.total),
      categoria: (txt(f.categoria) || 'otro').replace(/_/g, ' '), estado: ESTADO[f.estado] || txt(f.estado) || '—', estadoClave: f.estado, sede,
      ingreso: txt(f.num_ingreso) ? { numero: txt(f.num_ingreso), fecha: txt(f.fecha_ingreso) } : null,
      tienePdf: !!f.archivo_pdf, pedido, candidatos, avisos,
    };
  }

  return { ESTADO, TIPO, MAX_CANDIDATOS, armar };
});
