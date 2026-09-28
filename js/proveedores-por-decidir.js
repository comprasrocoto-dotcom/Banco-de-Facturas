// ============================================================
//  proveedores-por-decidir.js  -  ENSEÑARLE AL AGENTE proveedores  (28/09/2026)   (Admin -> Agente -> Proveedores por decidir)
//  Cuando el bot de pedidos no encuentra el proveedor en el ERP (el nombre del pedido no coincide con el del ERP, ej. "HIELO" vs "HIELOS"), queda
//  en proveedor_revision para que una persona diga el nombre EXACTO que usa el ERP. Ese nombre queda aprendido por NIT (proveedor_nombre_pos, via
//  proveedor_nombre_pos_registrar): la proxima vez que un pedido traiga ese NIT, el agente lo usa directo, sin volver a preguntar.
//  Logica PURA y determinista (sin red, sin IA). La usa index.html (js/proveedores-por-decidir-ui.js) y se prueba con node.
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ProveedoresPorDecidir = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const soloDigitos = (t) => String(t == null ? '' : t).replace(/\D/g, '');

  // El NIT que se va a ensenar: al menos 5 digitos (sin puntos ni guion; se limpia solo)
  function validarNit(nit) {
    const n = soloDigitos(nit);
    if (n.length < 5) return { ok: false, error: 'Escribe el NIT del proveedor (sin puntos ni guión).' };
    return { ok: true, nit: n };
  }
  // El nombre EXACTO que usa el ERP: recorta espacios, exige 2-200 caracteres (mismo limite que la base)
  function validarNombre(nombre) {
    const n = String(nombre == null ? '' : nombre).replace(/\s+/g, ' ').trim();
    if (n.length < 2) return { ok: false, error: 'Escribe el nombre EXACTO que usa el ERP.' };
    if (n.length > 200) return { ok: false, error: 'El nombre es muy largo (máximo 200 caracteres).' };
    return { ok: true, nombre: n };
  }

  // r: fila de proveedor_revision, nit/nombre ya escritos por la persona -> parametros de proveedor_nombre_pos_registrar (o null si algo no es valido)
  function armarEnsenar(r, nit, nombre, usuario) {
    const vn = validarNit(nit), vb = validarNombre(nombre);
    if (!vn.ok || !vb.ok || !r) return null;
    return { p_nit: vn.nit, p_nombre_pos: vb.nombre, p_usuario: usuario || null, p_revision_id: r.id };
  }

  return { validarNit, validarNombre, armarEnsenar, soloDigitos };
});
