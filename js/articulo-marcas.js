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

  // ===================== (14/10/2026) TODAS las marcas en el editor, sea cual sea la lista del articulo =====================
  // origen: 0 = el articulo esta en la lista GENERAL; id = esta en la lista propia de esa marca (Sin Par).
  // En las marcas de OTRA lista, la casilla dice si el articulo ya esta ahi (por nombre); si no esta y se marca, se pide el
  // codigo en el ERP de esa marca y al guardar se copia (nunca se borra de una lista desde aqui).
  const nombreNorm = (s) => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]+/g, ' ').trim();
  const nombreDe = (a) => (a && (a.articulo_comercial || a.articulo_hiopos || a.articulo)) || '';

  function estadoTodas(o) {
    const origen = Number(o.origen) || 0, a = o.articulo || {}, n = nombreNorm(nombreDe(a));
    const gen = marcasGenerales(o.marcas, o.marcaArts);
    const ga = origen === 0 ? a : ((o.general || []).find((g) => n && nombreNorm(nombreDe(g)) === n) || null);
    const propias = marcasPropias(o.marcas, o.marcaArts).map((m) => ({
      marca: m, esOrigen: m.id === origen,
      enLista: m.id === origen ? null : ((o.marcaArts || []).find((x) => x.marca_id === m.id && n && nombreNorm(x.articulo) === n) || null) }));
    return { origen, articulo: a, gen, ga, vinc: o.vinc || [], marcadasGen: ga ? marcadas(o.vinc, ga.id, gen) : [], propias };
  }

  // HTML: una casilla por marca (en el orden de `marcas`) + los campos de codigo que hagan falta
  function casillasTodas(est, marcas, idBase) {
    const b = esc(idBase), cod = esc(est.articulo.codigo_barras || '');
    const cb = (id, marcado, deshab, nombre, extra) => `<label style="display:inline-flex;gap:4px;align-items:center;margin-right:12px"><input type="checkbox" id="${b}_m${Number(id)}" ${marcado ? 'checked' : ''} ${deshab ? 'disabled' : ''} style="width:auto;margin:0"> ${esc(nombre)}${extra ? ' <span class="mut" style="font-size:12px">' + extra + '</span>' : ''}</label>`;
    const genIds = new Set(est.gen.map((m) => m.id)), sel = new Set(est.marcadasGen);
    let html = '';
    for (const m of marcas || []) {
      if (genIds.has(m.id)) { html += cb(m.id, sel.has(m.id), false, m.nombre, ''); continue; }
      const p = est.propias.find((x) => x.marca.id === m.id); if (!p) continue;
      if (p.esOrigen) html += cb(m.id, true, true, m.nombre, '(su lista)');
      else if (p.enLista) html += cb(m.id, true, true, m.nombre, '(ya está: código ' + esc(p.enLista.codigo_barras) + ')');
      else html += cb(m.id, false, false, m.nombre, '');
    }
    const campos = [];
    if (!est.ga && est.gen.length) campos.push(`<label style="display:inline-flex;gap:6px;align-items:center;margin-right:14px"><span class="mut" style="font-size:12px">Si marcas ${esc(est.gen.map((m) => m.nombre).join(' / '))}: código en su ERP</span><input id="${b}_codgen" value="${cod}" style="width:130px;margin:0;text-transform:uppercase" autocomplete="off"></label>`);
    for (const p of est.propias) if (!p.esOrigen && !p.enLista) campos.push(`<label style="display:inline-flex;gap:6px;align-items:center;margin-right:14px"><span class="mut" style="font-size:12px">Si marcas ${esc(p.marca.nombre)}: código en su ERP</span><input id="${b}_cod${Number(p.marca.id)}" value="${cod}" style="width:130px;margin:0;text-transform:uppercase" autocomplete="off"></label>`);
    return html + (campos.length ? `<div style="margin-top:6px">${campos.join('')}</div>` : '');
  }

  // que hacer al guardar. leer = { marcada(id) -> bool, codigo(id) -> texto, codigoGen -> texto }; ca = CopiarArticulo (validar)
  // -> { ok, error?, copiarPropias:[{marca_id,nombre,codigo}], copiarGeneral:{codigo}|null, gaId, agregar:[ids], quitar:[ids] }
  function planGuardar(est, leer, ca, general, marcaArts) {
    const out = { ok: true, copiarPropias: [], copiarGeneral: null, gaId: est.ga ? est.ga.id : null, agregar: [], quitar: [] };
    for (const p of est.propias) {
      if (p.esOrigen || p.enLista || !leer.marcada(p.marca.id)) continue;
      const v = ca.validar(leer.codigo(p.marca.id), p.marca.id, general, marcaArts);
      if (!v.ok) return { ok: false, error: p.marca.nombre + ': ' + v.error };
      out.copiarPropias.push({ marca_id: p.marca.id, nombre: p.marca.nombre, codigo: v.codigo });
    }
    const elegidas = est.gen.filter((m) => leer.marcada(m.id)).map((m) => m.id);
    if (est.ga) {
      if (!elegidas.length && est.gen.length) return { ok: false, error: 'Marca al menos una de ' + est.gen.map((m) => m.nombre).join(', ') + ': un artículo sin marcas no aparecería en ningún pedido de ellas.' };
      const cc = cambios(est.vinc, est.ga.id, elegidas, est.gen);
      out.agregar = cc.agregar; out.quitar = cc.quitar;
    } else if (elegidas.length) {
      const v = ca.validar(leer.codigoGen, 0, general, marcaArts);
      if (!v.ok) return { ok: false, error: 'Lista general: ' + v.error };
      out.copiarGeneral = { codigo: v.codigo };
      out.agregar = elegidas.length === est.gen.length ? [] : elegidas;   // todas = sin filas (aparece en todas)
    }
    return out;
  }

  return { esc, marcasGenerales, marcasPropias, filasDe, marcadas, cambios, visibles, casillas, estadoTodas, casillasTodas, planGuardar };
});
