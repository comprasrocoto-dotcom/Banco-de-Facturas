// ============================================================
//  unidad-proveedor.js  -  UNIDAD DEL PROVEEDOR por articulo (14/10/2026, pedido del usuario)
// ============================================================
// Ej. GUSTAVE LORENTZ (Sin Par): en el POS se compra en UNDX5C (UNA botella que rinde 5 copas); el proveedor vende y factura
// por UNIDAD. La ORDEN DE COMPRA le llega en su unidad (cantidad x factor) y el INGRESO al ERP se hace en la unidad del POS
// (si la factura viene en la del proveedor: cantidad / factor, precio x factor).
//   unidad_proveedor: como la llama el proveedor; factor_proveedor: cuantas del proveedor son 1 del POS (vacio = 1).
// Lo usan la web (editor, orden de compra) y el agente (ingreso). Puro, sin red.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.UnidadProveedor = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const r4 = (n) => Math.round(n * 10000) / 10000, r2 = (n) => Math.round(n * 100) / 100;
  const limpiaU = (u) => String(u == null ? '' : u).trim().toUpperCase().replace(/\s+/g, ' ');

  // configuracion de un articulo (de articulos o marca_articulo) -> { unidad, factor, unidadPos } | null
  function de(art) {
    const u = limpiaU(art && art.unidad_proveedor);
    if (!u) return null;
    const f = Number(art.factor_proveedor);
    return { unidad: u, factor: f > 0 ? f : 1, unidadPos: limpiaU(art.unimedida_compra || art.unidad_compra) };
  }

  // lo que se escribio en el editor -> { ok, error?, valores:{unidad_proveedor, factor_proveedor}, cambio }
  function leerEditor(art, unidadTexto, factorTexto) {
    const u = limpiaU(unidadTexto);
    const fTxt = String(factorTexto == null ? '' : factorTexto).trim().replace(',', '.');
    let f = null;
    if (u) {
      f = fTxt === '' ? 1 : Number(fTxt);
      if (!(f > 0) || !isFinite(f)) return { ok: false, error: 'La equivalencia con la unidad del proveedor tiene que ser un número mayor que 0 (ej. 1 o 6).' };
      if (u.length > 30) return { ok: false, error: 'La unidad del proveedor es demasiado larga.' };
    }
    const antesU = limpiaU(art && art.unidad_proveedor), antesF = antesU ? (Number(art.factor_proveedor) > 0 ? Number(art.factor_proveedor) : 1) : null;
    const valores = { unidad_proveedor: u || null, factor_proveedor: u ? f : null };
    return { ok: true, valores, cambio: (antesU || null) !== valores.unidad_proveedor || antesF !== valores.factor_proveedor };
  }

  // ORDEN DE COMPRA: cantidad en la unidad del POS -> lo que se le pide al proveedor
  function paraProveedor(cantidad, unidadPos, conf) {
    const c = Number(cantidad);
    if (!conf) return { cantidad: c, unidad: unidadPos || '' };
    return { cantidad: r4(c * conf.factor), unidad: conf.unidad };
  }

  // INGRESO: linea de la factura (en la unidad del proveedor) -> unidad del POS.
  // linea { cantidad, precio }; opciones { cantidadPedido } (en unidades del POS). -> { estado, cantidad, precio, motivo } | null
  //  - factor 1: solo cambia el nombre de la unidad (misma cantidad y precio)
  //  - factor != 1: se confirma con la cantidad del pedido; si la factura ya viene en la unidad del POS no se toca; si no se puede
  //    confirmar, NOVEDAD (no se adivina)
  function deFactura(linea, conf, opciones) {
    if (!conf) return null;
    const c = Number(linea && linea.cantidad), p = Number(linea && linea.precio), cp = Number(opciones && opciones.cantidadPedido);
    if (!(c > 0)) return null;
    const txt = `${c} ${conf.unidad} = ${r4(c / conf.factor)} ${conf.unidadPos || 'unidad del POS'} (homologado en el artículo)`;
    if (conf.factor === 1) return { estado: 'CONVERTIDA', cantidad: c, precio: p, motivo: txt };
    const cerca = (a, b) => Math.abs(a - b) <= Math.max(0.001, Math.abs(b) * 0.01);
    if (cp > 0 && cerca(c / conf.factor, cp)) return { estado: 'CONVERTIDA', cantidad: r4(c / conf.factor), precio: r2(p * conf.factor), motivo: txt };
    if (cp > 0 && cerca(c, cp)) return { estado: 'SIN_CAMBIO', cantidad: c, precio: p, motivo: 'la factura ya viene en ' + (conf.unidadPos || 'la unidad del POS') };
    return { estado: 'NOVEDAD', motivo: `no se pudo confirmar si ${c} es en ${conf.unidad} (1 ${conf.unidadPos || 'del POS'} = ${conf.factor} ${conf.unidad}) o en ${conf.unidadPos || 'la unidad del POS'}: el pedido decia ${cp > 0 ? cp : 'sin cantidad'}` };
  }

  return { de, leerEditor, paraProveedor, deFactura, limpiaU };
});
