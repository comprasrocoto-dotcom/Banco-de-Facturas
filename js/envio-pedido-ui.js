// ============================================================
//  envio-pedido-ui.js  -  "ENVIAR AL PROVEEDOR" en Pedidos  (22/09/2026)
//  Boton dentro del detalle del pedido -> modal de confirmacion (correo y/o WhatsApp) -> estado por canal + historial.
//    - CORREO: sale solo desde el sistema (no abre Gmail/Outlook): se encola en correo_cola con el PDF del pedido adjunto y el agente local lo
//      despacha por la Gmail API. Por eso el estado real ("enviado") lo dice la cola, no este boton.
//    - WHATSAPP: NO hay API oficial contratada: se abre WhatsApp Web/app con el mensaje ya escrito y la persona da "enviar". Queda como
//      "enlace abierto" hasta que confirme a mano ("Ya lo envié"). Nunca se muestra como envio automatico. Para cambiar a WhatsApp Business API
//      solo hay que reemplazar envioWhatsapp() (el resto: modal, estados, historial, no cambia).
//    - Cada intento (canal, destinatario, estado, error, usuario) queda en pedido_envio; nada se actualiza, siempre se agrega. Sin secretos.
//  Logica pura: js/envio-pedido.js. Usa las globales de index.html: $, SB, perfil, usuario, pedidos, sedes, provs, ordenCompra, escAg, fhAg.
// ============================================================
const EPC = { enCurso: {}, ctx: null, compartir: {} };   // compartir[id] = { archivo, texto }: el PDF y el mensaje listos para el boton "Compartir PDF adjunto"
const escE = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const envioPuede = () => !!(perfil && (perfil.rol === 'admin' || perfil.rol === 'pagos') && can('pedidos.enviar_proveedor'));   // encolar correos es de admin/pagos (regla del servidor) y ademas del permiso del perfil
const envioMsgErr = (e) => String((e && e.message) || e || 'error desconocido').replace(/\s+/g, ' ').slice(0, 300);

// ---------- Fase 1: tarjeta del proveedor en "Nuevo pedido" ----------
function pintarContactoProv() {
  const box = $('np_contacto'); if (!box) return;
  const id = Number(($('np_prov') && $('np_prov').value) || 0);
  const pv = (typeof provs !== 'undefined' ? provs : []).find((x) => x.id === id);
  if (!pv) { box.innerHTML = ''; return; }
  const c = EnvioPedido.contacto(pv);
  const fila = (k, v, ok) => `<div><span class="mut" style="font-weight:700">${k}</span><div style="font-weight:600;${ok ? '' : 'color:#b45309'}">${v}</div></div>`;
  box.innerHTML = `<div style="display:flex;gap:26px;flex-wrap:wrap;background:#f8fafc;border:1px solid var(--line);border-radius:10px;padding:8px 14px;margin:8px 0">
    ${fila('PROVEEDOR', escE(pv.razon_social || pv.nombre_comercial || ''), true)}
    ${fila('NIT', escE(pv.nit || '—'), !!pv.nit)}
    ${fila('CORREO', c.correo.ok ? escE(c.correo.valor) : 'sin correo válido', c.correo.ok)}
    ${fila('WHATSAPP', c.whatsapp.ok ? escE(c.whatsapp.visible) : 'sin WhatsApp válido', c.whatsapp.ok)}
  </div>`;
}

// ---------- estado (por canal y del pedido) ----------
async function envioCargar(id) {
  const r = await SB.from('pedido_envio').select('*').eq('pedido_id', id).order('creado_en', { ascending: false });
  if (r.error) throw new Error(r.error.message);
  const envios = r.data || [];
  const colas = {}, ids = [...new Set(envios.map((e) => e.correo_cola_id).filter((x) => x != null))];
  if (ids.length && envioPuede()) {
    const q = await SB.from('correo_cola').select('id,estado,ultimo_error,enviado_en,intentos').in('id', ids);
    (q.data || []).forEach((c) => { colas[c.id] = c; });
  }
  const porCanal = EnvioPedido.estadoPorCanal(envios, colas);
  return { envios, colas, porCanal, estado: EnvioPedido.estadoPedido(porCanal) };
}

const COLOR_ESTADO = { 'BORRADOR': '#64748b', 'PENDIENTE DE ENVÍO': '#b45309', 'ENVIANDO': '#1d4ed8', 'ENVIADO': '#166534', 'ERROR DE ENVÍO': '#b91c1c' };

// Panel dentro del detalle del pedido (contenedor #env_<id>)
async function pintarEstadoEnvio(id) {
  const box = $('env_' + id); if (!box) return;
  let e;
  try { e = await envioCargar(id); }
  catch (er) { box.innerHTML = `<div class="mut" style="margin-top:12px">No pude leer el estado del envío: ${escE(envioMsgErr(er))}</div>`; return; }
  const nombres = {};
  const uids = [...new Set(e.envios.map((x) => x.creado_por).filter(Boolean))];
  if (uids.length) { try { const q = await SB.from('perfiles').select('user_id,nombre').in('user_id', uids); (q.data || []).forEach((p) => { nombres[p.user_id] = p.nombre; }); } catch (_) { /* el nombre es opcional */ } }
  const puede = envioPuede();
  const linea = (canal, icono, nombre) => {
    const s = e.porCanal[canal]; if (!s) return '';
    const malo = s.estado === 'error';
    let acciones = '';
    if (puede && malo) acciones += `<button class="s" onclick="envioReintentar(${id},'${canal}')">REINTENTAR ENVÍO</button>`;
    if (canal === 'whatsapp' && s.estado === 'enlace_generado') acciones += `<button class="s" onclick="envioConfirmarWhatsapp(${id})">Ya lo envié por WhatsApp</button><button class="s" onclick="envioReabrirWhatsapp(${id})">Abrir WhatsApp otra vez</button>${envioPuedeCompartir() ? `<button class="s" onclick="envioCompartirPdf(${id})">📎 Compartir PDF adjunto</button>` : ''}`;
    return `<div style="margin:4px 0">${icono} <b>${nombre}:</b> <span style="font-weight:700;color:${malo ? '#b91c1c' : (s.estado === 'enviado' || s.estado === 'confirmado_manual' ? '#166534' : '#b45309')}">${escE(s.etiqueta)}</span>
      <span class="mut">· ${escE(s.destinatario)} · ${fhAg(s.fecha)}${s.intentos > 1 ? ' · ' + s.intentos + ' intentos' : ''}</span>
      ${malo && s.error ? `<div class="mut" style="color:#b91c1c">Motivo: ${escE(s.error)}</div>` : ''} ${acciones}</div>`;
  };
  const ultimos = {};
  e.envios.forEach((x) => { if (!ultimos[x.canal]) ultimos[x.canal] = x.id; });
  const hist = e.envios.map((x) => {
    const cola = x.canal === 'correo' && x.correo_cola_id != null && ultimos.correo === x.id ? e.colas[x.correo_cola_id] : null;
    const dc = x.estado === 'error' ? null : EnvioPedido.estadoCorreoDeCola(cola);
    const est = dc || x.estado;
    return `<tr><td>${fhAg(x.creado_en)}</td><td>${x.canal === 'correo' ? 'Correo' : 'WhatsApp'}</td><td>${escE(x.destinatario)}</td><td>${escE(EnvioPedido.ETIQUETAS[est] || est)}</td><td>${escE(nombres[x.creado_por] || (x.creado_por ? String(x.creado_por).slice(0, 8) : '—'))}</td><td>${escE(x.error || (est === 'error' && cola ? cola.ultimo_error : '') || '')}</td></tr>`;
  }).join('');
  box.innerHTML = `<div style="border:1px solid var(--line);border-radius:12px;padding:12px 16px;margin-top:16px">
    <div class="row" style="align-items:center"><span style="font-weight:700;color:#1e3a8a">📤 ENVÍO AL PROVEEDOR</span>
      <span class="badge" style="background:${COLOR_ESTADO[e.estado] || '#64748b'};color:#fff">${e.estado}</span><span class="sp"></span>
      ${puede ? `<button onclick="abrirEnvio(${id})" style="background:#1e3a8a;border-color:#1e3a8a;color:#fff;font-weight:700">📤 ENVIAR AL PROVEEDOR</button>` : ''}</div>
    ${e.envios.length ? linea('correo', '✉️', 'Correo') + linea('whatsapp', '💬', 'WhatsApp') : '<div class="mut" style="margin-top:6px">Este pedido todavía no se ha enviado al proveedor.</div>'}
    ${e.envios.length ? `<details style="margin-top:8px"><summary class="mut" style="cursor:pointer">Historial de envíos (${e.envios.length})</summary>
      <table style="margin-top:6px"><thead><tr><th>Fecha</th><th>Canal</th><th>Destinatario</th><th>Estado</th><th>Usuario</th><th>Error</th></tr></thead><tbody>${hist}</tbody></table></details>` : ''}
  </div>`;
}

// ---------- modal "ENVIAR PEDIDO" ----------
function envioMsg(t, ok) { const m = $('env_msg'); if (m) { m.textContent = t || ''; m.style.color = ok ? '#166534' : '#b91c1c'; } }
function envioBloquear(b) { ['env_btn', 'env_cancel'].forEach((i) => { const x = $(i); if (x) x.disabled = b; }); }

async function abrirEnvio(id) {
  const p = pedidos.find((x) => x.id === id); if (!p) return;
  if (!envioPuede()) { alert('Solo administración o pagos pueden enviar pedidos al proveedor.'); return; }
  const cuerpo = $('env_cuerpo'); cuerpo.innerHTML = '<div class="vacio">⏳ Cargando...</div>'; $('modalEnvio').classList.add('on');
  try {
    if (!p.proveedor_id) { cuerpo.innerHTML = '<div class="err" style="display:block">Este pedido no tiene un proveedor seleccionado: no se puede enviar.</div><div class="row"><span class="sp"></span><button onclick="$(\'modalEnvio\').classList.remove(\'on\')">Cerrar</button></div>'; EPC.ctx = null; return; }
    const r = await SB.from('proveedores').select('id,nit,razon_social,nombre_comercial,correo,telefono1,asesor').eq('id', p.proveedor_id).single();
    const prov = r.data || {};
    const estado = await envioCargar(id);
    const c = EnvioPedido.contacto(prov);
    EPC.ctx = { id, p, prov, c, estado };
    const opcion = (canal, icono, titulo, ayuda, v) => `<label style="display:flex;gap:8px;align-items:flex-start;margin:8px 0;${v.ok ? '' : 'opacity:.75'}">
        <input type="checkbox" id="env_ck_${canal}" style="width:auto;margin-top:4px" ${v.ok ? 'checked' : 'disabled'}>
        <span><b>${icono} ${titulo}</b>${v.ok ? ` <span class="mut">→ ${escE(canal === 'correo' ? v.valor : v.visible)}</span><div class="mut">${ayuda}</div>` : `<div style="color:#b45309">${escE(v.motivo)}</div>`}</span></label>`;
    cuerpo.innerHTML = `
      <div style="display:flex;gap:26px;flex-wrap:wrap;margin-bottom:6px">
        <div><div class="mut" style="font-weight:700">PROVEEDOR</div><div style="font-weight:700">${escE(prov.razon_social || prov.nombre_comercial || p.proveedor_texto || '')}</div></div>
        <div><div class="mut" style="font-weight:700">PEDIDO</div><div style="font-weight:700">#${escE(p.numero)}</div></div>
        <div><div class="mut" style="font-weight:700">FECHA</div><div style="font-weight:700">${escE(EnvioPedido.fechaCorta(p.fecha))}</div></div>
      </div>
      ${opcion('correo', '✉️', 'Enviar por correo', 'Sale automático desde el sistema, con el PDF del pedido adjunto.', c.correo)}
      ${opcion('whatsapp', '💬', 'Enviar por WhatsApp', 'Se abre WhatsApp con el mensaje escrito; <b>tú das “enviar”</b> (no es automático).', c.whatsapp)}
      <div id="env_dup" style="display:none;background:#fffbeb;border:1px solid #f59e0b;border-radius:10px;padding:10px 14px;margin:10px 0">
        <b>Este pedido ya fue enviado al proveedor. ¿Desea reenviarlo?</b>
        <div class="row" style="margin-top:8px"><span class="sp"></span>
          <button onclick="$('env_dup').style.display='none'">CANCELAR</button>
          <button class="p" id="env_reenviar" onclick="envioConfirmar(true)">REENVIAR</button></div></div>
      <div id="env_msg" style="min-height:18px;margin:6px 0"></div>
      <div class="row"><span class="sp"></span>
        <button id="env_cancel" onclick="$('modalEnvio').classList.remove('on')">CANCELAR</button>
        <button class="p" id="env_btn" onclick="envioConfirmar(false)">ENVIAR PEDIDO</button></div>`;
    if (!c.hayAlguno) envioMsg('Este proveedor no tiene correo ni WhatsApp válidos registrados. Agrégalos en Proveedores para poder enviar.', false);
  } catch (e) { cuerpo.innerHTML = `<div class="err" style="display:block">No pude preparar el envío: ${escE(envioMsgErr(e))}</div>`; EPC.ctx = null; }
}

// Se llama desde el clic. Es SINCRONA hasta abrir la ventana de WhatsApp (el navegador solo permite abrirla dentro del clic).
function envioConfirmar(reenviar) {
  const x = EPC.ctx; if (!x) return;
  if (EPC.enCurso[x.id]) return;                                  // doble clic: no se envia dos veces
  const canales = ['correo', 'whatsapp'].filter((k) => { const e = $('env_ck_' + k); return e && e.checked && !e.disabled; });
  if (!canales.length) { envioMsg(x.c.hayAlguno ? 'Elige al menos un canal (correo o WhatsApp).' : 'No hay ningún canal disponible: el proveedor no tiene correo ni WhatsApp válidos.', false); return; }
  for (const k of canales) if (!x.c[k].ok) { envioMsg(x.c[k].motivo, false); return; }
  const ya = EnvioPedido.canalesYaEnviados(x.estado.porCanal, canales);
  if (ya.length && !reenviar) { $('env_dup').style.display = 'block'; envioMsg('', true); return; }
  EPC.enCurso[x.id] = true; envioBloquear(true); envioMsg('Enviando...', true);
  $('env_dup').style.display = 'none';
  let win = null;
  if (canales.includes('whatsapp')) { try { win = window.open('', '_blank'); } catch (_) { win = null; } }
  envioEjecutar(x, canales, !!reenviar, win).catch((e) => envioMsg('No se pudo enviar: ' + envioMsgErr(e), false))
    .finally(() => { EPC.enCurso[x.id] = false; envioBloquear(false); });
}

// datos reales del pedido para armar los mensajes (mismas fuentes que el detalle y el PDF: pedido_lineas + articulos.unimedida_compra)
async function envioDatos(x, intento, enlacePdf) {
  const l = await SB.from('pedido_lineas').select('codigo,insumo,cantidad,unidad').eq('pedido_id', x.id);
  if (l.error) throw new Error('No pude leer los productos del pedido: ' + l.error.message);
  const lineas = l.data || [];
  if (!lineas.length) throw new Error('El pedido no tiene productos.');
  const cds = [...new Set(lineas.map((y) => y.codigo).filter(Boolean))], unidades = {};
  if (cds.length) {
    const a = await SB.from('articulos').select('codigo_barras,unimedida_compra').in('codigo_barras', cds.slice(0, 300));
    (a.data || []).forEach((y) => { if (y.unimedida_compra) unidades[y.codigo_barras] = y.unimedida_compra; });
  }
  const sede = (typeof sedes !== 'undefined' ? sedes : []).find((s) => s.id === x.p.sede_id) || {};
  const empresa = [x.p.sede_texto || sede.nombre].filter(Boolean).join(' ');
  const base = { pedido: x.p, proveedor: x.prov, lineas, unidades, empresa, intento };
  const m = EnvioPedido.armarMensajes({ ...base, enlacePdf });
  m.textoSinPdf = EnvioPedido.armarMensajes(base).textoWhatsapp;
  return m;
}

// PDF de la orden (el MISMO de "⬇ PDF", con los codigos de producto) guardado en el bucket privado: sirve de ADJUNTO del correo y de ENLACE en WhatsApp.
async function envioPdf(x) {
  if (x.pdf) return x.pdf;
  const pdf = await ordenCompra(x.id, { soloBlob: true });
  if (!pdf) throw new Error('No se pudo generar el PDF del pedido.');
  const ruta = EnvioPedido.rutaPdf(x.p.numero);
  const up = await SB.storage.from('facturas').upload(ruta, pdf.blob, { upsert: true, contentType: 'application/pdf' });
  if (up.error) throw new Error('No se pudo guardar el PDF: ' + up.error.message);
  x.pdf = { ruta, blob: pdf.blob, nombre: pdf.nombre || ruta.split('/').pop() };
  return x.pdf;
}
// WhatsApp no deja adjuntar un archivo desde una pagina (wa.me solo lleva texto): se manda un enlace directo al PDF, valido 30 dias.
const DIAS_ENLACE_PDF = 30;
async function envioEnlacePdf(ruta) {
  const r = await SB.storage.from('facturas').createSignedUrl(ruta, 60 * 60 * 24 * DIAS_ENLACE_PDF);
  if (r.error || !r.data || !r.data.signedUrl) throw new Error('No se pudo crear el enlace del PDF' + (r.error ? ': ' + r.error.message : ''));
  return r.data.signedUrl;
}

async function envioRegistrar(x, canal, destinatario, estado, colaId, error) {
  const r = await SB.rpc('pedido_envio_registrar', { p_pedido_id: x.id, p_canal: canal, p_destinatario: destinatario, p_estado: estado, p_correo_cola_id: colaId == null ? null : colaId, p_error: error || null });
  if (r.error) throw new Error('No pude registrar el envío: ' + r.error.message);
}

async function envioEjecutar(x, canales, reenviar, win) {
  const cerrarWin = () => { try { if (win) win.close(); } catch (_) { /* nada */ } };
  // Estado fresco (otra pestaña/persona pudo enviarlo hace un momento)
  const fresco = await envioCargar(x.id);
  x.estado = fresco; x.pdf = null;   // el PDF se genera de nuevo en cada envio (el pedido pudo cambiar)
  if (EnvioPedido.canalesYaEnviados(fresco.porCanal, canales).length && !reenviar) {
    cerrarWin(); $('env_dup').style.display = 'block'; envioMsg('', true); return;
  }
  const res = [];
  if (canales.includes('correo')) res.push(await envioCorreo(x, fresco));
  if (canales.includes('whatsapp')) res.push(await envioWhatsapp(x, fresco, win));
  else cerrarWin();
  const bien = res.filter((r) => r.ok).map((r) => r.texto), mal = res.filter((r) => !r.ok).map((r) => r.texto);
  envioMsg([...bien, ...mal].join('  ·  '), !mal.length);
  x.estado = await envioCargar(x.id);
  pintarEstadoEnvio(x.id);
  if (!mal.length) setTimeout(() => { $('modalEnvio').classList.remove('on'); }, 1600);
}

// CORREO: PDF -> Storage -> cola (correo_encolar) -> registro. Un fallo se registra como ERROR de ese canal; no afecta a los demas.
async function envioCorreo(x, fresco) {
  const dest = x.c.correo.valor;
  try {
    const ruta = (await envioPdf(x)).ruta;
    const m = await envioDatos(x, EnvioPedido.proximoIntento(fresco.envios, 'correo'));
    const r = await SB.rpc('correo_encolar', { p_para: dest, p_asunto: m.asunto, p_cuerpo: m.cuerpoCorreo, p_pedido: String(x.p.numero), p_archivo_pdf: ruta });
    if (r.error) throw new Error(r.error.message);
    const fila = Array.isArray(r.data) ? r.data[0] : r.data;
    if (fila && fila.duplicado) return { ok: true, texto: '✉️ Este correo ya estaba en la cola de envío (no se duplicó).' };
    await envioRegistrar(x, 'correo', dest, 'pendiente', fila && fila.correo_id, null);
    return { ok: true, texto: '✉️ Correo en cola: sale en unos minutos desde el sistema.' };
  } catch (e) {
    const msg = envioMsgErr(e);
    try { await envioRegistrar(x, 'correo', dest, 'error', null, msg); } catch (_) { /* si tampoco se pudo registrar, igual se le avisa a la persona */ }
    return { ok: false, texto: '✉️ Correo NO enviado: ' + msg };
  }
}

// WHATSAPP (sin API oficial): enlace wa.me con el mensaje escrito. Queda "enlace abierto" hasta que la persona confirme a mano.
async function envioWhatsapp(x, fresco, win) {
  const dest = x.c.whatsapp.valor;
  try {
    let enlace = null, aviso = '';
    try { const pdf = await envioPdf(x); enlace = await envioEnlacePdf(pdf.ruta); }
    catch (e) { aviso = ' ⚠️ Sin enlace al PDF (' + envioMsgErr(e) + '): el mensaje sale igual; adjunta el PDF con “⬇ PDF”.'; }
    const m = await envioDatos(x, EnvioPedido.proximoIntento(fresco.envios, 'whatsapp'), enlace);
    if (x.pdf) EPC.compartir[x.id] = { archivo: x.pdf, texto: m.textoSinPdf };
    const url = EnvioPedido.enlaceWhatsapp(dest, m.textoWhatsapp);
    let abierto = false;
    if (win && !win.closed) { win.location.href = url; abierto = true; }
    await envioRegistrar(x, 'whatsapp', dest, 'enlace_generado', null, abierto ? null : 'El navegador bloqueó la ventana: usa "Abrir WhatsApp otra vez".');
    return { ok: !aviso, texto: '💬 WhatsApp: ' + (abierto ? 'se abrió con el mensaje listo' + (enlace ? ' (con el enlace al PDF)' : '') + ' — falta que des “enviar” allá.' + aviso : 'el navegador bloqueó la ventana; usa “Abrir WhatsApp otra vez” en el detalle del pedido.') };
  } catch (e) {
    try { if (win) win.close(); } catch (_) { /* nada */ }
    const msg = envioMsgErr(e);
    try { await envioRegistrar(x, 'whatsapp', dest, 'error', null, msg); } catch (_) { /* nada */ }
    return { ok: false, texto: '💬 WhatsApp NO preparado: ' + msg };
  }
}

// ---------- acciones sobre un envio ya hecho ----------
// REINTENTAR ENVÍO: solo vuelve a avisar al proveedor por ese canal; jamas toca el pedido ni sus productos.
async function envioReintentar(id, canal) {
  if (EPC.enCurso[id]) return; EPC.enCurso[id] = true;
  try {
    const p = pedidos.find((y) => y.id === id); if (!p) return;
    const e = await envioCargar(id);
    const u = e.envios.find((y) => y.canal === canal);
    if (u && u.canal === 'correo' && u.correo_cola_id != null && u.estado !== 'error') {
      // el correo se encolo pero la entrega fallo: se re-encola ESE mismo correo (correo_reintentar)
      const r = await SB.rpc('correo_reintentar', { p_id: u.correo_cola_id }); if (r.error) throw new Error(r.error.message);
      await envioRegistrar({ id }, 'correo', u.destinatario, 'pendiente', u.correo_cola_id, null);
    } else {
      // fallo antes de encolarse (o WhatsApp): se prepara de nuevo el envio de ese canal
      const rv = await SB.from('proveedores').select('id,nit,razon_social,nombre_comercial,correo,telefono1,asesor').eq('id', p.proveedor_id).single();
      const prov = rv.data || {}, c = EnvioPedido.contacto(prov), x = { id, p, prov, c, estado: e };
      if (!c[canal].ok) { alert(c[canal].motivo); return; }
      let win = null; if (canal === 'whatsapp') { try { win = window.open('', '_blank'); } catch (_) { win = null; } }
      const r = canal === 'correo' ? await envioCorreo(x, e) : await envioWhatsapp(x, e, win);
      if (!r.ok) alert(r.texto);
    }
  } catch (er) { alert('No se pudo reintentar: ' + envioMsgErr(er)); }
  finally { EPC.enCurso[id] = false; pintarEstadoEnvio(id); }
}

async function envioConfirmarWhatsapp(id) {
  try {
    const e = await envioCargar(id); const u = e.envios.find((y) => y.canal === 'whatsapp'); if (!u) return;
    await envioRegistrar({ id }, 'whatsapp', u.destinatario, 'confirmado_manual', null, null);
  } catch (er) { alert('No se pudo registrar: ' + envioMsgErr(er)); }
  pintarEstadoEnvio(id);
}

async function envioReabrirWhatsapp(id) {
  let win = null; try { win = window.open('', '_blank'); } catch (_) { win = null; }
  try {
    const p = pedidos.find((y) => y.id === id); const rv = await SB.from('proveedores').select('id,nit,razon_social,nombre_comercial,correo,telefono1,asesor').eq('id', p.proveedor_id).single();
    const prov = rv.data || {}, c = EnvioPedido.contacto(prov); if (!c.whatsapp.ok) throw new Error(c.whatsapp.motivo);
    const e = await envioCargar(id);
    const x = { id, p, prov }; let enlace = null;
    try { try { enlace = await envioEnlacePdf(EnvioPedido.rutaPdf(p.numero)); } catch (_) { enlace = await envioEnlacePdf((await envioPdf(x)).ruta); } } catch (_) { /* sin enlace: el mensaje sale igual */ }
    const m = await envioDatos(x, Math.max(1, EnvioPedido.proximoIntento(e.envios, 'whatsapp') - 1), enlace);
    const url = EnvioPedido.enlaceWhatsapp(c.whatsapp.valor, m.textoWhatsapp);
    if (win) win.location.href = url; else window.open(url, '_blank');
  } catch (er) { try { if (win) win.close(); } catch (_) { /* nada */ } alert('No pude abrir WhatsApp: ' + envioMsgErr(er)); }
}

// ---------- PDF como ARCHIVO ADJUNTO en WhatsApp (menu "Compartir" del navegador) ----------
// wa.me no puede adjuntar archivos; el menu Compartir del sistema si (celulares y algunos equipos): se elige WhatsApp y el chat, y el PDF va adjunto con el mensaje.
const envioPuedeCompartir = () => { try { return typeof navigator !== 'undefined' && !!navigator.canShare && navigator.canShare({ files: [new File([new Blob(['x'])], 'x.pdf', { type: 'application/pdf' })] }); } catch (_) { return false; } };
async function envioCompartirPdf(id) {
  const c = EPC.compartir[id];
  if (!c) {   // pagina recargada: se prepara el PDF y se pide otro toque (el navegador solo deja compartir justo despues de un clic)
    try {
      const p = pedidos.find((y) => y.id === id); const rv = await SB.from('proveedores').select('id,nit,razon_social,nombre_comercial,correo,telefono1,asesor').eq('id', p.proveedor_id).single();
      const x = { id, p, prov: rv.data || {} }; const pdf = await envioPdf(x); const m = await envioDatos(x, 1, null);
      EPC.compartir[id] = { archivo: pdf, texto: m.textoSinPdf };
      alert('El PDF ya está listo: pulsa otra vez “📎 Compartir PDF adjunto”.');
    } catch (e) { alert('No pude preparar el PDF: ' + envioMsgErr(e)); }
    return;
  }
  try { await navigator.share({ files: [new File([c.archivo.blob], c.archivo.nombre || 'pedido.pdf', { type: 'application/pdf' })], title: 'Pedido', text: c.texto || '' }); }
  catch (e) { if (!e || e.name !== 'AbortError') alert('No se pudo compartir: ' + envioMsgErr(e)); }
}
