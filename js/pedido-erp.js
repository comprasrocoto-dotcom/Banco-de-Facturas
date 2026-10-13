// ============================================================
//  pedido-erp.js  -  ¿lo escrito en "N° pedido en el ERP" es de verdad un numero del ERP? (13/10/2026)
// ============================================================
// Incidente real (orden #328): en PED-0493 alguien escribio una nota ("2 BOTELLAS JOSE CUERVO Y 1 CAJA DE CLUB DORADA") en
// el campo "N° pedido en el ERP". Con ese campo lleno el agente cree que el pedido YA esta montado en "Pedidos de compra" y
// usa el camino viejo (abrir el pedido y facturarlo) en vez de la factura directa -> no lo encuentra y falla.
// Validos: "FCRC2556", "FCRC / 371", "FC.BAR / 1890", "154". Lo usan la web (no deja guardar texto) y el agente (lo ignora).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PedidoErp = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const RE = /^\s*(?:[A-Za-z][A-Za-z.]{0,9}\s*[/-]?\s*)?\d{1,9}\s*$/;
  const vacio = (t) => String(t == null ? '' : t).trim() === '';
  // true si es un numero del ERP (serie + numero, o solo el numero)
  const valido = (t) => !vacio(t) && RE.test(String(t));
  // texto para el aviso de la web
  const AYUDA = 'El «N° pedido en el ERP» es solo el número del pedido de compra en el ERP (ej. FCRC / 371 o 371). Si es una nota, escríbela en «Observación de factura».';
  return { valido, vacio, AYUDA };
});
