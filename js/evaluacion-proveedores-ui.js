// ============================================================
//  evaluacion-proveedores-ui.js  -  pestaña «🚚 Proveedores» del modulo 📈 Evaluacion (16/10/2026)
// ============================================================
// Carga sus datos aparte (RPC evaluacion_proveedores_datos) solo al abrir la pestaña, para no hacer mas lenta la evaluacion.
// Calculo en js/evaluacion-proveedores.js. Nombres globales con prefijo evProv / EV_PROV.
var EV_PROV = { clave: '', datos: null, res: [], filtro: '', abierto: null, cargando: false, error: '' };

async function evProvCargar() {
  const clave = EV.desde + '|' + EV.hasta;
  if (EV_PROV.clave === clave && EV_PROV.datos) return;
  EV_PROV.cargando = true; EV_PROV.error = '';
  try {
    const r = await SB.rpc('evaluacion_proveedores_datos', { p_desde: EV.desde, p_hasta: EV.hasta });
    if (r.error) { EV_PROV.error = r.error.message; return; }
    EV_PROV.datos = r.data || {}; EV_PROV.clave = clave;
    EV_PROV.res = EvaluacionProveedores.calcular(EV_PROV.datos, { desde: EV.desde, hasta: EV.hasta });
  } finally { EV_PROV.cargando = false; }
}
async function evProvAbrir() { if (EV.tab !== 'proveedores') return; await evProvCargar(); if (EV.tab === 'proveedores') evPintar(); }
function evProvFiltrar(v) { EV_PROV.filtro = v || ''; const l = $('evProvLista'); if (l) l.innerHTML = evProvLista(); }
function evProvToggle(clave) { EV_PROV.abierto = EV_PROV.abierto === clave ? null : clave; const l = $('evProvLista'); if (l) l.innerHTML = evProvLista(); }
function evProvMetas() { const c = (EV_PROV.datos && EV_PROV.datos.config) || (EV.datos && EV.datos.config) || {}; return { diasEntrega: c.dias_entrega_prov != null ? Number(c.dias_entrega_prov) : 2, alzaPct: c.alza_pct != null ? Number(c.alza_pct) : 5 }; }
const evPesos = (n) => '$' + Math.round(Number(n || 0)).toLocaleString('es-CO');

function evProvHtml() {
  if (EV_PROV.cargando || (!EV_PROV.datos && !EV_PROV.error)) return '<div class="mut" style="padding:16px">Cargando proveedores…</div>';
  if (EV_PROV.error) return '<div class="vacio">No pude cargar los proveedores: ' + escAg(EV_PROV.error) + '</div>';
  const m = evProvMetas(), l = EV_PROV.res || [];
  return `<div class="mut" style="margin-bottom:8px">Cada proveedor se califica de 1 a 100% en 4 puntos por separado; su calificación es el promedio de los que tienen datos.
      📦 entregas completas · ↩️ sin devoluciones (notas crédito) · 📈 precios estables (alza de más de ${m.alzaPct}% frente a la compra anterior) · ⏱️ entrega en máximo ${m.diasEntrega} día(s). Los peores primero.</div>
    <input type="search" placeholder="🔎 Buscar proveedor o NIT" value="${escAg(EV_PROV.filtro)}" oninput="evProvFiltrar(this.value)" style="max-width:360px;margin:0 0 10px">
    <div class="mut" style="margin-bottom:6px">${l.filter((x) => !x.pocoMovimiento).length} proveedor(es) evaluados · ${l.filter((x) => x.pocoMovimiento).length} con poco movimiento (al final)</div>
    <div id="evProvLista">${evProvLista()}</div>`;
}

function evProvLista() {
  const q = (EV_PROV.filtro || '').trim().toLowerCase();
  const l = (EV_PROV.res || []).filter((x) => !q || String(x.nombre).toLowerCase().includes(q) || String(x.nit).includes(q));
  if (!l.length) return '<div class="vacio">' + (q ? 'Ningún proveedor coincide.' : 'No hubo movimiento de proveedores en el período.') + '</div>';
  const m = evProvMetas();
  const ayuda = {
    completas: 'De sus pedidos con factura, cuántos llegaron con todo lo pedido. Incompleto = un producto del pedido no aparece en la factura, o la sede reportó «No llegó el pedido completo».',
    devoluciones: 'De sus facturas, cuántas NO tuvieron nota crédito (devolución) amarrada.',
    precios: `De los artículos que se le compraron y tienen compra anterior, cuántos NO subieron más de ${m.alzaPct}%. Subidas de más de 100% se muestran como posible cambio de presentación y no se califican.`,
    entrega: `De sus pedidos, cuántos llegaron en ${m.diasEntrega} día(s) o menos, desde la fecha del pedido hasta la fecha recibido.`,
  };
  return l.slice(0, 150).map((r) => {
    const d = r.detalle;
    return `<div class="card" style="margin-bottom:8px">
      <div class="row" style="gap:10px;align-items:center;flex-wrap:wrap">
        <div style="flex:1 1 240px"><b>🚚 ${escAg(r.nombre)}</b>${r.nit ? ' <span class="mut">NIT ' + escAg(r.nit) + '</span>' : ''}
          <div class="mut" style="font-size:12.5px">${d.pedidos} pedido(s) · ${d.facturas} factura(s)${d.notas ? ' · ' + d.notas + ' nota(s) crédito por ' + evPesos(d.valorDevuelto) : ''}</div></div>
        <div style="text-align:center;min-width:86px"><div style="font-size:26px;font-weight:800;color:${evColor(r.puntaje)}">${r.puntaje}%</div><div class="mut" style="font-size:11px">promedio</div></div>
      </div>
      ${r.pocoMovimiento ? `<div style="margin-top:6px;padding:4px 10px;border-radius:8px;background:#fffbeb;border:1px solid #fcd34d;color:#92400e;font-size:12px">⚠️ Poco movimiento (${r.observaciones} cosas medidas): calificación poco confiable.</div>` : ''}
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">${EvaluacionProveedores.PUNTOS.map((k) => evCuadro(k, r.puntos[k], ayuda[k], EvaluacionProveedores.NOMBRES[k])).join('')}</div>
      <div style="margin-top:6px"><button onclick="evProvToggle('${escAg(r.clave)}')">${EV_PROV.abierto === r.clave ? 'Ocultar detalle' : 'Ver detalle'}</button></div>
      ${EV_PROV.abierto === r.clave ? evProvDetalle(r) : ''}
    </div>`;
  }).join('') + (l.length > 150 ? `<div class="mut">…y ${l.length - 150} más: usa el buscador.</div>` : '');
}

function evProvDetalle(r) {
  const d = r.detalle, m = evProvMetas();
  const lista = (titulo, arr, fn, vacio) => `<div><b>${titulo}</b>${arr.length ? '<ul style="margin:4px 0 0 18px;padding:0">' + arr.slice(0, 40).map((x) => '<li>' + fn(x) + '</li>').join('') + '</ul>' + (arr.length > 40 ? `<div class="mut">…y ${arr.length - 40} más</div>` : '') : `<div class="mut">${vacio}</div>`}</div>`;
  const dinero = (n) => evPesos(n);
  return `<div style="margin-top:10px;border-top:1px solid var(--line);padding-top:10px;display:grid;gap:10px;font-size:13px">
    ${lista('📦 Entregas incompletas', d.incompletas, (x) => `<b>${escAg(x.pedido)}</b>: ${x.faltan.length ? 'no vino ' + escAg(x.faltan.slice(0, 6).join(', ')) + (x.faltan.length > 6 ? '…' : '') : ''}${x.reportada ? (x.faltan.length ? ' · ' : '') + '<span style="color:#b91c1c">la sede reportó «No llegó el pedido completo»</span>' : ''}`, 'Ninguna.')}
    ${d.menos.length ? lista('🔢 Llegó menos cantidad (solo para revisar: puede ser otra unidad)', d.menos, (x) => `<b>${escAg(x.pedido)}</b>: ` + x.lineas.slice(0, 4).map((l) => escAg(l.insumo) + ' pedido ' + l.pedido + ' → factura ' + l.factura).join(' · '), '') : ''}
    ${lista('↩️ Facturas con devolución (nota crédito)', d.devueltas, (x) => `<b>${escAg(x.factura)}</b> (${dinero(x.total)}) → ${escAg(x.notas.join(', '))}`, 'Ninguna.')}
    ${lista(`📈 Alzas de más de ${m.alzaPct}%`, d.alzas, (x) => `<b>${escAg(x.articulo)}</b>: ${dinero(x.antes)} → ${dinero(x.despues)} <b style="color:#b91c1c">+${x.pct}%</b> (${escAg(x.fecha)}${x.factura ? ', factura ' + escAg(x.factura) : ''})`, 'Ninguna.')}
    ${d.cambios.length ? lista('🔄 Posible cambio de presentación (no se califica; revisar)', d.cambios, (x) => `${escAg(x.articulo)}: ${dinero(x.antes)} → ${dinero(x.despues)} (${x.pct > 0 ? '+' : ''}${x.pct}%)`, '') : ''}
    ${lista(`⏱️ Entregas de más de ${m.diasEntrega} día(s)`, d.tarde, (x) => `<b>${escAg(x.pedido)}</b>: pedido ${escAg(evFecha(x.fecha))} → recibido ${escAg(evFecha(x.recibido))} (<b>${x.dias} días</b>)`, 'Ninguna.')}
  </div>`;
}
