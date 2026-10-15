// ============================================================
//  codigo-marca.js  -  CODIGO DEL ERP POR MARCA para un articulo COMPARTIDO de la lista general (15/10/2026, pedido del usuario)
// ============================================================
// Rocoto, Arrebatao, 123 wok y Casa de Nadie usan la MISMA lista general de articulos, pero algunas marcas (123 wok, Casa de
// Nadie) tienen en su ERP otro codigo para el mismo articulo. Aqui se guarda ese codigo (tabla articulo_codigo_marca) y SOLO se
// usa al ir al ERP: el CSV que importa el robot (pedido de compra y factura directa) y el ⬇ CSV de la web. En la web el
// articulo sigue con su codigo general (proveedores, precios, maximos, historial). Sin codigo de marca -> el general, como antes.
// Puro (sin red): lo usan la web (editor, CSV) y el agente (agente-pedidos.js).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CodigoMarca = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const norm = (s) => String(s == null ? '' : s).trim().replace(/\s+/g, '').toUpperCase();

  // filas de articulo_codigo_marca (con el codigo general del articulo) -> Map("marca|GENERAL" -> codigo de la marca)
  //   fila = { marca_id, codigo, codigo_general }   o   { marca_id, codigo, articulos: { codigo_barras } } (como lo trae la base)
  function indexar(filas) {
    const m = new Map();
    for (const f of filas || []) {
      const gen = norm(f && (f.codigo_general != null ? f.codigo_general : f.articulos && f.articulos.codigo_barras));
      const cod = norm(f && f.codigo);
      if (!f || f.marca_id == null || !gen || !cod) continue;
      m.set(String(f.marca_id) + '|' + gen, cod);
    }
    return m;
  }
  const codigoDe = (mapa, marcaId, codigoGeneral) => (mapa && marcaId != null && mapa.get(String(marcaId) + '|' + norm(codigoGeneral))) || null;

  // items [{ codigo, ... }] de un pedido de la marca -> { items (copias, codigo de la marca si tiene), cambios: [{ de, a }] }
  function traducir(items, marcaId, mapa) {
    const cambios = [];
    const out = (items || []).map((it) => {
      const c = it && codigoDe(mapa, marcaId, it.codigo);
      if (!c || c === norm(it.codigo)) return it;
      cambios.push({ de: it.codigo, a: c });
      return Object.assign({}, it, { codigo: c, codigo_general: it.codigo });
    });
    return { items: out, cambios };
  }

  // lo escrito en el editor -> { ok, errores, poner: [{ marca_id, codigo }], quitar: [marca_id] }
  //   actuales = { [marca_id]: codigo }   escritos = { [marca_id]: texto }   general = codigo general del articulo
  function cambios(actuales, escritos, general) {
    const errores = [], poner = [], quitar = [];
    for (const [mid, texto] of Object.entries(escritos || {})) {
      const c = norm(texto), antes = norm((actuales || {})[mid]);
      if (!c) { if (antes) quitar.push(Number(mid)); continue; }
      if (c.length > 40) { errores.push('El código de la marca es demasiado largo (máx. 40).'); continue; }
      if (/[^A-Z0-9_\-.]/.test(c)) { errores.push('El código «' + texto + '» solo puede tener letras, números, guion y punto.'); continue; }
      if (c === norm(general)) { if (antes) quitar.push(Number(mid)); continue; }   // igual al general: no hace falta guardarlo
      if (c !== antes) poner.push({ marca_id: Number(mid), codigo: c });
    }
    return { ok: errores.length === 0, errores, poner, quitar };
  }

  return { norm, indexar, codigoDe, traducir, cambios };
});
