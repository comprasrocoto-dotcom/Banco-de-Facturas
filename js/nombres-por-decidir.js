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

  // (03/11/2026) REGLA POR MARCA (pedido del usuario): el nombre puede aplicar solo a una marca y llevar la equivalencia de unidades
  // de esa marca (ej. Arrebatao: 1 ATUN POR 130 GRAMOS = 0,13 KILO del proveedor).
  // marcaId: id de la marca o '' / null = todas; unidadTexto + factorTexto: opcionales (los dos o ninguno).
  // -> { ok, error?, rpc, params }. Sin marca y sin unidad se guarda como siempre (producto_alias_registrar).
  function armarRegla(r, nombre, usuario, marcaId, unidadTexto, factorTexto) {
    const v = validarNombre(nombre);
    if (!v.ok) return v;
    if (!r) return { ok: false, error: 'No encontré la fila.' };
    const u = String(unidadTexto == null ? '' : unidadTexto).replace(/\s+/g, ' ').trim().toUpperCase();
    const fTxt = String(factorTexto == null ? '' : factorTexto).trim().replace(',', '.');
    if (!u && fTxt) return { ok: false, error: 'Escribe también la unidad del proveedor (ej. KILO).' };
    let f = null;
    if (u) {
      f = Number(fTxt);
      if (!fTxt || !(f > 0) || !isFinite(f)) return { ok: false, error: 'Escribe cuántos ' + u + ' del proveedor son 1 del pedido (ej. 0,13).' };
      if (u.length > 30) return { ok: false, error: 'La unidad del proveedor es demasiado larga.' };
    }
    const m = marcaId === '' || marcaId == null ? null : Number(marcaId);
    if (m === null && !u) return { ok: true, rpc: 'producto_alias_registrar', params: armarEnsenar(r, v.nombre, usuario) };
    return { ok: true, rpc: 'producto_alias_marca_registrar', params: { p_proveedor_nit: r.proveedor_nit, p_texto_norm: r.texto_norm, p_marca_id: m,
      p_nombre_pedido: v.nombre, p_unidad_proveedor: u || null, p_factor_proveedor: u ? f : null, p_usuario: usuario || null, p_revision_id: r.id } };
  }

  return { validarNombre, armarEnsenar, textoSugerencia, armarRegla };
});
