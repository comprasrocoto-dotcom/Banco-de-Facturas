// ============================================================
//  evaluacion-ui.js  -  modulo «📈 Evaluacion» (solo administradores) + aviso de alertas en Facturas (16/10/2026)
// ============================================================
// Calificacion de 1 a 100 por persona (calculo en js/evaluacion.js), detalle de cada punto, responsables por sede, pesos y
// dias de alerta. Las alertas (mas de N dias habiles sin enviar a contabilidad / facturas viejas en «Sin asignar») las genera la
// base al cargar la web (evaluacion_alertas_generar): una vez al dia manda el correo a cada responsable con copia a compras.
// Datos: RPC evaluacion_datos (supabase/evaluacion.sql). Todos los nombres globales empiezan por ev / EV_ (no chocar con otros).
var EV = { datos: null, res: [], periodo: '30', desde: null, hasta: null, abierto: null, config: false };
var EV_ALERTAS = null, EV_ALERTAS_T = 0;

function evPuedeVer() { return typeof perfil !== 'undefined' && perfil && perfil.rol === 'admin'; }
function evRolAnalista() { return typeof perfil !== 'undefined' && perfil && (perfil.rol === 'admin' || perfil.rol === 'pagos'); }
function evFecha(d) { return d ? d.slice(8, 10) + '/' + d.slice(5, 7) : ''; }
function evColor(n) { const v = Evaluacion.nivel(n); return v === 'bien' ? '#15803d' : v === 'medio' ? '#b45309' : v === 'mal' ? '#b91c1c' : '#64748b'; }

// ---------------------------------------------------------------- alertas (Facturas)
async function evAlertasCargar(forzar) {
  if (!evRolAnalista() || typeof SB === 'undefined') return;
  if (!forzar && EV_ALERTAS && Date.now() - EV_ALERTAS_T < 15 * 60000) { evPintarAviso(); return; }
  try {
    const r = await SB.rpc('evaluacion_alertas_generar');
    if (r.error) return;   // base sin la funcion: no se muestra nada
    EV_ALERTAS = r.data || null; EV_ALERTAS_T = Date.now();
  } catch (e) { return; }
  evPintarAviso();
}
function evMisAlertas() {
  const l = (EV_ALERTAS && EV_ALERTAS.alertas) || [];
  if (evPuedeVer()) return l;
  const yo = (typeof usuario !== 'undefined' && usuario && usuario.id) || null;
  return l.filter((a) => a.user_id === yo);
}
function evTextoAlerta(a, dias) {
  return a.tipo === 'por_enviar'
    ? `${escAg(a.nombre)}: <b>${a.cantidad}</b> sin enviar a contabilidad (el más viejo lleva ${a.max_dias} días hábiles)`
    : `${escAg(a.nombre)}: <b>${a.cantidad}</b> en «Sin asignar» con más de ${dias} días hábiles (la más vieja, ${a.max_dias})`;
}
function evPintarAviso() {
  const caja = $('avisoEval'); if (!caja) return;
  const l = evMisAlertas();
  if (!l.length) { caja.innerHTML = ''; return; }
  const dias = (EV_ALERTAS && EV_ALERTAS.dias_alerta) || 2;
  const porPersona = new Map();
  l.forEach((a) => { if (!porPersona.has(a.persona)) porPersona.set(a.persona, []); porPersona.get(a.persona).push(a); });
  caja.innerHTML = `<div class="card" style="border-left:5px solid #b91c1c;background:#fef2f2;margin-bottom:12px">
    <div class="row" style="gap:10px;align-items:flex-start"><div style="flex:1 1 320px">
      <div style="font-weight:700;color:#991b1b">🚨 Alertas de hoy (más de ${dias} días hábiles, sin contar fines de semana ni festivos)</div>
      ${[...porPersona.entries()].map(([p, as]) => `<div style="margin-top:4px">${evPuedeVer() ? '<b>' + escAg(p || '') + ':</b> ' : ''}${as.map((a) => evTextoAlerta(a, dias)).join(' · ')}</div>`).join('')}
      <div class="mut" style="margin-top:4px">A cada responsable le llega un correo al día con esto (copia a compras).</div></div>
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
  const cfg = EV.datos.config || {};
  EV.res = Evaluacion.calcular(EV.datos, { desde: EV.desde, hasta: EV.hasta, hoy, pesos: cfg.pesos, diasAlerta: cfg.dias_alerta });
  if (!EV_ALERTAS) await evAlertasCargar(true);
  evPintar();
}
function evPeriodo(p) { EV.periodo = p; EV.abierto = null; evCargar(); }
function evRango() {
  const d = ($('evDesde') || {}).value, h = ($('evHasta') || {}).value;
  if (!d || !h || d > h) { alert('Elige un rango válido (desde ≤ hasta).'); return; }
  EV.periodo = 'libre'; EV.desde = d; EV.hasta = h; evCargar();
}
function evToggle(uid) { EV.abierto = EV.abierto === uid ? null : uid; evPintar(); }
function evToggleConfig() { EV.config = !EV.config; evPintar(); }

function evNombreSede(id) {
  const D = EV.datos || {}, s = (D.sedes || []).find((x) => Number(x.id) === Number(id));
  if (!s) return '#' + id;
  const repetido = (D.sedes || []).filter((x) => x.nombre === s.nombre).length > 1;
  const m = (D.marcas || []).find((x) => Number(x.id) === Number(s.marca_id));
  return s.nombre + (repetido && m ? ' (' + m.nombre + ')' : '');
}

function evPintar() {
  const raiz = $('evalRaiz'); if (!raiz) return;
  const D = EV.datos || {}, cfg = D.config || {}, pesos = Object.assign({}, Evaluacion.PESOS, cfg.pesos || {});
  const dias = cfg.dias_alerta || Evaluacion.DIAS_ALERTA;
  const hoy = BancoUtils.hoyColombia();
  const habiles = Evaluacion.habilesEntre(EV.desde, EV.hasta > hoy ? hoy : EV.hasta).length;
  const fest = [];
  for (let y = Number(EV.desde.slice(0, 4)); y <= Number(EV.hasta.slice(0, 4)); y++) Evaluacion.festivosColombia(y).forEach((f) => { if (f.fecha >= EV.desde && f.fecha <= EV.hasta) fest.push(evFecha(f.fecha) + ' ' + f.nombre); });
  const chip = (p, t) => `<button class="chip${EV.periodo === p ? ' on' : ''}" onclick="evPeriodo('${p}')">${t}</button>`;
  const alertas = evMisAlertas();
  raiz.innerHTML = `
    <div class="card" style="margin-bottom:12px">
      <div class="row" style="gap:8px;flex-wrap:wrap;align-items:center">
        <b style="font-size:16px">📈 Evaluación de analistas y auxiliares</b><span class="sp"></span>
        ${chip('semana', 'Esta semana')}${chip('mes', 'Este mes')}${chip('30', 'Últimos 30 días')}
        <input type="date" id="evDesde" value="${EV.desde}" style="width:auto;margin:0"> → <input type="date" id="evHasta" value="${EV.hasta}" style="width:auto;margin:0">
        <button class="s" onclick="evRango()">Ver</button>
        <button onclick="evToggleConfig()">⚙️ Responsables y pesos</button>
      </div>
      <div class="mut" style="margin-top:6px">Del ${evFecha(EV.desde)} al ${evFecha(EV.hasta)} · ${habiles} días hábiles${fest.length ? ' · festivos: ' + escAg(fest.join(', ')) : ''} · alerta a los ${dias} días hábiles.
        El envío a contabilidad se mide desde el 16/10/2026 (lo anterior se dio por enviado al arrancar el control).</div>
    </div>
    ${EV.config ? evConfigHtml(pesos, dias) : ''}
    ${alertas.length ? `<div class="card" style="border-left:5px solid #b91c1c;margin-bottom:12px"><div style="font-weight:700;color:#991b1b">🚨 Alertas de hoy</div>${alertas.map((a) => `<div style="margin-top:3px"><b>${escAg(a.persona || '')}</b> · ${evTextoAlerta(a, dias)}</div>`).join('')}</div>` : '<div class="card" style="border-left:5px solid #15803d;margin-bottom:12px">✅ Hoy no hay alertas.</div>'}
    ${EV.res.length ? EV.res.map((r) => evTarjeta(r, pesos, dias)).join('') : '<div class="vacio">No hay administradores ni analistas activos.</div>'}`;
}

function evBarra(nombre, val, peso, ayuda) {
  const pct = peso > 0 ? Math.max(0, Math.min(100, (val / peso) * 100)) : 0;
  const col = pct >= 85 ? '#15803d' : pct >= 70 ? '#d97706' : '#dc2626';
  return `<div title="${escAg(ayuda || '')}" style="margin:3px 0"><div class="row" style="gap:6px;font-size:12.5px"><span>${nombre}</span><span class="sp"></span><b>${val} / ${peso}</b></div>
    <div style="height:8px;background:#e5e7eb;border-radius:6px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${col}"></div></div></div>`;
}

function evTarjeta(r, pesos, dias) {
  const d = r.detalle, sedes = r.sedes.map(evNombreSede);
  const n = r.puntaje;
  const ayuda = {
    envio: `De lo que quedó listo en sus sedes (ingresado y sellado), cuánto salió a contabilidad en ${dias} días hábiles o menos. Lo pendiente que ya pasó el plazo cuenta como tarde.`,
    sinAsignar: `Días hábiles en que «Sin asignar» de sus marcas estuvo sin facturas de más de ${dias} días hábiles.`,
    ingresos: 'Ingresos de sus sedes sin novedad del agente.',
    correcciones: 'Correcciones que hizo a mano (ingreso ERP manual, desamarres, sellos quitados, borrados) frente a los ingresos de sus sedes.',
    proceso: 'Pedidos de sus sedes creados por el punto y amarres hechos por el punto o por la foto de la factura (no a mano por un analista).',
  };
  const datos = [
    `📤 Por enviar ahora: <b>${d.envio.pendientes.length}</b>${d.envio.vencidos.length ? ` (<span style="color:#b91c1c">${d.envio.vencidos.length} vencidos</span>)` : ''}`,
    `📅 Hubo envío ${d.envio.diasConEnvio} de ${d.envio.diasHabiles} días hábiles`,
    `🗂️ Sin asignar hoy: ${d.sinAsignar.poolHoy}${d.sinAsignar.viejasHoy ? ` (<span style="color:#b91c1c">${d.sinAsignar.viejasHoy} viejas</span>)` : ''}`,
    `✋ Hizo a mano: ${d.proceso.yoCreo} pedido(s), ${d.proceso.yoAmarro} amarre(s), ${d.correcciones.total} corrección(es)`,
  ];
  return `<div class="card" style="margin-bottom:10px">
    <div class="row" style="gap:10px;align-items:center;flex-wrap:wrap">
      <div style="flex:1 1 260px"><div style="font-weight:700;font-size:15px">${escAg(r.nombre || '')} <span class="badge">${r.rol === 'pagos' ? 'Analista' : 'Administrador'}</span></div>
        <div class="mut">${sedes.length ? '📍 ' + escAg(sedes.join(', ')) : '<span style="color:#b45309">Sin sedes a cargo: asígnalas en ⚙️ para calificarlo.</span>'}</div></div>
      <div style="text-align:center;min-width:86px"><div style="font-size:30px;font-weight:800;color:${evColor(n)}">${n == null ? '—' : n}</div><div class="mut" style="font-size:11px">de 100</div></div>
    </div>
    ${n == null ? '' : `<div style="margin-top:6px">${Object.keys(Evaluacion.PESOS).map((k) => evBarra(Evaluacion.NOMBRES[k], r.comp[k], Number(pesos[k] || 0), ayuda[k])).join('')}</div>`}
    <div class="mut" style="margin-top:6px;display:flex;gap:4px 14px;flex-wrap:wrap">${datos.map((x) => '<span>' + x + '</span>').join('')}</div>
    <div style="margin-top:6px"><button onclick="evToggle('${r.user_id}')">${EV.abierto === r.user_id ? 'Ocultar detalle' : 'Ver detalle'}</button></div>
    ${EV.abierto === r.user_id ? evDetalle(r, dias) : ''}
  </div>`;
}

function evDetalle(r, dias) {
  const d = r.detalle;
  const lista = (l, vacio) => (l.length ? '<table style="width:100%;font-size:12.5px;border-collapse:collapse">' + l.slice(0, 60).map((x) => `<tr style="border-bottom:1px solid var(--line)"><td>${escAg(x.doc || '')}</td><td>${escAg(x.emisor || '')}</td><td>listo ${evFecha(x.listo)}</td><td style="text-align:right"><b>${x.dias}</b> días háb.</td></tr>`).join('') + '</table>' + (l.length > 60 ? `<div class="mut">…y ${l.length - 60} más</div>` : '') : `<div class="mut">${vacio}</div>`);
  const dh = Evaluacion.habilesEntre(EV.desde, EV.hasta > BancoUtils.hoyColombia() ? BancoUtils.hoyColombia() : EV.hasta);
  const max = Math.max(1, ...dh.map((x) => d.envio.porDia[x] || 0));
  const barras = dh.map((x) => { const v = d.envio.porDia[x] || 0; return `<div title="${evFecha(x)}: ${v} documento(s)" style="flex:1 1 0;min-width:6px;display:flex;flex-direction:column;justify-content:flex-end;height:60px"><div style="height:${Math.round((v / max) * 56) + (v ? 4 : 0)}px;background:${v ? '#1e3a8a' : '#e5e7eb'};border-radius:3px 3px 0 0;min-height:2px"></div></div>`; }).join('');
  const alertasDias = new Set(((EV.datos || {}).alertas || []).filter((a) => a.user_id === r.user_id).map((a) => a.dia)).size;
  const porAccion = Object.entries(d.correcciones.porAccion);
  return `<div style="margin-top:10px;border-top:1px solid var(--line);padding-top:10px;display:grid;gap:12px">
    <div><b>📤 Envíos a contabilidad por día hábil</b> <span class="mut">(${d.envio.aTiempo} de ${d.envio.total} a tiempo · ${d.envio.tarde.length} tarde · ${d.envio.vencidos.length} vencidos sin enviar)</span>
      <div style="display:flex;gap:2px;align-items:flex-end;margin-top:6px">${barras || '<span class="mut">Sin días hábiles en el período.</span>'}</div>
      <div class="row mut" style="font-size:11px"><span>${evFecha(dh[0])}</span><span class="sp"></span><span>${evFecha(dh[dh.length - 1])}</span></div></div>
    <div><b>⏰ Pendientes por enviar ahora</b>${lista(d.envio.pendientes.slice().sort((a, b) => b.dias - a.dias), 'Nada pendiente.')}</div>
    ${d.envio.tarde.length ? `<div><b>🐢 Enviados tarde (más de ${dias} días hábiles)</b>${lista(d.envio.tarde, '')}</div>` : ''}
    <div><b>🗂️ «Sin asignar» de sus marcas</b><div class="mut">Hoy: ${d.sinAsignar.poolHoy} factura(s), ${d.sinAsignar.viejasHoy} con más de ${dias} días hábiles${d.sinAsignar.masVieja ? ' (la más vieja lleva ' + d.sinAsignar.masVieja + ')' : ''}. ${d.sinAsignar.diasMedidos ? 'Limpio ' + d.sinAsignar.diasLimpios + ' de ' + d.sinAsignar.diasMedidos + ' días medidos.' : 'Aún no hay días medidos: se califica con lo de hoy (cada factura vieja resta 2 puntos).'} Días con alerta en el período: ${alertasDias}.</div></div>
    <div><b>🧾 Ingresos de sus sedes</b><div class="mut">${d.ingresos.total} ingreso(s) · ${d.ingresos.conNovedad} con novedad del agente · ${d.ingresos.sinPedido} factura(s) ingresadas SIN pedido del punto · ${d.ordenes} orden(es) de ingreso lanzadas por esta persona.</div>
      ${Object.keys(d.ingresos.motivos || {}).length ? '<div class="mut" style="margin-top:3px">Novedades por motivo: ' + Object.entries(d.ingresos.motivos).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([m, n]) => escAg(m) + ' (' + n + ')').join(' · ') + '</div>' : ''}</div>
    <div><b>✋ Correcciones a mano de esta persona</b><div class="mut">${porAccion.length ? porAccion.map(([a, n]) => escAg(a) + ': ' + n).join(' · ') : 'Ninguna en el período.'}</div></div>
    <div><b>📋 Debido proceso en sus sedes</b><div class="mut">Pedidos creados por el punto: ${d.proceso.creadosPunto} de ${d.proceso.creados} · Amarres por el punto o por foto: ${d.proceso.amarresPunto} de ${d.proceso.amarres}. Esta persona creó ${d.proceso.yoCreo} pedido(s) y amarró a mano ${d.proceso.yoAmarro} (en cualquier sede).</div></div>
  </div>`;
}

// ---------------------------------------------------------------- configuracion
function evConfigHtml(pesos, dias) {
  const D = EV.datos || {};
  const personas = (D.perfiles || []).filter((p) => p.activo !== false && (p.rol === 'admin' || p.rol === 'pagos')).sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
  const marcas = (D.marcas || []).slice().sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
  const resp = new Set((D.responsables || []).map((x) => x.user_id + '|' + x.sede_id));
  const filas = personas.map((p) => `<div style="padding:8px 0;border-bottom:1px solid var(--line)">
      <div class="row" style="gap:8px"><b>${escAg(p.nombre || '')}</b><span class="mut">${p.rol === 'pagos' ? 'Analista' : 'Administrador'}</span><span class="sp"></span><button class="s" onclick="evGuardarResp('${p.user_id}')">Guardar</button></div>
      <div style="display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:4px">${marcas.map((m) => {
        const ss = (D.sedes || []).filter((s) => Number(s.marca_id) === Number(m.id)).sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
        return ss.length ? `<span><span class="mut">${escAg(m.nombre)}:</span> ${ss.map((s) => `<label style="display:inline-flex;align-items:center;gap:4px;white-space:nowrap;margin-right:8px"><input type="checkbox" data-u="${p.user_id}" data-s="${s.id}"${resp.has(p.user_id + '|' + s.id) ? ' checked' : ''} style="width:auto;margin:0">${escAg(s.nombre)}</label>`).join('')}</span>` : '';
      }).join('')}</div></div>`).join('');
  const inp = (k) => `<label style="white-space:nowrap">${Evaluacion.NOMBRES[k]} <input type="number" min="0" max="100" id="evP_${k}" value="${Number(pesos[k] || 0)}" style="width:70px;margin:0"></label>`;
  return `<div class="card" style="margin-bottom:12px;border-left:5px solid #1e3a8a">
    <div style="font-weight:700">👥 ¿Quién responde por cada sede?</div>
    <div class="mut">Solo para la evaluación y las alertas: no cambia lo que cada persona puede ver. Las marcas de sus sedes son las que cuentan para «Sin asignar».</div>
    ${filas || '<div class="mut">No hay administradores ni analistas activos.</div>'}
    <div style="font-weight:700;margin-top:12px">⚖️ Pesos de la calificación (se reparten sobre 100)</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px 16px;margin-top:6px">${Object.keys(Evaluacion.PESOS).map(inp).join('')}
      <label style="white-space:nowrap">Alerta a los <input type="number" min="1" max="15" id="evDias" value="${dias}" style="width:60px;margin:0"> días hábiles</label>
      <button class="p" onclick="evGuardarPesos()">Guardar pesos</button></div>
    <div class="mut" id="evCfgRes" style="margin-top:6px"></div></div>`;
}
async function evGuardarResp(uid) {
  const sedes = [...document.querySelectorAll('#evalRaiz input[data-u="' + uid + '"]')].filter((x) => x.checked).map((x) => Number(x.getAttribute('data-s')));
  const r = await SB.rpc('evaluacion_responsables_guardar', { p_user: uid, p_sedes: sedes });
  if (r.error) { alert('No se pudo guardar: ' + r.error.message); return; }
  await evCargar(); await evAlertasCargar(true);
}
async function evGuardarPesos() {
  const p = {}; Object.keys(Evaluacion.PESOS).forEach((k) => { p[k] = Number(($('evP_' + k) || {}).value || 0); });
  const dias = Number(($('evDias') || {}).value || 0);
  const r = await SB.rpc('evaluacion_config_guardar', { p_pesos: p, p_dias: dias, p_usuario: (perfil && perfil.nombre) || null });
  if (r.error) { const c = $('evCfgRes'); if (c) c.textContent = 'No se pudo: ' + r.error.message; return; }
  await evCargar(); await evAlertasCargar(true);
}
