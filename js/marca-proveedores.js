// ============================================================
//  marca-proveedores.js  -  PROVEEDORES POR MARCA  (26/09/2026)   MARCA -> PROVEEDORES -> PRODUCTOS
//  Decide que proveedores (y que productos) ve cada marca. Logica pura (sin red ni DOM): la usa index.html y se prueba con node.
//  Datos: proveedor_marca (proveedor_id, marca_id) · marca_articulo · marca_catalogo (ver supabase/proveedor_marca.sql)
//
//  REGLA:  una marca con proveedores vinculados ve SOLO los suyos. Un proveedor SIN marca no se lista en ninguna marca con base cargada (se ve en Admin > Proveedores como "sin marca" hasta que se le asigne una).
//          una marca SIN proveedores cargados (123 wok, Casa de Nadie: su base aun no se ha cargado) sigue viendo todo, exactamente como antes.
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MarcaProv = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // provs: [{id,...}] · vinculos: [{proveedor_id, marca_id}] · marcaId: number|null
  function proveedoresVisibles(provs, vinculos, marcaId) {
    provs = provs || []; vinculos = vinculos || [];
    if (!marcaId) return provs;
    const deMarca = new Set();
    for (const v of vinculos) { if (v.marca_id === marcaId) deMarca.add(v.proveedor_id); }
    if (!deMarca.size) return provs;                                   // marca sin base cargada: como hoy
    return provs.filter((p) => deMarca.has(p.id));
  }

  // proveedores que no tienen ninguna marca (no se listan al hacer pedidos)
  function sinMarca(provs, vinculos) {
    const con = new Set((vinculos || []).map((v) => v.proveedor_id));
    return (provs || []).filter((p) => !con.has(p.id));
  }

  // Filtro ESTRICTO para Admin > Proveedores: '' = todos · 'sin' = los que no tienen ninguna marca · id = los de esa marca
  function proveedoresDeAdmin(provs, vinculos, filtro) {
    provs = provs || []; vinculos = vinculos || [];
    if (filtro === '' || filtro == null) return provs;
    if (filtro === 'sin') { const con = new Set(vinculos.map((v) => v.proveedor_id)); return provs.filter((p) => !con.has(p.id)); }
    const ids = new Set(vinculos.filter((v) => v.marca_id === Number(filtro)).map((v) => v.proveedor_id));
    return provs.filter((p) => ids.has(p.id));
  }

  const marcasDe = (vinculos, proveedorId) => (vinculos || []).filter((v) => v.proveedor_id === proveedorId).map((v) => v.marca_id);

  // ---- productos propios de la marca (sus codigos no son los de `articulos`)
  const tieneCatalogoPropio = (marcaArts, marcaId) => !!marcaId && (marcaArts || []).some((a) => a.marca_id === marcaId);
  // misma forma que `articulos`, para que el resto de la pantalla no note la diferencia
  const articulosDeMarca = (marcaArts, marcaId) => (marcaArts || []).filter((a) => a.marca_id === marcaId).map((a) => ({
    codigo_barras: a.codigo_barras, articulo_hiopos: a.articulo, articulo_comercial: a.articulo, unimedida_compra: a.unidad_compra || '', subfamilia: a.subfamilia || '' }));
  const catalogoDeMarca = (marcaCat, marcaId) => (marcaCat || []).filter((c) => c.marca_id === marcaId).map((c) => ({
    codigo_barras: c.codigo_barras, id_proveedor: c.id_proveedor, precio_negociado: c.precio_negociado }));

  // ---- Admin > Articulos por marca. Rocoto y Arrebatao comparten ERP (y por eso el catalogo general `articulos`); las demas marcas tienen su propio POS/ERP y sus codigos propios (marca_articulo).
  const esGeneral = (m) => ['rocoto', 'arrebatao'].indexOf(String((m && m.nombre) || '').trim().toLowerCase()) >= 0;
  const marcasPropias = (marcas) => (marcas || []).filter((m) => !esGeneral(m));
  // selector del catalogo: 'general' + las marcas que YA tienen articulos propios
  function opcionesCatalogo(marcas, marcaArts, seleccion) {
    const o = (v, t) => `<option value="${esc(v)}"${String(seleccion == null ? 'general' : seleccion) === String(v) ? ' selected' : ''}>${esc(t)}</option>`;
    return o('general', 'Rocoto y Arrebatao (catálogo general)') + marcasPropias(marcas).filter((m) => (marcaArts || []).some((a) => a.marca_id === m.id)).map((m) => o(m.id, m.nombre + ' (catálogo propio)')).join('');
  }
  // articulos propios de una marca con la forma de `articulos` (y su id) para reutilizar las tarjetas y el editor de Admin
  const articulosAdmin = (marcaArts, marcaId) => (marcaArts || []).filter((a) => a.marca_id === marcaId).map((a) => ({
    id: a.id, codigo_barras: a.codigo_barras, articulo_hiopos: a.articulo, articulo_comercial: a.articulo, unimedida_compra: a.unidad_compra || '', unimedida_hiopos: '', subfamilia: a.subfamilia || '' }));
  // texto de la pregunta "¿para que marca es el articulo?"
  function preguntaMarcaArticulo(marcas, porDefecto) {
    return '¿Para qué marca es el artículo?\n\n0. Rocoto y Arrebatao (catálogo general: comparten el mismo ERP)\n' + marcasPropias(marcas).map((m) => m.id + '. ' + m.nombre + ' (su propio ERP: códigos propios)').join('\n') + '\n\nEscribe el número' + (porDefecto != null ? ' (Enter = ' + porDefecto + ')' : '') + ':';
  }
  // 0 = general; id = marca con catalogo propio; null = respuesta invalida
  function marcaDeRespuesta(texto, marcas, porDefecto) {
    const t = String(texto == null ? '' : texto).trim();
    const n = t === '' ? Number(porDefecto || 0) : Number(t);
    if (!Number.isInteger(n) || n < 0) return null;
    if (n === 0) return 0;
    return marcasPropias(marcas).some((m) => m.id === n) ? n : null;
  }

  // ---- ventana "elegir proveedor" (Admin > Articulos > Amarrar): busqueda por nombre (sin tildes ni puntuacion, todas las palabras) o por NIT
  const plano = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  function buscarProveedores(provs, q) {
    const palabras = plano(q).split(' ').filter(Boolean);
    const lista = (provs || []).slice().sort((a, b) => plano(a.razon_social || a.nombre_comercial).localeCompare(plano(b.razon_social || b.nombre_comercial)));
    if (!palabras.length) return lista;
    return lista.filter((p) => {
      const texto = plano((p.razon_social || '') + ' ' + (p.nombre_comercial || '') + ' ' + (p.nit || ''));
      const compacto = texto.replace(/ /g, '');   // "sas" tambien encuentra "S.A.S."
      return palabras.every((w) => texto.indexOf(w) >= 0 || compacto.indexOf(w) >= 0);
    });
  }
  function filasProveedores(provs, q, seleccionadoId) {
    const l = buscarProveedores(provs, q);
    if (!l.length) return '<div class="mut" style="padding:12px">Ningún proveedor coincide con "' + esc(q) + '".</div>';
    return l.slice(0, 200).map((p) => `<div data-prov="${Number(p.id)}" onclick="provModalSel(${Number(p.id)})" style="padding:8px 10px;border-bottom:1px solid var(--line);cursor:pointer;${p.id === seleccionadoId ? 'background:#ccfbf1;font-weight:700' : ''}">${esc(p.razon_social || p.nombre_comercial || '—')} <span class="mut">${p.nit ? '· NIT ' + esc(p.nit) : '· sin NIT'}</span></div>`).join('') + (l.length > 200 ? '<div class="mut" style="padding:8px">…hay más: escribe para acotar.</div>' : '');
  }
  // Busqueda de articulos en Admin: codigo, AMBOS nombres (Hiopos y comercial: 699 de 732 solo tienen el comercial), subfamilia y unidad; sin tildes ni puntuacion, todas las palabras
  function buscarArticulos(articulos, q) {
    const palabras = plano(q).split(' ').filter(Boolean);
    if (!palabras.length) return articulos || [];
    return (articulos || []).filter((a) => {
      const texto = plano([a.codigo_barras, a.articulo_hiopos, a.articulo_comercial, a.subfamilia, a.unimedida_compra].join(' '));
      const compacto = texto.replace(/ /g, '');
      return palabras.every((w) => texto.indexOf(w) >= 0 || compacto.indexOf(w) >= 0);
    });
  }

  // proveedores que pueden recibir productos del catalogo GENERAL (Rocoto/Arrebatao): los de esas marcas o sin marca
  function proveedoresDelGeneral(provs, vinculos, marcas) {
    const gen = new Set((marcas || []).filter(esGeneral).map((x) => x.id)), con = new Set((vinculos || []).map((v) => v.proveedor_id)), enGen = new Set((vinculos || []).filter((v) => gen.has(v.marca_id)).map((v) => v.proveedor_id));
    return (provs || []).filter((p) => enGen.has(p.id) || !con.has(p.id));
  }

  // ---- Admin: cambios de marcas de un proveedor { agregar:[ids], quitar:[ids] }
  function cambiosMarcas(actuales, elegidas) {
    const a = new Set(actuales || []), e = new Set(elegidas || []);
    return { agregar: [...e].filter((x) => !a.has(x)), quitar: [...a].filter((x) => !e.has(x)) };
  }

  // selector de marca del listado de Admin
  function opcionesMarca(marcas, seleccion) {
    const o = (v, t) => `<option value="${esc(v)}"${String(seleccion == null ? '' : seleccion) === String(v) ? ' selected' : ''}>${esc(t)}</option>`;
    return o('', 'Todas las marcas') + (marcas || []).map((m) => o(m.id, m.nombre)).join('') + o('sin', 'Sin marca asignada');
  }
  // etiquetas de las marcas de un proveedor (tarjeta de Admin)
  function etiquetasMarcas(marcas, vinculos, proveedorId) {
    const ids = marcasDe(vinculos, proveedorId);
    if (!ids.length) return '<span class="badge" style="background:#fef3c7;color:#92400e">sin marca</span>';
    return ids.map((id) => { const m = (marcas || []).find((x) => x.id === id); return m ? `<span class="badge">${esc(m.nombre)}</span>` : ''; }).join(' ');
  }
  // casillas de marcas para el editor de proveedor
  function casillasMarcas(marcas, seleccionadas, idBase) {
    const s = new Set(seleccionadas || []);
    return (marcas || []).map((m) => `<label style="display:inline-flex;gap:4px;align-items:center;margin-right:12px"><input type="checkbox" id="${esc(idBase)}_m${Number(m.id)}" ${s.has(m.id) ? 'checked' : ''} style="width:auto;margin:0"> ${esc(m.nombre)}</label>`).join('');
  }

  return { esc, buscarArticulos, buscarProveedores, filasProveedores, proveedoresDelGeneral, esGeneral, marcasPropias, opcionesCatalogo, articulosAdmin, preguntaMarcaArticulo, marcaDeRespuesta, proveedoresVisibles, sinMarca, proveedoresDeAdmin, marcasDe, tieneCatalogoPropio, articulosDeMarca, catalogoDeMarca, cambiosMarcas, opcionesMarca, etiquetasMarcas, casillasMarcas };
});
