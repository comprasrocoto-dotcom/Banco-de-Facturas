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

  const SIN_SUB = '__sin__';   // valor del filtro de subfamilia para "(sin subfamilia)"

  // ver = situacion (VISTAS); prov = id de proveedor: sus filas del catalogo + lo que se le ha comprado y no esta en el catalogo;
  // sub = subfamilia exacta (SIN_SUB = vacia); q = palabras en codigo, articulo, subfamilia, unidad, proveedor, NIT.
  function filtrar(filas, { ver = 'todo', q = '', prov = '', sub = '' } = {}) {
    const f = (VISTAS[ver] || VISTAS.todo).f, palabras = norm(q).trim().split(/\s+/).filter(Boolean), pid = Number(prov) || 0;
    return filas.filter((x) => {
      if (!f(x)) return false;
      if (pid && !(Number(x.proveedorId) === pid || x.compradoA.some((c) => c.id === pid))) return false;
      if (sub && (sub === SIN_SUB ? !!x.subfamilia : (x.subfamilia || '') !== sub)) return false;
      if (!palabras.length) return true;
      const texto = norm([x.codigo, x.articulo, x.subfamilia, x.unidad, x.proveedor, x.nit, ...x.compradoA.map((c) => c.nombre + ' ' + (c.nit || ''))].join(' '));
      return palabras.every((p) => texto.includes(p));
    });
  }

  // cuantas filas tendria cada situacion con los DEMAS filtros puestos (proveedor, subfamilia, busqueda)
  function conteos(filas, { q = '', prov = '', sub = '' } = {}) {
    const base = filtrar(filas, { ver: 'todo', q, prov, sub }), r = {};
    for (const v of Object.keys(VISTAS)) r[v] = base.filter(VISTAS[v].f).length;
    return r;
  }

  // proveedores para el filtro: los del catalogo y a los que se les ha comprado algo que falta subir
  function proveedoresDe(filas) {
    const m = new Map();
    const de = (id, nombre, nit) => { const k = Number(id); if (!m.has(k)) m.set(k, { id: k, nombre: nombre || ('proveedor #' + k), nit: nit || null, enCatalogo: 0, porSubir: 0 }); return m.get(k); };
    for (const x of filas) {
      if (x.tipo === 'catalogo' && x.proveedorId != null) de(x.proveedorId, x.proveedor, x.nit).enCatalogo++;
      for (const c of x.compradoA) de(c.id, c.nombre, c.nit).porSubir++;
    }
    return [...m.values()].sort((a, b) => norm(a.nombre).localeCompare(norm(b.nombre)));
  }
  function subfamiliasDe(filas) {
    const m = new Map();
    for (const x of filas) { const k = x.subfamilia || SIN_SUB; m.set(k, (m.get(k) || 0) + 1); }
    return [...m.entries()].map(([valor, n]) => ({ valor, n })).sort((a, b) => (a.valor === SIN_SUB) - (b.valor === SIN_SUB) || a.valor.localeCompare(b.valor));
  }

  const ORDENES = { articulo: 'Artículo (A-Z)', proveedor: 'Proveedor (A-Z)', codigo: 'Código', precio: 'Precio (mayor primero)', subfamilia: 'Subfamilia' };
  function ordenar(filas, orden = 'articulo') {
    const l = filas.slice(), art = (x) => norm(x.articulo || x.codigo);
    if (orden === 'proveedor') l.sort((a, b) => (!a.proveedor) - (!b.proveedor) || norm(a.proveedor).localeCompare(norm(b.proveedor)) || art(a).localeCompare(art(b)));
    else if (orden === 'codigo') l.sort((a, b) => String(a.codigo).localeCompare(String(b.codigo), 'es', { numeric: true }));
    else if (orden === 'precio') l.sort((a, b) => (a.precio == null) - (b.precio == null) || (b.precio || 0) - (a.precio || 0) || art(a).localeCompare(art(b)));
    else if (orden === 'subfamilia') l.sort((a, b) => (!a.subfamilia) - (!b.subfamilia) || norm(a.subfamilia).localeCompare(norm(b.subfamilia)) || art(a).localeCompare(art(b)));
    return l;   // 'articulo': el orden de armarFilas
  }

  const pesos = (n) => '$ ' + Number(n).toLocaleString('es-CO', { maximumFractionDigits: 2 });

  // opciones: { ver, resumen (totales del catalogo), conteos (por situacion con los demas filtros), proveedores, subfamilias, prov, sub,
  //   orden, hayFiltros, limite, amarrar: nombre de la funcion global para amarrar (amarrarA / amarrarMarca) o '', conHist }
  function html(filas, o = {}) {
    const r = o.resumen || resumen(filas), ver = VISTAS[o.ver] ? o.ver : 'todo', limite = o.limite || 400;
    const n = o.conteos || r, prov = String(o.prov || ''), sub = String(o.sub || ''), orden = ORDENES[o.orden] ? o.orden : 'articulo';
    const chip = (v) => `<button class="chip${v === ver ? ' on' : ''}"${n[v] || v === ver ? '' : ' style="opacity:.55"'} onclick="catCompVer('${v}')">${esc(VISTAS[v].t)} (${n[v]})</button>`;
    const vistas = ['todo', 'catalogo', 'sin_proveedor'].concat(o.conHist === false ? [] : ['sugeridos']).concat(['sin_precio', 'sin_nit']);
    const opt = (v, t, sel) => `<option value="${esc(v)}"${String(v) === sel ? ' selected' : ''}>${esc(t)}</option>`;
    const selProv = opt('', 'Todos los proveedores', prov) + (o.proveedores || []).map((p) => opt(p.id, p.nombre + (p.nit ? ' · NIT ' + p.nit : '') + ' (' + p.enCatalogo + ' en catálogo' + (p.porSubir ? ', ' + p.porSubir + ' por subir' : '') + ')', prov)).join('');
    const selSub = opt('', 'Todas las subfamilias', sub) + (o.subfamilias || []).map((s) => opt(s.valor, (s.valor === SIN_SUB ? '(sin subfamilia)' : s.valor) + ' (' + s.n + ')', sub)).join('');
    const selOrd = Object.keys(ORDENES).map((k) => opt(k, ORDENES[k], orden)).join('');
    const campo = (titulo, html, crece) => `<label style="display:flex;flex-direction:column;gap:3px;min-width:0;flex:${crece || 1} 1 220px;max-width:100%"><span class="mut" style="font-size:12px">${titulo}</span>${html}</label>`;
    const cab = `<div class="card" style="margin-bottom:10px"><div class="row" style="gap:18px;flex-wrap:wrap">
        <div><b style="font-size:20px">${r.filas}</b> <span class="mut">filas en el catálogo</span></div>
        <div><b style="font-size:20px">${r.articulos}</b> <span class="mut">artículos con proveedor</span></div>
        <div><b style="font-size:20px">${r.proveedores}</b> <span class="mut">proveedores</span></div>
        <div><b style="font-size:20px;color:#b91c1c">${r.sin_proveedor}</b> <span class="mut">artículos SIN proveedor (falta subirlos)</span></div></div>
      <div class="mut" style="margin-top:6px">${o.conHist === false ? '' : '“Se le ha comprado a” sale de los pedidos: es una pista de a quién amarrarlo, no está en el catálogo. '}Descarga con ⬇ Excel lo que estás viendo para completarlo e importarlo.</div></div>
      <div class="card" style="margin-bottom:10px;padding:12px 14px">
        <div class="row" style="flex-wrap:wrap;gap:10px;align-items:flex-end">
          ${campo('Proveedor', `<select style="width:100%;margin:0" onchange="catCompSet('prov',this.value)">${selProv}</select>`, 2.5)}
          ${campo('Subfamilia', `<select style="width:100%;margin:0" onchange="catCompSet('sub',this.value)">${selSub}</select>`)}
          ${campo('Ordenar por', `<select style="width:100%;margin:0" onchange="catCompSet('orden',this.value)">${selOrd}</select>`)}
          ${o.hayFiltros ? '<button style="flex:0 0 auto" onclick="catCompLimpiar()">✕ Limpiar filtros</button>' : ''}
        </div>
        <div class="mut" style="font-size:12px;margin:10px 0 4px">Situación</div>
        <div class="row" style="flex-wrap:wrap;gap:6px">${vistas.map(chip).join('')}</div>
        ${prov && o.conHist !== false ? '<div class="mut" style="font-size:12px;margin-top:8px">Con un proveedor elegido también salen (en rojo) los artículos que se le han comprado y todavía no están en su catálogo.</div>' : ''}
      </div>
      <div class="mut" style="margin:0 2px 6px"><b>${filas.length}</b> fila(s) con estos filtros</div>`;
    if (!filas.length) return cab + '<div class="vacio">Sin resultados con estos filtros.</div>';
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

  return { esc, norm, armarFilas, resumen, filtrar, conteos, proveedoresDe, subfamiliasDe, ordenar, html, VISTAS, ORDENES, SIN_SUB };
});
