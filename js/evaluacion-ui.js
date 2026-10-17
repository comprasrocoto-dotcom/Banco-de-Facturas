// ============================================================
//  evaluacion-ui.js  -  modulo «📈 Evaluacion» (solo administradores) + aviso de alertas en Facturas (16/10/2026; v2 el mismo dia)
// ============================================================
// Pestañas: 👤 Analistas (cada punto sobre 100 por separado y su promedio; v3) y 🏪 Sedes (que el punto haga lo suyo). Arriba, el % de ingresos
// hechos a mano porque el agente no pudo. Configuracion: responsables por sede, pesos en % (suman 100) y metas (hora de corte,
// hora de la mañana siguiente, maximo de «Sin asignar»). Las alertas las genera la base al cargar la web (evaluacion_alertas_generar):
// una vez al dia habil manda el correo a cada responsable con copia a compras. Calculo en js/evaluacion.js.
// Todos los nombres globales empiezan por ev / EV_ (no chocar con otros archivos).
var EV = { datos: null, res: [], sedesRes: [], kpi: null, periodo: '30', desde: null, hasta: null, abierto: null, config: false, tab: 'analistas' };
var EV_ALERTAS = null, EV_ALERTAS_T = 0;

function evPuedeVer() { return typeof perfil !== 'undefined' && perfil && perfil.rol === 'admin'; }
function evRolAnalista() { return typeof perfil !== 'undefined' && perfil && (perfil.rol === 'admin' || perfil.rol === 'pagos'); }
function evFecha(d) { return d ? d.slice(8, 10) + '/' + d.slice(5, 7) : ''; }
function evColor(n) { const v = Evaluacion.nivel(n); return v === 'bien' ? '#15803d' : v === 'medio' ? '#b45309' : v === 'mal' ? '#b91c1c' : '#64748b'; }
function evHora(h) { h = Number(h); return (h % 12 || 12) + ':00 ' + (h < 12 ? 'a. m.' : h === 12 ? 'm.' : 'p. m.'); }
function evMetas() { const c = (EV.datos && EV.datos.config) || {}; return { horaCorte: c.hora_corte || 17, horaManana: c.hora_manana || 12, maxSinAsignar: c.max_sin_asignar != null ? c.max_sin_asignar : 5 }; }
function evNombrePersona(uid) { const p = (((EV.datos || {}).perfiles) || []).find((x) => x.user_id === uid); return p ? p.nombre : 'otra persona'; }

// ---------------------------------------------------------------- alertas (Facturas)
async function evAlertasCargar(forzar) {
  if (!evRolAnalista() || typeof SB === 'undefined') return;
  if (!forzar && EV_ALERTAS && Date.now() - EV_ALERTAS_T < 15 * 60000) { evPintarAviso(); return; }
  try {
    const r = await SB.rpc('evaluacion_alertas_generar');
    if (r.error) return;   // base sin la funcion: no se muestra nada
    EV_ALERTAS = r.data || null; EV_ALERTAS_T = Date.now();
    if (typeof csEnviarCola === 'function') csEnviarCola(true);   // si se encolo el correo de alertas, que salga ya
  } catch (e) { return; }
  evPintarAviso();
}
function evMisAlertas() {
  const l = (EV_ALERTAS && EV_ALERTAS.alertas) || [];
  if (evPuedeVer()) return l;
  const yo = (typeof usuario !== 'undefined' && usuario && usuario.id) || null;
  return l.filter((a) => a.user_id === yo);
}
function evTextoAlerta(a) {
  const meta = EV_ALERTAS && EV_ALERTAS.meta_hoy != null ? EV_ALERTAS.meta_hoy : 5;
  return a.tipo === 'por_enviar'
    ? `📤 ${escAg(a.nombre)}: <b>${a.cantidad}</b> procesado(s) sin enviar a contabilidad${a.desde ? ' (listos desde el ' + escAg(Evaluacion.horaCO(Date.parse(a.desde))) + ')' : ''}`
    : `🗂️ ${escAg(a.nombre)}: <b>${a.cantidad}</b> en «Sin asignar» (meta de hoy: máximo ${meta})`;
}
function evReglaTexto() {
  const a = EV_ALERTAS || {}, m = EV.datos ? evMetas() : { horaCorte: a.hora_corte || 17, horaManana: a.hora_manana || 12, maxSinAsignar: a.max_sin_asignar != null ? a.max_sin_asignar : 5 };
  return `Lo que el agente deja listo antes de las ${evHora(m.horaCorte)} se envía ese mismo día; lo que queda después, el siguiente día hábil antes de las ${evHora(m.horaManana)} «Sin asignar»: máximo ${m.maxSinAsignar} por marca y en 0 el primer día hábil del mes.`;
}
function evPintarAviso() {
  const caja = $('avisoEval'); if (!caja) return;
  const l = evMisAlertas();
  if (!l.length) { caja.innerHTML = ''; return; }
  const porPersona = new Map();
  l.forEach((a) => { if (!porPersona.has(a.persona)) porPersona.set(a.persona, []); porPersona.get(a.persona).push(a); });
  caja.innerHTML = `<div class="card" style="border-left:5px solid #b91c1c;background:#fef2f2;margin-bottom:12px">
    <div class="row" style="gap:10px;align-items:flex-start"><div style="flex:1 1 320px">
      <div style="font-weight:700;color:#991b1b">🚨 Pendientes de hoy</div>
      ${[...porPersona.entries()].map(([p, as]) => `<div style="margin-top:4px">${evPuedeVer() ? '<b>' + escAg(p || '') + ':</b> ' : ''}${as.map(evTextoAlerta).join(' · ')}</div>`).join('')}
      <div class="mut" style="margin-top:4px">⏰ ${escAg(evReglaTexto())} A cada responsable le llega un correo al día con esto (copia a compras).</div></div>
      ${evPuedeVer() ? '<button class="s" onclick="setModulo(\'eval\')">📈 Ver evaluación</button>' : ''}</div></div>`;
}

// ---------------------------------------------------------------- modulo
async function evAbrir() { if (!EV.datos) await evCargar(); else evPintar(); }
async function evCargar() {
  const raiz = $('evalRaiz'); if (!raiz) return;
  if (!evPuedeVer()) { raiz.innerHTML = '<div class="vacio">Solo un administrador ve la evaluación.</div>'; return; }
  const hoy = BancoUtils.hoyColombia();
  if (EV.periodo !== 'libre') { const p = Evaluacion.periodo(EV.periodo, hoy); EV.desde = p.desde; EV.hasta = p.hasta; }
  raiz.innerHTML = '<div class="mut" style="padding:20px">Cargando evaluación…</div>';
  const r = await SB.rpc('evaluacion_datos', { p_desde: EV.desde, p_hasta: EV.hasta });
  if (r.error) { raiz.innerHTML = '<div class="vacio">No pude cargar la evaluación: ' + escAg(r.error.message) + '</div>'; return; }
  EV.datos = r.data || {};
  try { const t = await SB.from('tarea').select('asignada_a,titulo,tipo,fecha_limite,estado,terminada_en,sede_id').limit(5000); EV.datos.tareas = (t && t.data) || []; } catch (e) { EV.datos.tareas = []; }   // (16/10/2026) tareas asignadas
  const cfg = EV.datos.config || {};
  const o = { desde: EV.desde, hasta: EV.hasta, hoy, ahora: Date.now(), pesos: cfg.pesos, metas: evMetas() };
  EV.res = Evaluacion.calcular(EV.datos, o);
  EV.sedesRes = Evaluacion.calcularSedes(EV.datos, o);
  EV.kpi = Evaluacion.ingresosAMano(EV.datos, o);
  if (!EV_ALERTAS) await evAlertasCargar(true);
  evPintar();
  if (EV.tab === 'proveedores' && typeof evProvAbrir === 'function') evProvAbrir();   // otro periodo: se recargan sus datos
}
function evPeriodo(p) { EV.periodo = p; EV.abierto = null; evCargar(); }
function evRango() {
  const d = ($('evDesde') || {}).value, h = ($('evHasta') || {}).value;
  if (!d || !h || d > h) { alert('Elige un rango válido (desde ≤ hasta).'); return; }
  EV.periodo = 'libre'; EV.desde = d; EV.hasta = h; evCargar();
}
function evToggle(uid) { EV.abierto = EV.abierto === uid ? null : uid; evPintar(); }
function evToggleConfig() { EV.config = !EV.config; evPintar(); }
function evTab(t) { EV.tab = t; EV.abierto = null; evPintar(); if (t === 'proveedores' && typeof evProvAbrir === 'function') evProvAbrir(); }

function evNombreSede(id) {
  const D = EV.datos || {}, s = (D.sedes || []).find((x) => Number(x.id) === Number(id));
  if (!s) return id == null ? 'Sin sede' : '#' + id;
  const repetido = (D.sedes || []).filter((x) => x.nombre === s.nombre).length > 1;
  const m = (D.marcas || []).find((x) => Number(x.id) === Number(s.marca_id));
  return s.nombre + (repetido && m ? ' (' + m.nombre + ')' : '');
}
function evNombreMarca(id) { const m = (((EV.datos || {}).marcas) || []).find((x) => Number(x.id) === Number(id)); return m ? m.nombre : '#' + id; }

function evPintar() {
  const raiz = $('evalRaiz'); if (!raiz) return;
  const D = EV.datos || {}, cfg = D.config || {}, pesos = Object.assign({}, Evaluacion.PESOS, cfg.pesos || {});
  const hoy = BancoUtils.hoyColombia();
  const habiles = Evaluacion.habilesEntre(EV.desde, EV.hasta > hoy ? hoy : EV.hasta).length;
  const fest = [];
  for (let y = Number(EV.desde.slice(0, 4)); y <= Number(EV.hasta.slice(0, 4)); y++) Evaluacion.festivosColombia(y).forEach((f) => { if (f.fecha >= EV.desde && f.fecha <= EV.hasta) fest.push(evFecha(f.fecha) + ' ' + f.nombre); });
  const chip = (p, t) => `<button class="chip${EV.periodo === p ? ' on' : ''}" onclick="evPeriodo('${p}')">${t}</button>`;
  const tab = (t, txt) => `<button class="chip${EV.tab === t ? ' on' : ''}" onclick="evTab('${t}')">${txt}</button>`;
  const alertas = evMisAlertas();
  const k = EV.kpi || { total: 0, aMano: 0, pct: 0, porSede: [] };
  raiz.innerHTML = `
    <div class="card" style="margin-bottom:12px">
      <div class="row" style="gap:8px;flex-wrap:wrap;align-items:center">
        <b style="font-size:16px">📈 Evaluación</b><span class="sp"></span>
        ${chip('semana', 'Esta semana')}${chip('mes', 'Este mes')}${chip('30', 'Últimos 30 días')}
        <input type="date" id="evDesde" value="${EV.desde}" style="width:auto;margin:0"> → <input type="date" id="evHasta" value="${EV.hasta}" style="width:auto;margin:0">
        <button class="s" onclick="evRango()">Ver</button>
        <button onclick="evToggleConfig()">⚙️ Responsables y metas</button>
      </div>
      <div class="mut" style="margin-top:6px">Del ${evFecha(EV.desde)} al ${evFecha(EV.hasta)} · ${habiles} días hábiles${fest.length ? ' · festivos: ' + escAg(fest.join(', ')) : ''}.
        ⏰ ${escAg(evReglaTexto())}</div>
      <div class="mut" style="margin-top:4px">📏 Cada punto se califica <b>sobre 100 por separado</b>; la calificación general es el <b>promedio</b> de los puntos que tienen datos («Sin datos» no cuenta).
        El envío solo cuenta lo enviado con «📤 Por enviar a contabilidad» (se mide desde el 16/10/2026).</div>
    </div>
    ${EV.config ? evConfigHtml() : ''}
    <div class="card" style="margin-bottom:12px;border-left:5px solid #7c3aed">
      <div class="row" style="gap:10px;align-items:center;flex-wrap:wrap">
        <div style="flex:1 1 280px"><div style="font-weight:700">🤖 Ingresos hechos a mano (el agente no pudo)</div>
          <div class="mut">${k.aMano} de ${k.total} factura(s) ingresadas en el período: el N° de ingreso lo escribió una persona y no el agente.</div></div>
        <div style="font-size:28px;font-weight:800;color:${k.pct <= 10 ? '#15803d' : k.pct <= 25 ? '#b45309' : '#b91c1c'}">${k.pct}%</div>
      </div>
      ${k.porSede.length ? '<div class="mut" style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px 14px">' + k.porSede.slice(0, 14).map((x) => `<span>${escAg(evNombreSede(x.sede_id))}: <b>${x.pct}%</b> (${x.aMano}/${x.total})</span>`).join('') + '</div>' : ''}
    </div>
    ${alertas.length ? `<div class="card" style="border-left:5px solid #b91c1c;margin-bottom:12px"><div style="font-weight:700;color:#991b1b">🚨 Pendientes de hoy</div>${alertas.map((a) => `<div style="margin-top:3px"><b>${escAg(a.persona || '')}</b> · ${evTextoAlerta(a)}</div>`).join('')}</div>` : '<div class="card" style="border-left:5px solid #15803d;margin-bottom:12px">✅ Hoy no hay pendientes fuera de la meta.</div>'}
    <div class="row" style="gap:6px;margin-bottom:10px">${tab('analistas', '👤 Analistas y auxiliares')}${tab('sedes', '🏪 Sedes (puntos)')}${typeof evProvHtml === 'function' ? tab('proveedores', '🚚 Proveedores') : ''}</div>
    ${EV.tab === 'proveedores' && typeof evProvHtml === 'function' ? evProvHtml() : EV.tab === 'sedes' ? evSedesHtml() : (EV.res.length ? EV.res.map((r) => evTarjeta(r)).join('') : '<div class="vacio">No hay administradores ni analistas activos.</div>')}`;
}

// un punto: su % sobre 100 (o «Sin datos»), de cuantos, y la explicacion al pasar el mouse
function evCuadro(k, p, ayuda, nombre) {
  const sin = p.pct == null, col = sin ? '#64748b' : evColor(p.pct);
  const pie = sin ? 'no hubo movimiento' : (k === 'sedes' ? 'promedio de ' + p.sedes + ' sede(s)' : p.ok + ' de ' + p.total + (p.total < 5 ? ' · pocos datos' : ''));
  return `<div title="${escAg(ayuda || '')}" style="flex:1 1 150px;min-width:140px;border:1px solid var(--line);border-radius:10px;padding:8px 10px;background:${sin ? '#f8fafc' : '#fff'}">
    <div style="font-size:12px;line-height:1.3">${nombre || Evaluacion.NOMBRES[k]}</div>
    <div style="font-size:22px;font-weight:800;color:${col};margin-top:2px">${sin ? 'Sin datos' : p.pct + '%'}</div>
    <div class="mut" style="font-size:11px">${pie}</div>
    ${sin ? '' : `<div style="height:6px;background:#e5e7eb;border-radius:6px;overflow:hidden;margin-top:4px"><div style="height:100%;width:${p.pct}%;background:${col}"></div></div>`}</div>`;
}

function evTarjeta(r) {
  const d = r.detalle, v = r.volumen, sedes = r.sedes.map(evNombreSede), m = evMetas();
  const n = r.puntaje;
  const ayuda = {
    cumplimiento: 'De lo procesado en sus sedes que YA debía estar enviado a contabilidad (venció el plazo o ya se envió), cuánto se envió. Lo que aún está en plazo no cuenta.',
    puntualidad: `De lo enviado, cuánto salió dentro del plazo: listo antes de las ${evHora(m.horaCorte)} → ese día; listo después → siguiente día hábil antes de las ${evHora(m.horaManana)}`,
    sinAsignar: `Días hábiles en que «Sin asignar» de sus marcas tuvo máximo ${m.maxSinAsignar} facturas (y 0 el primer día hábil del mes).`,
    ingresos: 'Ingresos de sus sedes que el agente terminó solo. Si el agente avisó pero lo logró en otro intento, NO cuenta como novedad; solo cuenta cuando lo tuvo que ingresar una persona.',
    sedes: 'Promedio de sus sedes en lo que le toca al punto: 📋 montar los pedidos y ✅ aceptar (asignarse y sellar) sus facturas. El analista responde por hacerle seguimiento.',
    proceso: 'El analista NO debe crear pedidos, amarrar facturas ni asignarles sede: eso es del punto. Mide qué parte de eso hizo el punto y no esta persona.',
    tareas: 'De las tareas asignadas que vencían en el período (inventarios, visitas, capacitaciones…), cuántas terminó a más tardar en su fecha de cumplimiento.',
    correcciones: 'Desamarres, sellos quitados y borrados que hizo a mano, frente a los ingresos de sus sedes. (Escribir el N° de ingreso a mano NO resta: es trabajo extra por fallas del agente).',
  };
  const vol = [
    `📤 Envió <b>${v.enviados}</b> documento(s) a contabilidad`,
    `🧾 ${v.ingresos} ingreso(s) en sus sedes`,
    `⌨️ Escribió a mano ${v.ingresosAMano} N° de ingreso (el agente no pudo)`,
    `🚀 ${v.ordenes} orden(es) de ingreso lanzadas`,
    `⏳ Por enviar ahora: ${v.pendientes}${d.envio.vencidos.length ? ` (<span style="color:#b91c1c">${d.envio.vencidos.length} vencidos</span>)` : ''}`,
  ];
  return `<div class="card" style="margin-bottom:10px">
    <div class="row" style="gap:10px;align-items:center;flex-wrap:wrap">
      <div style="flex:1 1 260px"><div style="font-weight:700;font-size:15px">${escAg(r.nombre || '')} <span class="badge">${r.rol === 'pagos' ? 'Analista' : 'Administrador'}</span></div>
        <div class="mut">${sedes.length ? '📍 ' + escAg(sedes.join(', ')) : '<span style="color:#b45309">Sin sedes a cargo: asígnalas en ⚙️ para calificarlo.</span>'}</div></div>
      <div style="text-align:center;min-width:96px"><div style="font-size:30px;font-weight:800;color:${evColor(n)}">${n == null ? '—' : n + '%'}</div><div class="mut" style="font-size:11px">promedio</div></div>
    </div>
    ${n != null && r.pocoMovimiento ? `<div style="margin-top:6px;padding:6px 10px;border-radius:8px;background:#fffbeb;border:1px solid #fcd34d;color:#92400e;font-size:12.5px">⚠️ Poco movimiento en sus sedes (solo ${r.observaciones} cosas medidas): esta calificación es poco confiable y va al final de la lista.</div>` : ''}
    ${r.sedes.length ? `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">${Evaluacion.PUNTOS.map((k) => evCuadro(k, r.puntos[k], ayuda[k])).join('')}</div>` : ''}
    ${(r.sedesEval || []).length ? `<div style="margin-top:10px"><b style="font-size:13px">🏪 Sus sedes (lo que le toca al punto; el analista les hace seguimiento)</b>
      <div style="display:grid;gap:6px;margin-top:6px">${r.sedesEval.map(evSedeFila).join('')}</div></div>` : ''}
    <div class="mut" style="margin-top:8px;display:flex;gap:4px 14px;flex-wrap:wrap">${vol.map((x) => '<span>' + x + '</span>').join('')}</div>
    <div style="margin-top:6px"><button onclick="evToggle('${r.user_id}')">${EV.abierto === r.user_id ? 'Ocultar detalle' : 'Ver detalle'}</button></div>
    ${EV.abierto === r.user_id ? evDetalle(r) : ''}
  </div>`;
}

function evDetalle(r) {
  const d = r.detalle;
  const fila = (x, extra) => `<tr style="border-bottom:1px solid var(--line)"><td>${escAg(x.doc || '')}</td><td>${escAg(x.emisor || '')}</td><td>listo ${escAg(x.listo)}</td><td>límite ${escAg(x.limite)}</td><td style="text-align:right">${extra || ''}</td></tr>`;
  const tabla = (l, extra, vacio) => (l.length ? '<div style="overflow-x:auto"><table style="width:100%;font-size:12.5px;border-collapse:collapse">' + l.slice(0, 60).map((x) => fila(x, extra(x))).join('') + '</table></div>' + (l.length > 60 ? `<div class="mut">…y ${l.length - 60} más</div>` : '') : `<div class="mut">${vacio}</div>`);
  const hoy = BancoUtils.hoyColombia();
  const dh = Evaluacion.habilesEntre(EV.desde, EV.hasta > hoy ? hoy : EV.hasta);
  const max = Math.max(1, ...dh.map((x) => d.envio.porDia[x] || 0));
  const barras = dh.map((x) => { const v = d.envio.porDia[x] || 0; return `<div title="${evFecha(x)}: ${v} documento(s)" style="flex:1 1 0;min-width:6px;display:flex;flex-direction:column;justify-content:flex-end;height:60px"><div style="height:${Math.round((v / max) * 56) + (v ? 4 : 0)}px;background:${v ? '#1e3a8a' : '#e5e7eb'};border-radius:3px 3px 0 0;min-height:2px"></div></div>`; }).join('');
  const porAccion = Object.entries(d.correcciones.porAccion);
  const yp = d.proceso.yoPor;
  return `<div style="margin-top:10px;border-top:1px solid var(--line);padding-top:10px;display:grid;gap:12px">
    <div><b>📤 Envíos a contabilidad por día hábil</b> <span class="mut">(${d.envio.enviados} enviado(s): ${d.envio.aTiempo} a tiempo y ${d.envio.tarde.length} tarde · ${d.envio.vencidos.length} vencido(s) sin enviar · ${d.envio.enPlazo} aún en plazo)</span>
      <div style="display:flex;gap:2px;align-items:flex-end;margin-top:6px">${barras || '<span class="mut">Sin días hábiles en el período.</span>'}</div>
      <div class="row mut" style="font-size:11px"><span>${evFecha(dh[0])}</span><span class="sp"></span><span>${evFecha(dh[dh.length - 1])}</span></div></div>
    <div><b>⏳ Por enviar ahora</b>${tabla(d.envio.pendientes, (x) => (x.vencido ? '<b style="color:#b91c1c">VENCIDO</b>' : '<span class="mut">en plazo</span>'), 'Nada pendiente.')}</div>
    ${d.envio.tarde.length ? `<div><b>🐢 Enviados tarde</b>${tabla(d.envio.tarde, (x) => 'enviado ' + escAg(x.enviado), '')}</div>` : ''}
    <div><b>🗂️ «Sin asignar» de sus marcas</b><div class="mut">Hoy: ${d.sinAsignar.marcasHoy.map((x) => escAg(evNombreMarca(x.marca_id)) + ' ' + x.pool).join(' · ') || '—'} (meta de hoy: máximo ${d.sinAsignar.metaHoy}).
      ${d.sinAsignar.diasMedidos ? 'En meta ' + d.sinAsignar.diasEnMeta + ' de ' + d.sinAsignar.diasMedidos + ' días hábiles medidos.' : 'Aún no hay días medidos: se califica con lo de hoy.'}
      ${d.sinAsignar.diasMal.length ? ' Fuera de la meta: ' + d.sinAsignar.diasMal.slice(-10).map((x) => evFecha(x.dia) + ' (' + x.pool + '/' + x.meta + ')').join(', ') + '.' : ''}</div></div>
    <div><b>🧾 Ingresos de sus sedes</b><div class="mut">${d.ingresos.total} ingreso(s) · ${d.ingresos.conNovedad} con novedad que tuvo que resolver una persona · ${d.ingresos.resueltasAgente} con aviso que el agente resolvió solo en otro intento · ${d.ingresos.aMano} hechos a mano · ${d.ingresos.conPedido} de ${d.ingresos.facturas} factura(s) con pedido del punto.</div>
      ${Object.keys(d.ingresos.motivos || {}).length ? '<div class="mut" style="margin-top:3px">Novedades por motivo: ' + Object.entries(d.ingresos.motivos).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([mo, nn]) => escAg(mo) + ' (' + nn + ')').join(' · ') + '</div>' : ''}</div>
    ${(d.tareas && d.tareas.total) ? `<div><b>📝 Tareas asignadas</b><div class="mut">${d.tareas.aTiempo} de ${d.tareas.total} a tiempo${d.tareas.tarde.length ? ' · terminadas tarde: ' + d.tareas.tarde.map((x) => escAg(x.titulo) + ' (vencía ' + evFecha(x.fecha) + ')').join(', ') : ''}${d.tareas.vencidas.length ? ' · <span style="color:#b91c1c">vencidas sin terminar: ' + d.tareas.vencidas.map((x) => escAg(x.titulo) + ' (' + evFecha(x.fecha) + ')').join(', ') + '</span>' : ''}</div></div>` : ''}
    <div><b>✋ Correcciones a mano de esta persona</b><div class="mut">${porAccion.length ? porAccion.map(([a, nn]) => escAg(a) + ': ' + nn).join(' · ') : 'Ninguna en el período.'}</div></div>
    <div><b>🚫 Lo que le toca al punto y lo hizo esta persona</b><div class="mut">Creó ${yp.creados} pedido(s) · amarró ${yp.amarres} factura(s) · asignó sede a ${yp.asignaciones} factura(s). En sus sedes, el punto hizo ${d.proceso.delPunto} de ${d.proceso.eventos}.</div></div>
  </div>`;
}

// ---------------------------------------------------------------- sedes
const EV_AYUDA_SEDE = {
  pedidos: 'De las facturas ingresadas de la sede, cuántas llegaron con un pedido que MONTÓ EL PUNTO en la web (sin pedido, o con pedido montado por un analista, no cuenta).',
  aceptacion: 'De las facturas asignadas a la sede, cuántas se asignó («Es mía») y SELLÓ el propio punto. Las que llevan más de 1 día hábil sin sellar cuentan en contra.',
};
// una sede: sus dos puntos de 1 a 100% y que falto (lo usan la tarjeta del analista y la pestaña Sedes)
function evSedeFila(s) {
  const d = s.detalle || {};
  const quien = (o) => Object.entries(o || {}).sort((a, b) => b[1] - a[1]).map(([n, k]) => escAg(n) + ' (' + k + ')').join(' · ');
  const faltas = [
    d.sinPedido ? `${d.sinPedido} factura(s) llegaron SIN pedido del punto` : '',
    Object.keys(d.pedAnalista || {}).length ? 'pedidos montados por analistas: ' + quien(d.pedAnalista) : '',
    d.sinSellar ? `<b style="color:#b91c1c">${d.sinSellar} asignada(s) sin sellar hace más de 1 día hábil</b>` : '',
    Object.keys(d.aceptoOtro || {}).length ? 'aceptadas por analistas: ' + quien(d.aceptoOtro) : '',
  ].filter(Boolean);
  return `<div style="border:1px solid var(--line);border-radius:10px;padding:8px 10px">
    <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap"><b>🏪 ${escAg(evNombreSede(s.sede_id))}</b><span class="mut">${escAg(evNombreMarca(s.marca_id))}</span><span class="sp"></span>
      <b style="font-size:18px;color:${evColor(s.puntaje)}">${s.puntaje}%</b></div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px">${Evaluacion.PUNTOS_SEDE.map((k) => evCuadro(k, s.puntos[k], EV_AYUDA_SEDE[k], Evaluacion.NOMBRES_SEDE[k])).join('')}</div>
    ${faltas.length ? '<div class="mut" style="margin-top:4px;font-size:12.5px">' + faltas.join(' · ') + '</div>' : ''}</div>`;
}
function evSedesHtml() {
  const l = EV.sedesRes || [];
  if (!l.length) return '<div class="vacio">No hubo movimiento de las sedes en el período.</div>';
  const resp = new Map();
  (((EV.datos || {}).responsables) || []).forEach((x) => { const n = evNombrePersona(x.user_id); if (!resp.has(Number(x.sede_id))) resp.set(Number(x.sede_id), []); resp.get(Number(x.sede_id)).push(n); });
  return `<div class="mut" style="margin-bottom:8px">Cada sede se califica en sus dos responsabilidades, cada una de 1 a 100%: <b>📋 montar los pedidos</b> y <b>✅ aceptar sus facturas</b> (asignárselas y sellarlas). La calificación de la sede es el promedio de las dos.</div>` +
    (typeof evInfTodas === 'function' ? '<div style="margin-bottom:10px"><button class="p" id="btnInfTodas" onclick="evInfTodas()">⬇ Informes de todas las sedes (ZIP)</button> <span class="mut">un PDF por sede, para enviarle a cada una su cumplimiento</span></div>' : '') +
    l.map((s) => `<div style="margin-bottom:8px">${evSedeFila(s)}<div class="row mut" style="font-size:12px;margin:3px 4px 0;gap:8px;align-items:center">${resp.has(s.sede_id) ? '<span>👤 Seguimiento: ' + escAg(resp.get(s.sede_id).join(', ')) + '</span>' : ''}<span class="sp"></span>${typeof evInfSede === 'function' ? '<button class="s" style="padding:3px 10px" onclick="evInfSede(' + s.sede_id + ')">⬇ Informe PDF</button>' : ''}</div></div>`).join('');
}

// ---------------------------------------------------------------- configuracion (metas y responsables; v3: sin pesos, cada punto va sobre 100)
function evConfigHtml() {
  const D = EV.datos || {}, m = evMetas();
  const personas = (D.perfiles || []).filter((p) => p.activo !== false && (p.rol === 'admin' || p.rol === 'pagos')).sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
  const marcas = (D.marcas || []).slice().sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
  const resp = new Set((D.responsables || []).map((x) => x.user_id + '|' + x.sede_id));
  const filas = personas.map((p) => `<div style="padding:8px 0;border-bottom:1px solid var(--line)">
      <div class="row" style="gap:8px"><b>${escAg(p.nombre || '')}</b><span class="mut">${p.rol === 'pagos' ? 'Analista' : 'Administrador'}</span><span class="sp"></span><button class="s" onclick="evGuardarResp('${p.user_id}')">Guardar</button></div>
      <div style="display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:4px">${marcas.map((mm) => {
        const ss = (D.sedes || []).filter((s) => Number(s.marca_id) === Number(mm.id)).sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
        return ss.length ? `<span><span class="mut">${escAg(mm.nombre)}:</span> ${ss.map((s) => `<label style="display:inline-flex;align-items:center;gap:4px;white-space:nowrap;margin-right:8px"><input type="checkbox" data-u="${p.user_id}" data-s="${s.id}"${resp.has(p.user_id + '|' + s.id) ? ' checked' : ''} style="width:auto;margin:0">${escAg(s.nombre)}</label>`).join('')}</span>` : '';
      }).join('')}</div></div>`).join('');
  const num = (id, v, min, max, txt) => `<label style="white-space:nowrap">${txt} <input type="number" min="${min}" max="${max}" id="${id}" value="${v}" style="width:70px;margin:0"></label>`;
  return `<div class="card" style="margin-bottom:12px;border-left:5px solid #1e3a8a">
    <div style="font-weight:700">🎯 Metas</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px 16px;margin-top:6px">
      ${num('evCorte', m.horaCorte, 6, 23, '⏰ Hora de corte del envío (0-23)')}${num('evManana', m.horaManana, 6, 23, '🌅 Al día siguiente, hasta las (0-23)')}${num('evMaxSA', m.maxSinAsignar, 0, 500, '🗂️ Máximo en «Sin asignar» por marca')}${num('evDiasProv', (D.config || {}).dias_entrega_prov != null ? D.config.dias_entrega_prov : 2, 0, 30, '🚚 Proveedores: entrega en máximo (días)')}${num('evAlzaProv', (D.config || {}).alza_pct != null ? Number(D.config.alza_pct) : 5, 0, 100, '📈 Proveedores: alza de precio de más de (%)')}</div>
    <div class="mut" style="margin-top:4px">Ej.: corte 17 = 5 p. m.; al día siguiente hasta las 12 = 12 m. El primer día hábil de cada mes la meta de «Sin asignar» es 0. Cada punto se califica sobre 100 por separado.</div>
    <div style="margin-top:8px"><button class="p" onclick="evGuardarMetas()">💾 Guardar metas</button> <span class="mut" id="evCfgRes"></span></div>
    <div style="font-weight:700;margin-top:14px">👥 ¿Quién responde por cada sede?</div>
    <div class="mut">Solo para la evaluación y las alertas: no cambia lo que cada persona puede ver. Las marcas de sus sedes cuentan para «Sin asignar».</div>
    ${filas || '<div class="mut">No hay administradores ni analistas activos.</div>'}
  </div>`;
}
async function evGuardarResp(uid) {
  const sedes = [...document.querySelectorAll('#evalRaiz input[data-u="' + uid + '"]')].filter((x) => x.checked).map((x) => Number(x.getAttribute('data-s')));
  const r = await SB.rpc('evaluacion_responsables_guardar', { p_user: uid, p_sedes: sedes });
  if (r.error) { alert('No se pudo guardar: ' + r.error.message); return; }
  await evCargar(); await evAlertasCargar(true);
}
async function evGuardarMetas() {
  const res = $('evCfgRes');
  // la base aun guarda pesos (v2): se mandan los de siempre (suman 100); la calificacion ya no los usa
  const r = await SB.rpc('evaluacion_config_guardar', { p_pesos: Object.assign({}, Evaluacion.PESOS), p_dias: null, p_usuario: (perfil && perfil.nombre) || null,
    p_hora_corte: Number(($('evCorte') || {}).value), p_hora_manana: Number(($('evManana') || {}).value), p_max_sin_asignar: Number(($('evMaxSA') || {}).value),
    p_dias_entrega: $('evDiasProv') ? Number($('evDiasProv').value) : null, p_alza_pct: $('evAlzaProv') ? Number($('evAlzaProv').value) : null });
  if (r.error) { if (res) res.textContent = 'No se pudo: ' + r.error.message; return; }
  if (typeof EV_PROV !== 'undefined') EV_PROV.clave = '';   // metas nuevas: se recalculan los proveedores
  await evCargar(); await evAlertasCargar(true);
  const r2 = $('evCfgRes'); if (r2) r2.textContent = '✅ Guardado.';
}
