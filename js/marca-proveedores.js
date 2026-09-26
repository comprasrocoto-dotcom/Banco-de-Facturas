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

  return { proveedoresVisibles, sinMarca, proveedoresDeAdmin, marcasDe, tieneCatalogoPropio, articulosDeMarca, catalogoDeMarca, cambiosMarcas, opcionesMarca, etiquetasMarcas, casillasMarcas };
});
