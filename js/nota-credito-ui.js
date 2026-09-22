// ============================================================
//  nota-credito-ui.js  -  AMARRAR NOTAS CREDITO A SUS FACTURAS  (21/09/2026)   (lista de Facturas / Notas crédito)
//  El boton "Amarrar a factura" de cada nota abre una ventana con las facturas del MISMO proveedor (mas reciente primero) para marcar una o varias.
//  En la tarjeta de la nota se ve a que factura(s) va; en la de la factura, sus notas. Solo admin y pagos amarran (funcion nota_credito_amarrar).
//  Logica de decision: js/nota-credito.js. Usa las globales de index.html: $, SB, facturas, perfil, usuario, money, fch, escAg, pintar.
// ============================================================
let ncLinks = [], ncIdx = { porNota: {}, porFactura: {} }, ncNota = null, ncSel = new Set();

const ncPuede = () => !!(perfil && (perfil.rol === 'admin' || perfil.rol === 'pagos'));

// Se carga junto con las facturas. Si falla (o la tabla aun no existe), la pantalla sigue como antes sin amarres.
async function cargarNotaLinks() {
  try {
    const { data, error } = await SB.from('nota_credito_factura').select('nota_cufe,factura_cufe,creado_por,creado_en').order('creado_en', { ascending: false });
    if (error) throw new Error(error.message);
    ncLinks = data || [];
  } catch (e) { ncLinks = ncLinks || []; }
  ncIdx = NotaCredito.indexar(ncLinks);
}

// Lo que se ve en la tarjeta: en una nota, sus facturas (o el aviso de que no tiene); en una factura, sus notas.
function chipsNotaCredito(f) {
  if (NotaCredito.esNota(f)) {
    const fs = NotaCredito.facturasDeNota(f, facturas, ncIdx);
    if (fs.length) return fs.map((x) => `<span class="badge st-asignada" title="Esta nota credito corrige la factura ${escAg(NotaCredito.numero(x))} (${escAg(money(x.total))})">↩ Factura ${escAg(NotaCredito.numero(x) || '—')}</span>`).join('');
    return ncPuede() ? '<span class="badge st-pool" title="Amárrala a la factura que corrige, para la trazabilidad">⚠️ sin factura amarrada</span>' : '';
  }
  if (NotaCredito.esFactura(f)) {
    const ns = NotaCredito.notasDeFactura(f, facturas, ncIdx); if (!ns.length) return '';
    const neto = NotaCredito.netoFactura(f, ns);
    return ns.map((n) => `<span class="badge st-asignada" title="Nota credito ${escAg(NotaCredito.numero(n))} por ${escAg(money(n.total))}. Queda ${escAg(money(neto))} de la factura.">📎 NC ${escAg(NotaCredito.numero(n) || '—')} −${escAg(money(n.total))}</span>`).join('');
  }
  return '';
}
const botonNotaCredito = (f) => (NotaCredito.esNota(f) && ncPuede()) ? `<button class="s" onclick="abrirNC('${f.cufe}')">🔗 Amarrar a factura</button>` : '';

async function abrirNC(cufe) {
  const n = facturas.find((x) => x.cufe === cufe); if (!n || !NotaCredito.esNota(n)) return;
  if (!ncPuede()) { alert('Solo admin o pagos pueden amarrar notas crédito.'); return; }
  ncNota = n; ncSel = new Set(); $('ncErr').textContent = ''; $('ncBuscar').value = '';
  $('ncTitulo').textContent = '🔗 Nota crédito ' + (NotaCredito.numero(n) || '') + ' — ¿de qué factura(s) es?';
  pintarNC(); $('modalNC').classList.add('on'); setTimeout(() => { try { $('ncBuscar').focus(); } catch (e) { /* sin foco */ } }, 120);
}
function cerrarNC() { $('modalNC').classList.remove('on'); ncNota = null; }

function pintarNC() {
  const n = ncNota; if (!n) return;
  const q = ($('ncBuscar').value || '').trim().toLowerCase();
  const ya = NotaCredito.facturasDeNota(n, facturas, ncIdx);
  let h = `<div class="mut" style="margin:2px 0 8px"><b>${escAg(n.emisor || '—')}</b> · NIT ${escAg(n.nit_emisor || '—')} · ${escAg(fch(n.fecha_emision))} · <b>${escAg(money(n.total))}</b></div>`;
  if (ya.length) {
    h += '<div class="mut" style="font-weight:700;margin-top:6px">Ya amarrada a:</div>' + ya.map((f) => `<div class="card" style="margin:4px 0;padding:8px 12px"><div class="row">
      <div><b>${escAg(NotaCredito.numero(f) || '—')}</b> <span class="mut">· ${escAg(fch(f.fecha_emision))} · ${escAg(money(f.total))}</span></div><span class="sp"></span>
      <button class="d" onclick="quitarNC('${f.cufe}')">Quitar</button></div></div>`).join('');
  }
  let l = NotaCredito.candidatas(n, facturas, ncIdx).filter((x) => !x.ya);
  if (q) l = l.filter((x) => (NotaCredito.numero(x.f) + ' ' + (x.f.emisor || '') + ' ' + (x.f.fecha_emision || '') + ' ' + (x.f.total || '')).toLowerCase().includes(q));
  h += `<div class="mut" style="font-weight:700;margin-top:10px">Facturas de este proveedor (${l.length}) · la más reciente primero</div>`;
  h += l.length ? l.slice(0, 200).map((x) => { const f = x.f, on = ncSel.has(f.cufe);
    return `<div class="card" style="margin:4px 0;padding:8px 12px;cursor:pointer;${on ? 'border-color:#0f766e;background:#f0fdfa' : ''}" onclick="ncMarcar('${f.cufe}')"><div class="row">
      <input type="checkbox" ${on ? 'checked' : ''} style="width:auto;margin:0 8px 0 0" onclick="event.stopPropagation();ncMarcar('${f.cufe}')">
      <div><b>${escAg(NotaCredito.numero(f) || '—')}</b> <span class="mut">· ${escAg(fch(f.fecha_emision))}</span></div><span class="sp"></span>
      ${x.cubre ? '' : '<span class="badge" title="El total de la nota es mayor que el de esta factura: puede ir junto con otra">nota mayor</span>'}
      ${f.num_ingreso ? `<span class="badge st-sellada">Ingreso ${escAg(f.num_ingreso)}</span>` : ''}
      <b>${escAg(money(f.total))}</b></div></div>`; }).join('')
    : `<div class="vacio">${q ? 'No encontré nada con "' + escAg(q) + '"' : 'Este proveedor no tiene más facturas cargadas en el banco.'}</div>`;
  $('ncLista').innerHTML = h;
  $('ncGuardar').disabled = !ncSel.size;
  $('ncGuardar').textContent = ncSel.size ? `Amarrar a ${ncSel.size} factura${ncSel.size === 1 ? '' : 's'}` : 'Elige la(s) factura(s)';
}
function ncMarcar(cufe) { if (ncSel.has(cufe)) ncSel.delete(cufe); else ncSel.add(cufe); pintarNC(); }

async function guardarNC() {
  if (!ncNota || !ncSel.size) return;
  const btn = $('ncGuardar'); btn.disabled = true;
  const { error } = await SB.rpc('nota_credito_amarrar', { p_nota: ncNota.cufe, p_facturas: [...ncSel], p_usuario: (perfil && perfil.nombre) || (usuario && usuario.email) || 'admin' });
  if (error) { btn.disabled = false; $('ncErr').textContent = 'No se pudo amarrar: ' + error.message; return; }
  await cargarNotaLinks(); ncSel = new Set(); $('ncErr').textContent = ''; cerrarNC(); pintar();
}
async function quitarNC(facCufe) {
  if (!ncNota) return;
  const f = facturas.find((x) => x.cufe === facCufe) || {};
  if (!confirm('¿Quitar el amarre de la nota ' + (NotaCredito.numero(ncNota) || '') + ' con la factura ' + (NotaCredito.numero(f) || '') + '?\n\nNo se borra ninguno de los dos documentos.')) return;
  const { error } = await SB.rpc('nota_credito_desamarrar', { p_nota: ncNota.cufe, p_factura: facCufe });
  if (error) { $('ncErr').textContent = 'No se pudo quitar: ' + error.message; return; }
  await cargarNotaLinks(); pintarNC(); pintar();
}
