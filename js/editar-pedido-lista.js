// ============================================================
//  editar-pedido-lista.js  -  articulos para "＋ Anexar artículo" en Editar pedido (13/10/2026)
// ============================================================
// Antes la lista solo traia lo que YA se le habia comprado a ese proveedor (Dulce Mar: 1 articulo) -> no se encontraba
// nada nuevo, y lo escrito a mano se guardaba como si fuera el CODIGO (el agente no lo puede ingresar al ERP).
// Ahora: primero lo que se le compra a ese proveedor y luego TODOS los articulos de la marca del pedido (lista general o
// la propia de la marca); y al guardar, una linea nueva tiene que ser un articulo de la lista.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EditarPedidoLista = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const fmt = (a) => ({ codigo: a.codigo_barras, unidad: a.unimedida_compra || '', subfamilia: a.subfamilia || '',
    nombre: (a.articulo_hiopos || a.articulo_comercial || a.codigo_barras || '') + (a.unimedida_compra ? ' (' + a.unimedida_compra + ')' : '') });

  // provArts: [{codigo, insumo, veces}] (historial con ese proveedor); base: articulos de la marca con la forma de `articulos`
  function armar(provArts, base) {
    const porCod = new Map((base || []).filter((a) => a.codigo_barras).map((a) => [a.codigo_barras, a]));
    const out = [], vistos = new Set();
    for (const pa of provArts || []) {
      const a = porCod.get(pa.codigo);
      if (a && !vistos.has(a.codigo_barras)) { out.push(Object.assign(fmt(a), { delProveedor: true })); vistos.add(a.codigo_barras); }
      else if (!a && pa.codigo && !vistos.has(pa.codigo)) { out.push({ codigo: pa.codigo, unidad: '', subfamilia: '', nombre: pa.insumo || pa.codigo, delProveedor: true }); vistos.add(pa.codigo); }
    }
    for (const a of base || []) if (a.codigo_barras && !vistos.has(a.codigo_barras)) { out.push(fmt(a)); vistos.add(a.codigo_barras); }
    return out;
  }

  // el articulo de la lista que corresponde a lo escrito (nombre exacto de la lista o su codigo); null si no es de la lista
  function buscar(lista, texto) {
    const t = String(texto || '').trim();
    if (!t) return null;
    const u = t.toUpperCase();
    return (lista || []).find((a) => a.nombre === t) || (lista || []).find((a) => String(a.codigo || '').toUpperCase() === u) ||
      (lista || []).find((a) => a.nombre.toUpperCase() === u) || null;
  }

  // filas del formulario [{id, cod, texto, cantidad}] -> { ok, errores, nuevas: [{codigo, insumo, unidad, cantidad}] }
  function validarNuevas(filas, lista) {
    const errores = [], nuevas = [];
    for (const f of filas || []) {
      if (f.id || f.cod) continue;                     // las que ya existian se guardan como siempre
      const texto = String(f.texto || '').trim();
      if (!texto) continue;
      const a = buscar(lista, texto);
      if (!a) { errores.push('"' + texto + '" no está en la lista de artículos: elígelo de la lista que aparece al escribir.'); continue; }
      nuevas.push({ codigo: a.codigo, insumo: a.nombre.replace(/ \([^()]*\)$/, ''), unidad: a.unidad || null, cantidad: f.cantidad });
    }
    return { ok: !errores.length, errores, nuevas };
  }

  return { armar, buscar, validarNuevas };
});
