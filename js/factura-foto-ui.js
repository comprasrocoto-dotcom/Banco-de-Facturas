// ============================================================
//  factura-foto-ui.js  -  ventana "📸 Foto de la factura" del pedido (14/10/2026)
// ============================================================
// La sede toma la foto de la factura desde el pedido. El N° sale del codigo QR (si se puede leer) o lo escribe. Se sube la
// foto y factura_foto_registrar busca ESA factura en el banco (mismo proveedor + mismo numero, o el CUFE del QR) y la
// amarra al pedido. Si aun no esta en el banco, queda esperando y la base la amarra sola cuando llegue (trigger).
// Logica pura en js/factura-foto.js. El QR se lee con el lector del navegador (BarcodeDetector) o con jsQR (sin IA).
// (15/10/2026) tambien NOTA CREDITO, DEVOLUCION u OTRO documento (tipo) y la NOVEDAD al recibir (devolucion, faltante...)
const FF = { pedido: null, foto: null, fotoUrl: null, cufe: null, guardando: false, porPedido: {}, tipo: 'factura' };

function ffModal() {
  let m = document.getElementById('modalFF');
  if (m) return m;
  m = document.createElement('div');
  m.id = 'modalFF'; m.className = 'modal';
  m.innerHTML = `<div class="card" style="max-width:560px">
    <h1 id="ffTitulo">📸 Foto de la factura</h1>
    <div class="mut" id="ffAyuda" style="margin-bottom:8px">Toma la foto de la factura donde se vean el número y el código QR. El sistema busca esa factura en el banco y la amarra a este pedido. Si todavía no está en el banco, se amarra sola cuando llegue.</div>
    <label id="ffTipoLbl" style="font-weight:700;display:block">Tipo de documento</label>
    <select id="ffTipo" style="margin:4px 0 8px" onchange="ffCambiarTipo(this.value)"></select>
    <label style="font-weight:700">1. Foto del documento <span style="color:#b91c1c">*</span></label>
    <div class="row" style="gap:8px;margin:4px 0">
      <button type="button" class="s" onclick="$('ffFotoCam').click()">📷 Tomar foto</button>
      <button type="button" onclick="$('ffFoto').click()">📎 Subir foto</button></div>
    <input type="file" id="ffFotoCam" accept="image/*" capture="environment" style="display:none" onchange="ffElegirFoto(this)">
    <input type="file" id="ffFoto" accept="image/*" style="display:none" onchange="ffElegirFoto(this)">
    <div id="ffFotoVista" style="margin:6px 0"></div>
    <div id="ffQR" class="mut" style="margin:4px 0"></div>
    <div class="row" style="gap:12px;align-items:flex-end;flex-wrap:wrap">
      <div><label style="font-weight:700">2. <span id="ffNumLbl">N° de la factura</span> <span id="ffNumReq" style="color:#b91c1c">*</span></label><input id="ffNumero" placeholder="Ej. FE38865" style="width:160px;margin:4px 0" autocomplete="off"></div>
      <div><label style="font-weight:700">3. <span id="ffFechaLbl">Fecha Recibido</span> <span style="color:#b91c1c">*</span></label><input type="date" id="ffFecha" style="width:auto;margin:4px 0"></div>
    </div>
    <div><label style="font-weight:700">4. Recibido por <span style="color:#b91c1c">*</span></label><input id="ffRecibe" placeholder="Nombre de quien recibe" style="margin:4px 0" autocomplete="off"></div>
    <div id="ffCentroBox" style="display:none;margin:4px 0"><label style="font-weight:700">Centro de costo <span style="color:#b91c1c">*</span></label><div id="ffCentroSel"></div></div>
    <div id="ffNovBox" style="margin-top:8px;padding:10px 12px;border:1px solid #fde68a;background:#fffbeb;border-radius:10px">
      <label style="font-weight:700">5. ¿Llegó todo bien? (novedad)</label>
      <select id="ffNovTipo" style="margin:4px 0" onchange="ffCambiarNovedad()"></select>
      <textarea id="ffNovTexto" placeholder="Cuenta qué pasó: producto, cantidad y motivo (ej. devolví 2 cajas de Coca-Cola por golpeadas)" style="display:none;min-height:64px;margin:4px 0"></textarea>
      <div class="mut" style="font-size:12px">La novedad le llega al analista en Facturas → «Con novedad», en la factura de este pedido.</div>
    </div>
    <div class="err" id="ffErr"></div>
    <div class="row" style="margin-top:8px"><span class="sp"></span>
      <button onclick="ffCerrar()">Cancelar</button>
      <button class="p" id="ffGuardar" onclick="ffGuardar()">Guardar y buscar factura</button></div>
  </div>`;
  document.body.appendChild(m);
  return m;
}

const FF_AYUDA = {
  factura: 'Toma la foto de la factura donde se vean el número y el código QR. El sistema busca esa factura en el banco y la amarra a este pedido. Si todavía no está en el banco, se amarra sola cuando llegue.',
  nota_credito: 'Toma la foto de la nota crédito (número y código QR). El sistema la busca en el banco y la amarra a la factura de este pedido. Si todavía no está en el banco, o el pedido aún no tiene factura, se amarra sola después.',
  devolucion: 'Toma la foto del papel de la devolución. Queda guardada como soporte de este pedido. Si devolviste algo, cuéntalo abajo en la novedad.',
  otro: 'Toma la foto del documento (remisión, acta, etc.). Queda guardado como soporte de este pedido.',
};
// cambia textos y campos segun el tipo de documento (js/factura-foto.js -> requisitos)
function ffCambiarTipo(tipo) {
  FF.tipo = tipo || 'factura';
  const rq = FacturaFoto.requisitos(FF.tipo), nom = FacturaFoto.nombreTipo(FF.tipo);
  const p = FF.pedido || {};
  $('ffAyuda').textContent = FF_AYUDA[FF.tipo] || FF_AYUDA.factura;
  $('ffTitulo').textContent = '📸 ' + nom + ' — pedido ' + (p.numero || '') + ' · ' + (p.proveedor_texto || p.proveedor || '');
  $('ffNumLbl').textContent = 'N° de ' + (FF.tipo === 'nota_credito' ? 'la nota crédito' : FF.tipo === 'factura' ? 'la factura' : 'el documento (si tiene)');
  $('ffNumReq').style.display = rq.numero ? '' : 'none';
  $('ffNumero').placeholder = FF.tipo === 'nota_credito' ? 'Ej. NC1234' : FF.tipo === 'factura' ? 'Ej. FE38865' : 'opcional';
  $('ffFechaLbl').textContent = FF.tipo === 'factura' ? 'Fecha Recibido' : 'Fecha del documento';
  if (rq.fechaPedido && p.fecha) $('ffFecha').min = String(p.fecha).slice(0, 10); else $('ffFecha').removeAttribute && $('ffFecha').removeAttribute('min');
  $('ffCentroBox').style.display = rq.centro && $('ffCentroSel').innerHTML ? '' : 'none';
  $('ffGuardar').textContent = FF.tipo === 'factura' || FF.tipo === 'nota_credito' ? 'Guardar y buscar ' + (FF.tipo === 'factura' ? 'factura' : 'nota crédito') : 'Guardar';
  if (!rq.qr) { FF.cufe = null; $('ffQR').innerHTML = ''; }
}
function ffCambiarNovedad() {
  const hay = !!$('ffNovTipo').value;
  $('ffNovTexto').style.display = hay ? '' : 'none';
  if (hay) setTimeout(() => { try { $('ffNovTexto').focus(); } catch (e) {} }, 30);
}

// soloSoportes: proveedor de cuenta de cobro -> solo devolucion / otro documento
async function abrirFotoFactura(pedidoId, soloSoportes) {
  const p = (typeof pedidos !== 'undefined' ? pedidos : []).find((x) => x.id === pedidoId);
  if (!p) return;
  let tipos = FacturaFoto.tiposOfrecidos(p, !!soloSoportes);
  if (FF.baseNueva === false) tipos = tipos.filter(([t]) => t === 'factura');   // base sin factura_foto_documentos.sql
  if (!tipos.length) { alert('Esta opción todavía no está activa: falta actualizar la base de datos.'); return; }
  const m = ffModal();
  FF.pedido = p; FF.foto = null; FF.cufe = null; FF.guardando = false;
  if (FF.fotoUrl) { try { URL.revokeObjectURL(FF.fotoUrl); } catch (e) {} FF.fotoUrl = null; }
  $('ffFoto').value = ''; $('ffFotoCam').value = ''; $('ffFotoVista').innerHTML = ''; $('ffQR').innerHTML = ''; $('ffNumero').value = ''; $('ffErr').textContent = '';
  $('ffRecibe').value = (typeof perfil !== 'undefined' && perfil && perfil.nombre) || '';
  $('ffTipo').innerHTML = tipos.map(([v, t]) => `<option value="${v}">${escAg(t)}</option>`).join('');
  $('ffNovTipo').innerHTML = FacturaFoto.NOVEDADES.map(([v, t]) => `<option value="${v}">${escAg(t)}</option>`).join('');
  $('ffNovTipo').value = ''; $('ffNovTexto').value = ''; $('ffNovTexto').style.display = 'none';
  if ($('ffNovBox')) $('ffNovBox').style.display = FF.baseNueva === false ? 'none' : '';
  if ($('ffTipo')) $('ffTipo').style.display = tipos.length > 1 ? '' : 'none';
  if ($('ffTipoLbl')) $('ffTipoLbl').style.display = tipos.length > 1 ? 'block' : 'none';
  const hoy = FechaRecibido.hoyCO();
  $('ffFecha').value = hoy; $('ffFecha').max = hoy;
  let htmlCC = '';
  try { if (typeof cargarCentrosCosto === 'function') await cargarCentrosCosto(); htmlCC = CentroCosto.selectHtml(centrosCosto, p.marca_id, 'ffCentro', ''); } catch (e) { htmlCC = ''; }
  $('ffCentroSel').innerHTML = htmlCC;
  $('ffTipo').value = tipos[0][0];
  ffCambiarTipo(tipos[0][0]);
  m.classList.add('on');
}

// la foto se reduce (lado mayor 1600 px, JPG) para subir rapido; el QR se busca en una copia mas grande (hasta 2400 px)
async function ffElegirFoto(input) {
  const f = input.files && input.files[0];
  FF.foto = null; FF.cufe = null; $('ffFotoVista').innerHTML = ''; $('ffQR').innerHTML = '';
  if (!f) return;
  if (!/^image\//.test(f.type)) { $('ffErr').textContent = 'El archivo no es una foto.'; return; }
  if (FF.fotoUrl) { try { URL.revokeObjectURL(FF.fotoUrl); } catch (e) {} FF.fotoUrl = null; }
  try { FF.foto = await ccComprimir(f); } catch (e) { FF.foto = f; }
  FF.fotoUrl = URL.createObjectURL(FF.foto);
  $('ffFotoVista').innerHTML = `<img src="${FF.fotoUrl}" alt="Foto de la factura" style="max-width:100%;max-height:220px;border:1px solid var(--line);border-radius:8px">`;
  $('ffErr').textContent = '';
  if (!FacturaFoto.requisitos(FF.tipo).qr) return;   // devolucion / otro: no traen QR de la DIAN
  const doc = FF.tipo === 'nota_credito' ? 'nota crédito' : 'factura';
  $('ffQR').textContent = 'Buscando el código QR...';
  let texto = null;
  try { texto = await ffLeerQR(f); } catch (e) { texto = null; }
  const qr = FacturaFoto.leerQR(texto);
  if (qr && (qr.numero || qr.cufe)) {
    FF.cufe = qr.cufe || null;
    if (qr.numero) $('ffNumero').value = qr.numero;
    $('ffQR').innerHTML = '<span style="color:#166534;font-weight:700">✅ Leí el código QR' + (qr.numero ? ': ' + doc + ' ' + escAg(qr.numero) : '') + '</span>' +
      (qr.numero ? '' : ' <span class="mut">(escribe el número)</span>');
  } else {
    $('ffQR').innerHTML = '<span style="color:#92400e">No pude leer el código QR: escribe el número de la ' + doc + ' como sale en el papel.</span>';
    setTimeout(() => { try { $('ffNumero').focus(); } catch (e) {} }, 50);
  }
}

// texto del QR de la foto, o null. Primero el lector del navegador; si no hay, jsQR (se carga solo cuando hace falta)
async function ffLeerQR(file) {
  const img = await new Promise((ok, mal) => { const i = new Image(), u = URL.createObjectURL(file); i.onload = () => { URL.revokeObjectURL(u); ok(i); }; i.onerror = () => { URL.revokeObjectURL(u); mal(new Error('foto')); }; i.src = u; });
  const tamanos = [4000, 2400, 1400, 900];   // primero casi tal cual (QR pequeño en la foto), luego mas chica (QR grande o borroso)
  if (typeof BarcodeDetector !== 'undefined') {
    try {
      const det = new BarcodeDetector({ formats: ['qr_code'] });
      const r = await det.detect(img);
      if (r && r.length && r[0].rawValue) return r[0].rawValue;
    } catch (e) { /* sigue con jsQR */ }
  }
  if (typeof jsQR === 'undefined') {
    await new Promise((ok) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js'; s.onload = ok; s.onerror = ok; document.head.appendChild(s); });
  }
  if (typeof jsQR === 'undefined') return null;
  for (const lado of tamanos) {
    const k = Math.min(1, lado / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, c.width, c.height);
    const d = ctx.getImageData(0, 0, c.width, c.height);
    const r = jsQR(d.data, c.width, c.height, { inversionAttempts: 'attemptBoth' });
    if (r && r.data) return r.data;
  }
  return null;
}

function ffCerrar() { const m = $('modalFF'); if (m) m.classList.remove('on'); }

async function ffGuardar() {
  if (FF.guardando || !FF.pedido) return;
  const p = FF.pedido, err = $('ffErr'); err.textContent = '';
  const tipo = FF.tipo || 'factura', rq = FacturaFoto.requisitos(tipo), nom = ({ factura: 'factura', nota_credito: 'nota crédito', devolucion: 'devolución', otro: 'documento' })[tipo] || 'factura';
  const errores = [];
  if (!FF.foto) errores.push('Toma la foto del documento.');
  const num = FacturaFoto.numeroLimpio($('ffNumero').value);
  if (rq.numero && (!num || !/\d/.test(num))) errores.push('Escribe el número de la ' + nom + ' (como sale en el papel).');
  const vf = FechaRecibido.validar($('ffFecha').value, rq.fechaPedido ? p.fecha : null, FechaRecibido.hoyCO()); if (!vf.ok) errores.push(vf.error);
  const recibe = ($('ffRecibe').value || '').trim(); if (recibe.length < 3) errores.push('Escribe el nombre de quien recibe.');
  let cc = null;
  if (rq.centro && $('ffCentro')) { const vc = CentroCosto.validar(centrosCosto, p.marca_id, $('ffCentro').value); if (!vc.ok) errores.push(vc.error); else cc = vc.serie; }
  const vn = FacturaFoto.validarNovedad($('ffNovTipo').value, $('ffNovTexto').value); if (!vn.ok) errores.push(vn.error);
  if (errores.length) { err.innerHTML = errores.map(escAg).join('<br>'); return; }
  FF.guardando = true; $('ffGuardar').disabled = true; $('ffGuardar').textContent = 'Guardando...';
  const ruta = FacturaFoto.rutaFoto(p, Date.now(), 'jpg');
  try {
    const up = await SB.storage.from('facturas').upload(ruta, FF.foto, { contentType: 'image/jpeg', upsert: false });
    if (up.error) throw new Error('No pude subir la foto: ' + up.error.message);
    const base = { p_pedido_id: p.id, p_numero: num, p_foto: ruta, p_fecha_recibido: vf.fecha, p_cufe_qr: rq.qr ? FF.cufe : null, p_centro_costo: cc, p_recibido_por: recibe };
    let r = await SB.rpc('factura_foto_registrar', Object.assign({}, base, { p_tipo: tipo, p_novedad_tipo: vn.tipo, p_novedad: vn.texto }));
    // la base aun sin supabase/factura_foto_documentos.sql (funcion de 7 datos): la factura sin novedad se guarda como antes;
    // lo nuevo (nota credito, devolucion, otro, novedad) avisa que falta actualizar la base
    if (r.error && FacturaFoto.baseSinDocumentos(r.error)) {
      if (tipo === 'factura' && !vn.tipo) r = await SB.rpc('factura_foto_registrar', base);
      else { try { await SB.storage.from('facturas').remove([ruta]); } catch (e) {} throw new Error('Esta opción (' + FacturaFoto.nombreTipo(tipo).toLowerCase() + (vn.tipo ? ' / novedad' : '') + ') todavía no está activa: falta actualizar la base de datos. Por ahora usa «Factura electrónica» sin novedad, o reporta la novedad desde Facturas → «Novedad».'); }
    }
    if (r.error) { try { await SB.storage.from('facturas').remove([ruta]); } catch (e) {} throw new Error(r.error.message); }
    const d = r.data || {};
    ffCerrar();
    const nov = vn.tipo ? (d.novedad_registrada ? '\n\n📣 La novedad quedó registrada en la factura del pedido (el analista la ve en «Con novedad»).' : '\n\n📣 La novedad se registra en cuanto el pedido tenga su factura.') : '';
    if (d.estado === 'AMARRADA') alert('✅ Encontré la ' + nom + ' ' + (d.documento || num) + ' en el banco y quedó amarrada ' + (tipo === 'nota_credito' ? 'a la factura del pedido ' : 'al pedido ') + (p.numero || '') + '.' + (tipo === 'factura' ? '\nEl agente la ingresa al ERP en la próxima orden de ingresos.' : '') + nov);
    else if (d.estado === 'ESPERANDO') alert('📸 Foto guardada. ' + (d.motivo ? 'La ' + nom + ' ' + num + ': ' + d.motivo + '.' : 'La ' + nom + ' ' + num + ' todavía no está en el banco: apenas llegue se amarra sola a este pedido.') + nov);
    else if (d.estado === 'GUARDADA') alert('📎 ' + FacturaFoto.nombreTipo(tipo) + ' guardada como soporte del pedido ' + (p.numero || '') + '.' + nov);
    else alert('⚠️ Foto guardada, pero no se pudo amarrar sola: ' + (d.motivo || 'revisar') + '.' + nov);
    try { if (typeof cargar === 'function') await cargar(); } catch (e) {}
    try { if (typeof cargarPedidos === 'function') { pedidosCargados = false; await cargarPedidos(); } } catch (e) {}
  } catch (e) {
    err.textContent = e.message;
  } finally {
    FF.guardando = false; const b = $('ffGuardar'); if (b) b.disabled = false; try { ffCambiarTipo(FF.tipo); } catch (e) {}
  }
}

// (15/10/2026) DOCUMENTOS DEL PEDIDO: las fotos que se tomaron (factura, nota credito, devolucion, otro), su estado y su novedad
async function pintarDocsPedido(pedidoId) {
  const caja = $('docs_' + pedidoId); if (!caja) return;
  let l = [];
  try {
    const r = await SB.from('factura_foto').select('id,tipo_doc,numero,estado,motivo,foto,novedad_tipo,novedad,creado_en').eq('pedido_id', pedidoId).neq('estado', 'CANCELADA').order('creado_en', { ascending: false });
    if (r.error) return; l = r.data || [];
  } catch (e) { return; }
  if (!l.length) { caja.innerHTML = ''; return; }
  const nov = (t) => (FacturaFoto.NOVEDADES.find((x) => x[0] === t) || [, ''])[1];
  caja.innerHTML = `<div style="border:1px solid var(--line);border-radius:12px;padding:12px 16px;margin-top:16px">
    <div style="font-weight:700;color:#1e3a8a">📎 DOCUMENTOS DEL PEDIDO (fotos)</div>
    ${l.map((x) => `<div class="row" style="gap:8px;padding:6px 0;border-bottom:1px solid var(--line)">
      <span class="badge">${escAg(FacturaFoto.nombreTipo(x.tipo_doc || 'factura'))}${x.numero && x.numero !== 'SN' ? ' ' + escAg(x.numero) : ''}</span>
      <span class="mut" style="flex:1 1 200px">${escAg(FacturaFoto.aviso(x))}${x.novedad_tipo ? `<div style="color:#92400e">📣 ${escAg(nov(x.novedad_tipo))}: ${escAg(x.novedad || '')}</div>` : ''}</span>
      ${x.foto ? `<button onclick="verPdfArchivo('${escAg(x.foto)}')">👁 Ver foto</button>` : ''}</div>`).join('')}
  </div>`;
}

// fotos que esperan o tienen novedad, por pedido (para la etiqueta en la lista de pedidos)
async function cargarFotosFactura() {
  try {
    let r = await SB.from('factura_foto').select('pedido_id,numero,estado,motivo,tipo_doc').in('estado', ['ESPERANDO', 'NOVEDAD']).limit(1000);
    FF.baseNueva = !r.error;   // false: la base aun sin factura_foto_documentos.sql -> solo la foto de factura de siempre
    if (r.error) r = await SB.from('factura_foto').select('pedido_id,numero,estado,motivo').in('estado', ['ESPERANDO', 'NOVEDAD']).limit(1000);   // base sin tipo_doc
    FF.porPedido = {};
    (r.data || []).forEach((x) => { const y = FF.porPedido[x.pedido_id]; if (!y || x.estado === 'NOVEDAD') FF.porPedido[x.pedido_id] = x; });
  } catch (e) { FF.porPedido = {}; }
}
function fotoFacturaBadge(p) {
  const x = p && FF.porPedido[p.id];
  if (!x || (p.factura_cufe && (x.tipo_doc || 'factura') === 'factura')) return '';
  const nov = x.estado === 'NOVEDAD', nc = x.tipo_doc === 'nota_credito';
  return '<span class="badge" style="' + (nov ? 'background:#fef3c7;color:#92400e' : 'background:#e0f2fe;color:#075985') + '" title="' + escAg(FacturaFoto.aviso(x)) + '">' +
    (nov ? '⚠️ Foto ' : '📸 Esperando ') + (nc ? 'NC ' : '') + escAg(x.numero) + '</span>';
}
