// ============================================================
//  desamarrar.js  -  SOLTAR UNA FACTURA DE SU PEDIDO SIN BORRAR NADA  (06/10/2026)
//  Antes no habia como: si se amarraba la factura a un pedido equivocado, la unica salida era BORRAR la factura (🗑)
//  y despues no se podia volver a subir (caso 1FEV1374564). Ahora "⛓ Desamarrar" (en el pedido y en la factura) llama a
//  la funcion pedido_factura_desamarrar de la base (supabase/desamarrar_pedido_factura.sql): el pedido queda sin
//  factura y la factura queda LIBRE en el banco. Si ya se ingreso al ERP, solo un admin, con motivo (el ERP no cambia).
//  Logica pura arriba (se prueba con node) + funciones de pagina abajo (usan las globales de index.html).
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Desamarrar = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const limpio = (s) => String(s == null ? '' : s).trim();
  const numeroFactura = (f, p) => limpio(f && (f.documento || ((f.prefijo || '') + (f.folio || '')))) || limpio(p && p.numero_factura) || 'la factura';

  // ¿Ya quedo en el ERP? -> texto que lo dice (N° de ingreso, pedido ERP o "facturado") o '' si no
  function enErp(p, f) {
    return limpio(p && p.pedido_erp) || limpio(f && f.num_ingreso) || ((p && p.estado === 'facturado') ? 'facturado' : '');
  }
  // Quien ve el boton (la base vuelve a revisar: una sede solo puede con SUS pedidos)
  const puede = (perfil) => !!perfil && ['admin', 'pagos', 'sede'].includes(perfil.rol);

  // Que preguntarle a la persona. -> { tipo: 'confirmar' | 'motivo' | 'bloqueado', texto }
  function plan(p, f, perfil) {
    const num = numeroFactura(f, p), ped = limpio(p && p.numero) || 'el pedido', erp = enErp(p, f);
    if (!erp) return { tipo: 'confirmar', texto: '¿Desamarrar la factura ' + num + ' del pedido ' + ped + '?\n\nLa factura NO se borra: vuelve a quedar libre en el banco.\nEl pedido queda sin factura, listo para amarrarle la correcta.' };
    if (!perfil || perfil.rol !== 'admin') return { tipo: 'bloqueado', texto: 'La factura ' + num + ' ya se ingresó al ERP (' + erp + ').\n\nDesamarrarla aquí NO la quita del ERP. Pídeselo a un administrador.' };
    return { tipo: 'motivo', texto: '⚠️ La factura ' + num + ' ya se ingresó al ERP (' + erp + ') con el pedido ' + ped + '.\n\nDesamarrarla aquí NO la quita del ERP: allá hay que corregirla o anularla a mano.\n\nSi igual quieres soltarla, escribe el motivo:' };
  }
  return { enErp, puede, plan, numeroFactura };
});

// ---------------------------------------------------------------- en la pagina
async function desamarrarPedidoFactura(p) {
  const f = (typeof facturas !== 'undefined' ? facturas : []).find((x) => x.cufe === p.factura_cufe) || {};
  const pl = Desamarrar.plan(p, f, perfil);
  let forzar = false, motivo = null;
  if (pl.tipo === 'bloqueado') { alert(pl.texto); return; }
  if (pl.tipo === 'motivo') { motivo = prompt(pl.texto, ''); if (!motivo || !motivo.trim()) return; forzar = true; }
  else if (!confirm(pl.texto)) return;
  const r = await SB.rpc('pedido_factura_desamarrar', { p_pedido_id: p.id, p_usuario: (perfil && perfil.nombre) || (usuario && usuario.email) || null, p_forzar: forzar, p_motivo: motivo });
  if (r.error) { alert('No se pudo desamarrar: ' + r.error.message); return; }
  pedidosCargados = false; await cargarPedidos(); await cargar();
  alert('Listo: la factura ' + (r.data || Desamarrar.numeroFactura(f, p)) + ' quedó libre en el banco y el pedido ' + (p.numero || '') + ' quedó sin factura.');
}
// Desde la tarjeta del pedido
async function desamarrarPedido(pid) {
  const p = pedidos.find((x) => x.id === pid);
  if (!p || !p.factura_cufe) { alert('Este pedido no tiene factura amarrada.'); return; }
  await desamarrarPedidoFactura(p);
}
// Desde la tarjeta de la factura: se busca su pedido (puede no estar en la lista cargada)
async function desamarrarFactura(cufe) {
  let p = (typeof pedidos !== 'undefined' ? pedidos : []).find((x) => x.factura_cufe === cufe);
  if (!p) {
    const q = await SB.from('pedidos').select('id,numero,estado,pedido_erp,factura_cufe,numero_factura').eq('factura_cufe', cufe);
    if (q.error) { alert('No pude buscar el pedido: ' + q.error.message); return; }
    if (!q.data || !q.data.length) { alert('Esta factura no está amarrada a ningún pedido (o no tienes acceso a ese pedido).'); return; }
    if (q.data.length > 1) { alert('Esta factura está amarrada a ' + q.data.length + ' pedidos (' + q.data.map((x) => x.numero).join(', ') + '): desamárrala desde cada pedido.'); return; }
    p = q.data[0];
  }
  await desamarrarPedidoFactura(p);
}
