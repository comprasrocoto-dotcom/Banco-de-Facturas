// ============================================================
//  copiar-articulo.js  -  COPIAR UNA REFERENCIA YA CREADA A LA LISTA DE OTRA MARCA (13/10/2026, pedido del usuario)
// ============================================================
// Hay dos tipos de lista de articulos: la GENERAL (`articulos`: Rocoto y Arrebatao, mismo ERP) y la PROPIA de cada marca
// con su propio ERP (`marca_articulo`: hoy Sin Par). Ej. el Portobello existe en la general y Sin Par tambien lo maneja:
// se copia la referencia (nombre, unidad, subfamilia) a la lista de Sin Par con el CODIGO DE ESE ERP (los codigos de las
// listas propias chocan con los de la general: mismo codigo, otro articulo). Solo agrega: no borra ni cambia nada.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CopiarArticulo = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const GENERAL = ['rocoto', 'arrebatao'];
  const esGeneral = (m) => GENERAL.indexOf(String((m && m.nombre) || '').trim().toLowerCase()) >= 0;
  const nombreNorm = (s) => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]+/g, ' ').trim();
  const codigoNorm = (s) => String(s || '').trim().toUpperCase().replace(/\s+/g, '');
  const nombreDe = (a) => (a && (a.articulo_comercial || a.articulo_hiopos || a.articulo)) || '';

  // listas a las que se puede copiar desde `origen` (0 = general; id = lista propia de esa marca)
  // -> [{ id, nombre, nueva }]  nueva = la marca aun no tiene lista propia (al copiar, deja de ver la general en Nuevo pedido)
  function destinos(marcas, marcaArts, origen) {
    const o = Number(origen) || 0, out = [];
    if (o !== 0) out.push({ id: 0, nombre: 'Rocoto y Arrebatao (general)', nueva: false });
    (marcas || []).filter((m) => !esGeneral(m) && m.id !== o).forEach((m) => {
      out.push({ id: m.id, nombre: m.nombre, nueva: !(marcaArts || []).some((a) => a.marca_id === m.id) });
    });
    return out;
  }

  // en que otras listas ya esta este articulo (mismo nombre) -> [{ id, codigo }]
  function dondeEsta(articulo, origen, general, marcaArts) {
    const n = nombreNorm(nombreDe(articulo)), o = Number(origen) || 0, out = [];
    if (!n) return out;
    if (o !== 0) { const g = (general || []).find((a) => nombreNorm(nombreDe(a)) === n); if (g) out.push({ id: 0, codigo: g.codigo_barras }); }
    (marcaArts || []).filter((a) => a.marca_id !== o && nombreNorm(a.articulo) === n).forEach((a) => out.push({ id: a.marca_id, codigo: a.codigo_barras }));
    return out;
  }

  // valida el codigo en la lista destino -> { ok, codigo, error }
  function validar(codigo, destino, general, marcaArts) {
    const c = codigoNorm(codigo), d = Number(destino) || 0;
    if (!c) return { ok: false, error: 'Escribe el código del artículo en el ERP de esa marca.' };
    if (c.length > 40) return { ok: false, error: 'El código es demasiado largo.' };
    const ya = d === 0 ? (general || []).find((a) => codigoNorm(a.codigo_barras) === c) : (marcaArts || []).find((a) => a.marca_id === d && codigoNorm(a.codigo_barras) === c);
    if (ya) return { ok: false, error: 'En esa lista el código ' + c + ' ya es "' + nombreDe(ya) + '". Escribe el código que tiene este artículo en el ERP de esa marca.' };
    return { ok: true, codigo: c };
  }

  // fila a insertar en la tabla de la lista destino
  function fila(articulo, destino, codigo) {
    const a = articulo || {}, d = Number(destino) || 0, nombre = String(nombreDe(a)).trim();
    const unidad = (a.unimedida_compra || a.unidad_compra || '') ? String(a.unimedida_compra || a.unidad_compra).trim().toUpperCase() : null;
    const sub = a.subfamilia ? String(a.subfamilia).trim() : null;
    if (d === 0) return { tabla: 'articulos', datos: { codigo_barras: codigo, articulo_hiopos: nombre, articulo_comercial: nombre, unimedida_compra: unidad, subfamilia: sub } };
    return { tabla: 'marca_articulo', datos: { marca_id: d, codigo_barras: codigo, articulo: nombre, unidad_compra: unidad, subfamilia: sub ? sub.toUpperCase() : null } };
  }

  return { esGeneral, nombreNorm, codigoNorm, destinos, dondeEsta, validar, fila };
});
