// ============================================================
//  pedidos-atrasados.js  -  ALERTA de pedidos que llevan MAS DE 2 DIAS sin factura  (07/11/2026, pedido del usuario:
//  «crear alerta para los pedidos cuando lleven mas de 2 dias para hacerle seguimiento a los pendientes»)
// ============================================================
// Un pedido «atrasado» = sigue Pendiente, todavia no tiene factura (ni cuenta de cobro) amarrada y su fecha de pedido fue hace
// mas de 2 dias calendario (hora Colombia). En «Pedidos» sale un aviso rojo arriba con cuantos son, un boton para ver solo esos
// y, en cada pedido atrasado, cuantos dias lleva. Logica pura (se puede probar sin pantalla).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PedidosAtrasados = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const DIAS = 2;

  // hoy en Colombia (yyyy-mm-dd)
  function hoyCo(ahora) {
    const d = new Date((ahora ? new Date(ahora) : new Date()).getTime() - 5 * 3600 * 1000);
    return d.toISOString().slice(0, 10);
  }
  // dias calendario entre dos fechas yyyy-mm-dd (b - a)
  function diasEntre(a, b) {
    const x = Date.parse(String(a).slice(0, 10) + 'T00:00:00Z'), y = Date.parse(String(b).slice(0, 10) + 'T00:00:00Z');
    return isFinite(x) && isFinite(y) ? Math.round((y - x) / 86400000) : null;
  }
  // cuantos dias lleva un pedido pendiente sin factura (null si no aplica)
  function diasSinFactura(p, hoy) {
    if (!p || p.estado !== 'pendiente' || p.factura_cufe || !p.fecha) return null;
    const d = diasEntre(p.fecha, hoy || hoyCo());
    return d == null || d < 0 ? null : d;
  }
  const esAtrasado = (p, hoy, dias) => { const d = diasSinFactura(p, hoy); return d != null && d > (dias == null ? DIAS : dias); };
  // los atrasados, del mas viejo al mas nuevo
  function lista(pedidos, hoy, dias) {
    const h = hoy || hoyCo();
    return (pedidos || []).filter((p) => esAtrasado(p, h, dias))
      .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)) || (a.id || 0) - (b.id || 0));
  }
  // { total, porSede: [{sede, n}], masViejo: dias }
  function resumen(pedidos, hoy, dias) {
    const h = hoy || hoyCo(), l = lista(pedidos, h, dias), m = new Map();
    l.forEach((p) => { const s = p.sede_texto || 'Sin sede'; m.set(s, (m.get(s) || 0) + 1); });
    return { total: l.length, porSede: [...m.entries()].map(([sede, n]) => ({ sede, n })).sort((a, b) => b.n - a.n || a.sede.localeCompare(b.sede)),
      masViejo: l.length ? diasSinFactura(l[0], h) : 0 };
  }
  return { DIAS, hoyCo, diasEntre, diasSinFactura, esAtrasado, lista, resumen };
});
