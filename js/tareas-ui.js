// ============================================================
//  tareas-ui.js  -  menu «📝 Tareas» (administrador y analistas) (16/10/2026, pedido del usuario)
// ============================================================
// Administrador: asigna tareas (a una o varias personas) con tipo, sede y fecha de cumplimiento; ve todas, edita la fecha o
// cancela. Analista: ve las suyas, las empieza / termina (con comentario), comenta y sube evidencias (fotos o PDF, tambien
// desde el celular; quedan en el bucket «facturas», carpeta tareas/<id>/). Logica pura en js/tareas.js; base en supabase/tareas.sql.
// Nombres globales con prefijo tar / TAR.
var TAR = { lista: [], eventos: new Map(), personas: [], cargado: false, filtroPersona: '', filtroEstado: 'abiertas', busca: '', form: false, ocupado: false,
  // (18/10/2026) vista calendario: mes visible, dia abierto, modo «planear el mes» (admin) y dias marcados
  vista: (function () { try { return localStorage.getItem('tarVista') === 'calendario' ? 'calendario' : 'lista'; } catch (e) { return 'lista'; } })(),
  mes: '', dia: '', plan: false, sel: new Set() };

function tarPuede() { return typeof perfil !== 'undefined' && perfil && (perfil.rol === 'admin' || perfil.rol === 'pagos'); }
function tarEsAdmin() { return typeof perfil !== 'undefined' && perfil && perfil.rol === 'admin'; }
function tarHoy() { return typeof BancoUtils !== 'undefined' ? BancoUtils.hoyColombia() : new Date().toISOString().slice(0, 10); }
function tarFecha(d) { return d ? String(d).slice(8, 10) + '/' + String(d).slice(5, 7) + '/' + String(d).slice(0, 4) : ''; }
function tarHora(ts) { if (!ts) return ''; const d = new Date(Date.parse(ts) - 5 * 3600000); const h = d.getUTCHours(); return String(d.getUTCDate()).padStart(2, '0') + '/' + String(d.getUTCMonth() + 1).padStart(2, '0') + ' ' + (h % 12 || 12) + ':' + String(d.getUTCMinutes()).padStart(2, '0') + (h < 12 ? ' a. m.' : ' p. m.'); }
function tarNombre(uid) { const p = TAR.personas.find((x) => x.user_id === uid); return p ? p.nombre : (typeof perfil !== 'undefined' && perfil && typeof usuario !== 'undefined' && usuario && usuario.id === uid ? perfil.nombre : ''); }
function tarSede(id) { const s = (typeof sedes !== 'undefined' ? sedes : []).find((x) => Number(x.id) === Number(id)); return s ? s.nombre + (s.marcas && s.marcas.nombre ? ' · ' + s.marcas.nombre : '') : ''; }
// (18/10/2026) opciones de sede agrupadas por marca (hay sedes con el mismo nombre en marcas distintas, ej. Laureles)
function tarSedeOpciones() {
  const grupos = new Map();
  (typeof sedes !== 'undefined' ? sedes : []).forEach((s) => { const m = (s.marcas && s.marcas.nombre) || 'Sin marca'; if (!grupos.has(m)) grupos.set(m, []); grupos.get(m).push(s); });
  return [...grupos.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([m, l]) => `<optgroup label="${escAg(m)}">${l.slice().sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)))
    .map((s) => `<option value="${s.id}">${escAg(s.nombre)} · ${escAg(m)}</option>`).join('')}</optgroup>`).join('');
}
// (19/10/2026) SEDES CON SELECCION MULTIPLE: casillas agrupadas por marca dentro de un desplegable (<details>).
// Al asignar, a cada persona le queda una tarea por cada sede marcada (y por cada fecha). Ninguna marcada = sin sede.
function tarSedesHtml(id) {
  const grupos = new Map();
  (typeof sedes !== 'undefined' ? sedes : []).forEach((s) => { const m = (s.marcas && s.marcas.nombre) || 'Sin marca'; if (!grupos.has(m)) grupos.set(m, []); grupos.get(m).push(s); });
  const cuerpo = [...grupos.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([m, l]) => `<div style="margin-top:4px"><b style="font-size:12.5px">${escAg(m)}</b>
      ${l.slice().sort((a, b) => String(a.nombre).localeCompare(String(b.nombre))).map((s) => `<label style="display:flex;gap:6px;align-items:center;padding:2px 0 2px 8px;white-space:nowrap;cursor:pointer"><input type="checkbox" data-tsede="${s.id}" style="width:auto;margin:0" onchange="tarSedesResumen('${id}')">${escAg(s.nombre)} · ${escAg(m)}</label>`).join('')}</div>`).join('');
  return `<details id="${id}" class="tar-sedes" style="display:inline-block;position:relative;vertical-align:middle">
      <summary style="cursor:pointer;list-style:none;border:1px solid var(--line);border-radius:8px;padding:6px 10px;background:#fff;min-width:220px">
        <span data-tsres>— (ninguna)</span> ▾</summary>
      <div style="position:absolute;z-index:30;background:#fff;border:1px solid var(--line);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.12);padding:6px 10px;max-height:320px;overflow:auto;min-width:260px">
        <div style="display:flex;gap:8px;margin-bottom:2px"><button type="button" class="s" style="padding:2px 8px;font-size:12px" onclick="tarSedesTodas('${id}',true)">Todas</button><button type="button" style="padding:2px 8px;font-size:12px" onclick="tarSedesTodas('${id}',false)">Ninguna</button></div>
        ${cuerpo}
      </div>
    </details>`;
}
function tarSedesElegidas(id) { return [...document.querySelectorAll('#' + id + ' input[data-tsede]')].filter((x) => x.checked).map((x) => Number(x.getAttribute('data-tsede'))); }
function tarSedesResumen(id) {
  const d = $(id); if (!d) return;
  const l = tarSedesElegidas(id), r = d.querySelector('[data-tsres]');
  if (r) r.textContent = !l.length ? '— (ninguna)' : l.length === 1 ? tarSede(l[0]) : l.length + ' sedes marcadas';
}
function tarSedesTodas(id, si) { document.querySelectorAll('#' + id + ' input[data-tsede]').forEach((x) => { x.checked = !!si; }); tarSedesResumen(id); }
// asigna una vez por sede marcada (o una sola vez sin sede). a = parametros de tarAsignarRpc sin p_sede -> { data, error, hechas }
async function tarAsignarPorSedes(a, sedesIds) {
  const lista = sedesIds.length ? sedesIds : [null];
  let total = 0, hechas = 0;
  for (const s of lista) {
    const r = await tarAsignarRpc(Object.assign({}, a, { p_sede: s }));
    if (r.error) return { data: total, error: r.error, hechas, falto: s };
    total += Number(r.data) || 0; hechas++;
  }
  return { data: total, error: null, hechas };
}

async function tarCargar() {
  const r = await SB.from('tarea').select('*').order('fecha_limite', { ascending: true }).limit(2000);
  if (r.error) { TAR.error = r.error.message; return; }
  TAR.error = ''; TAR.lista = r.data || [];
  TAR.eventos = new Map();
  const ids = TAR.lista.map((t) => t.id);
  for (let i = 0; i < ids.length; i += 200) {
    const e = await SB.from('tarea_evento').select('*').in('tarea_id', ids.slice(i, i + 200)).order('en', { ascending: true });
    (e.data || []).forEach((x) => { if (!TAR.eventos.has(x.tarea_id)) TAR.eventos.set(x.tarea_id, []); TAR.eventos.get(x.tarea_id).push(x); });
  }
  if (tarEsAdmin() && !TAR.personas.length) {
    const p = await SB.from('perfiles').select('user_id,nombre,rol,activo').in('rol', ['admin', 'pagos']);
    TAR.personas = (p.data || []).filter((x) => x.activo !== false).sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
  }
  TAR.cargado = true;
  tarContador();
}
// numero en el boton del menu: tareas abiertas (las mias; el administrador, todas)
function tarContador() {
  const b = $('m-tareas'); if (!b) return;
  const res = Tareas.resumen(TAR.lista, tarHoy());
  b.innerHTML = '📝 Tareas' + (res.abiertas ? ` <b style="color:${res.vencidas ? '#b91c1c' : 'inherit'}">(${res.abiertas})</b>` : '');
}
async function tarContarAlEntrar() { if (!tarPuede() || typeof SB === 'undefined') return; try { await tarCargar(); } catch (e) { /* sin tablas: nada */ } }
async function tarAbrir() { const raiz = $('tareasRaiz'); if (!raiz) return; if (!tarPuede()) { raiz.innerHTML = '<div class="vacio">Solo administradores y analistas ven las tareas.</div>'; return; } raiz.innerHTML = '<div class="mut" style="padding:16px">Cargando tareas…</div>'; await tarCargar(); tarPintar(); }

function tarFiltradas() {
  const hoy = tarHoy(), q = (TAR.busca || '').trim().toLowerCase();
  return Tareas.ordenar(TAR.lista).filter((t) => {
    if (TAR.filtroPersona && t.asignada_a !== TAR.filtroPersona) return false;
    if (TAR.filtroEstado === 'abiertas' && !Tareas.abierta(t)) return false;
    if (TAR.filtroEstado === 'vencidas' && !Tareas.vencida(t, hoy)) return false;
    if (TAR.filtroEstado === 'terminadas' && t.estado !== 'terminada') return false;
    if (q && !(t.titulo + ' ' + (t.descripcion || '') + ' ' + tarNombre(t.asignada_a) + ' ' + tarSede(t.sede_id)).toLowerCase().includes(q)) return false;
    return true;
  });
}

function tarPintar() {
  const raiz = $('tareasRaiz'); if (!raiz) return;
  if (TAR.error) { raiz.innerHTML = '<div class="vacio">No pude cargar las tareas: ' + escAg(TAR.error) + '</div>'; return; }
  const hoy = tarHoy(), res = Tareas.resumen(TAR.lista, hoy), adm = tarEsAdmin();
  if (!TAR.mes) TAR.mes = hoy.slice(0, 7);
  const cal = TAR.vista === 'calendario';
  const chip = (v, t) => `<button class="chip${TAR.filtroEstado === v ? ' on' : ''}" onclick="TAR.filtroEstado='${v}';tarPintar()">${t}</button>`;
  const chipVista = (v, t) => `<button class="chip${TAR.vista === v ? ' on' : ''}" onclick="tarVista('${v}')">${t}</button>`;
  raiz.innerHTML = `
    <div class="card" style="margin-bottom:12px">
      <div class="row" style="gap:8px;flex-wrap:wrap;align-items:center">
        <b style="font-size:16px">📝 ${adm ? 'Tareas de los analistas' : 'Mis tareas'}</b>
        <span class="badge">${res.abiertas} abierta(s)</span>${res.vencidas ? `<span class="badge" style="color:#991b1b;background:#fee2e2;border-color:#fca5a5">⚠️ ${res.vencidas} vencida(s)</span>` : ''}${res.hoy ? `<span class="badge" style="color:#92400e;background:#fffbeb;border-color:#fcd34d">📅 ${res.hoy} para hoy</span>` : ''}
        <span class="sp"></span>${chipVista('lista', '📋 Lista')}${chipVista('calendario', '📅 Calendario')}
        ${adm && cal ? `<button class="p" onclick="tarPlanAlternar()">${TAR.plan ? '✖ Cerrar plan' : '📦 Planear el mes'}</button>` : ''}
        ${adm && !cal ? `<button class="p" onclick="TAR.form=!TAR.form;tarPintar()">${TAR.form ? '✖ Cerrar' : '➕ Asignar tarea'}</button>` : ''}
      </div>
      <div class="mut" style="margin-top:6px">${adm ? 'Asigna inventarios cíclicos, visitas, capacitaciones u otras tareas con fecha de cumplimiento. En la evaluación cuenta «📝 Tareas a tiempo».' : 'Cambia el estado cuando empieces y cuando termines, y sube las evidencias (fotos o PDF). Si la terminas a más tardar en su fecha, cuenta a tiempo en tu evaluación.'}</div>
    </div>
    ${adm && TAR.form && !cal ? tarFormHtml() : ''}
    <div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:10px;align-items:center">
      ${cal ? '' : chip('abiertas', '⏳ Abiertas') + chip('vencidas', '⚠️ Vencidas') + chip('terminadas', '✅ Terminadas') + chip('todas', 'Todas')}
      ${adm ? `<select onchange="TAR.filtroPersona=this.value;tarPintar()" style="width:auto;margin:0"><option value="">👤 Todas las personas</option>${TAR.personas.map((p) => `<option value="${p.user_id}"${TAR.filtroPersona === p.user_id ? ' selected' : ''}>${escAg(p.nombre)}</option>`).join('')}</select>` : ''}
      <input type="search" placeholder="🔎 Buscar" value="${escAg(TAR.busca)}" oninput="TAR.busca=this.value;tarRefrescarCuerpo()" style="width:auto;min-width:180px;margin:0">
    </div>
    ${cal ? tarCalHtml() : `<div id="tarLista">${tarListaHtml()}</div>`}`;
}
// repinta solo lo que cambia con el buscador (sin perder lo que se esta escribiendo)
function tarRefrescarCuerpo() {
  if (TAR.vista === 'calendario') tarCalRefrescar();
  else { const l = $('tarLista'); if (l) l.innerHTML = tarListaHtml(); }
}
function tarVista(v) {
  TAR.vista = v === 'calendario' ? 'calendario' : 'lista';
  if (TAR.vista === 'lista') TAR.plan = false;
  try { localStorage.setItem('tarVista', TAR.vista); } catch (e) { /* sin almacenamiento: no pasa nada */ }
  tarPintar();
}

// ============================================================
//  📅 CALENDARIO (18/10/2026, pedido del usuario)
// ============================================================
// Mes de lunes a domingo con las tareas en su fecha de cumplimiento (color por estado). Tocar un dia abre debajo sus tareas con
// los mismos botones de la lista (empezar, terminar, reabrir, comentar, evidencias). El administrador puede «📦 Planear el mes»:
// marca dias (uno a uno o por dia de la semana), elige personas, sede y titulo, y se crea una tarea por dia; a cada persona le
// llega UN correo con la lista de fechas (funcion tarea_crear_varias, supabase/tareas_calendario.sql).
const TAR_COLOR = {
  pendiente:  { bg: '#eff6ff', bd: '#93c5fd', tx: '#1e3a8a', t: '⏳ Pendiente' },
  en_proceso: { bg: '#fffbeb', bd: '#fcd34d', tx: '#92400e', t: '🔧 En proceso' },
  terminada:  { bg: '#ecfdf5', bd: '#86efac', tx: '#166534', t: '✅ A tiempo' },
  tarde:      { bg: '#fff7ed', bd: '#fdba74', tx: '#9a3412', t: '⏰ Terminada tarde' },
  vencida:    { bg: '#fee2e2', bd: '#fca5a5', tx: '#991b1b', t: '⚠️ Vencida' },
  cancelada:  { bg: '#f1f5f9', bd: '#cbd5e1', tx: '#64748b', t: '✖ Cancelada' },
};
function tarCalCss() {
  if (document.getElementById('tarCalCss')) return;
  const s = document.createElement('style'); s.id = 'tarCalCss';
  s.textContent = `
  .tcal{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}
  .tcal-h{font-size:12px;font-weight:700;color:var(--mut);text-align:center;padding:2px 0}
  .tcal-d{min-height:96px;background:#fff;border:1px solid var(--line);border-radius:10px;padding:4px 5px;cursor:pointer;display:flex;flex-direction:column;gap:3px;min-width:0;transition:.12s}
  .tcal-d:hover{border-color:var(--accent)}
  .tcal-d.fuera{background:#f8fafc;opacity:.55}
  .tcal-d.hoy .tcal-n{background:var(--accent);color:#fff}
  .tcal-d.abierto{box-shadow:0 0 0 2px var(--accent)}
  .tcal-d.sel{background:#ecfeff;border-color:#0891b2;box-shadow:0 0 0 2px #0891b2}
  .tcal-d.pasado.planeando{cursor:not-allowed;opacity:.45}
  .tcal-n{font-size:12px;font-weight:700;width:22px;height:22px;line-height:22px;text-align:center;border-radius:999px;color:var(--txt)}
  .tcal-c{font-size:11px;line-height:1.25;border:1px solid;border-radius:6px;padding:1px 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .tcal-c.cancelada{text-decoration:line-through}
  .tcal-mas{font-size:11px;color:var(--mut);font-weight:600}
  .tcal-ley{display:flex;flex-wrap:wrap;gap:6px;font-size:11.5px;margin-top:8px}
  .tcal-ley span{border:1px solid;border-radius:999px;padding:1px 8px}
  @media (max-width:640px){
    .tcal{gap:2px}.tcal-d{min-height:58px;padding:2px}
    .tcal-c{font-size:0;padding:0;height:7px;border-radius:4px}
    .tcal-h{font-size:10.5px}
  }`;
  document.head.appendChild(s);
}
// tareas que se ven en el calendario: respetan persona y buscador; las canceladas solo si se pide «Todas»
function tarCalTareas() {
  const q = (TAR.busca || '').trim().toLowerCase();
  return TAR.lista.filter((t) => {
    if (TAR.filtroPersona && t.asignada_a !== TAR.filtroPersona) return false;
    if (t.estado === 'cancelada' && !TAR.verCanceladas) return false;
    if (q && !(t.titulo + ' ' + (t.descripcion || '') + ' ' + tarNombre(t.asignada_a) + ' ' + tarSede(t.sede_id)).toLowerCase().includes(q)) return false;
    return true;
  });
}
function tarCalHtml() {
  tarCalCss();
  const adm = tarEsAdmin();
  return `<div class="card" style="margin-bottom:12px;padding:12px">
      <div class="row" style="gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
        <button onclick="tarMes(-1)" title="Mes anterior">◀</button>
        <b style="font-size:16px;text-transform:capitalize;min-width:150px;text-align:center" id="tarMesNombre">${escAg(Tareas.mesNombre(TAR.mes))}</b>
        <button onclick="tarMes(1)" title="Mes siguiente">▶</button>
        <button onclick="tarMes(0)">Hoy</button>
        <span class="sp"></span>
        <label class="mut" style="display:inline-flex;align-items:center;gap:4px;white-space:nowrap"><input type="checkbox" style="width:auto;margin:0" ${TAR.verCanceladas ? 'checked' : ''} onchange="TAR.verCanceladas=this.checked;tarCalRefrescar()"> Ver canceladas</label>
      </div>
      ${adm && TAR.plan ? tarPlanBarraHtml() : ''}
      <div id="tarCalGrid">${tarCalGridHtml()}</div>
      <div class="tcal-ley">${['pendiente', 'en_proceso', 'vencida', 'terminada', 'tarde'].map((k) => `<span style="background:${TAR_COLOR[k].bg};border-color:${TAR_COLOR[k].bd};color:${TAR_COLOR[k].tx}">${TAR_COLOR[k].t}</span>`).join('')}</div>
    </div>
    ${adm && TAR.plan ? tarPlanFormHtml() : ''}
    <div id="tarDia">${tarDiaHtml()}</div>`;
}
function tarCalGridHtml() {
  const hoy = tarHoy(), adm = tarEsAdmin(), plan = adm && TAR.plan;
  const dias = Tareas.porDia(tarCalTareas());
  let h = '<div class="tcal">' + Tareas.DIAS_CORTO.map((d) => `<div class="tcal-h">${d}</div>`).join('');
  Tareas.mesGrid(TAR.mes).forEach((sem) => sem.forEach((c) => {
    const ts = dias.get(c.fecha) || [];
    const cls = ['tcal-d', c.delMes ? '' : 'fuera', c.fecha === hoy ? 'hoy' : '', !plan && TAR.dia === c.fecha ? 'abierto' : '',
      plan && TAR.sel.has(c.fecha) ? 'sel' : '', c.fecha < hoy ? 'pasado' : '', plan ? 'planeando' : ''].filter(Boolean).join(' ');
    const chips = ts.slice(0, 3).map((t) => {
      const k = Tareas.colorEstado(t, hoy), col = TAR_COLOR[k] || TAR_COLOR.pendiente;
      const quien = adm && !TAR.filtroPersona ? ' · ' + (tarNombre(t.asignada_a) || '').split(' ')[0] : '';
      return `<div class="tcal-c ${k}" style="background:${col.bg};border-color:${col.bd};color:${col.tx}" title="${escAg(t.titulo + quien + ' · ' + col.t)}">${escAg((Tareas.TIPOS[t.tipo] || '📝').split(' ')[0])} ${escAg(t.titulo)}${escAg(quien)}</div>`;
    }).join('');
    h += `<div class="${cls}" onclick="tarCalClic('${c.fecha}')"><span class="tcal-n">${Number(c.fecha.slice(8, 10))}</span>${chips}${ts.length > 3 ? `<span class="tcal-mas">+${ts.length - 3} más</span>` : ''}</div>`;
  }));
  return h + '</div>';
}
function tarDiaHtml() {
  if (TAR.plan || !TAR.dia) return '';
  const hoy = tarHoy(), adm = tarEsAdmin();
  const ts = Tareas.ordenar(tarCalTareas().filter((t) => String(t.fecha_limite).slice(0, 10) === TAR.dia));
  const d = TAR.dia, titulo = `📅 ${Tareas.DIAS_CORTO[Tareas.diaSemana(d) - 1]} ${tarFecha(d)}`;
  const atajo = adm && d >= hoy ? ` <button class="s" onclick="tarPlanAlternar('${d}')">➕ Asignar en este día</button>` : '';
  if (!ts.length) return `<div class="vacio" style="padding:20px">${titulo}: no hay tareas.${atajo}</div>`;
  return `<div class="row" style="gap:8px;align-items:center;margin:4px 0 8px"><b>${titulo}</b><span class="badge">${ts.length} tarea(s)</span>${atajo}</div>` + ts.map((t) => tarTarjetaHtml(t, hoy, adm)).join('');
}
function tarCalRefrescar() {
  const g = $('tarCalGrid'); if (g) g.innerHTML = tarCalGridHtml();
  const d = $('tarDia'); if (d) d.innerHTML = tarDiaHtml();
  const n = $('tarSelCuenta'); if (n) n.innerHTML = tarSelCuentaHtml();
}
function tarMes(n) {
  TAR.mes = n === 0 ? tarHoy().slice(0, 7) : Tareas.mesSumar(TAR.mes, n);
  if (n === 0) TAR.dia = tarHoy();
  const nom = $('tarMesNombre'); if (nom) nom.textContent = Tareas.mesNombre(TAR.mes);
  tarCalRefrescar();
}
function tarCalClic(fecha) {
  if (TAR.plan && tarEsAdmin()) {
    if (fecha < tarHoy()) return;                       // no se planea hacia atras
    if (TAR.sel.has(fecha)) TAR.sel.delete(fecha); else TAR.sel.add(fecha);
  } else {
    TAR.dia = TAR.dia === fecha ? '' : fecha;
  }
  tarCalRefrescar();
  if (!TAR.plan && TAR.dia) { const d = $('tarDia'); if (d && d.scrollIntoView) d.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
}

// ---------- 📦 Planear el mes (solo administrador) ----------
function tarPlanAlternar(fecha) {
  TAR.plan = !TAR.plan || !!fecha;
  TAR.sel = new Set(fecha ? [fecha] : []);
  if (fecha) { TAR.mes = fecha.slice(0, 7); TAR.vista = 'calendario'; }
  tarPintar();
}
function tarSelCuentaHtml() {
  const n = TAR.sel.size;
  if (!n) return '<span class="mut">Toca los días en el calendario (o usa los atajos) para marcarlos.</span>';
  const l = [...TAR.sel].sort();
  return `<b>${n} día(s) marcado(s)</b> <span class="mut">${l.slice(0, 8).map(tarFecha).map((x) => x.slice(0, 5)).join(', ')}${n > 8 ? '…' : ''}</span>`;
}
function tarPlanBarraHtml() {
  const dia = (n, t) => `<button class="chip" onclick="tarPlanPatron([${n}])" title="Marcar todos los ${t} que faltan del mes">${t}</button>`;
  return `<div style="background:#ecfeff;border:1px solid #67e8f9;border-radius:10px;padding:8px 10px;margin-bottom:8px">
      <div style="font-weight:700;color:#155e75">📦 Planear el mes: marca el día en que INICIA cada tarea</div>
      <div class="row" style="gap:4px;flex-wrap:wrap;margin-top:6px;align-items:center">
        <span class="mut">Marcar todos los:</span>${dia(1, 'lunes')}${dia(2, 'martes')}${dia(3, 'miércoles')}${dia(4, 'jueves')}${dia(5, 'viernes')}${dia(6, 'sábados')}${dia(7, 'domingos')}
        <button class="chip" onclick="tarPlanPatron([1,2,3,4,5])">Días hábiles (L–V)</button>
        <button class="chip" onclick="tarPlanPatron([1,2,3,4,5,6,7])">Todo el mes</button>
        <button class="chip" onclick="TAR.sel=new Set();tarCalRefrescar()">🧹 Limpiar</button>
      </div>
      <div id="tarSelCuenta" style="margin-top:6px">${tarSelCuentaHtml()}</div>
    </div>`;
}
// suma (no reemplaza) los dias de ese patron que faltan del mes visible (desde hoy)
function tarPlanPatron(diasSemana) {
  Tareas.fechasPatron(TAR.mes, diasSemana, tarHoy()).forEach((f) => TAR.sel.add(f));
  tarCalRefrescar();
}
function tarPlanFormHtml() {
  const personas = TAR.personas.filter((p) => p.rol === 'pagos' || p.rol === 'admin');
  return `<div class="card" style="margin-bottom:12px;border-left:5px solid #0891b2">
    <div style="font-weight:700">📦 Asignar en los días marcados</div>
    <div class="mut" style="margin:4px 0">¿A quién? A cada persona le queda una tarea por cada día marcado y le llega <b>un solo correo</b> con todas las fechas.</div>
    <div style="display:flex;flex-wrap:wrap;gap:4px 14px">${personas.map((p) => `<label style="display:inline-flex;align-items:center;gap:4px;white-space:nowrap"><input type="checkbox" data-tpq="${p.user_id}" style="width:auto;margin:0">${escAg(p.nombre)}</label>`).join('')}</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px 12px;margin-top:8px">
      <label>Tipo <select id="tarPlanTipo" style="width:auto;margin:0" onchange="tarPlantillaCargar('tarPlanTipo','tarPlanDesc','tarPlanActs')">${Object.entries(Tareas.TIPOS).map(([k, v]) => `<option value="${k}"${k === 'inventario' ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>Sede(s) (opcional) ${tarSedesHtml('tarPlanSede')}</label>
      <label title="1 = se inicia y se termina el mismo día">⏱️ Días para terminarla <input type="number" id="tarPlanDias" min="1" max="31" value="1" style="width:70px;margin:0"></label>
    </div>
    <div class="mut" style="font-size:12.5px;margin-top:4px">Cada día marcado es el 🟢 inicio; la tarea 🏁 debe terminarse los días que pongas después (1 = el mismo día).</div>
    <input id="tarPlanTitulo" placeholder="Título (ej. Inventario cíclico de bebidas)" style="margin-top:8px">
    ${tarPlantillaCamposHtml('tarPlanDesc', 'tarPlanActs', 'inventario')}
    <div style="margin-top:8px"><button class="p" onclick="tarCrearVarias()">📦 Asignar en los días marcados</button> <span class="mut" id="tarPlanRes"></span></div>
  </div>`;
}
async function tarCrearVarias() {
  if (TAR.ocupado) return;
  const res = $('tarPlanRes'), msg = (t) => { if (res) res.textContent = t; };
  const quienes = [...document.querySelectorAll('#tareasRaiz input[data-tpq]')].filter((x) => x.checked).map((x) => x.getAttribute('data-tpq'));
  const fechas = [...TAR.sel].filter((f) => f >= tarHoy()).sort();   // dias de INICIO
  const nd = Math.max(1, Math.min(31, parseInt(($('tarPlanDias') || {}).value, 10) || 1));
  const fines = fechas.map((f) => Tareas.sumarDias(f, nd - 1));
  const titulo = ($('tarPlanTitulo') || {}).value || '';
  if (!fechas.length) return msg('⚠️ Marca al menos un día en el calendario.');
  if (!quienes.length) return msg('⚠️ Elige a quién se le asigna.');
  if (!titulo.trim()) return msg('⚠️ Escribe el título.');
  if (fechas.length > 62) return msg('⚠️ Máximo 62 días por asignación.');
  const sedesIds = tarSedesElegidas('tarPlanSede'), ns = Math.max(1, sedesIds.length);
  const total = fechas.length * quienes.length * ns;
  if (!confirm(`📦 Se van a crear ${total} tarea(s): ${fechas.length} día(s) × ${quienes.length} persona(s)${ns > 1 ? ' × ' + ns + ' sedes' : ''}.\nA cada persona le llega un correo con sus fechas${ns > 1 ? ' (uno por sede)' : ''}.\n\n¿Continuar?`)) return;
  TAR.ocupado = true; msg('Asignando…');
  try {
    const r = await tarAsignarPorSedes({ p_asignados: quienes, p_tipo: ($('tarPlanTipo') || {}).value || 'inventario', p_titulo: titulo,
      p_descripcion: ($('tarPlanDesc') || {}).value || null, p_fechas: fines, p_dias_antes: nd - 1,
      p_actividades: Tareas.actividadesDeTexto(($('tarPlanActs') || {}).value), p_usuario: tarUsuario() }, sedesIds);
    if (r.error) { if (r.hechas) { await tarCargar(); tarPintar(); } return msg((r.hechas ? '⚠️ Se asignaron ' + r.hechas + ' sede(s), pero falló ' + tarSede(r.falto) + ': ' : '') + (r.error.aviso || 'No se pudo: ' + r.error.message)); }
    TAR.plan = false; TAR.sel = new Set(); TAR.dia = fines[0];
    await tarCargar(); tarPintar();
    if (typeof csEnviarCola === 'function') csEnviarCola(true);   // el correo sale ya desde el servidor
    alert('✅ ' + r.data + ' tarea(s) asignada(s). A cada persona le llega un correo con sus fechas.');
  } finally { TAR.ocupado = false; }
}

function tarFormHtml() {
  const hoy = tarHoy();
  const personas = TAR.personas.filter((p) => p.rol === 'pagos' || p.rol === 'admin');
  return `<div class="card" style="margin-bottom:12px;border-left:5px solid #1e3a8a">
    <div style="font-weight:700">➕ Asignar tarea</div>
    <div class="mut" style="margin:4px 0">¿A quién? (puedes marcar varias personas: a cada una le queda su propia tarea y le llega un correo)</div>
    <div style="display:flex;flex-wrap:wrap;gap:4px 14px">${personas.map((p) => `<label style="display:inline-flex;align-items:center;gap:4px;white-space:nowrap"><input type="checkbox" data-tq="${p.user_id}" style="width:auto;margin:0">${escAg(p.nombre)}</label>`).join('')}</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px 12px;margin-top:8px">
      <label>Tipo <select id="tarTipo" style="width:auto;margin:0" onchange="tarPlantillaCargar('tarTipo','tarDesc','tarActs')">${Object.entries(Tareas.TIPOS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      <label>Sede(s) (opcional) ${tarSedesHtml('tarSedeSel')}</label>
      <label>🟢 Inicia <input type="date" id="tarFechaIni" min="${hoy}" value="${hoy}" style="width:auto;margin:0" onchange="tarFechaIniCambio()"></label>
      <label>🏁 Debe terminarse <input type="date" id="tarFecha" min="${hoy}" value="${hoy}" style="width:auto;margin:0"></label>
    </div>
    <input id="tarTitulo" placeholder="Título (ej. Inventario cíclico de bebidas en Provenza)" style="margin-top:8px">
    ${tarPlantillaCamposHtml('tarDesc', 'tarActs', Object.keys(Tareas.TIPOS)[0])}
    <div style="margin-top:8px"><button class="p" id="tarBtnCrear" onclick="tarCrear()">📝 Asignar</button> <span class="mut" id="tarFormRes"></span></div>
  </div>`;
}

function tarListaHtml() {
  const l = tarFiltradas(), hoy = tarHoy(), adm = tarEsAdmin();
  if (!l.length) return '<div class="vacio">No hay tareas con este filtro.</div>';
  return l.slice(0, 200).map((t) => tarTarjetaHtml(t, hoy, adm)).join('') + (l.length > 200 ? `<div class="mut">…y ${l.length - 200} más: usa el buscador.</div>` : '');
}

// tarjeta de UNA tarea (la usan la lista y el calendario: mismos botones de estado, comentario y evidencias)
function tarTarjetaHtml(t, hoy, adm) {
    const fal = Tareas.faltan(t, hoy), evTodos = TAR.eventos.get(t.id) || [];
    const seg = Tareas.seguimiento(t, evTodos, hoy), ev = seg ? evTodos.filter((e) => !/^📆 Día \d{2}\/\d{2}\/\d{4}: /.test(String(e.comentario || ''))) : evTodos;
    const vence = t.estado === 'terminada' ? (Tareas.aTiempo(t) ? '<span class="badge st-sellada">✅ a tiempo</span>' : '<span class="badge" style="color:#991b1b;background:#fee2e2;border-color:#fca5a5">⏰ terminada tarde</span>')
      : t.estado === 'cancelada' ? '' : fal < 0 ? `<span class="badge" style="color:#991b1b;background:#fee2e2;border-color:#fca5a5;font-weight:700">⚠️ vencida hace ${-fal} día(s)</span>` : fal === 0 ? '<span class="badge" style="color:#92400e;background:#fffbeb;border-color:#fcd34d;font-weight:700">📅 vence HOY</span>' : `<span class="badge">📅 faltan ${fal} día(s)</span>`;
    const acciones = [];
    if (t.estado === 'pendiente') acciones.push(`<button class="s" onclick="tarEstado(${t.id},'en_proceso')">🔧 Empezar</button>`);
    if (Tareas.abierta(t)) acciones.push(`<button class="p" style="background:#15803d;border-color:#15803d" onclick="tarEstado(${t.id},'terminada')">✅ Terminar</button>`);
    if (t.estado === 'terminada' || (t.estado === 'cancelada' && adm)) acciones.push(`<button onclick="tarEstado(${t.id},'en_proceso')">↩ Reabrir</button>`);
    if (t.estado !== 'cancelada') acciones.push(`<button onclick="tarComentar(${t.id})">💬 Comentar</button>`);
    if (adm && t.estado !== 'cancelada' && TAR.editando !== t.id) acciones.push(`<button onclick="tarEditarAbrir(${t.id})">📋 Editar resumen y actividades</button>`);
    if (adm && t.estado !== 'cancelada') acciones.push(`<button onclick="tarEditarFecha(${t.id})">✏️ Cambiar fechas</button>`, `<button class="d" onclick="tarEstado(${t.id},'cancelada')">✖ Cancelar</button>`);
    return `<div class="card" style="margin-bottom:8px${Tareas.vencida(t, hoy) ? ';border-left:5px solid #b91c1c' : ''}">
      <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap">
        <div style="flex:1 1 260px"><b>${escAg((Tareas.TIPOS[t.tipo] || '📝').split(' ')[0])} ${escAg(t.titulo)}</b>
          <div class="mut" style="font-size:12.5px">${escAg(Tareas.TIPOS[t.tipo] || '')}${adm ? ' · 👤 ' + escAg(tarNombre(t.asignada_a)) : ''}${t.sede_id ? ' · 🏪 ' + escAg(tarSede(t.sede_id)) : ''}${Tareas.inicio(t) ? ' · 🟢 inicia ' + tarFecha(Tareas.inicio(t)) : ''} · 🏁 vence ${tarFecha(t.fecha_limite)}${t.terminada_en ? ' · terminada ' + tarHora(t.terminada_en) : ''}</div></div>
        <span class="badge">${Tareas.ESTADOS[t.estado] || t.estado}</span>${vence}${seg && Tareas.abierta(t) && seg.dias.some((d) => d.estado === 'hoy') ? '<span class="badge" style="color:#1e40af;background:#eff6ff;border-color:#93c5fd;font-weight:700">📆 falta validar HOY</span>' : ''}
      </div>
      ${TAR.editando === t.id ? tarEditorHtml(t) : (t.descripcion ? `<div style="margin-top:6px;white-space:pre-wrap;font-size:13.5px">${escAg(t.descripcion)}</div>` : '') + tarActividadesHtml(t, adm)}
      ${seg ? tarSeguimientoHtml(t, seg) : ''}
      ${ev.length ? `<div style="margin-top:8px;border-top:1px solid var(--line);padding-top:6px;display:grid;gap:3px;font-size:12.5px">${ev.map((e) => `<div><span class="mut">${tarHora(e.en)}${e.usuario_nombre ? ' · ' + escAg(e.usuario_nombre) : ''}:</span> ${e.estado ? '<b>' + escAg(Tareas.ESTADOS[e.estado] || e.estado) + '</b> ' : ''}${e.comentario ? escAg(e.comentario) + ' ' : ''}${e.archivo ? `<a href="#" onclick="tarVer('${escAg(e.archivo)}');return false">📎 ${escAg(e.archivo_nombre || 'evidencia')}</a>` : ''}</div>`).join('')}</div>` : ''}
      ${t.estado !== 'cancelada' ? `<div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap;align-items:center">
        <label class="s" style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;border:1px solid var(--line);border-radius:8px;padding:5px 10px">📎 Subir evidencia<input type="file" accept="image/*,application/pdf" multiple style="display:none" onchange="tarSubir(${t.id},this)"></label>
        ${acciones.join('')}</div>` : ''}
    </div>`;
}

// (19/10/2026) VALIDACION DIARIA de las tareas de varios dias (ej. «Token DIAN diario»: todo el mes, la misma persona).
// Un cuadrito por dia: ✅ OK · ❌ NO OK · ⚠️ ya paso y nadie lo valido · azul = hoy, falta validar · gris = todavia no llega.
// Clic en un dia (hoy o pasado) para validarlo; queda en el historial con fecha, hora y quien lo hizo (si se corrige, vale el ultimo).
const TAR_DIA = { ok: ['#dcfce7', '#16a34a', '#166534', '✅ OK'], no: ['#fee2e2', '#dc2626', '#991b1b', '❌ NO OK'], falta: ['#fffbeb', '#f59e0b', '#92400e', '⚠️ sin validar'],
  hoy: ['#eff6ff', '#2563eb', '#1e40af', '📆 hoy: falta validar'], futuro: ['#f8fafc', '#e2e8f0', '#94a3b8', 'todavía no llega'] };
function tarSeguimientoHtml(t, seg) {
  const puede = t.estado !== 'cancelada';
  const celdas = seg.dias.map((d) => {
    const c = TAR_DIA[d.estado], clic = puede && d.estado !== 'futuro';
    const tip = Tareas.DIAS_CORTO[Tareas.diaSemana(d.fecha) - 1] + ' ' + tarFecha(d.fecha) + ': ' + c[3] + (d.nota ? ' — ' + d.nota : '') + (d.por ? ' (' + d.por + ')' : '') + (clic ? '\nClic para validar este día' : '');
    return `<div title="${escAg(tip)}" ${clic ? `onclick="tarValidarDia(${t.id},'${d.fecha}')"` : ''} style="min-width:30px;padding:0 3px;box-sizing:border-box;height:30px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:11.5px;font-weight:700;background:${c[0]};border:${d.estado === 'hoy' ? 2 : 1}px solid ${c[1]};color:${c[2]};cursor:${clic ? 'pointer' : 'default'}">${Number(d.fecha.slice(8, 10))}${d.estado === 'ok' ? '✓' : d.estado === 'no' ? '✗' : ''}</div>`;
  }).join('');
  const hoyEnRango = seg.dias.some((d) => d.fecha === tarHoy());
  return `<div style="margin-top:8px;border:1px solid #bfdbfe;background:#f8fbff;border-radius:10px;padding:8px 10px">
      <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap">
        <b style="color:#1e3a8a">📆 Validación diaria</b>
        <span class="mut" style="font-size:12.5px">✅ ${seg.ok} OK · ❌ ${seg.no} NO OK${seg.falta ? ` · <b style="color:#b45309">⚠️ ${seg.falta} día(s) sin validar</b>` : ''}</span>
        <span class="sp"></span>
        ${puede && hoyEnRango ? `<button class="s" style="padding:3px 10px;background:#15803d;border-color:#15803d;color:#fff" onclick="tarValidarDia(${t.id},'${tarHoy()}',true)">✅ Hoy quedó OK</button>
          <button class="d" style="padding:3px 10px" onclick="tarValidarDia(${t.id},'${tarHoy()}',false)">❌ Hoy NO quedó OK</button>` : ''}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px">${celdas}</div>
    </div>`;
}
async function tarValidarDia(id, fecha, ok) {
  const t = TAR.lista.find((x) => x.id === id); if (!t || TAR.ocupado) return;
  if (fecha > tarHoy()) { alert('Ese día todavía no llega.'); return; }
  const dia = Tareas.DIAS_CORTO[Tareas.diaSemana(fecha) - 1] + ' ' + tarFecha(fecha);
  if (ok === undefined) {
    const r = prompt('📆 «' + t.titulo + '» — ' + dia + '\n\n¿Cómo quedó este día?\n  1 = ✅ OK\n  2 = ❌ NO OK', '1');
    if (r === null) return;
    if (!['1', '2'].includes(r.trim())) { alert('Escribe 1 (OK) o 2 (NO OK).'); return; }
    ok = r.trim() === '1';
  }
  let nota = '';
  if (!ok) { nota = prompt('❌ ' + dia + ' NO quedó OK.\n\n¿Qué pasó? (obligatorio)', ''); if (nota === null) return; if (!nota.trim()) { alert('Escribe qué pasó.'); return; } }
  else if (fecha < tarHoy()) { nota = 'validado después, el ' + tarFecha(tarHoy()); }
  TAR.ocupado = true;
  try {
    const r = await SB.rpc('tarea_evidencia', { p_id: id, p_archivo: null, p_nombre: null, p_comentario: Tareas.marcaDia(fecha, ok, nota), p_usuario: tarUsuario() });
    if (r.error) { alert('No se pudo: ' + r.error.message); return; }
    if (t.estado === 'pendiente') await SB.rpc('tarea_estado', { p_id: id, p_estado: 'en_proceso', p_comentario: null, p_usuario: tarUsuario() });   // validar un dia = ya empezo
    await tarCargar(); tarPintar();
  } finally { TAR.ocupado = false; }
}

const tarUsuario = () => (typeof perfil !== 'undefined' && perfil && perfil.nombre) || (typeof usuario !== 'undefined' && usuario && usuario.email) || null;
async function tarCrear() {
  if (TAR.ocupado) return;
  const quienes = [...document.querySelectorAll('#tareasRaiz input[data-tq]')].filter((x) => x.checked).map((x) => x.getAttribute('data-tq'));
  const titulo = ($('tarTitulo') || {}).value || '', fecha = ($('tarFecha') || {}).value || '';
  const res = $('tarFormRes');
  if (!quienes.length) { if (res) res.textContent = '⚠️ Elige a quién se le asigna.'; return; }
  if (!titulo.trim()) { if (res) res.textContent = '⚠️ Escribe el título.'; return; }
  if (!fecha) { if (res) res.textContent = '⚠️ Elige la fecha en que debe terminarse.'; return; }
  const ini = ($('tarFechaIni') || {}).value || fecha;
  if (ini > fecha) { if (res) res.textContent = '⚠️ La fecha de inicio no puede ser después de la fecha en que debe terminarse.'; return; }
  const sedesIds = tarSedesElegidas('tarSedeSel');
  if (sedesIds.length > 1 && !confirm(`📝 Se van a crear ${sedesIds.length * quienes.length} tarea(s): ${quienes.length} persona(s) × ${sedesIds.length} sedes.\nA cada persona le llega un correo por sede.\n\n¿Continuar?`)) return;
  TAR.ocupado = true;
  try {
    const r = await tarAsignarPorSedes({ p_asignados: quienes, p_tipo: ($('tarTipo') || {}).value || 'otra', p_titulo: titulo, p_descripcion: ($('tarDesc') || {}).value || null,
      p_fechas: [fecha], p_dias_antes: Tareas.diasEntre(ini, fecha), p_actividades: Tareas.actividadesDeTexto(($('tarActs') || {}).value), p_usuario: tarUsuario() }, sedesIds);
    if (r.error) { if (r.hechas) { TAR.form = false; await tarCargar(); tarPintar(); } if (res) res.textContent = (r.hechas ? '⚠️ Se asignaron ' + r.hechas + ' sede(s), pero falló ' + tarSede(r.falto) + ': ' : '') + (r.error.aviso || 'No se pudo: ' + r.error.message); if (r.hechas) alert('Se asignaron ' + r.hechas + ' sede(s); la de ' + tarSede(r.falto) + ' falló: ' + (r.error.aviso || r.error.message)); return; }
    TAR.form = false; await tarCargar(); tarPintar();
    if (typeof csEnviarCola === 'function') csEnviarCola(true);   // el correo sale ya desde el servidor
    alert('✅ ' + r.data + ' tarea(s) asignada(s)' + (sedesIds.length > 1 ? ' en ' + sedesIds.length + ' sedes' : '') + '. A cada persona le llega un correo' + (sedesIds.length > 1 ? ' por sede' : '') + '.');
  } finally { TAR.ocupado = false; }
}
async function tarEstado(id, estado) {
  const t = TAR.lista.find((x) => x.id === id); if (!t) return;
  let comentario = null;
  if (estado === 'terminada') { comentario = prompt('✅ Terminar «' + t.titulo + '».\n\n¿Qué hiciste? (opcional; las fotos súbelas con «📎 Subir evidencia»)', ''); if (comentario === null) return; }
  if (estado === 'cancelada') { comentario = prompt('✖ ¿Por qué se cancela «' + t.titulo + '»?', ''); if (comentario === null) return; }
  const r = await SB.rpc('tarea_estado', { p_id: id, p_estado: estado, p_comentario: comentario, p_usuario: tarUsuario() });
  if (r.error) { alert('No se pudo: ' + r.error.message); return; }
  await tarCargar(); tarPintar();
}
async function tarComentar(id) {
  const c = prompt('💬 Comentario para la tarea:', ''); if (!c || !c.trim()) return;
  const r = await SB.rpc('tarea_evidencia', { p_id: id, p_archivo: null, p_nombre: null, p_comentario: c, p_usuario: tarUsuario() });
  if (r.error) { alert('No se pudo: ' + r.error.message); return; }
  await tarCargar(); tarPintar();
}
async function tarEditarFecha(id) {
  const t = TAR.lista.find((x) => x.id === id); if (!t) return;
  const fin0 = String(t.fecha_limite).slice(0, 10), bien = (x) => /^\d{4}-\d{2}-\d{2}$/.test(x);
  const i = prompt('🟢 Fecha de INICIO de «' + t.titulo + '» (AAAA-MM-DD):', Tareas.inicio(t) || fin0);
  if (!i) return;
  if (!bien(i.trim())) { alert('Escribe la fecha como AAAA-MM-DD (ej. 2026-10-20).'); return; }
  const v = prompt('🏁 Fecha en que DEBE TERMINARSE «' + t.titulo + '» (AAAA-MM-DD):', fin0 < i.trim() ? i.trim() : fin0);
  if (!v) return;
  if (!bien(v.trim())) { alert('Escribe la fecha como AAAA-MM-DD (ej. 2026-10-20).'); return; }
  if (i.trim() > v.trim()) { alert('La fecha de inicio no puede ser después de la fecha en que debe terminarse.'); return; }
  const rf = await SB.rpc('tarea_fechas', { p_id: id, p_inicio: i.trim(), p_fin: v.trim(), p_usuario: tarUsuario() });
  if (!rf.error) { await tarCargar(); tarPintar(); return; }
  if (!tarFaltaFuncion(rf.error, 'tarea_fechas')) { alert('No se pudo: ' + rf.error.message); return; }
  if (i.trim() !== v.trim()) { alert(TAR_AVISO_FECHAS); return; }   // base sin la funcion nueva: solo se puede cambiar el fin
  const r = await SB.rpc('tarea_editar', { p_id: id, p_tipo: t.tipo, p_titulo: t.titulo, p_descripcion: t.descripcion, p_sede: t.sede_id, p_fecha_limite: v.trim(), p_usuario: tarUsuario() });
  if (r.error) { alert('No se pudo: ' + r.error.message); return; }
  await tarCargar(); tarPintar();
}
async function tarSubir(id, input) {
  const files = [...((input && input.files) || [])]; if (!files.length) return;
  const comentario = prompt('📎 ' + files.length + ' archivo(s). Comentario para la evidencia (opcional):', '');
  if (comentario === null) { input.value = ''; return; }
  let ok = 0; const errores = [];
  for (const f of files) {
    if (f.size > 15 * 1024 * 1024) { errores.push(f.name + ': pesa más de 15 MB'); continue; }
    const ruta = Tareas.rutaEvidencia(id, f.name, Date.now() + ok);
    const up = await SB.storage.from('facturas').upload(ruta, f, { contentType: f.type || 'application/octet-stream', upsert: false });
    if (up.error) { errores.push(f.name + ': ' + up.error.message); continue; }
    const r = await SB.rpc('tarea_evidencia', { p_id: id, p_archivo: ruta, p_nombre: f.name, p_comentario: ok === 0 ? comentario : null, p_usuario: tarUsuario() });
    if (r.error) { errores.push(f.name + ': ' + r.error.message); try { await SB.storage.from('facturas').remove([ruta]); } catch (e) { /* queda suelto */ } continue; }
    ok++;
  }
  input.value = '';
  await tarCargar(); tarPintar();
  alert((ok ? '✅ ' + ok + ' evidencia(s) subida(s).' : '') + (errores.length ? '\n\n⚠️ No se pudieron subir:\n' + errores.join('\n') : ''));
}
async function tarVer(ruta) {
  const r = await SB.storage.from('facturas').createSignedUrl(ruta, 600);
  if (r.error || !r.data) { alert('No pude abrir la evidencia: ' + ((r.error && r.error.message) || '')); return; }
  window.open(r.data.signedUrl, '_blank');
}

// ============================================================
//  📋 PLANTILLAS: resumen + lista de actividades (18/10/2026, pedido del usuario)
// ============================================================
// Al elegir el tipo en «➕ Asignar tarea» o en «📦 Planear el mes» se cargan el resumen y las actividades de la plantilla
// (Tareas.PLANTILLAS en js/tareas.js). Se pueden editar antes de asignar; despues, el administrador las edita en cada tarea
// («📋 Editar resumen y actividades») sin tocar la plantilla. Quien tiene la tarea marca cada actividad como hecha.
// Base: supabase/tareas_plantillas.sql (tarea.actividades + tarea_asignar / tarea_actividad / tarea_actividades_editar).
const TAR_AVISO_PLANTILLAS = '⚠️ Falta activar las plantillas en la base (supabase/tareas_plantillas.sql). Avísale al administrador del sistema.';
const TAR_AVISO_FECHAS = '⚠️ Falta activar la fecha de inicio en la base (supabase/tareas_fechas.sql). Avísale al administrador del sistema.';
// si la fecha de inicio pasa a ser despues del fin, el fin se corre al mismo dia
function tarFechaIniCambio() { const i = $('tarFechaIni'), f = $('tarFecha'); if (!i || !f) return; f.min = i.value; if (f.value < i.value) f.value = i.value; }
function tarFaltaFuncion(err, nombre) { const m = (err && err.message) || ''; return m.includes(nombre) && /(find|exist|encontr|schema cache)/i.test(m); }

function tarPlantillaCamposHtml(idDesc, idActs, tipo) {
  const p = Tareas.plantilla(tipo);
  return `<div class="mut" style="margin-top:8px;font-size:12.5px">📋 Resumen</div>
    <textarea id="${idDesc}" rows="3" data-plantilla="${escAg(tipo)}" placeholder="Qué hay que hacer y qué evidencia subir (opcional)" style="margin-top:2px;width:100%">${escAg(p.resumen)}</textarea>
    <div class="mut" style="margin-top:6px;font-size:12.5px">✅ Actividades (una por línea; quien tenga la tarea las marca a medida que las haga)</div>
    <textarea id="${idActs}" rows="${Math.min(12, Math.max(3, p.actividades.length))}" placeholder="Escribe las actividades, una por línea (opcional)" style="margin-top:2px;width:100%">${escAg(p.actividades.join('\n'))}</textarea>`;
}
// cambia el tipo -> carga su plantilla (si ya habias cambiado el texto, pregunta antes de reemplazarlo)
function tarPlantillaCargar(idTipo, idDesc, idActs) {
  const sel = $(idTipo), d = $(idDesc), a = $(idActs); if (!sel || !d || !a) return;
  const antes = Tareas.plantilla(d.getAttribute('data-plantilla') || ''), nueva = Tareas.plantilla(sel.value);
  const tocado = (d.value.trim() && d.value.trim() !== antes.resumen) || (a.value.trim() && a.value.trim() !== antes.actividades.join('\n'));
  if (tocado && !confirm('Ya cambiaste el resumen o las actividades.\n\n¿Reemplazarlos por los de «' + (Tareas.TIPOS[sel.value] || sel.value) + '»?')) return;
  d.value = nueva.resumen; a.value = nueva.actividades.join('\n');
  a.rows = Math.min(12, Math.max(3, nueva.actividades.length));
  d.setAttribute('data-plantilla', sel.value);
}
// asigna con tarea_asignar; si la base todavia no la tiene y la tarea no usa nada nuevo, sigue como antes (tarea_crear / _varias)
async function tarAsignarRpc(a0, sinRespaldo) {
  // (19/10/2026) tipo nuevo «cierre de mes»: si la base aun no lo acepta (supabase/tareas_cierre_mes.sql sin aplicar), se guarda
  // como «Otra» con el mismo titulo, resumen y actividades, para que nunca falle
  if (a0.p_tipo === 'cierre_mes' && !sinRespaldo) {
    const rc = await tarAsignarRpc(a0, true);
    if (!rc.error || !/tipo_check|check constraint/i.test(rc.error.message || '')) return rc;
    return tarAsignarRpc(Object.assign({}, a0, { p_tipo: 'otra' }), true);
  }
  // (18/10/2026) con fecha de inicio: tarea_asignar_rango (supabase/tareas_fechas.sql); si la base aun no la tiene y la tarea es de un
  // solo dia, sigue como antes
  const r0 = await SB.rpc('tarea_asignar_rango', a0);
  if (!r0.error || !tarFaltaFuncion(r0.error, 'tarea_asignar_rango')) return r0;
  if ((a0.p_dias_antes || 0) > 0) return { data: null, error: { message: r0.error.message, aviso: TAR_AVISO_FECHAS } };
  const a = Object.assign({}, a0); delete a.p_dias_antes;
  const r = await SB.rpc('tarea_asignar', a);
  if (!r.error || !tarFaltaFuncion(r.error, 'tarea_asignar')) return r;
  const viejo = ['inventario', 'visita', 'capacitacion', 'otra'].includes(a.p_tipo) && !(a.p_actividades || []).length;
  if (!viejo) return { data: null, error: { message: r.error.message, aviso: TAR_AVISO_PLANTILLAS } };
  const base = { p_asignados: a.p_asignados, p_tipo: a.p_tipo, p_titulo: a.p_titulo, p_descripcion: a.p_descripcion, p_sede: a.p_sede, p_usuario: a.p_usuario };
  return a.p_fechas.length === 1 ? SB.rpc('tarea_crear', Object.assign(base, { p_fecha_limite: a.p_fechas[0] })) : SB.rpc('tarea_crear_varias', Object.assign(base, { p_fechas: a.p_fechas }));
}

// lista de verificacion de una tarea (abierta por defecto para quien la tiene; el administrador la abre cuando quiera)
function tarActividadesHtml(t, adm) {
  const l = Tareas.actividades(t); if (!l.length) return '';
  const av = Tareas.avance(t), pct = Math.round((av.hechas * 100) / av.total), puede = t.estado !== 'cancelada';
  if (!TAR.actsAbiertas) TAR.actsAbiertas = new Map();
  const abierta = TAR.actsAbiertas.has(t.id) ? TAR.actsAbiertas.get(t.id) : !adm && Tareas.abierta(t);
  const items = l.map((x, i) => `<label style="display:flex;gap:8px;align-items:flex-start;padding:3px 0;cursor:${puede ? 'pointer' : 'default'}">
      <input type="checkbox" style="width:auto;margin:3px 0 0;flex:none" ${x.h ? 'checked' : ''} ${puede ? '' : 'disabled'} onchange="tarActividad(${t.id},${i},this)">
      <span style="${x.h ? 'text-decoration:line-through;color:#64748b' : ''}">${escAg(x.t)}${x.h && (x.por || x.en) ? ` <span class="mut" style="font-size:11.5px;text-decoration:none;display:inline-block">· ${escAg(x.por || '')}${x.en ? ' ' + tarHora(x.en) : ''}</span>` : ''}</span></label>`).join('');
  return `<details id="tarActs${t.id}" ${abierta ? 'open' : ''} ontoggle="TAR.actsAbiertas.set(${t.id},this.open)" style="margin-top:8px;border:1px solid var(--line);border-radius:8px;padding:6px 10px">
      <summary style="cursor:pointer;font-weight:600;font-size:13.5px">✅ Actividades: ${av.hechas} de ${av.total}
        <span style="display:inline-block;vertical-align:middle;width:90px;height:7px;background:#e2e8f0;border-radius:4px;margin-left:6px;overflow:hidden"><span style="display:block;height:100%;width:${pct}%;background:${av.hechas === av.total ? '#15803d' : '#0891b2'}"></span></span></summary>
      <div style="font-size:13.5px;margin-top:4px">${items}</div>
    </details>`;
}
async function tarActividad(id, idx, el) {
  const t = TAR.lista.find((x) => x.id === id), l = Tareas.actividades(t); if (!t || !l[idx]) return;
  el.disabled = true;
  const r = await SB.rpc('tarea_actividad', { p_id: id, p_idx: idx, p_texto: l[idx].t, p_hecha: !!el.checked, p_usuario: tarUsuario() });
  if (r.error) {
    el.checked = !el.checked; el.disabled = false;
    alert(tarFaltaFuncion(r.error, 'tarea_actividad') ? TAR_AVISO_PLANTILLAS : 'No se pudo: ' + r.error.message);
    return;
  }
  t.actividades = r.data;
  const caja = $('tarActs' + id); if (caja) caja.outerHTML = tarActividadesHtml(t, tarEsAdmin());
}

// ---------- editar resumen y actividades de UNA tarea (solo administrador) ----------
function tarEditarAbrir(id) { TAR.editando = id; tarRefrescarCuerpo(); }
function tarEditarCerrar() { TAR.editando = null; tarRefrescarCuerpo(); }
function tarEditorHtml(t) {
  const p = Tareas.plantilla(t.tipo), conPlantilla = p.resumen || p.actividades.length;
  return `<div style="margin-top:8px;background:#f8fafc;border:1px solid var(--line);border-radius:8px;padding:8px 10px">
      <div class="mut" style="font-size:12.5px">📋 Resumen (solo de esta tarea; la plantilla no cambia)</div>
      <textarea id="tarEdDesc" rows="3" style="width:100%;margin-top:2px">${escAg(t.descripcion || '')}</textarea>
      <div class="mut" style="font-size:12.5px;margin-top:6px">✅ Actividades, una por línea (las que ya están marcadas siguen marcadas si no cambias su texto)</div>
      <textarea id="tarEdActs" rows="${Math.min(14, Math.max(4, Tareas.actividades(t).length + 1))}" style="width:100%;margin-top:2px">${escAg(Tareas.actividadesTexto(t.actividades))}</textarea>
      <div class="row" style="gap:6px;margin-top:6px;flex-wrap:wrap;align-items:center">
        <button class="p" onclick="tarEditarGuardar(${t.id})">💾 Guardar</button><button onclick="tarEditarCerrar()">Cancelar</button>
        ${conPlantilla ? `<button class="s" onclick="tarEditarPlantilla('${escAg(t.tipo)}')" title="Pone el texto de la plantilla en los cuadros (no guarda hasta que presiones Guardar)">↺ Poner la plantilla de ${escAg(Tareas.TIPOS[t.tipo] || t.tipo)}</button>` : ''}
        <span class="mut" id="tarEdRes"></span>
      </div>
    </div>`;
}
function tarEditarPlantilla(tipo) {
  const p = Tareas.plantilla(tipo), d = $('tarEdDesc'), a = $('tarEdActs'); if (!d || !a) return;
  if ((d.value.trim() || a.value.trim()) && !confirm('¿Reemplazar el texto de los cuadros por la plantilla? (no se guarda hasta que presiones «💾 Guardar»)')) return;
  d.value = p.resumen; a.value = p.actividades.join('\n');
}
async function tarEditarGuardar(id) {
  if (TAR.ocupado) return;
  const t = TAR.lista.find((x) => x.id === id); if (!t) return;
  const res = $('tarEdRes');
  TAR.ocupado = true;
  try {
    const acts = Tareas.actividadesDeTexto(($('tarEdActs') || {}).value, Tareas.actividades(t));
    const r = await SB.rpc('tarea_actividades_editar', { p_id: id, p_descripcion: ($('tarEdDesc') || {}).value || null, p_actividades: acts, p_usuario: tarUsuario() });
    if (r.error) { if (res) res.textContent = tarFaltaFuncion(r.error, 'tarea_actividades_editar') ? TAR_AVISO_PLANTILLAS : 'No se pudo: ' + r.error.message; return; }
    TAR.editando = null;
    await tarCargar(); tarPintar();
  } finally { TAR.ocupado = false; }
}
// el desplegable de sedes se cierra al hacer clic fuera de el
if (typeof document !== 'undefined') document.addEventListener('click', (e) => { document.querySelectorAll('details.tar-sedes[open]').forEach((d) => { if (!d.contains(e.target)) d.open = false; }); });
