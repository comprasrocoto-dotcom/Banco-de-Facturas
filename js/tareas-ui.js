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
function tarSede(id) { const s = (typeof sedes !== 'undefined' ? sedes : []).find((x) => Number(x.id) === Number(id)); return s ? s.nombre : ''; }

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
      <div style="font-weight:700;color:#155e75">📦 Planear el mes: marca los días en que va la tarea</div>
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
      <label>Tipo <select id="tarPlanTipo" style="width:auto;margin:0">${Object.entries(Tareas.TIPOS).map(([k, v]) => `<option value="${k}"${k === 'inventario' ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>Sede (opcional) <select id="tarPlanSede" style="width:auto;margin:0"><option value="">—</option>${(typeof sedes !== 'undefined' ? sedes : []).map((s) => `<option value="${s.id}">${escAg(s.nombre)}</option>`).join('')}</select></label>
    </div>
    <input id="tarPlanTitulo" placeholder="Título (ej. Inventario cíclico de bebidas)" style="margin-top:8px">
    <textarea id="tarPlanDesc" rows="3" placeholder="Qué hay que hacer y qué evidencia subir (opcional)" style="margin-top:6px;width:100%"></textarea>
    <div style="margin-top:8px"><button class="p" onclick="tarCrearVarias()">📦 Asignar en los días marcados</button> <span class="mut" id="tarPlanRes"></span></div>
  </div>`;
}
async function tarCrearVarias() {
  if (TAR.ocupado) return;
  const res = $('tarPlanRes'), msg = (t) => { if (res) res.textContent = t; };
  const quienes = [...document.querySelectorAll('#tareasRaiz input[data-tpq]')].filter((x) => x.checked).map((x) => x.getAttribute('data-tpq'));
  const fechas = [...TAR.sel].filter((f) => f >= tarHoy()).sort();
  const titulo = ($('tarPlanTitulo') || {}).value || '';
  if (!fechas.length) return msg('⚠️ Marca al menos un día en el calendario.');
  if (!quienes.length) return msg('⚠️ Elige a quién se le asigna.');
  if (!titulo.trim()) return msg('⚠️ Escribe el título.');
  if (fechas.length > 62) return msg('⚠️ Máximo 62 días por asignación.');
  const total = fechas.length * quienes.length;
  if (!confirm(`📦 Se van a crear ${total} tarea(s): ${fechas.length} día(s) × ${quienes.length} persona(s).\nA cada persona le llega un correo con sus fechas.\n\n¿Continuar?`)) return;
  TAR.ocupado = true; msg('Asignando…');
  try {
    const sede = ($('tarPlanSede') || {}).value;
    const r = await SB.rpc('tarea_crear_varias', { p_asignados: quienes, p_tipo: ($('tarPlanTipo') || {}).value || 'inventario', p_titulo: titulo,
      p_descripcion: ($('tarPlanDesc') || {}).value || null, p_sede: sede ? Number(sede) : null, p_fechas: fechas, p_usuario: tarUsuario() });
    if (r.error) {
      const falta = /tarea_crear_varias/.test(r.error.message || '') && /(find|exist|encontr|schema cache)/i.test(r.error.message || '');
      return msg(falta ? '⚠️ Falta activar el calendario en la base (supabase/tareas_calendario.sql). Avísale al administrador del sistema.' : 'No se pudo: ' + r.error.message);
    }
    TAR.plan = false; TAR.sel = new Set(); TAR.dia = fechas[0];
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
      <label>Tipo <select id="tarTipo" style="width:auto;margin:0">${Object.entries(Tareas.TIPOS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      <label>Sede (opcional) <select id="tarSedeSel" style="width:auto;margin:0"><option value="">—</option>${(typeof sedes !== 'undefined' ? sedes : []).map((s) => `<option value="${s.id}">${escAg(s.nombre)}</option>`).join('')}</select></label>
      <label>📅 Fecha de cumplimiento <input type="date" id="tarFecha" min="${hoy}" value="${hoy}" style="width:auto;margin:0"></label>
    </div>
    <input id="tarTitulo" placeholder="Título (ej. Inventario cíclico de bebidas en Provenza)" style="margin-top:8px">
    <textarea id="tarDesc" rows="3" placeholder="Qué hay que hacer y qué evidencia subir (opcional)" style="margin-top:6px;width:100%"></textarea>
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
    const fal = Tareas.faltan(t, hoy), ev = TAR.eventos.get(t.id) || [];
    const vence = t.estado === 'terminada' ? (Tareas.aTiempo(t) ? '<span class="badge st-sellada">✅ a tiempo</span>' : '<span class="badge" style="color:#991b1b;background:#fee2e2;border-color:#fca5a5">⏰ terminada tarde</span>')
      : t.estado === 'cancelada' ? '' : fal < 0 ? `<span class="badge" style="color:#991b1b;background:#fee2e2;border-color:#fca5a5;font-weight:700">⚠️ vencida hace ${-fal} día(s)</span>` : fal === 0 ? '<span class="badge" style="color:#92400e;background:#fffbeb;border-color:#fcd34d;font-weight:700">📅 vence HOY</span>' : `<span class="badge">📅 faltan ${fal} día(s)</span>`;
    const acciones = [];
    if (t.estado === 'pendiente') acciones.push(`<button class="s" onclick="tarEstado(${t.id},'en_proceso')">🔧 Empezar</button>`);
    if (Tareas.abierta(t)) acciones.push(`<button class="p" style="background:#15803d;border-color:#15803d" onclick="tarEstado(${t.id},'terminada')">✅ Terminar</button>`);
    if (t.estado === 'terminada' || (t.estado === 'cancelada' && adm)) acciones.push(`<button onclick="tarEstado(${t.id},'en_proceso')">↩ Reabrir</button>`);
    if (t.estado !== 'cancelada') acciones.push(`<button onclick="tarComentar(${t.id})">💬 Comentar</button>`);
    if (adm && t.estado !== 'cancelada') acciones.push(`<button onclick="tarEditarFecha(${t.id})">✏️ Cambiar fecha</button>`, `<button class="d" onclick="tarEstado(${t.id},'cancelada')">✖ Cancelar</button>`);
    return `<div class="card" style="margin-bottom:8px${Tareas.vencida(t, hoy) ? ';border-left:5px solid #b91c1c' : ''}">
      <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap">
        <div style="flex:1 1 260px"><b>${escAg((Tareas.TIPOS[t.tipo] || '📝').split(' ')[0])} ${escAg(t.titulo)}</b>
          <div class="mut" style="font-size:12.5px">${escAg(Tareas.TIPOS[t.tipo] || '')}${adm ? ' · 👤 ' + escAg(tarNombre(t.asignada_a)) : ''}${t.sede_id ? ' · 🏪 ' + escAg(tarSede(t.sede_id)) : ''} · vence ${tarFecha(t.fecha_limite)}${t.terminada_en ? ' · terminada ' + tarHora(t.terminada_en) : ''}</div></div>
        <span class="badge">${Tareas.ESTADOS[t.estado] || t.estado}</span>${vence}
      </div>
      ${t.descripcion ? `<div style="margin-top:6px;white-space:pre-wrap;font-size:13.5px">${escAg(t.descripcion)}</div>` : ''}
      ${ev.length ? `<div style="margin-top:8px;border-top:1px solid var(--line);padding-top:6px;display:grid;gap:3px;font-size:12.5px">${ev.map((e) => `<div><span class="mut">${tarHora(e.en)}${e.usuario_nombre ? ' · ' + escAg(e.usuario_nombre) : ''}:</span> ${e.estado ? '<b>' + escAg(Tareas.ESTADOS[e.estado] || e.estado) + '</b> ' : ''}${e.comentario ? escAg(e.comentario) + ' ' : ''}${e.archivo ? `<a href="#" onclick="tarVer('${escAg(e.archivo)}');return false">📎 ${escAg(e.archivo_nombre || 'evidencia')}</a>` : ''}</div>`).join('')}</div>` : ''}
      ${t.estado !== 'cancelada' ? `<div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap;align-items:center">
        <label class="s" style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;border:1px solid var(--line);border-radius:8px;padding:5px 10px">📎 Subir evidencia<input type="file" accept="image/*,application/pdf" multiple style="display:none" onchange="tarSubir(${t.id},this)"></label>
        ${acciones.join('')}</div>` : ''}
    </div>`;
}

const tarUsuario = () => (typeof perfil !== 'undefined' && perfil && perfil.nombre) || (typeof usuario !== 'undefined' && usuario && usuario.email) || null;
async function tarCrear() {
  if (TAR.ocupado) return;
  const quienes = [...document.querySelectorAll('#tareasRaiz input[data-tq]')].filter((x) => x.checked).map((x) => x.getAttribute('data-tq'));
  const titulo = ($('tarTitulo') || {}).value || '', fecha = ($('tarFecha') || {}).value || '';
  const res = $('tarFormRes');
  if (!quienes.length) { if (res) res.textContent = '⚠️ Elige a quién se le asigna.'; return; }
  if (!titulo.trim()) { if (res) res.textContent = '⚠️ Escribe el título.'; return; }
  if (!fecha) { if (res) res.textContent = '⚠️ Elige la fecha de cumplimiento.'; return; }
  TAR.ocupado = true;
  try {
    const sede = ($('tarSedeSel') || {}).value;
    const r = await SB.rpc('tarea_crear', { p_asignados: quienes, p_tipo: ($('tarTipo') || {}).value || 'otra', p_titulo: titulo, p_descripcion: ($('tarDesc') || {}).value || null,
      p_sede: sede ? Number(sede) : null, p_fecha_limite: fecha, p_usuario: tarUsuario() });
    if (r.error) { if (res) res.textContent = 'No se pudo: ' + r.error.message; return; }
    TAR.form = false; await tarCargar(); tarPintar();
    if (typeof csEnviarCola === 'function') csEnviarCola(true);   // el correo sale ya desde el servidor
    alert('✅ Tarea asignada a ' + r.data + ' persona(s). A cada una le llega un correo.');
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
  const v = prompt('📅 Nueva fecha de cumplimiento para «' + t.titulo + '» (AAAA-MM-DD):', String(t.fecha_limite).slice(0, 10));
  if (!v) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) { alert('Escribe la fecha como AAAA-MM-DD (ej. 2026-10-20).'); return; }
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
