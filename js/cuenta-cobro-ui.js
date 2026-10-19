// ============================================================
//  cuenta-cobro-ui.js  -  ventana "📷 Cuenta de cobro" del pedido (13/10/2026)
// ============================================================
// Foto (camara del celular) + N° + Fecha Recibido + centro de costo (si la marca lo usa) + cantidad y TOTAL de cada
// articulo del pedido. Valida con CuentaCobro.validar, sube la foto (comprimida) y llama a cuenta_cobro_amarrar
// (crea la cuenta y la amarra al pedido, todo o nada). Despues el agente la ingresa al ERP como cualquier factura.
const CC = { pedido: null, lineas: [], foto: null, fotoUrl: null, guardando: false };

function ccModal() {
  let m = document.getElementById('modalCC');
  if (m) return m;
  m = document.createElement('div');
  m.id = 'modalCC'; m.className = 'modal';
  m.innerHTML = `<div class="card" style="max-width:720px">
    <h1 id="ccTitulo">📷 Cuenta de cobro</h1>
    <div class="mut" style="margin-bottom:8px">Para proveedores sin factura electrónica. Toma la foto del papel y escribe lo que dice: el agente la ingresa al ERP con estos datos.</div>
    <label style="font-weight:700">1. Foto o PDF de la cuenta de cobro <span style="color:#b91c1c">*</span></label>
    <div class="row" style="gap:8px;margin:4px 0">
      <button type="button" class="s" onclick="$('ccFotoCam').click()">📷 Tomar foto</button>
      <button type="button" onclick="$('ccFoto').click()">📎 Subir foto o PDF</button></div>
    <input type="file" id="ccFotoCam" accept="image/*" capture="environment" style="display:none" onchange="ccElegirFoto(this)">
    <input type="file" id="ccFoto" accept="image/*,application/pdf,.pdf" style="display:none" onchange="ccElegirFoto(this)">
    <div id="ccFotoVista" style="margin:6px 0"></div>
    <div class="row" style="gap:12px;align-items:flex-end;flex-wrap:wrap">
      <div><label style="font-weight:700">2. N° de la cuenta <span style="color:#b91c1c">*</span></label><input id="ccNumero" placeholder="Ej. 0457" style="width:140px;margin:4px 0" autocomplete="off"></div>
      <div><label style="font-weight:700">3. Fecha Recibido <span style="color:#b91c1c">*</span></label><input type="date" id="ccFecha" style="width:auto;margin:4px 0"></div>
    </div>
    <div id="ccCentroBox" style="display:none;margin:4px 0"><label style="font-weight:700">Centro de costo <span style="color:#b91c1c">*</span></label><div id="ccCentroSel"></div></div>
    <div style="font-weight:700;margin-top:8px">4. Lo que llegó, según el papel</div>
    <div class="mut" style="font-size:12px">Cantidad y TOTAL de cada artículo (como viene en el papel): el precio unitario y el total de la cuenta se calculan solos. Si un artículo no llegó, deja la cantidad en 0.</div>
    <div id="ccLineas" style="max-height:40vh;overflow:auto;margin-top:6px"></div>
    <div id="ccSuma" style="margin-top:6px;font-weight:700"></div>
    <div class="err" id="ccErr"></div>
    <div class="row" style="margin-top:8px"><span class="sp"></span>
      <button onclick="ccCerrar()">Cancelar</button>
      <button class="p" id="ccGuardar" onclick="ccGuardar()">Guardar y amarrar</button></div>
  </div>`;
  document.body.appendChild(m);
  return m;
}

async function abrirCuentaCobro(pedidoId) {
  const p = (typeof pedidos !== 'undefined' ? pedidos : []).find((x) => x.id === pedidoId);
  if (!p) return;
  if (p.factura_cufe) { alert('Este pedido ya tiene una factura amarrada.'); return; }
  const m = ccModal();
  CC.pedido = p; CC.foto = null; CC.guardando = false;
  if (CC.fotoUrl) { try { URL.revokeObjectURL(CC.fotoUrl); } catch (e) {} CC.fotoUrl = null; }
  $('ccTitulo').textContent = '📷 Cuenta de cobro — pedido ' + (p.numero || '') + ' · ' + (p.proveedor_texto || p.proveedor || '');
  $('ccFoto').value = ''; $('ccFotoCam').value = ''; $('ccFotoVista').innerHTML = ''; $('ccNumero').value = ''; $('ccErr').textContent = '';
  const hoy = FechaRecibido.hoyCO();
  $('ccFecha').value = hoy; $('ccFecha').max = hoy; if (p.fecha) $('ccFecha').min = String(p.fecha).slice(0, 10);
  // centro de costo (solo si la marca lo usa), igual que en "Amarrar"
  let htmlCC = '';
  try { if (typeof cargarCentrosCosto === 'function') await cargarCentrosCosto(); htmlCC = CentroCosto.selectHtml(centrosCosto, p.marca_id, 'ccCentro', ''); } catch (e) { htmlCC = ''; }
  $('ccCentroSel').innerHTML = htmlCC; $('ccCentroBox').style.display = htmlCC ? '' : 'none';
  $('ccLineas').innerHTML = '<div class="mut">Cargando artículos del pedido...</div>';
  m.classList.add('on');
  const r = await SB.from('pedido_lineas').select('id,codigo,insumo,cantidad,unidad').eq('pedido_id', p.id).order('id');
  if (r.error) { $('ccLineas').innerHTML = '<div class="err">No pude cargar los artículos: ' + escAg(r.error.message) + '</div>'; CC.lineas = []; return; }
  CC.lineas = (r.data || []).map((l) => ({ codigo: l.codigo, articulo: l.insumo, unidad: l.unidad, cantidad: l.cantidad == null ? '' : String(l.cantidad), total: '' }));
  ccPintarLineas();
}

function ccPintarLineas() {
  if (!CC.lineas.length) { $('ccLineas').innerHTML = '<div class="err">El pedido no tiene artículos.</div>'; ccSuma(); return; }
  // el precio unitario (total / cantidad) va debajo del total (cabe en el celular)
  $('ccLineas').innerHTML = `<table style="font-size:13px"><thead><tr><th style="padding:4px">Artículo</th><th style="padding:4px">Cant.</th><th style="padding:4px">Total artículo</th></tr></thead><tbody>${
    CC.lineas.map((l, i) => `<tr><td style="padding:4px">${escAg(l.articulo)}${l.unidad ? ' <span class="mut">(' + escAg(l.unidad) + ')</span>' : ''}</td>
      <td style="padding:4px"><input inputmode="decimal" value="${escAg(l.cantidad)}" style="width:58px;margin:0;padding:6px" oninput="CC.lineas[${i}].cantidad=this.value;ccSuma()"></td>
      <td style="padding:4px"><input inputmode="numeric" value="${escAg(l.total)}" placeholder="$" style="width:92px;margin:0;padding:6px" oninput="CC.lineas[${i}].total=this.value;ccSuma()">
        <div class="mut" style="font-size:11px" id="ccSub${i}"></div></td></tr>`).join('')}</tbody></table>`;
  ccSuma();
}

// en vivo: precio unitario de cada articulo (total / cantidad) y el total de la cuenta (suma de los articulos)
function ccSuma() {
  CC.lineas.forEach((l, i) => {
    const c = CuentaCobro.cantidad(l.cantidad), t = CuentaCobro.num(l.total), el = $('ccSub' + i);
    if (el) el.textContent = c && t != null && t >= 0 ? 'unit. ' + money(CuentaCobro.unitario(t, c)) + (Math.round(t / c) !== CuentaCobro.unitario(t, c) ? ' (' + CuentaCobro.unitario(t, c).toLocaleString('es-CO') + ')' : '') : '';
  });
  const v = CuentaCobro.validar({ foto: true, numero: 'x', lineas: CC.lineas });
  const s = $('ccSuma'); if (!s) return;
  if (!v.lineas.length) { s.textContent = ''; return; }
  s.innerHTML = '<div style="background:#f0fdf4;border:1px solid #86efac;color:#166534;border-radius:8px;padding:8px 12px;font-size:16px">Total de la cuenta: ' + money(v.total) +
    (v.lineas.length > 1 ? ' <span style="font-weight:400;font-size:13px">(suma de ' + v.lineas.length + ' artículos)</span>' : '') + '</div>';
}

// foto: se reduce (lado mayor 1600 px, JPG) para que suba rapido desde el celular.
// (14/10/2026) tambien PDF: va tal cual (hasta 10 MB)
async function ccElegirFoto(input) {
  const f = input.files && input.files[0];
  CC.foto = null; CC.ext = 'jpg'; $('ccFotoVista').innerHTML = '';
  if (!f) return;
  const esPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');
  if (!esPdf && !/^image\//.test(f.type)) { $('ccErr').textContent = 'El archivo no es una foto ni un PDF.'; return; }
  if (CC.fotoUrl) { try { URL.revokeObjectURL(CC.fotoUrl); } catch (e) {} CC.fotoUrl = null; }
  if (esPdf) {
    if (f.size > 10 * 1024 * 1024) { $('ccErr').textContent = 'El PDF pesa más de 10 MB: súbelo más liviano o toma una foto.'; return; }
    CC.foto = f; CC.ext = 'pdf';
    $('ccFotoVista').innerHTML = `<span class="badge" style="font-size:13px">📄 ${escAg(f.name || 'cuenta de cobro.pdf')} · ${Math.max(1, Math.round(f.size / 1024))} KB</span>`;
    $('ccErr').textContent = ''; return;
  }
  // (19/10/2026) ESCANEAR la foto (4 esquinas -> hoja derecha y en blanco y negro): js/escaner-ui.js
  let escaneada = null;
  if (typeof escanearFoto === 'function') {
    const r = await escanearFoto(f);
    if (r === null) { input.value = ''; return; }   // cancelo
    if (r && r.blob) escaneada = r.blob;
  }
  try { CC.foto = escaneada || await ccComprimir(f); } catch (e) { CC.foto = f; }
  CC.fotoUrl = URL.createObjectURL(CC.foto);
  $('ccFotoVista').innerHTML = `<img src="${CC.fotoUrl}" alt="Foto de la cuenta de cobro" style="max-width:100%;max-height:220px;border:1px solid var(--line);border-radius:8px">`;
  $('ccErr').textContent = '';
}
function ccComprimir(file) {
  return new Promise((ok, mal) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const lado = 1600, k = Math.min(1, lado / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? ok(b) : mal(new Error('sin imagen'))), 'image/jpeg', 0.82);
    };
    img.onerror = () => { URL.revokeObjectURL(url); mal(new Error('no pude abrir la foto')); };
    img.src = url;
  });
}

// (13/10/2026) en Facturas > "Cuentas de cobro": lo que la sede digito (articulo, cantidad, precio unitario y total), debajo de la tarjeta
async function verLineasCuentaCobro(cufe, boton) {
  const card = boton && boton.closest('.card'); if (!card) return;
  const ya = card.querySelector('.cc-lineas'); if (ya) { ya.remove(); return; }
  const caja = document.createElement('div'); caja.className = 'cc-lineas'; caja.style.cssText = 'margin-top:10px;overflow:auto';
  caja.innerHTML = '<div class="mut">Cargando artículos...</div>'; card.appendChild(caja);
  const r = await SB.from('cuenta_cobro_linea').select('orden,codigo,articulo,cantidad,precio_unitario,subtotal').eq('factura_cufe', cufe).order('orden');
  if (r.error) { caja.innerHTML = '<div class="err">No pude cargar los artículos: ' + escAg(r.error.message) + '</div>'; return; }
  const l = r.data || [];
  if (!l.length) { caja.innerHTML = '<div class="mut">Esta cuenta de cobro no tiene artículos guardados.</div>'; return; }
  const n = (x) => Number(x || 0).toLocaleString('es-CO', { maximumFractionDigits: 2 });
  caja.innerHTML = `<table style="font-size:13px"><thead><tr><th>Código</th><th>Artículo</th><th style="text-align:right">Cant.</th><th style="text-align:right">Precio unit.</th><th style="text-align:right">Total</th></tr></thead><tbody>${
    l.map((x) => `<tr><td>${escAg(x.codigo || '—')}</td><td>${escAg(x.articulo)}</td><td style="text-align:right">${n(x.cantidad)}</td><td style="text-align:right">$ ${n(x.precio_unitario)}</td><td style="text-align:right">${money(Number(x.subtotal))}</td></tr>`).join('')
  }</tbody><tfoot><tr><td colspan="4" style="text-align:right;font-weight:700">Total</td><td style="text-align:right;font-weight:700">${money(l.reduce((s, x) => s + Number(x.subtotal || 0), 0))}</td></tr></tfoot></table>`;
}

function ccCerrar() { const m = $('modalCC'); if (m) m.classList.remove('on'); }

async function ccGuardar() {
  if (CC.guardando || !CC.pedido) return;
  const p = CC.pedido, err = $('ccErr'); err.textContent = '';
  const v = CuentaCobro.validar({ foto: !!CC.foto, numero: $('ccNumero').value, lineas: CC.lineas });
  const vf = FechaRecibido.validar($('ccFecha').value, p.fecha, FechaRecibido.hoyCO());
  const errores = v.errores.slice(); if (!vf.ok) errores.push(vf.error);
  let cc = null;
  if ($('ccCentro')) { const vc = CentroCosto.validar(centrosCosto, p.marca_id, $('ccCentro').value); if (!vc.ok) errores.push(vc.error); else cc = vc.serie; }
  if (errores.length) { err.innerHTML = errores.map(escAg).join('<br>'); return; }
  CC.guardando = true; $('ccGuardar').disabled = true; $('ccGuardar').textContent = 'Guardando...';
  const ruta = CuentaCobro.rutaFoto(p, Date.now(), CC.ext);
  try {
    const up = await SB.storage.from('facturas').upload(ruta, CC.foto, { contentType: CC.ext === 'pdf' ? 'application/pdf' : 'image/jpeg', upsert: false });
    if (up.error) throw new Error('No pude subir la foto: ' + up.error.message);
    const r = await SB.rpc('cuenta_cobro_amarrar', { p_pedido_id: p.id, p_numero: $('ccNumero').value, p_fecha_recibido: vf.fecha, p_total: v.total,
      p_foto: ruta, p_lineas: v.lineas, p_centro_costo: cc, p_usuario: (perfil && perfil.nombre) || (usuario && usuario.email) || null });
    if (r.error) { try { await SB.storage.from('facturas').remove([ruta]); } catch (e) {} throw new Error(r.error.message); }
    ccCerrar();
    alert('✅ Cuenta de cobro ' + CuentaCobro.numeroLimpio($('ccNumero').value) + ' guardada y amarrada al pedido ' + (p.numero || '') + '.\nEl agente la ingresa al ERP en la próxima orden de ingresos.');
    try { if (typeof cargar === 'function') await cargar(); } catch (e) {}
    try { if (typeof cargarPedidos === 'function') await cargarPedidos(); } catch (e) {}
  } catch (e) {
    err.textContent = e.message;
  } finally {
    CC.guardando = false; const b = $('ccGuardar'); if (b) { b.disabled = false; b.textContent = 'Guardar y amarrar'; }
  }
}
