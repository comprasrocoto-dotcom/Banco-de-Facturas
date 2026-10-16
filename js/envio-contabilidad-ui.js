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
    if (CONT_PREP === null) contPrepLeer();
    if (CONT_PREP) { caja.innerHTML = contPrepHtml(p); return; }   // nunca se cierra solo: solo al confirmar o descartar
    const viejos = p.lista.filter((f) => EnvioContabilidad.diasSinEnviar(f, BancoUtils.hoyColombia()) >= 2).length;
    caja.innerHTML = `<div class="card" style="border-left:5px solid #1e3a8a;margin-bottom:12px">
      <div class="row" style="gap:10px;align-items:center">
        <div style="flex:1 1 300px"><div style="font-weight:700;color:#1e3a8a">📤 ${p.lista.length} documento(s) por enviar a contabilidad</div>
          <div class="mut">Todo lo que tiene el proceso terminado (ingresado al ERP y sellado, o nota crédito ingresada) y aún no se ha enviado, sea de la fecha que sea.${viejos ? ` <b style="color:#b91c1c">${viejos} llevan 2 días o más sin enviar.</b>` : ''}${p.sinPdf.length ? ` <b style="color:#b45309">${p.sinPdf.length} sin PDF en la web (no entran al ZIP).</b>` : ''}</div></div>
        ${p.lista.length ? `<button class="p" id="btnEnviarCont" onclick="contPrepIniciar()" title="Saca la lista FIJA de lo que se va a enviar; cada documento con su casilla">📋 Preparar envío (${p.lista.length})</button>` : '<span class="badge st-sellada">✅ Nada pendiente</span>'}
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

// ---------------------------------------------------------------- ENVIO PREPARADO (16/10/2026, pedido del usuario)
// Antes: un solo boton bajaba todo y un confirm() marcaba; si se cancelaba, al volver salian mas documentos (el agente seguia
// terminando) y no se podia sacar uno que no debia ir. Ahora: «📋 Preparar envío» CONGELA la lista; cada documento tiene su
// casilla; se baja el ZIP + Excel de los marcados y solo esos se marcan como enviados. La lista se queda abierta (se recuerda
// en este navegador) hasta confirmar o descartar. Logica pura en EnvioContabilidad.preparar / vigentes / puedeConfirmar.
var CONT_PREP = null;
function contPrepClave() { return 'bf_envio_prep_' + ((typeof usuario !== 'undefined' && usuario && usuario.id) || 'x'); }
function contPrepLeer() { try { const s = localStorage.getItem(contPrepClave()); CONT_PREP = s ? JSON.parse(s) : null; } catch (e) { /* sin storage: solo no se recuerda */ } }
function contPrepGuardar() { try { if (CONT_PREP) localStorage.setItem(contPrepClave(), JSON.stringify(CONT_PREP)); else localStorage.removeItem(contPrepClave()); } catch (e) { /* sin storage */ } }
function contPendientes() { return EnvioContabilidad.pendientes(contBase(), CONT_ENV, BancoUtils.esTerminada); }
function contPrepRefrescar() { if (typeof pintarPanelEnvio === 'function') pintarPanelEnvio('envio'); }

function contPrepHtml(p) {
  const v = EnvioContabilidad.vigentes(CONT_PREP, p.lista), sel = EnvioContabilidad.seleccion(CONT_PREP, v.docs);
  const total = sel.reduce((a, f) => a + Number(f.total || 0), 0);
  const ok = EnvioContabilidad.puedeConfirmar(CONT_PREP, sel);
  const nombreSede = (id) => { const s = (typeof sedes !== 'undefined' ? sedes : []).find((x) => x.id === id); return s ? s.nombre : 'Sin sede'; };
  const prep = new Date(CONT_PREP.creado).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  const filas = v.docs.map((f) => `<tr style="border-bottom:1px solid var(--line)${CONT_PREP.marcados[f.cufe] ? '' : ';opacity:.5'}">
      <td style="width:28px"><input type="checkbox" style="width:auto;margin:0" ${CONT_PREP.marcados[f.cufe] ? 'checked' : ''} onchange="contPrepMarcar('${f.cufe}',this.checked)"></td>
      <td><b>${escAg((f.prefijo || '') + (f.folio || '') || f.documento || '')}</b>${f.tipo === 'nota_credito' ? ' <span class="badge">NC</span>' : ''}</td>
      <td>${escAg(f.emisor || '')}</td><td>${escAg(nombreSede(f.sede_id))}</td><td>${escAg(f.num_ingreso || '')}</td>
      <td style="text-align:right">${typeof money === 'function' ? money(f.total) : escAg(f.total)}</td>
      <td><button class="s" style="padding:2px 8px" onclick="verPdf('${f.cufe}')">📄</button></td></tr>`).join('');
  return `<div class="card" style="border-left:5px solid #1e3a8a;margin-bottom:12px">
    <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap">
      <div style="flex:1 1 280px"><div style="font-weight:700;color:#1e3a8a">📋 Envío preparado (${prep}) · ${sel.length} de ${v.docs.length} marcado(s) · ${typeof money === 'function' ? money(total) : total}</div>
        <div class="mut">Esta lista quedó FIJA: lo que el agente termine después no entra. Desmarca lo que NO debe ir: sigue pendiente para otro envío.
          ${v.nuevos.length ? `<b style="color:#b45309">${v.nuevos.length} documento(s) nuevos quedaron para el próximo envío.</b>` : ''}${v.salieron ? ` ${v.salieron} no se ven con este filtro de sede o ya no están pendientes.` : ''}</div></div>
      <button onclick="contPrepTodos(true)">☑ Todos</button><button onclick="contPrepTodos(false)">☐ Ninguno</button>
    </div>
    ${v.docs.length ? `<div style="overflow-x:auto;max-height:420px;overflow-y:auto;margin-top:8px"><table style="width:100%;font-size:13px;border-collapse:collapse">
      <tr class="mut" style="text-align:left"><th></th><th>Documento</th><th>Proveedor</th><th>Sede</th><th>Ingreso ERP</th><th style="text-align:right">Total</th><th></th></tr>${filas}</table></div>`
    : `<div class="mut" style="margin-top:8px">Ninguno de los ${CONT_PREP.cufes.length} documento(s) de este envío está pendiente con el filtro de sede actual: cambia a «Todas las sedes» o descártalo.</div>`}
    <div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap;align-items:center">
      <button class="p" id="btnEnvioBajar" onclick="contPrepBajar()" ${sel.length ? '' : 'disabled'}>⬇ 1. Bajar ZIP + Excel de los marcados (${sel.length})</button>
      <button class="p" id="btnEnvioConfirmar" style="background:#15803d;border-color:#15803d" onclick="contPrepConfirmar()" ${ok.ok ? '' : 'disabled'} title="${escAg(ok.motivo)}">✅ 2. Ya los envié: marcar ${sel.length} como enviados</button>
      <span class="sp"></span><button class="d" onclick="contPrepDescartar()">✖ Descartar este envío</button>
    </div>
    <div class="mut" id="envioRes" style="margin-top:6px">${ok.ok ? '✅ Lo bajado coincide con lo marcado: cuando lo envíes, confirma con el botón verde.' : escAg(ok.motivo)}</div></div>`;
}

function contPrepIniciar() {
  const p = contPendientes(); if (!p.lista.length) return;
  CONT_PREP = EnvioContabilidad.preparar(p.lista); contPrepGuardar(); contPrepRefrescar();
}
// (compatibilidad: el boton viejo llamaba asi)
function enviarAContabilidad() { contPrepIniciar(); }
function contPrepMarcar(cufe, valor) { if (!CONT_PREP) return; CONT_PREP = EnvioContabilidad.marcar(CONT_PREP, cufe, valor); contPrepGuardar(); contPrepRefrescar(); }
function contPrepTodos(valor) { if (!CONT_PREP) return; const v = EnvioContabilidad.vigentes(CONT_PREP, contPendientes().lista); CONT_PREP = EnvioContabilidad.marcarTodos(CONT_PREP, v.docs, valor); contPrepGuardar(); contPrepRefrescar(); }
function contPrepDescartar() { if (!confirm('¿Descartar este envío preparado? No se marca nada: todo sigue pendiente.')) return; CONT_PREP = null; contPrepGuardar(); contPrepRefrescar(); }

async function contPrepBajar() {
  if (!CONT_PREP) return;
  const v = EnvioContabilidad.vigentes(CONT_PREP, contPendientes().lista), sel = EnvioContabilidad.seleccion(CONT_PREP, v.docs);
  if (!sel.length) return;
  const res = $('envioRes') || $('resdesc'), b = $('btnEnvioBajar'); if (b) b.disabled = true;
  try {
    const hoy = BancoUtils.hoyColombia();
    const r = await bajarPdfsEnZip(sel, BancoUtils.nombreArchivoCiclo, 'envio_contabilidad_' + hoy + '.zip', res);
    const fall = new Set(r.fallCufes || []);
    if (fall.size) fall.forEach((c) => { CONT_PREP = EnvioContabilidad.marcar(CONT_PREP, c, false); });   // sin PDF: se desmarca (sigue pendiente)
    const enZip = sel.filter((f) => !fall.has(f.cufe));
    if (!enZip.length) { contPrepGuardar(); contPrepRefrescar(); const rr = $('envioRes'); if (rr) rr.textContent = 'No pude bajar ningún PDF: no hay nada para marcar.'; return; }
    await descargarContabilidad(enZip, 'envio_contabilidad_' + hoy + '.xlsx');
    CONT_PREP = Object.assign({}, CONT_PREP, { bajado: true, firmaBajada: EnvioContabilidad.firma(enZip.map((f) => f.cufe)) });
    contPrepGuardar(); contPrepRefrescar();
    if (fall.size) alert('⚠️ ' + fall.size + ' PDF no se pudieron bajar: quedaron DESMARCADOS y siguen pendientes.');
  } finally { const bb = $('btnEnvioBajar'); if (bb) bb.disabled = false; }
}

async function contPrepConfirmar() {
  if (!CONT_PREP) return;
  const v = EnvioContabilidad.vigentes(CONT_PREP, contPendientes().lista), sel = EnvioContabilidad.seleccion(CONT_PREP, v.docs);
  const ok = EnvioContabilidad.puedeConfirmar(CONT_PREP, sel);
  if (!ok.ok) { alert(ok.motivo); return; }
  if (!confirm('¿Marcar como ENVIADOS a contabilidad estos ' + sel.length + ' documento(s)?\n\nNo vuelven a salir en «Por enviar». Los desmarcados (' + (v.docs.length - sel.length) + ') siguen pendientes.')) return;
  const rr = await SB.rpc('contabilidad_marcar', { p_cufes: sel.map((f) => f.cufe), p_nota: null, p_usuario: (perfil && perfil.nombre) || (usuario && usuario.email) || null });
  if (rr.error) { const res = $('envioRes'); if (res) res.textContent = 'No se pudieron marcar: ' + rr.error.message; return; }
  const d = rr.data || {};
  CONT_PREP = null; contPrepGuardar();
  await cargarEnvioContabilidad(); pintar();
  alert('✅ Lote ' + d.lote + ': ' + d.marcadas + ' documento(s) marcados como enviados a contabilidad.' + (d.ya_estaban ? ' (' + d.ya_estaban + ' ya estaban enviados)' : ''));
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
