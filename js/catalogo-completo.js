// ============================================================
//  catalogo-completo.js  -  ADMIN > "📋 Catálogo completo"  (05/10/2026)
//  Todo el catalogo de compras cargado, en una sola tabla: articulo (codigo, nombre, unidad, subfamilia) + proveedor (nombre y NIT)
//  + precio / prioridad / estado, y lo que FALTA subir: articulos sin proveedor en el catalogo (con a quien ya se le ha comprado,
//  segun los pedidos), filas sin precio y proveedores sin NIT.
//  Logica pura (sin red ni DOM): la usa index.html y se prueba con node.
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CatalogoCompleto = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const nombreProv = (p) => (p ? (p.razon_social || p.nombre_comercial || '') : '');
  const nombreArt = (a) => (a ? (a.articulo_hiopos || a.articulo_comercial || '') : '');

  // filas: una por cada fila del catalogo + una por cada articulo que NO tiene ningun proveedor en el catalogo.
  // hist (vista proveedor_articulos: proveedor_id, codigo, veces, ultima) solo sugiere a quien se le ha comprado; usarHist=false
  // para una marca con catalogo propio (sus codigos chocan con los de `articulos`).
  function armarFilas({ cat = [], arts = [], provs = [], hist = [], usarHist = true } = {}) {
    const artDe = new Map(), provDe = new Map();
    for (const a of arts) if (a && a.codigo_barras && !artDe.has(a.codigo_barras)) artDe.set(a.codigo_barras, a);
    for (const p of provs) if (p && p.id != null) provDe.set(Number(p.id), p);
    const filas = [], conCatalogo = new Set();
    for (const k of cat) {
      const a = artDe.get(k.codigo_barras), p = provDe.get(Number(k.id_proveedor));
      conCatalogo.add(k.codigo_barras);
      const faltas = [];
      if (!a) faltas.push('el código no está en Artículos');
      if (!p) faltas.push('el proveedor no existe');
      else if (!String(p.nit || '').trim()) faltas.push('proveedor sin NIT');
      if (k.precio_negociado == null) faltas.push('sin precio');
      filas.push({ tipo: 'catalogo', id: k.id, codigo: k.codigo_barras, articulo: nombreArt(a) || null, unidad: a ? (a.unimedida_compra || a.unimedida_hiopos || '') : '',
        subfamilia: a ? (a.subfamilia || '') : '', proveedorId: k.id_proveedor, proveedor: nombreProv(p) || null, nit: p ? (String(p.nit || '').trim() || null) : null,
        precio: k.precio_negociado == null ? null : Number(k.precio_negociado), prioridad: k.prioridad == null ? null : k.prioridad, estado: k.estado || null, faltas, compradoA: [] });
    }
    // a quien se le ha comprado cada articulo (sumando por proveedor)
    const comprado = new Map();
    if (usarHist) for (const h of hist) {
      const id = Number(h.proveedor_id); if (!id || !h.codigo || conCatalogo.has(h.codigo)) continue;
      const m = comprado.get(h.codigo) || new Map(); comprado.set(h.codigo, m);
      const x = m.get(id) || { id, nombre: nombreProv(provDe.get(id)) || h.proveedor || ('proveedor #' + id), nit: provDe.get(id) ? (String(provDe.get(id).nit || '').trim() || null) : null, veces: 0, ultima: null };
      m.set(id, x); x.veces += Number(h.veces || 0); if (h.ultima && (!x.ultima || h.ultima > x.ultima)) x.ultima = h.ultima;
    }
    for (const a of artDe.values()) {
      if (conCatalogo.has(a.codigo_barras)) continue;
      const compradoA = [...(comprado.get(a.codigo_barras) || new Map()).values()].sort((x, y) => y.veces - x.veces);
      filas.push({ tipo: 'sin_proveedor', id: null, codigo: a.codigo_barras, articulo: nombreArt(a) || null, unidad: a.unimedida_compra || a.unimedida_hiopos || '', subfamilia: a.subfamilia || '',
        proveedorId: null, proveedor: null, nit: null, precio: null, prioridad: null, estado: null, faltas: ['sin proveedor en el catálogo'], compradoA });
    }
    return filas.sort((x, y) => norm(x.articulo || x.codigo).localeCompare(norm(y.articulo || y.codigo)) || String(x.codigo).localeCompare(String(y.codigo)) || norm(x.proveedor).localeCompare(norm(y.proveedor)));
  }

  const VISTAS = {
    todo: { t: 'Todo', f: () => true },
    catalogo: { t: 'En el catálogo', f: (x) => x.tipo === 'catalogo' },
    sin_proveedor: { t: 'Artículos sin proveedor', f: (x) => x.tipo === 'sin_proveedor' },
    sugeridos: { t: '…ya comprados a alguien', f: (x) => x.tipo === 'sin_proveedor' && x.compradoA.length > 0 },
    sin_precio: { t: 'Sin precio', f: (x) => x.tipo === 'catalogo' && x.precio == null },
    sin_nit: { t: 'Proveedor sin NIT', f: (x) => x.tipo === 'catalogo' && !!x.proveedor && !x.nit },
  };

  function resumen(filas) {
    const cat = filas.filter((x) => x.tipo === 'catalogo');
    const r = { filas: cat.length, articulos: new Set(cat.map((x) => x.codigo)).size, proveedores: new Set(cat.map((x) => x.proveedorId)).size };
    for (const v of Object.keys(VISTAS)) r[v] = filas.filter(VISTAS[v].f).length;
    return r;
  }

  function filtrar(filas, { ver = 'todo', q = '' } = {}) {
    const f = (VISTAS[ver] || VISTAS.todo).f, palabras = norm(q).trim().split(/\s+/).filter(Boolean);
    return filas.filter((x) => {
      if (!f(x)) return false;
      if (!palabras.length) return true;
      const texto = norm([x.codigo, x.articulo, x.subfamilia, x.unidad, x.proveedor, x.nit, ...x.compradoA.map((c) => c.nombre + ' ' + (c.nit || ''))].join(' '));
      return palabras.every((p) => texto.includes(p));
    });
  }

  const pesos = (n) => '$ ' + Number(n).toLocaleString('es-CO', { maximumFractionDigits: 2 });

  // opciones: { ver, resumen, limite, amarrar: nombre de la funcion global para amarrar (amarrarA / amarrarMarca) o '' , conHist }
  function html(filas, o = {}) {
    const r = o.resumen || resumen(filas), ver = VISTAS[o.ver] ? o.ver : 'todo', limite = o.limite || 400;
    const chip = (v) => `<button class="chip${v === ver ? ' on' : ''}" onclick="catCompVer('${v}')">${esc(VISTAS[v].t)} (${r[v]})</button>`;
    const vistas = ['todo', 'catalogo', 'sin_proveedor'].concat(o.conHist === false ? [] : ['sugeridos']).concat(['sin_precio', 'sin_nit']);
    const cab = `<div class="card" style="margin-bottom:10px"><div class="row" style="gap:18px;flex-wrap:wrap">
        <div><b style="font-size:20px">${r.filas}</b> <span class="mut">filas en el catálogo</span></div>
        <div><b style="font-size:20px">${r.articulos}</b> <span class="mut">artículos con proveedor</span></div>
        <div><b style="font-size:20px">${r.proveedores}</b> <span class="mut">proveedores</span></div>
        <div><b style="font-size:20px;color:#b91c1c">${r.sin_proveedor}</b> <span class="mut">artículos SIN proveedor (falta subirlos)</span></div></div>
      <div class="mut" style="margin-top:6px">${o.conHist === false ? '' : '“Se le ha comprado a” sale de los pedidos: es una pista de a quién amarrarlo, no está en el catálogo. '}Descarga con ⬇ Excel lo que estás viendo para completarlo e importarlo.</div></div>
      <div class="row" style="flex-wrap:wrap;gap:6px;margin-bottom:10px">${vistas.map(chip).join('')}</div>`;
    if (!filas.length) return cab + '<div class="vacio">Sin resultados.</div>';
    const fila = (x) => {
      const prov = x.tipo === 'catalogo'
        ? (x.proveedor ? esc(x.proveedor) : '<span style="color:#b91c1c">— no existe —</span>')
        : '<span style="color:#b91c1c;font-weight:700">— sin proveedor —</span>' + (x.compradoA.length
          ? '<div class="mut" style="font-size:11.5px;margin-top:3px">Se le ha comprado a: ' + x.compradoA.slice(0, 3).map((c) => `<b>${esc(c.nombre)}</b>${c.nit ? ' (NIT ' + esc(c.nit) + ')' : ''} · ${c.veces} ${c.veces === 1 ? 'vez' : 'veces'}`).join('; ') + (x.compradoA.length > 3 ? '; y ' + (x.compradoA.length - 3) + ' más' : '') + '</div>' : '');
      const nit = x.tipo === 'catalogo' ? (x.nit ? esc(x.nit) : (x.proveedor ? '<span style="color:#b91c1c">sin NIT</span>' : '—')) : '—';
      const precio = x.precio != null ? pesos(x.precio) : (x.tipo === 'catalogo' ? '<span style="color:#b45309">sin precio</span>' : '—');
      const accion = o.amarrar && x.codigo ? `<button class="s" style="padding:3px 10px;font-size:12px;white-space:nowrap" title="${x.tipo === 'catalogo' ? 'Amarrarlo a otro proveedor o cambiar su precio' : 'Amarrarlo a un proveedor (con precio)'}" onclick="${o.amarrar}('${esc(String(x.codigo).replace(/['\\]/g, ''))}')">＋ Amarrar</button>` : '';
      return `<tr${x.tipo === 'sin_proveedor' ? ' style="background:#fef2f2"' : ''}><td class="mut" style="white-space:nowrap">${esc(x.codigo)}</td><td style="min-width:190px">${x.articulo ? esc(x.articulo) : '<span style="color:#b91c1c">— no está en Artículos —</span>'}</td>
        <td class="mut">${esc(x.unidad || '—')}</td><td class="mut">${esc(x.subfamilia || '—')}</td><td style="min-width:190px;max-width:340px">${prov}</td><td style="white-space:nowrap">${nit}</td>
        <td class="num" style="white-space:nowrap">${precio}</td><td class="num mut">${x.prioridad == null ? '—' : esc(x.prioridad)}</td><td>${accion}</td></tr>`;
    };
    return cab + `<div class="card" style="padding:0;overflow-x:auto"><table><thead><tr><th>CÓDIGO</th><th>ARTÍCULO</th><th>UNIDAD</th><th>SUBFAMILIA</th><th>PROVEEDOR</th><th>NIT</th><th class="num">PRECIO</th><th class="num">PRIOR.</th><th></th></tr></thead>
      <tbody>${filas.slice(0, limite).map(fila).join('')}</tbody></table></div>`
      + (filas.length > limite ? `<div class="row" style="justify-content:center;margin:12px 0"><span class="mut">Mostrando ${limite} de ${filas.length}</span><button onclick="adminLimite+=400;pintarAdmin()">Ver 400 más</button></div>` : `<div class="mut" style="text-align:center;margin:10px 0">${filas.length} fila(s)</div>`);
  }

  return { esc, norm, armarFilas, resumen, filtrar, html, VISTAS };
});
