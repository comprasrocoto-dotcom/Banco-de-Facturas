// ============================================================
//  ingreso-elegir.js  -  ELEGIR QUE SE INGRESA AL ERP  (25/10/2026, pedido del usuario)
// ============================================================
// «Darme la opcion de lanzar una sola marca o sede (ej. solo 123 wok) y no todas las pendientes; o solo el pedido que yo quiera.»
// Al pulsar «🚀 Iniciar ingresos al ERP» sale una ventana: Todos | Una marca | Una sede | Elegir pedidos. La orden lleva
// ordenes.pedido_ids con lo elegido y el agente procesa SOLO esos (agente-pedidos.js: «Orden de prueba: SOLO los pedidos...»).
// Parte pura (grupos, filtrar) + ventana. Nombres globales con prefijo ingEleg.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IngresoElegir = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const marcaDe = (p, sedes) => { const s = (sedes || []).find((x) => x.id === p.sede_id) || {}; return { id: p.marca_id || s.marca_id || 0, nombre: (s.marcas && s.marcas.nombre) || '' }; };
  const sedeDe = (p, sedes) => { const s = (sedes || []).find((x) => x.id === p.sede_id) || {}; return { id: p.sede_id || 0, nombre: s.nombre || p.sede_texto || 'Sin sede' }; };
  // pedidos -> { marcas:[{id,nombre,n}], sedes:[{id,nombre,marca,n}] }
  function grupos(pedidos, sedes) {
    const m = new Map(), s = new Map();
    for (const p of pedidos || []) {
      const ma = marcaDe(p, sedes), se = sedeDe(p, sedes);
      if (!m.has(ma.id)) m.set(ma.id, { id: ma.id, nombre: ma.nombre || ('Marca ' + ma.id), n: 0 }); m.get(ma.id).n++;
      if (!s.has(se.id)) s.set(se.id, { id: se.id, nombre: se.nombre, marca: ma.nombre, n: 0 }); s.get(se.id).n++;
    }
    const ord = (a, b) => String(a.nombre).localeCompare(String(b.nombre));
    return { marcas: [...m.values()].sort(ord), sedes: [...s.values()].sort((a, b) => String(a.marca).localeCompare(String(b.marca)) || ord(a, b)) };
  }
  // o = { modo:'todos'|'marca'|'sede'|'pedidos', marca, sede, ids:Set }
  function filtrar(pedidos, sedes, o) {
    o = o || {};
    if (o.modo === 'marca') return (pedidos || []).filter((p) => String(marcaDe(p, sedes).id) === String(o.marca));
    if (o.modo === 'sede') return (pedidos || []).filter((p) => String(sedeDe(p, sedes).id) === String(o.sede));
    if (o.modo === 'pedidos') { const ids = o.ids instanceof Set ? o.ids : new Set(o.ids || []); return (pedidos || []).filter((p) => ids.has(p.id)); }
    return (pedidos || []).slice();
  }
  return { grupos, filtrar, marcaDe, sedeDe };
});

// ---------------------------------------------------------------- ventana
// eleg: pedidos listos; estados: Map pedido_id -> estado en la cola (ERROR, PENDIENTE_REINTENTO...)
// -> Promise: null (cancelo) | { todos:true } | { ids:[...] }
const ING_ELEG = { eleg: [], estados: new Map(), modo: 'todos', marca: '', sede: '', ids: new Set(), q: '', resolver: null };
function ingElegAbrir(eleg, estados) {
  return new Promise((resolver) => {
    Object.assign(ING_ELEG, { eleg: eleg || [], estados: estados || new Map(), modo: 'todos', marca: '', sede: '', ids: new Set(), q: '', resolver });
    let m = document.getElementById('modalIngEleg');
    if (!m) { m = document.createElement('div'); m.id = 'modalIngEleg'; m.className = 'modal'; document.body.appendChild(m); }
    m.classList.add('on');
    ingElegPintar();
  });
}
function ingElegTerminar(v) {
  const m = document.getElementById('modalIngEleg'); if (m) m.classList.remove('on');
  const r = ING_ELEG.resolver; ING_ELEG.resolver = null; if (r) r(v);
}
function ingElegSet(k, v) {
  if (k === 'id') { const id = Number(v); if (ING_ELEG.ids.has(id)) ING_ELEG.ids.delete(id); else ING_ELEG.ids.add(id); }
  else ING_ELEG[k] = v;
  if (k === 'q') { ingElegLista(); return; }
  ingElegPintar();
}
function ingElegSeleccion() {
  const o = { modo: ING_ELEG.modo, marca: ING_ELEG.marca, sede: ING_ELEG.sede, ids: ING_ELEG.ids };
  return IngresoElegir.filtrar(ING_ELEG.eleg, typeof sedes !== 'undefined' ? sedes : [], o);
}
function ingElegLista() {
  const caja = document.getElementById('ingElegLista'); if (!caja) return;
  const sd = typeof sedes !== 'undefined' ? sedes : [], q = String(ING_ELEG.q || '').trim().toLowerCase();
  const l = ING_ELEG.eleg.filter((p) => !q || ((p.numero || '') + ' ' + (p.proveedor_texto || '') + ' ' + IngresoElegir.sedeDe(p, sd).nombre + ' ' + IngresoElegir.marcaDe(p, sd).nombre).toLowerCase().includes(q));
  caja.innerHTML = l.slice(0, 300).map((p) => { const st = ING_ELEG.estados.get(p.id);
    return `<label style="display:flex;gap:8px;align-items:center;padding:5px 2px;border-bottom:1px solid var(--line);cursor:pointer">
      <input type="checkbox" style="width:18px;height:18px;margin:0" ${ING_ELEG.ids.has(p.id) ? 'checked' : ''} onchange="ingElegSet('id',${p.id})">
      <b>${escAg(p.numero || '')}</b><span>${escAg(p.proveedor_texto || '')}</span><span class="mut">· ${escAg(IngresoElegir.marcaDe(p, sd).nombre)} ${escAg(IngresoElegir.sedeDe(p, sd).nombre)}</span>
      ${st === 'ERROR' ? '<span class="badge" style="background:#fee2e2;color:#991b1b">con error</span>' : st === 'DESCARTADO' ? '<span class="badge">sacado de la cola</span>' : ''}</label>`; }).join('') || '<div class="mut">Nada con esa búsqueda.</div>';
  const n = document.getElementById('ingElegN'); if (n) n.textContent = ingElegSeleccion().length;
}
function ingElegPintar() {
  const m = document.getElementById('modalIngEleg'); if (!m) return;
  const sd = typeof sedes !== 'undefined' ? sedes : [], g = IngresoElegir.grupos(ING_ELEG.eleg, sd), md = ING_ELEG.modo;
  const radio = (v, t) => `<label style="display:flex;gap:6px;align-items:center;cursor:pointer"><input type="radio" name="ingElegModo" style="width:auto;margin:0" ${md === v ? 'checked' : ''} onchange="ingElegSet('modo','${v}')"> ${t}</label>`;
  const opt = (v, t, sel) => `<option value="${escAg(v)}"${String(v) === String(sel) ? ' selected' : ''}>${escAg(t)}</option>`;
  const n = ingElegSeleccion().length;
  m.innerHTML = `<div class="card" style="max-width:640px;width:96vw">
    <h1 style="margin:0 0 6px">🚀 ¿Qué ingreso al ERP?</h1>
    <div class="mut" style="margin-bottom:10px">${ING_ELEG.eleg.length} pedido(s) con factura amarrada esperando ingreso.</div>
    <div style="display:flex;flex-direction:column;gap:8px">
      ${radio('todos', '<b>Todos</b> los pendientes')}
      ${radio('marca', 'Solo una <b>marca</b>')}
      ${md === 'marca' ? `<select style="margin:0 0 0 26px;width:auto" onchange="ingElegSet('marca',this.value)">${opt('', 'Elige la marca...', ING_ELEG.marca)}${g.marcas.map((x) => opt(x.id, x.nombre + ' (' + x.n + ')', ING_ELEG.marca)).join('')}</select>` : ''}
      ${radio('sede', 'Solo una <b>sede</b>')}
      ${md === 'sede' ? `<select style="margin:0 0 0 26px;width:auto" onchange="ingElegSet('sede',this.value)">${opt('', 'Elige la sede...', ING_ELEG.sede)}${g.sedes.map((x) => opt(x.id, (x.marca ? x.marca + ' · ' : '') + x.nombre + ' (' + x.n + ')', ING_ELEG.sede)).join('')}</select>` : ''}
      ${radio('pedidos', 'Elegir <b>pedidos</b> uno por uno')}
      ${md === 'pedidos' ? `<div style="margin-left:26px"><input placeholder="🔎 Buscar N° de pedido, proveedor, sede o marca" value="${escAg(ING_ELEG.q)}" oninput="ingElegSet('q',this.value)" style="margin:0 0 6px">
        <div id="ingElegLista" style="max-height:300px;overflow:auto;border:1px solid var(--line);border-radius:9px;padding:0 8px"></div></div>` : ''}
    </div>
    <div class="row" style="margin-top:14px;gap:8px;justify-content:flex-end">
      <button onclick="ingElegTerminar(null)">Cancelar</button>
      <button class="p" style="background:#1e3a8a;border-color:#1e3a8a" ${n ? '' : 'disabled'} onclick="ingElegConfirmar()">🚀 Ingresar <span id="ingElegN">${n}</span> pedido(s)</button>
    </div></div>`;
  if (md === 'pedidos') ingElegLista();
}
function ingElegConfirmar() {
  const l = ingElegSeleccion(); if (!l.length) return;
  if (ING_ELEG.modo === 'todos') { ingElegTerminar({ todos: true, lista: l }); return; }
  ingElegTerminar({ ids: l.map((p) => p.id), lista: l });
}
