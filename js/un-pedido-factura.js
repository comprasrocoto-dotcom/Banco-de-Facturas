// ============================================================
//  un-pedido-factura.js  -  UNA FACTURA = UN PEDIDO para las sedes (16/10/2026, pedido del usuario)
// ============================================================
// Las sedes estaban amarrando DOS pedidos a la misma factura con «🔗 Buscar pedido» (10 facturas al 16/10). Una sede ya no puede
// amarrar un pedido a una factura que tiene otro pedido; admin y pagos si (hay casos reales, ej. un pedido partido en dos), pero
// se les pregunta. La base tambien lo exige para las sedes (supabase/un_pedido_por_factura.sql). Puro (sin red).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.UnPedidoFactura = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // numero del OTRO pedido (no anulado) que ya tiene esta factura, o '' si esta libre.
  // f: la factura (facturas_busqueda trae pedido_num / pedido_erp); pedidos: los cargados en la web; pid: el pedido que se va a amarrar
  function otroPedido(f, pedidos, pid) {
    const cufe = f && f.cufe;
    if (!cufe) return '';
    const p = (pedidos || []).find((x) => x && x.factura_cufe === cufe && x.id !== pid && x.estado !== 'anulado');
    if (p) return String(p.numero || p.pedido_erp || 'otro pedido');
    if (pid != null && (pedidos || []).some((x) => x && x.id === pid && x.factura_cufe === cufe)) return '';   // es el mismo pedido
    const n = f.pedido_num || f.pedido_erp;
    if (!n) return '';
    const mio = (pedidos || []).find((x) => x && x.id === pid);
    if (mio && (mio.numero === n || mio.pedido_erp === n)) return '';
    return String(n);
  }

  // 'libre' (no tiene otro pedido) | 'bloquear' (sede) | 'preguntar' (admin / pagos)
  function decidir(rol, otro) {
    if (!otro) return 'libre';
    return rol === 'admin' || rol === 'pagos' ? 'preguntar' : 'bloquear';
  }

  // ¿se muestra «🔗 Buscar pedido» en la tarjeta de la factura? (a la sede no, si ya tiene pedido)
  function mostrarBuscar(rol, f) {
    if (!f || f.tipo !== 'factura') return false;
    if (rol === 'admin' || rol === 'pagos') return true;
    return !(f.pedido_num || f.pedido_erp);
  }

  function textoBloqueo(otro) {
    return '⛔ Esta factura ya está amarrada al pedido ' + otro + '.\n\nCada factura va con UN solo pedido. Si el pedido amarrado es el equivocado, pide a administración que lo desamarre; si el proveedor mandó una sola factura para dos pedidos, avisa a administración.';
  }
  function textoPregunta(otro) {
    return '⚠️ Esta factura ya está amarrada al pedido ' + otro + '.\n\n¿Amarrar TAMBIÉN este pedido a la misma factura? (Solo si de verdad es una sola factura para los dos pedidos.)';
  }

  return { otroPedido, decidir, mostrarBuscar, textoBloqueo, textoPregunta };
});
