// ============================================================
//  articulo-marcas.js  -  en que marcas aparece un articulo de la lista GENERAL (13/10/2026, pedido del usuario)
// ============================================================
// Igual que las casillas de marcas de Proveedores. La lista general (`articulos`) la usan las marcas SIN lista propia
// (Arrebatao, 123 wok, Casa de Nadie, Rocoto). Sin filas en articulo_marca = aparece en todas ellas (como siempre);
// con filas = solo en esas al hacer pedidos. Las marcas con lista propia (Sin Par) no tienen casilla: tienen sus propios
// codigos; ahi se agrega con «Usar esta referencia en otra marca».
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ArticuloMarcas = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tieneListaPropia = (marcaArts, marcaId) => (marcaArts || []).some((a) => a.marca_id === marcaId);

  // marcas que usan la lista general (las que NO tienen lista propia)
  const marcasGenerales = (marcas, marcaArts) => (marcas || []).filter((m) => !tieneListaPropia(marcaArts, m.id));
  // marcas con lista propia (Sin Par...)
  const marcasPropias = (marcas, marcaArts) => (marcas || []).filter((m) => tieneListaPropia(marcaArts, m.id));

  // filas de articulo_marca de un articulo
  const filasDe = (vinc, articuloId) => (vinc || []).filter((v) => Number(v.articulo_id) === Number(articuloId)).map((v) => Number(v.marca_id));

  // casillas marcadas: sin filas = todas las marcas generales
  function marcadas(vinc, articuloId, generales) {
    const f = filasDe(vinc, articuloId);
    return f.length ? f : (generales || []).map((m) => m.id);
  }

  // que guardar -> { ok, error?, agregar:[ids], quitar:[ids] }. Todas marcadas = sin filas (aparece en todas, como antes).
  function cambios(vinc, articuloId, elegidas, generales) {
    const e = [...new Set((elegidas || []).map(Number))];
    if (!e.length) return { ok: false, error: 'Marca al menos una marca: un artículo sin marcas no aparecería en ningún pedido.', agregar: [], quitar: [] };
    const todas = (generales || []).map((m) => m.id);
    const objetivo = todas.length && todas.every((id) => e.includes(id)) ? [] : e;
    const actuales = filasDe(vinc, articuloId);
    return { ok: true, agregar: objetivo.filter((id) => !actuales.includes(id)), quitar: actuales.filter((id) => !objetivo.includes(id)) };
  }

  // articulos de la lista general que ve una marca al hacer pedidos (los sin filas + los de esa marca). Necesita el `id` del articulo.
  function visibles(arts, vinc, marcaId) {
    if (!(vinc && vinc.length) || !marcaId) return arts || [];
    const con = new Map();
    for (const v of vinc) { const k = Number(v.articulo_id); (con.get(k) || con.set(k, new Set()).get(k)).add(Number(v.marca_id)); }
    return (arts || []).filter((a) => { const s = con.get(Number(a.id)); return !s || s.has(Number(marcaId)); });
  }

  // HTML: casillas de las marcas generales + nota de las marcas con lista propia (si ya esta ahi, por nombre)
  function casillas(marcas, marcaArts, vinc, articulo, idBase) {
    const gen = marcasGenerales(marcas, marcaArts), sel = new Set(marcadas(vinc, articulo.id, gen));
    const nombre = String(articulo.articulo_comercial || articulo.articulo_hiopos || '').trim().toUpperCase().replace(/\s+/g, ' ');
    const cb = gen.map((m) => `<label style="display:inline-flex;gap:4px;align-items:center;margin-right:12px"><input type="checkbox" id="${esc(idBase)}_m${Number(m.id)}" ${sel.has(m.id) ? 'checked' : ''} style="width:auto;margin:0"> ${esc(m.nombre)}</label>`).join('');
    const propias = marcasPropias(marcas, marcaArts).map((m) => {
      const ya = (marcaArts || []).find((a) => a.marca_id === m.id && String(a.articulo || '').trim().toUpperCase().replace(/\s+/g, ' ') === nombre);
      return `<span class="badge" title="${esc(m.nombre)} tiene su propia lista con sus códigos">${esc(m.nombre)}: ${ya ? 'ya está (código ' + esc(ya.codigo_barras) + ')' : 'no está — agrégalo abajo con «Usar esta referencia en otra marca»'}</span>`;
    }).join(' ');
    return cb + (propias ? `<div style="margin-top:6px">${propias}</div>` : '');
  }

  return { esc, marcasGenerales, marcasPropias, filasDe, marcadas, cambios, visibles, casillas };
});
