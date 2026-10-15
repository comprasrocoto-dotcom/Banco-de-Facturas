// ============================================================
//  factura-foto-ui.js  -  ventana "📸 Foto de la factura" del pedido (14/10/2026)
// ============================================================
// La sede toma la foto de la factura desde el pedido. El N° sale del codigo QR (si se puede leer) o lo escribe. Se sube la
// foto y factura_foto_registrar busca ESA factura en el banco (mismo proveedor + mismo numero, o el CUFE del QR) y la
// amarra al pedido. Si aun no esta en el banco, queda esperando y la base la amarra sola cuando llegue (trigger).
// Logica pura en js/factura-foto.js. El QR se lee con el lector del navegador (BarcodeDetector) o con jsQR (sin IA).
const FF = { pedido: null, foto: null, fotoUrl: null, cufe: null, guardando: false, porPedido: {} };

function ffModal() {
  let m = document.getElementById('modalFF');
  if (m) return m;
  m = document.createElement('div');
  m.id = 'modalFF'; m.className = 'modal';
  m.innerHTML = `<div class="card" style="max-width:560px">
    <h1 id="ffTitulo">📸 Foto de la factura</h1>
    <div class="mut" style="margin-bottom:8px">Toma la foto de la factura donde se vean el número y el código QR. El sistema busca esa factura en el banco y la amarra a este pedido. Si todavía no está en el banco, se amarra sola cuando llegue.</div>
    <label style="font-weight:700">1. Foto de la factura <span style="color:#b91c1c">*</span></label>
    <div class="row" style="gap:8px;margin:4px 0">
      <button type="button" class="s" onclick="$('ffFotoCam').click()">📷 Tomar foto</button>
      <button type="button" onclick="$('ffFoto').click()">📎 Subir foto</button></div>
    <input type="file" id="ffFotoCam" accept="image/*" capture="environment" style="display:none" onchange="ffElegirFoto(this)">
    <input type="file" id="ffFoto" accept="image/*" style="display:none" onchange="ffElegirFoto(this)">
    <div id="ffFotoVista" style="margin:6px 0"></div>
    <div id="ffQR" class="mut" style="margin:4px 0"></div>
    <div class="row" style="gap:12px;align-items:flex-end;flex-wrap:wrap">
      <div><label style="font-weight:700">2. N° de la factura <span style="color:#b91c1c">*</span></label><input id="ffNumero" placeholder="Ej. FE38865" style="width:160px;margin:4px 0" autocomplete="off"></div>
      <div><label style="font-weight:700">3. Fecha Recibido <span style="color:#b91c1c">*</span></label><input type="date" id="ffFecha" style="width:auto;margin:4px 0"></div>
    </div>
    <div><label style="font-weight:700">4. Recibido por <span style="color:#b91c1c">*</span></label><input id="ffRecibe" placeholder="Nombre de quien recibe" style="margin:4px 0" autocomplete="off"></div>
    <div id="ffCentroBox" style="display:none;margin:4px 0"><label style="font-weight:700">Centro de costo <span style="color:#b91c1c">*</span></label><div id="ffCentroSel"></div></div>
    <div class="err" id="ffErr"></div>
    <div class="row" style="margin-top:8px"><span class="sp"></span>
      <button onclick="ffCerrar()">Cancelar</button>
      <button class="p" id="ffGuardar" onclick="ffGuardar()">Guardar y buscar factura</button></div>
  </div>`;
  document.body.appendChild(m);
  return m;
}

async function abrirFotoFactura(pedidoId) {
  const p = (typeof pedidos !== 'undefined' ? pedidos : []).find((x) => x.id === pedidoId);
  if (!p) return;
  if (p.factura_cufe) { alert('Este pedido ya tiene una factura amarrada.'); return; }
  const m = ffModal();
  FF.pedido = p; FF.foto = null; FF.cufe = null; FF.guardando = false;
  if (FF.fotoUrl) { try { URL.revokeObjectURL(FF.fotoUrl); } catch (e) {} FF.fotoUrl = null; }
  $('ffTitulo').textContent = '📸 Foto de la factura — pedido ' + (p.numero || '') + ' · ' + (p.proveedor_texto || p.proveedor || '');
  $('ffFoto').value = ''; $('ffFotoCam').value = ''; $('ffFotoVista').innerHTML = ''; $('ffQR').innerHTML = ''; $('ffNumero').value = ''; $('ffErr').textContent = '';
  $('ffRecibe').value = (typeof perfil !== 'undefined' && perfil && perfil.nombre) || '';
  const hoy = FechaRecibido.hoyCO();
  $('ffFecha').value = hoy; $('ffFecha').max = hoy; if (p.fecha) $('ffFecha').min = String(p.fecha).slice(0, 10);
  let htmlCC = '';
  try { if (typeof cargarCentrosCosto === 'function') await cargarCentrosCosto(); htmlCC = CentroCosto.selectHtml(centrosCosto, p.marca_id, 'ffCentro', ''); } catch (e) { htmlCC = ''; }
  $('ffCentroSel').innerHTML = htmlCC; $('ffCentroBox').style.display = htmlCC ? '' : 'none';
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
  $('ffQR').textContent = 'Buscando el código QR...';
  let texto = null;
  try { texto = await ffLeerQR(f); } catch (e) { texto = null; }
  const qr = FacturaFoto.leerQR(texto);
  if (qr && (qr.numero || qr.cufe)) {
    FF.cufe = qr.cufe || null;
    if (qr.numero) $('ffNumero').value = qr.numero;
    $('ffQR').innerHTML = '<span style="color:#166534;font-weight:700">✅ Leí el código QR' + (qr.numero ? ': factura ' + escAg(qr.numero) : '') + '</span>' +
      (qr.numero ? '' : ' <span class="mut">(escribe el número)</span>');
  } else {
    $('ffQR').innerHTML = '<span style="color:#92400e">No pude leer el código QR: escribe el número de la factura como sale en el papel.</span>';
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
  const errores = [];
  if (!FF.foto) errores.push('Toma la foto de la factura.');
  const num = FacturaFoto.numeroLimpio($('ffNumero').value);
  if (!num || !/\d/.test(num)) errores.push('Escribe el número de la factura (como sale en el papel).');
  const vf = FechaRecibido.validar($('ffFecha').value, p.fecha, FechaRecibido.hoyCO()); if (!vf.ok) errores.push(vf.error);
  const recibe = ($('ffRecibe').value || '').trim(); if (recibe.length < 3) errores.push('Escribe el nombre de quien recibe la factura.');
  let cc = null;
  if ($('ffCentro')) { const vc = CentroCosto.validar(centrosCosto, p.marca_id, $('ffCentro').value); if (!vc.ok) errores.push(vc.error); else cc = vc.serie; }
  if (errores.length) { err.innerHTML = errores.map(escAg).join('<br>'); return; }
  FF.guardando = true; $('ffGuardar').disabled = true; $('ffGuardar').textContent = 'Buscando...';
  const ruta = FacturaFoto.rutaFoto(p, Date.now(), 'jpg');
  try {
    const up = await SB.storage.from('facturas').upload(ruta, FF.foto, { contentType: 'image/jpeg', upsert: false });
    if (up.error) throw new Error('No pude subir la foto: ' + up.error.message);
    const r = await SB.rpc('factura_foto_registrar', { p_pedido_id: p.id, p_numero: num, p_foto: ruta, p_fecha_recibido: vf.fecha,
      p_cufe_qr: FF.cufe, p_centro_costo: cc, p_recibido_por: recibe });
    if (r.error) { try { await SB.storage.from('facturas').remove([ruta]); } catch (e) {} throw new Error(r.error.message); }
    const d = r.data || {};
    ffCerrar();
    if (d.estado === 'AMARRADA') alert('✅ Encontré la factura ' + (d.documento || num) + ' en el banco y quedó amarrada al pedido ' + (p.numero || '') + '.\nEl agente la ingresa al ERP en la próxima orden de ingresos.');
    else if (d.estado === 'ESPERANDO') alert('📸 Foto guardada. La factura ' + num + ' todavía no está en el banco: apenas llegue se amarra sola a este pedido.');
    else alert('⚠️ Foto guardada, pero no se pudo amarrar sola: ' + (d.motivo || 'revisar') + '.');
    try { if (typeof cargar === 'function') await cargar(); } catch (e) {}
    try { if (typeof cargarPedidos === 'function') { pedidosCargados = false; await cargarPedidos(); } } catch (e) {}
  } catch (e) {
    err.textContent = e.message;
  } finally {
    FF.guardando = false; const b = $('ffGuardar'); if (b) { b.disabled = false; b.textContent = 'Guardar y buscar factura'; }
  }
}

// fotos que esperan o tienen novedad, por pedido (para la etiqueta en la lista de pedidos)
async function cargarFotosFactura() {
  try {
    const r = await SB.from('factura_foto').select('pedido_id,numero,estado,motivo').in('estado', ['ESPERANDO', 'NOVEDAD']).limit(1000);
    FF.porPedido = {};
    (r.data || []).forEach((x) => { FF.porPedido[x.pedido_id] = x; });
  } catch (e) { FF.porPedido = {}; }
}
function fotoFacturaBadge(p) {
  const x = p && !p.factura_cufe && FF.porPedido[p.id];
  if (!x) return '';
  const nov = x.estado === 'NOVEDAD';
  return '<span class="badge" style="' + (nov ? 'background:#fef3c7;color:#92400e' : 'background:#e0f2fe;color:#075985') + '" title="' + escAg(FacturaFoto.aviso(x)) + '">' +
    (nov ? '⚠️ Foto ' : '📸 Esperando ') + escAg(x.numero) + '</span>';
}
