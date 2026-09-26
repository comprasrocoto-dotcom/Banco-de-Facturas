// ============================================================
//  admin-editar.js  -  EDITAR ARTICULOS (unidad de medida) Y PROVEEDORES (datos) desde Admin  (26/09/2026)
//  Logica pura (sin red ni DOM): valida, compara y arma el HTML de los editores. La usa index.html y se prueba con node.
//  Solo se cambia lo que la persona modifica (un PATCH con los campos distintos), nunca se reescribe la fila entera.
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AdminEditar = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const limpio = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

  // ---- unidad de medida de compra: texto libre en el formato del ERP (KILO, UNIDADES, UNDX500G...), siempre en MAYUSCULAS y sin espacios
  function normalizarUnidad(s) { return limpio(s).replace(/\s+/g, '').toUpperCase(); }

  // Las unidades que ya existen en el catalogo de articulos (mas usadas primero) + las del catalogo de unidades: se ofrecen como sugerencia para no inventar variantes
  function unidadesConocidas(articulos, catalogo) {
    const cuenta = new Map();
    for (const a of articulos || []) { const u = normalizarUnidad(a && a.unimedida_compra); if (u) cuenta.set(u, (cuenta.get(u) || 0) + 1); }
    for (const c of catalogo || []) { const u = normalizarUnidad(c && (c.nombre || c.canon)); if (u && !cuenta.has(u)) cuenta.set(u, 0); }
    return [...cuenta.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map((e) => e[0]);
  }

  // { ok, unidad, cambio, error }  · una unidad vacia no se acepta (el agente y los pedidos la necesitan)
  function validarUnidad(actual, nueva) {
    const u = normalizarUnidad(nueva);
    if (!u) return { ok: false, error: 'La unidad no puede quedar vacía.' };
    if (u.length > 40) return { ok: false, error: 'La unidad es demasiado larga (máx. 40 caracteres).' };
    if (/[^A-Z0-9ÁÉÍÓÚÑ*.,/_\-+]/.test(u)) return { ok: false, error: 'La unidad tiene caracteres no válidos (usa letras, números y * . , / - _).' };
    return { ok: true, unidad: u, cambio: u !== normalizarUnidad(actual) };
  }

  // ---- codigo del articulo (articulos.codigo_barras): mayusculas y sin espacios, como todos los que ya existen; unico
  function normalizarCodigo(s) { return limpio(s).replace(/\s+/g, '').toUpperCase(); }
  function validarCodigo(actual, nuevo, articulos, id) {
    const c = normalizarCodigo(nuevo);
    if (!c) return { ok: false, error: 'El código no puede quedar vacío.' };
    if (c.length > 40) return { ok: false, error: 'El código es demasiado largo (máx. 40 caracteres).' };
    if (/[^A-Z0-9_\-.]/.test(c)) return { ok: false, error: 'El código solo puede tener letras, números, guion y punto.' };
    const otro = (articulos || []).find((a) => a && a.id !== id && normalizarCodigo(a.codigo_barras) === c);
    if (otro) return { ok: false, error: 'Ya existe otro artículo con ese código: ' + (otro.articulo_hiopos || otro.articulo_comercial || c) + '.' };
    return { ok: true, codigo: c, cambio: c !== normalizarCodigo(actual) };
  }

  // Valida lo escrito en el editor del articulo. Una unidad que no se toco no se valida (hay articulos sin unidad y solo se quiere cambiar el codigo).
  function validarArticulo(a, escrito, articulos) {
    const errores = [], r = { ok: false, errores, codigo: { cambio: false }, unidad: { cambio: false } };
    const vc = validarCodigo(a.codigo_barras, escrito.codigo, articulos, a.id);
    if (!vc.ok) errores.push(vc.error); else r.codigo = { cambio: vc.cambio, valor: vc.codigo };
    if (normalizarUnidad(escrito.unidad) !== normalizarUnidad(a.unimedida_compra)) {
      const vu = validarUnidad(a.unimedida_compra, escrito.unidad);
      if (!vu.ok) errores.push(vu.error); else r.unidad = { cambio: true, valor: vu.unidad };
    }
    r.ok = errores.length === 0;
    return r;
  }

  // ---- proveedor
  const CAMPOS_PROV = ['razon_social', 'nombre_comercial', 'nit', 'telefono1', 'telefono2', 'correo', 'asesor'];
  const soloDigitos = (s) => String(s == null ? '' : s).replace(/[^0-9]/g, '');
  const correoValido = (s) => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(s);

  // datos: lo escrito en el formulario. Devuelve { ok, errores[], valores } con los valores ya limpios (texto vacio = null)
  function validarProveedor(datos, opciones) {
    opciones = opciones || {};
    const v = {
      razon_social: limpio(datos.razon_social), nombre_comercial: limpio(datos.nombre_comercial) || null, nit: soloDigitos(datos.nit) || null,
      telefono1: limpio(datos.telefono1) || null, telefono2: limpio(datos.telefono2) || null, correo: limpio(datos.correo).toLowerCase() || null, asesor: limpio(datos.asesor) || null,
    };
    const errores = [];
    if (!v.razon_social) errores.push('La razón social es obligatoria.');
    if (v.nit && (v.nit.length < 5 || v.nit.length > 15)) errores.push('El NIT debe tener entre 5 y 15 dígitos (sin dígito de verificación).');
    if (v.correo && !v.correo.split(/[;,]/).every((c) => correoValido(limpio(c)))) errores.push('El correo no es válido.');
    if (v.nit) {
      const otro = (opciones.otros || []).find((p) => p && p.id !== opciones.id && soloDigitos(p.nit) === v.nit);
      if (otro) errores.push('Ese NIT ya lo tiene otro proveedor: ' + (otro.razon_social || otro.nombre_comercial || '#' + otro.id) + '.');
    }
    return { ok: errores.length === 0, errores, valores: v };
  }

  // Solo los campos que cambiaron (para el PATCH). Compara normalizando vacio = null.
  function cambiosProveedor(original, valores) {
    const n = (x) => (x == null || String(x).trim() === '' ? null : String(x).trim());
    const cambios = {};
    for (const c of CAMPOS_PROV) { const a = c === 'nit' ? n(soloDigitos(original && original[c])) : n(original && original[c]); if (a !== n(valores[c])) cambios[c] = valores[c] == null ? null : valores[c]; }
    return cambios;
  }
  // Cambios que afectan como se reconoce al proveedor en facturas / pedidos: la pantalla pide confirmacion
  const cambiaIdentidad = (cambios) => 'nit' in cambios || 'razon_social' in cambios;

  // ---- HTML de los editores (van dentro de la tarjeta de la lista de Admin)
  function editorArticulo(a, conocidas, opciones) {
    opciones = opciones || {};
    const id = 'ea_' + Number(a.id);
    return `<div class="card" style="margin:6px 0;border-left:5px solid #0f766e">
      <div class="emisor">✏️ Editar artículo · ${esc(a.articulo_hiopos || a.articulo_comercial || '—')}</div>
      <div class="row" style="margin-top:8px;gap:10px;flex-wrap:wrap;align-items:flex-end">
        <label style="display:block;min-width:160px"><span class="mut">Código</span>
          <input id="${id}_codigo" value="${esc(a.codigo_barras || '')}" style="margin:2px 0 0;width:100%;text-transform:uppercase" autocomplete="off"></label>
        <label style="display:block;min-width:220px"><span class="mut">Unidad de medida (compra)</span>
          <input id="${id}_unidad" list="${id}_l" value="${esc(a.unimedida_compra || '')}" placeholder="KILO, UNIDADES, UNDX500G…" style="margin:2px 0 0;width:100%;text-transform:uppercase" autocomplete="off"></label>
        <datalist id="${id}_l">${(conocidas || []).slice(0, 300).map((u) => `<option value="${esc(u)}">`).join('')}</datalist>
        <button class="p" onclick="guardarArticuloAdmin(${Number(a.id)})">💾 Guardar</button>
        <button onclick="cancelarEdicionAdmin()">Cancelar</button></div>
      <div class="mut" style="margin-top:6px">La unidad es en la que se compra y se pide (formato del ERP). Si cambias el código, se actualiza también en los amarres a proveedores (con sus precios), el historial de precios y las líneas de los pedidos; debe ser el código que tiene el ERP. Queda registrado quién y cuándo.</div>
      ${opciones.error ? `<div style="color:#b91c1c;margin-top:6px">${esc(opciones.error)}</div>` : ''}</div>`;
  }

  function editorProveedor(p, opciones) {
    opciones = opciones || {};
    const id = 'ep_' + Number(p.id);
    const campo = (col, etiqueta, ancho, extra) => `<label style="display:block;flex:${ancho || 1};min-width:180px"><span class="mut">${etiqueta}</span>
        <input id="${id}_${col}" value="${esc(p[col] == null ? '' : p[col])}" style="margin:2px 0 0;width:100%" autocomplete="off" ${extra || ''}></label>`;
    return `<div class="card" style="margin:6px 0;border-left:5px solid #0f766e">
      <div class="emisor">✏️ Editar proveedor</div>
      <div class="row" style="gap:10px;margin-top:6px;flex-wrap:wrap">${campo('razon_social', 'Razón social *', 2)}${campo('nombre_comercial', 'Nombre comercial', 2)}</div>
      <div class="row" style="gap:10px;margin-top:6px;flex-wrap:wrap">${campo('nit', 'NIT (sin dígito de verificación)', 1, 'inputmode="numeric"')}${campo('asesor', 'Asesor / contacto', 1)}</div>
      <div class="row" style="gap:10px;margin-top:6px;flex-wrap:wrap">${campo('telefono1', 'Teléfono / WhatsApp', 1, 'inputmode="tel"')}${campo('telefono2', 'Teléfono 2', 1, 'inputmode="tel"')}${campo('correo', 'Correo', 2, 'type="text"')}</div>
      ${opciones.marcasHtml ? `<div style="margin-top:8px"><span class="mut">Marcas que lo manejan (definen en qué marcas aparece al hacer pedidos)</span><div style="margin-top:4px">${opciones.marcasHtml}</div></div>` : ''}
      <div class="row" style="margin-top:10px;gap:8px"><button class="p" onclick="guardarProveedorAdmin(${Number(p.id)})">💾 Guardar cambios</button><button onclick="cancelarEdicionAdmin()">Cancelar</button></div>
      <div class="mut" style="margin-top:6px">El teléfono es el WhatsApp al que se envían los pedidos; el correo, donde llegan. Cambiar el NIT o la razón social afecta cómo se reconoce a este proveedor en facturas y pedidos nuevos.</div>
      ${opciones.error ? `<div style="color:#b91c1c;margin-top:6px">${esc(opciones.error)}</div>` : ''}</div>`;
  }

  return { esc, normalizarUnidad, normalizarCodigo, unidadesConocidas, validarUnidad, validarCodigo, validarArticulo, validarProveedor, cambiosProveedor, cambiaIdentidad, editorArticulo, editorProveedor, CAMPOS_PROV };
});
