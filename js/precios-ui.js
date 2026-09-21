// ============================================================
//  precios-ui.js  -  PANTALLA "💲 PRECIOS" (variacion de precios de proveedores)  (21/09/2026)   (admin y pagos)
//  Lista los cambios de precio que la base detecto (desde las facturas que procesa el agente, listas de precios o registros a mano), permite
//  marcarlos como revisados, registrar un precio, subir una lista del proveedor y configurar el correo del resumen diario.
//  No calcula variaciones: eso lo hace la base (precio_registrar). Logica de filtros/formatos/CSV: js/precios.js.
//  Usa las globales de index.html: $, escAg, SB, perfil, traerTodo, fch, Importacion, Precios, BancoUtils.
// ============================================================
const pr = { vars: [], cargado: false, cargando: false, cfg: {}, estado: 'nueva', sens: 'media', sentido: null, q: '', panel: null, msg: '', msgMal: false, tope: 100,
  hist: {}, provs: null, ocupado: false, lista: { archivo: '', leido: null, resp: null } };

const PR_COLOR = { alta: ['#991b1b', '#fee2e2'], media: ['#92400e', '#fef3c7'], baja: ['#475569', '#f1f5f9'], baja_precio: ['#166534', '#dcfce7'] };
const prSoloAdmin = () => perfil && perfil.rol === 'admin';
function prBadgePct(v) {
  const pct = Number(v.variacion_pct), c = pct < 0 ? PR_COLOR.baja_precio : PR_COLOR[Precios.nivelDe(pct)];
  return `<span style="display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:700;color:${c[0]};background:${c[1]};white-space:nowrap">${pct < 0 ? '▼' : '▲'} ${escAg(Precios.fmtPct(pct))}</span>`;
}

async function precAbrir() { if (!pr.cargado && !pr.cargando) await precCargar(); else precPintar(); }
async function precCargar() {
  pr.cargando = true; precPintar();
  try {
    pr.vars = await traerTodo('precio_variacion', '*', ['id']);
    const cfg = await traerTodo('precio_config', 'clave,valor', ['clave']); pr.cfg = {}; cfg.forEach((c) => { pr.cfg[c.clave] = c.valor; });
    pr.cargado = true;
  } catch (e) { pr.msg = 'No se pudo cargar: ' + escAg(e.message); pr.msgMal = true; }
  pr.cargando = false; precPintar();
}
function precRepintar() { if (typeof modulo !== 'undefined' && modulo === 'precios') precPintar(); }

function precPintar() {
  const cont = $('preciosRaiz'); if (!cont) return;
  const base = Precios.ordenar(Precios.filtrar(pr.vars, { estado: pr.estado, minPct: Precios.SENSIBILIDAD[pr.sens], sentido: pr.sentido, q: pr.q }));
  const R = Precios.resumen(pr.vars), Rb = Precios.resumen(base), cuentaEstado = (e) => pr.vars.filter((v) => v.estado === e).length;
  const chip = (activo, click, txt) => `<button class="chip${activo ? ' on' : ''}" onclick="${click}">${txt}</button>`;
  let h = `<div class="card" style="margin:6px 0">
    <div style="font-weight:700;margin-bottom:4px">💲 Variación de precios</div>
    <div class="mut" style="margin-bottom:10px">Cambios de precio de los proveedores frente al último precio que cobraron (o al precio negociado la primera vez). Se alimenta solo con cada factura que procesa el agente; también puedes registrar un precio o subir la lista del proveedor. Cada día se envía un resumen por correo.</div>
    <div class="row" style="margin-bottom:8px">
      ${chip(pr.estado === 'nueva', "precFiltro('estado','nueva')", `Nuevas (${cuentaEstado('nueva')})`)}${chip(pr.estado === 'revisada', "precFiltro('estado','revisada')", `Revisadas (${cuentaEstado('revisada')})`)}${chip(pr.estado === 'descartada', "precFiltro('estado','descartada')", `Descartadas (${cuentaEstado('descartada')})`)}${chip(pr.estado === 'todas', "precFiltro('estado','todas')", `Todas (${R.total})`)}
      <span class="sp"></span>
      <span class="mut">Sensibilidad:</span>${['alta', 'media', 'baja'].map((s) => chip(pr.sens === s, `precFiltro('sens','${s}')`, `${s[0].toUpperCase() + s.slice(1)} ≥ ${Precios.SENSIBILIDAD[s]} %`)).join('')}
    </div>
    <div class="row" style="margin-bottom:10px">
      <input id="prQ" value="${escAg(pr.q)}" placeholder="🔎 producto, proveedor, NIT o factura" style="width:280px;margin:0" oninput="precBuscar(this.value)">
      ${chip(pr.sentido === 'sube', "precFiltro('sentido','sube')", '▲ Suben')}${chip(pr.sentido === 'baja', "precFiltro('sentido','baja')", '▼ Bajan')}
      <span class="sp"></span>
      <button onclick="precPanel('registrar')">➕ Registrar precio</button><button onclick="precPanel('lista')">📥 Subir lista (CSV)</button><button onclick="precPanel('config')">⚙️ Correo y umbral</button>
    </div>
    ${pr.msg ? `<div style="padding:8px 12px;border-radius:8px;${pr.msgMal ? 'background:#fee2e2;color:#991b1b' : 'background:#eff6ff;color:#1e3a8a'}">${pr.msg}</div>` : ''}
  </div>`;
  if (pr.panel === 'config') h += precConfigHtml();
  if (pr.panel === 'registrar') h += precRegistrarHtml();
  if (pr.panel === 'lista') h += precListaHtml();
  if (pr.cargando) h += '<div class="vacio">⏳ Cargando…</div>';
  else if (!pr.vars.length) h += '<div class="vacio">Todavía no hay variaciones de precio. Aparecen cuando un proveedor cobra un precio distinto al anterior (más del umbral).</div>';
  else {
    h += `<div class="card" style="margin:6px 0"><div class="mut" style="margin-bottom:8px">${base.length} cambio${base.length === 1 ? '' : 's'} en la lista · ${Rb.suben} suben · ${Rb.bajan} bajan · ${Rb.proveedores} proveedor${Rb.proveedores === 1 ? '' : 'es'}</div>
      ${base.length ? `<div style="overflow:auto"><table><thead><tr><th>Producto</th><th>Proveedor</th><th>Fecha</th><th class="num">Antes</th><th class="num">Ahora</th><th>Variación</th><th></th></tr></thead><tbody>
      ${base.slice(0, pr.tope).map(precFilaHtml).join('')}</tbody></table></div>${base.length > pr.tope ? `<div class="mut" style="margin-top:6px">Mostrando ${pr.tope} de ${base.length}. <button style="padding:2px 10px" onclick="precVerMas()">ver más</button></div>` : ''}`
        : '<div class="vacio">No hay cambios con estos filtros.</div>'}</div>`;
  }
  cont.innerHTML = h;
}

function precFilaHtml(v) {
  const abierto = pr.hist[v.id];
  const acciones = v.estado === 'nueva'
    ? `<button title="Marcar como revisada" style="padding:3px 9px" onclick="precRevisar(${v.id},'revisada')">✓ Revisada</button><button class="d" title="Descartar (no es un cambio real)" style="padding:3px 9px" onclick="precRevisar(${v.id},'descartada')">✖</button>`
    : `<span class="mut" title="${escAg((v.revisada_por || '') + (v.nota ? ' · ' + v.nota : ''))}">${v.estado === 'revisada' ? '✓ revisada' : '✖ descartada'}${v.revisada_por ? ' · ' + escAg(v.revisada_por) : ''}</span><button style="padding:3px 9px" title="Volver a Nuevas" onclick="precRevisar(${v.id},'nueva')">↩</button>`;
  let h = `<tr><td><b>${escAg(v.articulo_texto)}</b><div class="mut" style="font-size:11.5px">${v.base === 'negociado' ? 'contra el precio negociado' : 'contra el último precio'}${v.factura_ref ? ' · factura ' + escAg(v.factura_ref) : ''}</div></td>
    <td>${escAg(v.proveedor_nombre || '—')}<div class="mut" style="font-size:11.5px">NIT ${escAg(v.proveedor_nit || '')}</div></td>
    <td class="mut" style="white-space:nowrap">${escAg(fch(v.fecha_nueva))}${v.fecha_anterior ? `<div style="font-size:11.5px">antes ${escAg(fch(v.fecha_anterior))}</div>` : ''}</td>
    <td class="num" style="white-space:nowrap">${escAg(Precios.fmtPeso(v.precio_anterior))}</td><td class="num" style="white-space:nowrap"><b>${escAg(Precios.fmtPeso(v.precio_nuevo))}</b></td><td>${prBadgePct(v)}</td>
    <td style="white-space:nowrap"><button title="Ver el historial de precios" style="padding:3px 9px" onclick="precHistorial(${v.id})">📈</button> ${acciones}</td></tr>`;
  if (abierto) h += `<tr><td colspan="7" style="background:#f8fafc">${abierto === 'cargando' ? '⏳ cargando historial…' : abierto === 'error' ? 'No se pudo cargar el historial.' : abierto.length ? `<b>Historial de precios</b> <span class="mut">(más reciente primero)</span><div style="margin-top:4px">${abierto.map((x) => `<span style="display:inline-block;margin:2px 10px 2px 0;white-space:nowrap">${escAg(fch(x.fecha))} · <b>${escAg(Precios.fmtPeso(x.precio))}</b>${x.factura_ref ? ' <span class="mut">(' + escAg(x.factura_ref) + ')</span>' : ''}</span>`).join('')}</div>` : 'Sin historial.'}</td></tr>`;
  return h;
}

// ---------------------------------------------------------------- filtros y acciones
function precFiltro(k, valor) {
  if (k === 'sentido') pr.sentido = pr.sentido === valor ? null : valor; else pr[k] = valor;
  pr.tope = 100; precRepintar();
}
let _prBuscarT = null;
function precBuscar(t) { pr.q = t; pr.tope = 100; clearTimeout(_prBuscarT); _prBuscarT = setTimeout(() => { precRepintar(); const el = $('prQ'); if (el) { el.focus(); el.setSelectionRange(t.length, t.length); } }, 250); }
function precVerMas() { pr.tope += 200; precRepintar(); }
function precPanel(p) { pr.panel = pr.panel === p ? null : p; pr.msg = ''; if (p === 'registrar' && !pr.provs) precCargarProvs(); precRepintar(); }
async function precCargarProvs() { try { pr.provs = await traerTodo('proveedores', 'id,nit,razon_social,nombre_comercial', ['razon_social', 'id']); } catch (e) { pr.provs = []; } precRepintar(); }

async function precRevisar(id, estado) {
  const v = pr.vars.find((x) => x.id === id); if (!v) return;
  if (estado === 'descartada' && !confirm('¿Descartar este cambio de precio?\n\n' + (v.articulo_texto || '') + '\nNo saldrá en Nuevas (queda en Descartadas).')) return;
  const { error } = await SB.rpc('precio_revisar', { p_id: id, p_estado: estado, p_nota: null });
  if (error) { pr.msg = 'No se pudo actualizar: ' + escAg(error.message); pr.msgMal = true; precRepintar(); return; }
  v.estado = estado; v.revisada_por = estado === 'nueva' ? null : (perfil.nombre || 'yo'); pr.msg = ''; precRepintar();
}
async function precHistorial(id) {
  const v = pr.vars.find((x) => x.id === id); if (!v) return;
  if (pr.hist[id]) { delete pr.hist[id]; precRepintar(); return; }
  pr.hist[id] = 'cargando'; precRepintar();
  try {
    const { data, error } = await SB.from('precio_historial').select('fecha,precio,factura_ref,fuente').eq('proveedor_nit', v.proveedor_nit).eq('articulo_clave', v.articulo_clave).order('fecha', { ascending: false }).order('id', { ascending: false }).limit(12);
    if (error) throw new Error(error.message); pr.hist[id] = data || [];
  } catch (e) { pr.hist[id] = 'error'; }
  precRepintar();
}

// ---------------------------------------------------------------- configuracion (correo, umbral, hora)
function precConfigHtml() {
  const c = pr.cfg, ro = prSoloAdmin() ? '' : ' disabled';
  return `<div class="card" style="margin:6px 0"><div style="font-weight:700;margin-bottom:8px">⚙️ Correo y umbral</div>
    <div class="row" style="align-items:flex-end;gap:14px">
      <div style="flex:2;min-width:240px"><label class="mut">Correos que reciben el resumen diario (separados por coma)</label><input id="pc_correos" value="${escAg(c.correos || '')}"${ro}></div>
      <div style="width:130px"><label class="mut">Umbral (%)</label><input id="pc_umbral" value="${escAg(c.umbral_pct || '5')}" inputmode="decimal"${ro}></div>
      <div style="width:170px"><label class="mut">Enviar desde las (hora Col.)</label><input id="pc_hora" value="${escAg(c.resumen_hora || '17')}" inputmode="numeric"${ro}></div>
      <label style="display:flex;align-items:center;gap:6px;margin-bottom:10px"><input type="checkbox" id="pc_activo" style="width:auto;margin:0" ${c.resumen_activo === 'false' ? '' : 'checked'}${ro}> Enviar el resumen</label>
    </div>
    <div class="mut" style="margin:4px 0 10px">Solo se crea una variación (y se avisa) si el precio cambia el umbral o más. Se envía <b>un correo al día</b> con los cambios nuevos, por el vigilante del PC.${c.ultimo_resumen ? ' Último resumen: ' + escAg(c.ultimo_resumen) + '.' : ''}${prSoloAdmin() ? '' : ' <b>Solo el administrador puede cambiar esto.</b>'}</div>
    <div id="pc_msg" style="margin-bottom:8px;font-weight:600"></div>
    <div class="row">${prSoloAdmin() ? '<button class="p" onclick="precGuardarConfig()">Guardar</button>' : ''}<button onclick="precEnviarResumen()" title="Pone en cola ahora el correo con los cambios que aún no se han avisado">📧 Enviar el resumen ahora</button><span class="sp"></span><button onclick="precPanel(null)">Cerrar</button></div></div>`;
}
async function precGuardarConfig() {
  const nuevo = { correos: $('pc_correos').value, umbral_pct: $('pc_umbral').value, resumen_hora: $('pc_hora').value, resumen_activo: $('pc_activo').checked ? 'true' : 'false' };
  const cambios = Object.keys(nuevo).filter((k) => String(nuevo[k]).trim() !== String(pr.cfg[k] == null ? '' : pr.cfg[k]).trim());
  const dentro = (t) => { const el = $('pc_msg'); if (el) { el.textContent = t; el.style.color = '#991b1b'; } };
  if (!cambios.length) { const el = $('pc_msg'); if (el) { el.textContent = 'No hay cambios que guardar.'; el.style.color = '#1e3a8a'; } return; }
  for (const k of cambios) {
    const { error } = await SB.rpc('precio_config_guardar', { p_clave: k, p_valor: nuevo[k] });
    if (error) return dentro('No se guardó «' + k + '»: ' + error.message);
  }
  await precCargar(); pr.msg = '✅ Guardado.'; pr.msgMal = false; precRepintar();
}
async function precEnviarResumen() {
  if (!confirm('¿Poner en cola ahora el correo con los cambios de precio que aún no se han avisado?\n\nLo envía el vigilante del PC en su siguiente ciclo.')) return;
  const { data, error } = await SB.rpc('precio_resumen_diario', { p_forzar: true });
  if (error) { pr.msg = 'No se pudo: ' + escAg(error.message); pr.msgMal = true; }
  else if (data && data.enviado) { pr.msg = `✅ En cola: ${data.variaciones} cambio(s) de ${data.proveedores} proveedor(es) para ${data.destinatarios} correo(s). Lo envía el vigilante.`; pr.msgMal = false; }
  else { pr.msg = 'No se envió: ' + escAg((data && data.motivo) || 'sin respuesta') + '.'; pr.msgMal = false; }
  await precCargar(); precRepintar();
}

// ---------------------------------------------------------------- registrar un precio a mano
function precRegistrarHtml() {
  const hoy = BancoUtils.hoyColombia();
  return `<div class="card" style="margin:6px 0"><div style="font-weight:700;margin-bottom:8px">➕ Registrar un precio</div>
    <div class="row" style="align-items:flex-end;gap:12px">
      <div style="flex:2;min-width:220px"><label class="mut">Proveedor</label><select id="pg_prov"><option value="">— elige —</option>${(pr.provs || []).map((p) => `<option value="${escAg(p.nit || '')}">${escAg(p.razon_social || p.nombre_comercial || '')}</option>`).join('')}</select></div>
      <div style="flex:2;min-width:220px"><label class="mut">Artículo (como lo escribe el proveedor)</label><input id="pg_art" placeholder="ARROZ DIANA X 500G"></div>
      <div style="width:130px"><label class="mut">Precio unitario</label><input id="pg_precio" inputmode="decimal" placeholder="2100"></div>
      <div style="width:150px"><label class="mut">Fecha</label><input type="date" id="pg_fecha" value="${hoy}" max="${hoy}"></div>
    </div>
    <div class="mut" style="margin:2px 0 10px">Se compara con el último precio que ese proveedor cobró por ese artículo.</div>
    <div id="pg_msg" style="margin-bottom:8px;font-weight:600"></div>
    <div class="row"><button class="p" onclick="precRegistrar()">Registrar</button><span class="sp"></span><button onclick="precPanel(null)">Cerrar</button></div></div>`;
}
async function precRegistrar() {
  const dentro = (t) => { const el = $('pg_msg'); if (el) { el.textContent = t; el.style.color = '#991b1b'; } };
  const sel = $('pg_prov'), nit = sel.value, art = $('pg_art').value.trim(), pn = Importacion.numero($('pg_precio').value), fecha = $('pg_fecha').value;
  const prov = (pr.provs || []).find((p) => p.nit === nit);
  if (!nit) return dentro('Elige el proveedor.');
  if (!art) return dentro('Escribe el artículo.');
  if (pn.vacio || pn.error || !(pn.valor > 0)) return dentro('El precio debe ser un número mayor que 0.');
  const { data, error } = await SB.rpc('precio_registrar', { p_lineas: [{ nit, proveedor: prov && (prov.razon_social || prov.nombre_comercial), articulo: art, precio: pn.valor, fecha: fecha || undefined }], p_fuente: 'manual', p_aplicar: true });
  if (error) return dentro('No se pudo registrar: ' + error.message);
  const f = data.filas[0];
  if (f.estado === 'error') return dentro('No se registró: ' + (f.errores || []).join('; '));
  if (f.estado === 'duplicado') return dentro('Ese precio ya estaba registrado para esa fecha.');
  if (f.variacion) { pr.msg = `✅ Registrado. Cambio de precio: ${escAg(Precios.fmtPeso(f.variacion.anterior))} → ${escAg(Precios.fmtPeso(f.variacion.nuevo))} (${escAg(Precios.fmtPct(f.variacion.pct))}). Quedó en «Nuevas».`; pr.msgMal = false; pr.panel = null; await precCargar(); }
  else { pr.msg = '✅ Registrado. Sin cambio importante frente al precio anterior (o es el primero de ese artículo).'; pr.msgMal = false; pr.panel = null; }
  precRepintar();
}

// ---------------------------------------------------------------- lista de precios del proveedor (CSV)
function precListaHtml() {
  const L = pr.lista, leido = L.leido;
  let h = `<div class="card" style="margin:6px 0"><div style="font-weight:700;margin-bottom:6px">📥 Subir la lista de precios de un proveedor</div>
    <div class="mut" style="margin-bottom:8px">CSV con las columnas <code>nit</code>*, <code>articulo</code>*, <code>precio</code>*, y opcionales <code>proveedor</code>, <code>fecha</code> (si falta, hoy), <code>codigo</code>, <code>unidad</code>. Primero ves qué cambiaría (no se guarda nada); solo al confirmar se registra.</div>
    <div class="row"><button onclick="precDescargarPlantilla()">⬇ Plantilla CSV</button>
      <label class="s" style="display:inline-block;padding:6px 14px;border-radius:8px;cursor:pointer;background:#12306b;color:#fff;font-weight:700">📂 Elegir archivo CSV<input type="file" accept=".csv,.txt,text/csv" style="display:none" onchange="precLeerLista(event)"></label>
      ${L.archivo ? `<span class="mut">${escAg(L.archivo)}</span>` : ''}<span class="sp"></span><button onclick="precPanel(null)">Cerrar</button></div>`;
  if (leido && !leido.ok) h += `<div style="margin-top:10px;color:#991b1b"><b>No se puede leer el archivo</b><ul>${leido.errores.map((e) => `<li>${escAg(e)}</li>`).join('')}</ul></div>`;
  else if (leido) {
    const filas = precFilasLista(), c = { nuevo: 0, duplicado: 0, error: 0, variaciones: 0 };
    filas.forEach((f) => { c[f.estado] = (c[f.estado] || 0) + 1; if (f.variacion) c.variaciones++; });
    h += `<div style="margin:10px 0" class="row"><span class="badge">${filas.length} filas</span><span class="badge st-sellada">${c.nuevo || 0} se registrarían</span>${c.variaciones ? `<span class="badge st-asignada">${c.variaciones} con cambio de precio</span>` : ''}${c.duplicado ? `<span class="badge">${c.duplicado} ya estaban</span>` : ''}${c.error ? `<span class="badge st-pool">${c.error} con error</span>` : ''}
      <span class="sp"></span><button class="p" ${(c.nuevo && L.resp && !pr.ocupado) ? '' : 'disabled'} onclick="precAplicarLista()">✅ Registrar ${c.nuevo || 0} precio${c.nuevo === 1 ? '' : 's'}</button></div>
      ${L.resp ? '' : '<div style="color:#92400e;margin-bottom:6px">⚠ No se pudo consultar la base: solo se revisó el archivo.</div>'}
      <div style="overflow:auto"><table><thead><tr><th>Fila</th><th>Resultado</th><th>Artículo</th><th class="num">Precio</th><th>Detalle</th></tr></thead><tbody>
      ${filas.slice(0, 200).map((f) => `<tr><td class="mut">${f.n}</td><td>${f.estado === 'error' ? '<span class="badge st-pool">Error</span>' : f.estado === 'duplicado' ? '<span class="badge">Ya estaba</span>' : '<span class="badge st-sellada">Nueva</span>'}</td><td>${escAg(f.datos.articulo || '')}<div class="mut" style="font-size:11.5px">NIT ${escAg(f.datos.nit || '')}</div></td><td class="num">${escAg(Precios.fmtPeso(f.datos.precio))}</td>
        <td>${(f.errores || []).map((e) => `<div style="color:#991b1b">✖ ${escAg(e)}</div>`).join('')}${(f.avisos || []).map((e) => `<div style="color:#92400e">⚠ ${escAg(e)}</div>`).join('')}${f.variacion ? `<div style="color:#1e3a8a">${f.variacion.pct > 0 ? '▲' : '▼'} ${escAg(Precios.fmtPct(f.variacion.pct))} · antes ${escAg(Precios.fmtPeso(f.variacion.anterior))}${f.variacion.base === 'negociado' ? ' (precio negociado)' : ''}</div>` : ''}</td></tr>`).join('')}
      </tbody></table></div>${filas.length > 200 ? `<div class="mut">Mostrando 200 de ${filas.length}.</div>` : ''}`;
  }
  return h + '</div>';
}
// Junta lo que vio el navegador con lo que respondio la base (por numero de fila)
function precFilasLista() {
  const L = pr.lista, porN = new Map(((L.resp && L.resp.filas) || []).map((f) => [f.n, f]));
  return L.leido.filas.map((f) => {
    if (f.errores.length) return { n: f.n, datos: f.datos, estado: 'error', errores: f.errores, avisos: f.avisos, variacion: null };
    const s = porN.get(f.n);
    return { n: f.n, datos: f.datos, estado: s ? s.estado : 'nuevo', errores: s && s.estado === 'error' ? s.errores || [] : [], avisos: f.avisos, variacion: s ? s.variacion : null };
  });
}
async function precLeerLista(ev) {
  const f = ev.target.files && ev.target.files[0]; if (!f) return;
  pr.lista = { archivo: f.name, leido: null, resp: null }; pr.msg = ''; pr.ocupado = true; precRepintar();
  try {
    const texto = Importacion.decodificar(new Uint8Array(await f.arrayBuffer()));
    pr.lista.leido = Precios.leerLista(texto, BancoUtils.hoyColombia());
    const lineas = pr.lista.leido.ok ? Precios.aServidor(pr.lista.leido) : [];
    if (lineas.length) {
      const { data, error } = await SB.rpc('precio_registrar', { p_lineas: lineas, p_fuente: 'lista', p_aplicar: false });
      if (error) { pr.msg = 'La base no pudo revisar el archivo: ' + escAg(error.message); pr.msgMal = true; } else pr.lista.resp = data;
    } else if (pr.lista.leido.ok) pr.lista.resp = { filas: [] };
  } catch (e) { pr.msg = 'No se pudo leer el archivo: ' + escAg(e.message); pr.msgMal = true; }
  pr.ocupado = false; ev.target.value = ''; precRepintar();
}
async function precAplicarLista() {
  const L = pr.lista; if (!L.leido || !L.resp || pr.ocupado) return;
  const n = precFilasLista().filter((f) => f.estado === 'nuevo').length; if (!n) return;
  if (!confirm(`Vas a registrar ${n} precio(s) de la lista.\n\nLos cambios de precio quedan en «Nuevas» y salen en el resumen diario. ¿Registrar?`)) return;
  pr.ocupado = true; precRepintar();
  const { data, error } = await SB.rpc('precio_registrar', { p_lineas: Precios.aServidor(L.leido), p_fuente: 'lista', p_aplicar: true });
  pr.ocupado = false;
  if (error) { pr.msg = 'No se registró nada: ' + escAg(error.message); pr.msgMal = true; precRepintar(); return; }
  const r = data.resumen; pr.lista = { archivo: '', leido: null, resp: null }; pr.panel = null; await precCargar();
  pr.msg = `✅ Lista registrada: ${r.registrados} precio(s), ${r.variaciones} con cambio importante${r.duplicados ? ', ' + r.duplicados + ' ya estaban' : ''}${r.errores ? ', ' + r.errores + ' con error (no se registraron)' : ''}.`; pr.msgMal = false; precRepintar();
}
function precDescargarPlantilla() {
  const url = URL.createObjectURL(new Blob([Precios.plantilla()], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = 'plantilla_lista_de_precios.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
