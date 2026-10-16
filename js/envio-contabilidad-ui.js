// ============================================================
//  envio-contabilidad-ui.js  -  Facturas > «📤 Por enviar a contabilidad» y «📦 Enviadas a contabilidad» (16/10/2026)
// ============================================================
// «Por enviar»: TODO lo que tiene el proceso terminado y aun no salio en un envio, sea de la fecha que sea. Un boton baja el
// ZIP de PDFs y el Excel de contabilidad de esos documentos y, si se confirma que se enviaron, los marca en un LOTE: nunca
// vuelven a salir (no hay envios repetidos ni pagos dobles). «Enviadas»: los lotes, para volver a bajar uno; un admin puede
// deshacer un lote marcado por error. Logica pura en js/envio-contabilidad.js; tablas en supabase/envio_contabilidad.sql.
var CONT_ENV = new Map(), CONT_LOTES = [], CONT_OK = false;

// documentos de la sede elegida; un analista con sedes asignadas, solo los de sus sedes (16/10/2026: el ZIP y el Excel salen de aqui)
function contBase() { const l = facturas.filter((f) => sedeOk(f.sede_id)); return typeof listaParaBajar === 'function' ? listaParaBajar(l) : l; }

function contEnvioPuede() { return typeof perfil !== 'undefined' && perfil && (perfil.rol === 'admin' || perfil.rol === 'pagos'); }

async function cargarEnvioContabilidad() {
  if (!contEnvioPuede() || typeof EnvioContabilidad === 'undefined') return;
  try {
    const r = await SB.from('contabilidad_envio').select('factura_cufe,lote_id,enviada_en').limit(20000);
    if (r.error) { CONT_OK = false; return; }   // base sin las tablas: no se muestra nada
    CONT_ENV = EnvioContabilidad.indexar(r.data || []);
    const l = await SB.from('contabilidad_lote').select('id,creado_en,creado_por,cantidad,nota,anulado').order('id', { ascending: false }).limit(300);
    CONT_LOTES = (l.data || []);
    CONT_OK = true;
  } catch (e) { CONT_OK = false; }
  ['v-envio', 'v-enviadas'].forEach((id) => { const b = $(id); if (b) b.style.display = CONT_OK ? '' : 'none'; });
  const n = $('nEnvio');
  if (n && CONT_OK) { const p = EnvioContabilidad.pendientes(contBase(), CONT_ENV, BancoUtils.esTerminada); const c = p.lista.length + p.sinPdf.length; n.textContent = c ? '(' + c + ')' : '(0)'; n.style.color = c ? '#b91c1c' : ''; }
}

function envioBadge(f) {
  if (!CONT_OK || !f) return '';
  const e = CONT_ENV.get(f.cufe);
  if (e) return `<span class="badge" style="color:#1e3a8a;background:#eff6ff;border-color:#93c5fd;font-weight:700">${escAg(EnvioContabilidad.etiqueta(e))}</span>`;
  if (vista === 'envio' && BancoUtils.esTerminada(f)) {
    const d = EnvioContabilidad.diasSinEnviar(f, BancoUtils.hoyColombia());
    return `<span class="badge" style="${d >= 2 ? 'color:#991b1b;background:#fee2e2;border-color:#fca5a5' : 'color:#92400e;background:#fffbeb;border-color:#fcd34d'};font-weight:700">⏰ Por enviar${d ? ' · ' + d + ' día(s) desde el ingreso' : ' · ingresada hoy'}${(f.archivo_pdf || f.archivo_pdf_sellado) ? '' : ' · SIN PDF'}</span>`;
  }
  return '';
}

function pintarPanelEnvio(v) {
  const caja = $('panelEnvio'); if (!caja) return;
  if (!v || !CONT_OK) { caja.innerHTML = ''; return; }
  const todas = contBase();
  if (v === 'envio') {
    const p = EnvioContabilidad.pendientes(todas, CONT_ENV, BancoUtils.esTerminada);
    const viejos = p.lista.filter((f) => EnvioContabilidad.diasSinEnviar(f, BancoUtils.hoyColombia()) >= 2).length;
    caja.innerHTML = `<div class="card" style="border-left:5px solid #1e3a8a;margin-bottom:12px">
      <div class="row" style="gap:10px;align-items:center">
        <div style="flex:1 1 300px"><div style="font-weight:700;color:#1e3a8a">📤 ${p.lista.length} documento(s) por enviar a contabilidad</div>
          <div class="mut">Todo lo que tiene el proceso terminado (ingresado al ERP y sellado, o nota crédito ingresada) y aún no se ha enviado, sea de la fecha que sea.${viejos ? ` <b style="color:#b91c1c">${viejos} llevan 2 días o más sin enviar.</b>` : ''}${p.sinPdf.length ? ` <b style="color:#b45309">${p.sinPdf.length} sin PDF en la web (no entran al ZIP).</b>` : ''}</div></div>
        ${p.lista.length ? `<button class="p" id="btnEnviarCont" onclick="enviarAContabilidad()">📤 Bajar ZIP + Excel y marcar como enviados (${p.lista.length})</button>` : '<span class="badge st-sellada">✅ Nada pendiente</span>'}
      </div><div class="mut" id="envioRes" style="margin-top:6px"></div></div>`;
    return;
  }
  const grupos = EnvioContabilidad.porLote(todas, CONT_ENV);
  const info = new Map(CONT_LOTES.map((l) => [Number(l.id), l]));
  const esAdmin = perfil && perfil.rol === 'admin';
  caja.innerHTML = `<div class="card" style="border-left:5px solid #15803d;margin-bottom:12px">
    <div style="font-weight:700;color:#166534">📦 Envíos a contabilidad (${grupos.length} lote(s))</div>
    ${grupos.length ? grupos.slice(0, 40).map((g) => { const l = info.get(g.lote) || {}; const fe = l.creado_en ? new Date(l.creado_en).toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''; return `<div class="row" style="gap:8px;padding:6px 0;border-bottom:1px solid var(--line)">
      <b>Lote ${g.lote}</b><span class="mut">${escAg(fe)}${l.creado_por ? ' · ' + escAg(l.creado_por) : ''} · ${g.docs.length} documento(s)${l.nota ? ' · ' + escAg(l.nota) : ''}</span><span class="sp"></span>
      <button onclick="rebajarLote(${g.lote})">⬇ Volver a bajar</button>
      ${esAdmin ? `<button class="d" title="Se marcó por error: los documentos vuelven a «Por enviar»" onclick="deshacerLote(${g.lote})">↩ Deshacer</button>` : ''}</div>`; }).join('') : '<div class="mut">Todavía no hay envíos.</div>'}
    <div class="mut" id="envioRes" style="margin-top:6px"></div></div>`;
}

async function enviarAContabilidad() {
  const p = EnvioContabilidad.pendientes(contBase(), CONT_ENV, BancoUtils.esTerminada);
  const lista = p.lista; if (!lista.length) return;
  const res = $('envioRes') || $('resdesc'), b = $('btnEnviarCont'); if (b) b.disabled = true;
  try {
    const hoy = BancoUtils.hoyColombia();
    const r = await bajarPdfsEnZip(lista, BancoUtils.nombreArchivoCiclo, 'envio_contabilidad_' + hoy + '.zip', res);
    const fall = new Set(r.fallCufes || []);
    const enZip = lista.filter((f) => !fall.has(f.cufe));   // solo lo que de verdad quedo en el ZIP
    if (!enZip.length) { res.textContent = 'No pude bajar ningún PDF: no se marca nada como enviado.'; return; }
    await descargarContabilidad(enZip, 'envio_contabilidad_' + hoy + '.xlsx');
    const msg = '📤 Se bajaron el ZIP (' + enZip.length + ' PDF) y el Excel de contabilidad.' + (fall.size ? '\n\n⚠️ ' + fall.size + ' PDF no se pudieron bajar: esos NO se marcan y siguen pendientes.' : '') +
      '\n\n¿Ya los enviaste a contabilidad?\n\nAceptar = marcarlos como ENVIADOS (no vuelven a salir).\nCancelar = siguen pendientes.';
    if (!confirm(msg)) { res.textContent = 'Descargado, pero NO marcado: siguen pendientes.'; return; }
    const rr = await SB.rpc('contabilidad_marcar', { p_cufes: enZip.map((f) => f.cufe), p_nota: null, p_usuario: (perfil && perfil.nombre) || (usuario && usuario.email) || null });
    if (rr.error) { res.textContent = 'No se pudieron marcar: ' + rr.error.message; return; }
    const d = rr.data || {};
    await cargarEnvioContabilidad(); pintar();
    alert('✅ Lote ' + d.lote + ': ' + d.marcadas + ' documento(s) marcados como enviados a contabilidad.' + (d.ya_estaban ? ' (' + d.ya_estaban + ' ya estaban enviados)' : ''));
  } finally { const bb = $('btnEnviarCont'); if (bb) bb.disabled = false; }
}

async function rebajarLote(lote) {
  const docs = facturas.filter((f) => { const e = CONT_ENV.get(f.cufe); return e && e.lote === lote; });
  if (!docs.length) return;
  const res = $('envioRes') || $('resdesc');
  const r = await bajarPdfsEnZip(docs, BancoUtils.nombreArchivoCiclo, 'envio_contabilidad_lote_' + lote + '.zip', res);
  await descargarContabilidad(docs, 'envio_contabilidad_lote_' + lote + '.xlsx');
  res.textContent = msgZip(r, ' Lote ' + lote + ' (solo para volver a mirarlo: no cambia nada).');
}

async function deshacerLote(lote) {
  if (!confirm('¿Deshacer el lote ' + lote + '?\n\nSus documentos vuelven a «Por enviar a contabilidad». Úsalo solo si se marcó por error y NO se envió.')) return;
  const r = await SB.rpc('contabilidad_anular_lote', { p_lote: lote, p_usuario: (perfil && perfil.nombre) || null });
  if (r.error) { alert('No se pudo: ' + r.error.message); return; }
  await cargarEnvioContabilidad(); pintar();
  alert('Lote ' + lote + ' deshecho: ' + r.data + ' documento(s) vuelven a «Por enviar».');
}
