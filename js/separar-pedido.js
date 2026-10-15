// ============================================================
//  separar-pedido.js  -  PRODUCTOS QUE VAN EN UN PEDIDO APARTE, por PROVEEDOR + PRODUCTO  (06/10/2026)
//  Regla del usuario: para JUAN D. HOYOS DISTRIBUCIONES S.A.S. (proveedores.id 200), PAPA DELGADA 9X9 2KG (articulos.id
//  490) y PAPA SURECRISP FLAVOR 7x7x2.27KG (articulos.id 769) van SIEMPRE en un "PEDIDO ESPECIAL", separado del resto.
//  Las reglas viven en la tabla regla_pedido_aparte (proveedor_id + articulo_id, por ID: no dependen del nombre ni del
//  codigo, que se pueden cambiar). La condicion es PROVEEDOR + PRODUCTO: el mismo producto con otro proveedor NO se separa.
//  Los productos del mismo grupo van juntos en UN solo pedido; un producto nunca queda en dos pedidos; si no hay
//  productos especiales no se crea un pedido especial vacio. El precio no interviene.
//  Logica pura (sin red ni DOM): la usa index.html (guardarPedido) y se prueba con node.
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SepararPedido = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // reglas del proveedor elegido -> Map(articulo_id -> grupo)
  function reglasDe(reglas, proveedorId) {
    const m = new Map(), pid = Number(proveedorId);
    if (!pid) return m;
    for (const r of reglas || []) {
      if (!r || r.activo === false) continue;
      if (Number(r.proveedor_id) !== pid) continue;
      const aid = Number(r.articulo_id); if (!aid) continue;
      m.set(aid, String(r.grupo || 'PEDIDO ESPECIAL').trim() || 'PEDIDO ESPECIAL');
    }
    return m;
  }

  // filas: [{codigo, cant, ...}]; idDeCodigo(codigo) -> articulos.id (o null si no es del catalogo general)
  // -> { normales: [...], especiales: [{ grupo, filas: [...] }] }  (cada fila en UNO solo)
  function partir(filas, proveedorId, reglas, idDeCodigo) {
    const m = reglasDe(reglas, proveedorId);
    if (!m.size) return { normales: (filas || []).slice(), especiales: [] };
    const normales = [], porGrupo = new Map();
    for (const f of filas || []) {
      const id = f && f.codigo != null ? Number(idDeCodigo(f.codigo)) : NaN;
      const g = id ? m.get(id) : undefined;
      if (!g) { normales.push(f); continue; }
      if (!porGrupo.has(g)) porGrupo.set(g, []);
      porGrupo.get(g).push(f);
    }
    return { normales, especiales: [...porGrupo.entries()].map(([grupo, fs]) => ({ grupo, filas: fs })) };
  }

  // grupo especial al que iria un codigo con el proveedor elegido (para avisar en la lista de productos), o null
  function grupoDe(codigo, proveedorId, reglas, idDeCodigo) {
    const m = reglasDe(reglas, proveedorId); if (!m.size || codigo == null) return null;
    const id = Number(idDeCodigo(codigo));
    return (id && m.get(id)) || null;
  }

  // (14/10/2026) CATEGORIA de la orden segun la subfamilia: insumos | aseo | empaque | loza. Por PALABRAS, no por letras
  // sueltas: antes "GASEOSAS Y SODAS" contenia "ASEO" (g-ASEO-sas) y la gaseosa salia en la orden de material de aseo,
  // separada del agua (INDUSTRIA NACIONAL DE GASEOSAS, PED-0725/0726, 0737/0738).
  function categoria(subfamilia) {
    const palabras = String(subfamilia || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().split(/[^A-Z]+/).filter(Boolean);
    const hay = (fn) => palabras.some(fn);
    if (hay((w) => w === 'ASEO')) return 'aseo';
    if (hay((w) => w.startsWith('EMPAQUE'))) return 'empaque';
    if (hay((w) => w.startsWith('UTENSIL') || w === 'LOZA' || w === 'LOZAS')) return 'loza';
    return 'insumos';
  }

  return { reglasDe, partir, grupoDe, categoria };
});
