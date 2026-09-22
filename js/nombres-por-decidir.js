// ============================================================
//  nombres-por-decidir.js  -  HOMOLOGACION DE NOMBRES POR PROVEEDOR  (22/09/2026)   (Admin -> Agente -> Nombres por decidir)
//  Cuando el texto de una factura no se parece al nombre que el insumo tiene en el pedido/ERP (ej. "AJI PIQUE" vs "AJI DULCE"), el agente no lo
//  inventa: lo deja en producto_revision para que una persona diga a que nombre corresponde. Ese nombre queda aprendido POR PROVEEDOR (tabla
//  producto_alias, via la funcion producto_alias_registrar) y sirve tambien para la presentacion (el nombre YA dice si son 2 KILOS o UNDX2270).
//  Logica PURA y determinista (sin red, sin IA). La usa index.html (js/nombres-por-decidir-ui.js) y se prueba con node.
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NombresPorDecidir = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // El nombre que se va a ensenar: recorta espacios, exige 2-200 caracteres (mismo limite que la base)
  function validarNombre(nombre) {
    const n = String(nombre == null ? '' : nombre).replace(/\s+/g, ' ').trim();
    if (n.length < 2) return { ok: false, error: 'Escribe a qué nombre del pedido corresponde.' };
    if (n.length > 200) return { ok: false, error: 'El nombre es muy largo (máximo 200 caracteres).' };
    return { ok: true, nombre: n };
  }

  // r: fila de producto_revision  -> parametros de producto_alias_registrar (o null si el nombre no es valido)
  function armarEnsenar(r, nombre, usuario) {
    const v = validarNombre(nombre);
    if (!v.ok || !r) return null;
    return { p_proveedor_nit: r.proveedor_nit, p_texto_norm: r.texto_norm, p_nombre_pedido: v.nombre, p_usuario: usuario || null, p_revision_id: r.id, p_admin: true };
  }

  // Texto para el boton de una sugerencia (candidato que la conciliacion ya comparo): "AJI DULCE X KILO (33%)"
  const textoSugerencia = (s) => `${s && s.nombre || ''}${s && s.score != null ? ' (' + Math.round(s.score * 100) + '%)' : ''}`;

  return { validarNombre, armarEnsenar, textoSugerencia };
});
