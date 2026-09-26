// ============================================================
//  usuarios-ui.js  -  ADMIN -> "Usuarios y perfiles"  +  permisos en la web  +  cambio obligatorio de contrasena  (25/09/2026)
//   - can(permiso): lo que la persona puede ver/hacer segun su PERFIL (mis_permisos() de la base; si falla, los de origen de su nivel).
//   - Usuarios: crear (usuario de acceso via la Edge Function `admin-usuarios`), cambiar perfil/sede, activar/desactivar, restablecer contrasena temporal.
//   - Perfiles: crear/editar con sus permisos (perfil_guardar), borrar los que no tienen usuarios.
//   - Contrasena temporal: el primer ingreso obliga a cambiarla (perfiles.debe_cambiar_clave).
//  Logica pura: js/usuarios.js. Usa las globales de index.html: $, SB, perfil, usuario, sedes, escAg, fhAg, pintarAdmin, setModulo.
// ============================================================
let USR_PUEDE = null;                      // (permiso) => boolean
const USR = { cargado: false, cargando: false, error: null, sub: 'usuarios', usuarios: [], perfiles: [], permisosPorPerfil: {}, catalogo: [] };

function can(p) { return USR_PUEDE ? USR_PUEDE(p) : UsuariosLib.crearPuede(UsuariosLib.DEFECTO[(perfil && perfil.rol) || 'sede'])(p); }

async function cargarPermisos() {
  let base = null;
  try { const r = await SB.rpc('mis_permisos'); if (!r.error && Array.isArray(r.data)) base = r.data; } catch (e) { /* sin red: se usan los de origen del nivel */ }
  USR_PUEDE = UsuariosLib.crearPuede(UsuariosLib.permisosEfectivos(perfil, base));
}

// Muestra u oculta lo que cada perfil puede usar. Lo que el servidor exige (borrados, ingresos, usuarios) ademas lo valida la base.
function aplicarPermisosUI() {
  const mostrar = (id, ok, tipo) => { const e = $(id); if (e) e.style.display = ok ? (tipo || 'inline-block') : 'none'; };
  mostrar('m-banco', can('facturas.ver')); mostrar('m-pedidos', can('pedidos.ver'));
  mostrar('m-cruce', can('cruce_dian.ver')); mostrar('m-precios', can('precios.ver'));
  mostrar('m-admin', can('admin.ver') || can('admin.usuarios'));
  mostrar('btnsubir', can('facturas.subir')); mostrar('barraDescarga', can('facturas.subir'), 'flex');
  mostrar('btnIngresos', can('ingresos.iniciar'));
  mostrar('btnNuevoPedido', can('pedidos.crear'));
  mostrar('ad-usuarios', can('admin.usuarios'));
  mostrar('ad-prov', can('admin.ver')); mostrar('ad-art', can('admin.ver')); mostrar('ad-cat', can('admin.ver'));
  mostrar('ad-agente', can('admin.agente')); mostrar('ad-import', can('admin.importar'));
  if (!can('facturas.ver') && can('pedidos.ver') && typeof setModulo === 'function') setModulo('pedidos');
}

// ---------------- carga ----------------
async function usrCargar(forzar) {
  if (USR.cargando || (USR.cargado && !forzar)) return;
  USR.cargando = true; USR.error = null;
  try {
    const [u, p, pp, c] = await Promise.all([SB.rpc('usuarios_listar'), SB.from('perfil_acceso').select('*').order('id'), SB.from('perfil_permiso').select('perfil_id,permiso'), SB.from('permiso_catalogo').select('*').order('orden')]);
    const err = u.error || p.error || pp.error || c.error; if (err) throw new Error(err.message);
    USR.usuarios = u.data || []; USR.perfiles = p.data || []; USR.catalogo = c.data || [];
    USR.permisosPorPerfil = {}; (pp.data || []).forEach((x) => { (USR.permisosPorPerfil[x.perfil_id] = USR.permisosPorPerfil[x.perfil_id] || []).push(x.permiso); });
    USR.cargado = true;
  } catch (e) { USR.error = e.message; }
  USR.cargando = false; if (typeof adminVista !== 'undefined' && adminVista === 'usuarios') pintarAdmin();
}

// ---------------- pantalla (dentro de Admin) ----------------
function pintarUsuarios(c, q) {
  if (!can('admin.usuarios')) { c.innerHTML = '<div class="vacio">No tienes permiso para gestionar usuarios.</div>'; return; }
  if (!USR.cargado) { c.innerHTML = USR.error ? `<div class="card" style="border-color:#b45309">⚠️ No pude cargar: ${escAg(USR.error)} <button onclick="usrCargar(true)">Reintentar</button></div>` : '<div class="vacio">⏳ Cargando usuarios y perfiles...</div>'; usrCargar(); return; }
  const cnt = UsuariosLib.contarPorPerfil(USR.usuarios);
  const tab = (id, txt) => `<button class="chip ${USR.sub === id ? 'on' : ''}" onclick="USR.sub='${id}';pintarAdmin()">${txt}</button>`;
  let h = `<div class="row" style="margin-bottom:8px;gap:8px">${tab('usuarios', '👤 Usuarios (' + USR.usuarios.length + ')')}${tab('perfiles', '🛡 Perfiles y permisos (' + USR.perfiles.length + ')')}<span class="sp"></span>
    ${USR.sub === 'usuarios' ? '<button class="p" onclick="usrAbrir(null)">➕ Nuevo usuario</button>' : '<button class="p" onclick="perfilAbrir(null)">➕ Nuevo perfil</button>'}</div>`;
  if (USR.sub === 'usuarios') {
    const l = USR.usuarios.filter((u) => !q || `${u.nombre} ${u.email} ${u.perfil} ${u.sede} ${u.marca}`.toLowerCase().includes(q));
    h += l.map((u) => `<div class="card" style="margin:6px 0;${u.activo ? '' : 'opacity:.6'}"><div class="row">
        <div style="flex:2"><div class="emisor">${escAg(u.nombre)} ${u.activo ? '' : '<span class="badge" style="color:#991b1b;border-color:#fca5a5;background:#fef2f2">DESACTIVADO</span>'}${u.debe_cambiar_clave ? ' <span class="badge st-asignada">debe cambiar la contraseña</span>' : ''}</div>
          <div class="mut">${escAg(u.email || '—')} · ${u.ultimo_ingreso ? 'último ingreso ' + fhAg(u.ultimo_ingreso) : 'nunca ha ingresado'}</div></div>
        <div style="flex:1.2"><span class="badge st-sellada">${escAg(u.perfil || u.rol)}</span><div class="mut">${u.sede ? escAg((u.marca ? u.marca + ' · ' : '') + u.sede) : 'todas las sedes'}</div></div>
        <div class="row" style="gap:6px"><button class="s" onclick="usrAbrir('${u.user_id}')">✎ Editar</button><button class="s" onclick="usrClaveAbrir('${u.user_id}')">🔑 Contraseña</button>
          ${u.user_id === (usuario && usuario.id) ? '' : `<button class="${u.activo ? 'd' : 'p'}" onclick="usrEstado('${u.user_id}',${!u.activo})">${u.activo ? 'Desactivar' : 'Activar'}</button>`}</div></div></div>`).join('') || '<div class="vacio">Sin resultados.</div>';
  } else {
    h += USR.perfiles.filter((p) => !q || `${p.nombre} ${p.descripcion}`.toLowerCase().includes(q)).map((p) => {
      const n = (USR.permisosPorPerfil[p.id] || []).length, us = cnt[p.id] || 0;
      return `<div class="card" style="margin:6px 0"><div class="row"><div style="flex:2"><div class="emisor">${escAg(p.nombre)} ${p.sistema ? '<span class="badge">de origen</span>' : ''}</div><div class="mut">${escAg(p.descripcion || '')}</div></div>
        <div style="flex:1.2"><span class="badge">nivel de datos: ${escAg(p.nivel)}</span><div class="mut">${n} de ${USR.catalogo.length} permisos · ${us} usuario${us === 1 ? '' : 's'}</div></div>
        <div class="row" style="gap:6px"><button class="s" onclick="perfilAbrir(${p.id})">✎ Editar permisos</button>${p.sistema || us ? '' : `<button class="d" onclick="perfilBorrar(${p.id})">Borrar</button>`}</div></div></div>`;
    }).join('') || '<div class="vacio">Sin resultados.</div>';
    h += '<div class="mut" style="margin:10px 4px">El <b>nivel de datos</b> (administrador, pagos o sede) decide qué información puede leer el servidor; los permisos deciden qué módulos y acciones ve la persona. Lo crítico (usuarios, borrados, ingresos) además lo exige el servidor.</div>';
  }
  c.innerHTML = h;
}

// ---------------- llamada a la Edge Function ----------------
async function usrLlamar(body) {
  const r = await SB.functions.invoke('admin-usuarios', { body });
  if (r.error) { let m = r.error.message; try { const j = await r.error.context.json(); if (j && j.error) m = j.error; } catch (e) { /* mensaje generico */ } throw new Error(UsuariosLib.mensajeError(m)); }
  if (r.data && r.data.error) throw new Error(UsuariosLib.mensajeError(r.data.error));
  return r.data;
}
function usrRng() { if (typeof crypto !== 'undefined' && crypto.getRandomValues) { const a = new Uint32Array(1); return () => { crypto.getRandomValues(a); return a[0] / 4294967296; }; } return Math.random; }
const usrMsg = (id, t, ok) => { const e = $(id); if (e) { e.textContent = t || ''; e.style.color = ok ? '#166534' : '#b91c1c'; } };

// ---------------- modal usuario (crear / editar) ----------------
let usrEditando = null;
function usrPerfilElegido() { const id = Number($('usr_perfil').value || 0); return USR.perfiles.find((p) => p.id === id) || null; }
function usrPintarSede() {
  const pf = usrPerfilElegido(); const box = $('usr_sede_box'); if (!box) return;
  box.style.display = pf ? 'block' : 'none';
  $('usr_sede_ayuda').textContent = pf && pf.nivel === 'sede' ? 'Obligatoria: este usuario solo verá lo de esta sede.' : 'Opcional: los perfiles de administración y pagos ven todas las sedes.';
}
function usrAbrir(id) {
  usrEditando = id ? USR.usuarios.find((u) => u.user_id === id) : null;
  const u = usrEditando, nuevo = !u;
  $('usr_titulo').textContent = nuevo ? '➕ Nuevo usuario' : '✎ Editar usuario';
  $('usr_nombre').value = u ? u.nombre : ''; $('usr_email').value = u ? (u.email || '') : ''; $('usr_email').disabled = !nuevo;
  $('usr_perfil').innerHTML = '<option value="">— elige el perfil —</option>' + USR.perfiles.filter((p) => p.activo || (u && p.id === u.perfil_id)).map((p) => `<option value="${p.id}">${escAg(p.nombre)} (nivel ${escAg(p.nivel)})</option>`).join('');
  $('usr_perfil').value = u && u.perfil_id ? u.perfil_id : '';
  $('usr_sede').innerHTML = '<option value="">— todas las sedes —</option>' + (typeof sedes !== 'undefined' ? sedes : []).map((s) => `<option value="${s.id}">${escAg((s.marcas && s.marcas.nombre ? s.marcas.nombre + ' · ' : '') + s.nombre)}</option>`).join('');
  $('usr_sede').value = u && u.sede_id ? u.sede_id : '';
  $('usr_clave_box').style.display = nuevo ? 'block' : 'none'; if (nuevo) $('usr_clave').value = UsuariosLib.generarClave(usrRng());
  $('usr_activo_box').style.display = (!nuevo && u.user_id !== (usuario && usuario.id)) ? 'block' : 'none'; $('usr_activo').checked = u ? !!u.activo : true;
  usrMsg('usr_err', ''); usrPintarSede(); $('modalUsuario').classList.add('on');
}
async function usrGuardar() {
  const pf = usrPerfilElegido(), nuevo = !usrEditando, sedeId = Number($('usr_sede').value || 0) || null;
  const d = { nombre: $('usr_nombre').value, email: $('usr_email').value, clave: $('usr_clave').value, perfil: pf, sedeId };
  const v = nuevo ? UsuariosLib.validarNuevoUsuario(d) : UsuariosLib.validarEdicion(d);
  if (!v.ok) { usrMsg('usr_err', v.errores.join(' '), false); return; }
  const b = $('usr_guardar'); b.disabled = true; usrMsg('usr_err', 'Guardando...', true);
  try {
    if (nuevo) await usrLlamar({ accion: 'crear', email: d.email.trim(), clave: d.clave, nombre: d.nombre.trim(), perfil_id: pf.id, sede_id: sedeId });
    else { const r = await usrLlamar({ accion: 'actualizar', user_id: usrEditando.user_id, nombre: d.nombre.trim(), perfil_id: pf.id, sede_id: sedeId, activo: $('usr_activo_box').style.display === 'none' ? usrEditando.activo : $('usr_activo').checked }); if (r && r.aviso) alert(r.aviso); }
    $('modalUsuario').classList.remove('on');
    if (nuevo) alert('Usuario creado.\n\nEntrégale su correo y esta contraseña temporal (solo se muestra ahora):\n\n' + d.clave + '\n\nEn su primer ingreso el sistema le pedirá cambiarla.');
    await usrCargar(true);
  } catch (e) { usrMsg('usr_err', e.message, false); }
  b.disabled = false;
}
async function usrEstado(id, activo) {
  const u = USR.usuarios.find((x) => x.user_id === id); if (!u) return;
  if (!confirm(activo ? `¿Activar a ${u.nombre}?` : `¿Desactivar a ${u.nombre}? No podrá ingresar hasta que lo actives de nuevo.`)) return;
  try { await usrLlamar({ accion: 'actualizar', user_id: id, nombre: u.nombre, perfil_id: u.perfil_id, sede_id: u.sede_id, activo }); await usrCargar(true); }
  catch (e) { alert('No se pudo: ' + e.message); }
}

// ---------------- restablecer contrasena (la temporal la escribe / genera el admin) ----------------
let usrClaveId = null;
function usrClaveAbrir(id) {
  const u = USR.usuarios.find((x) => x.user_id === id); if (!u) return; usrClaveId = id;
  $('usc_quien').textContent = `${u.nombre} · ${u.email || ''}`; $('usc_clave').value = UsuariosLib.generarClave(usrRng()); usrMsg('usc_err', ''); $('modalClaveAdmin').classList.add('on');
}
async function usrClaveGuardar() {
  const c = $('usc_clave').value, e = UsuariosLib.errorClave(c); if (e) { usrMsg('usc_err', e, false); return; }
  const b = $('usc_guardar'); b.disabled = true; usrMsg('usc_err', 'Guardando...', true);
  try { await usrLlamar({ accion: 'clave', user_id: usrClaveId, clave: c }); $('modalClaveAdmin').classList.remove('on'); alert('Contraseña temporal establecida:\n\n' + c + '\n\nEntrégasela a la persona (solo se muestra ahora). Al ingresar tendrá que cambiarla.'); await usrCargar(true); }
  catch (er) { usrMsg('usc_err', er.message, false); }
  b.disabled = false;
}

// ---------------- perfiles ----------------
let perfilEditando = null;
function perfilAbrir(id) {
  perfilEditando = id ? USR.perfiles.find((p) => p.id === id) : null; const p = perfilEditando;
  const tieneUsuarios = p ? USR.usuarios.some((u) => u.perfil_id === p.id) : false;
  $('pf_titulo').textContent = p ? '✎ Editar perfil' : '➕ Nuevo perfil';
  $('pf_nombre').value = p ? p.nombre : ''; $('pf_desc').value = p ? (p.descripcion || '') : '';
  $('pf_nivel').value = p ? p.nivel : 'pagos'; $('pf_nivel').disabled = !!(p && (p.sistema || tieneUsuarios));
  const marcados = new Set(p ? (USR.permisosPorPerfil[p.id] || []) : []);
  $('pf_permisos').innerHTML = UsuariosLib.agruparCatalogo(USR.catalogo).map((g) => `<div style="margin:8px 0"><div style="font-weight:700;color:#12306b">${escAg(g.modulo)}</div>
    ${g.items.map((i) => `<label style="display:flex;gap:8px;align-items:flex-start;margin:3px 0"><input type="checkbox" class="pf_ck" value="${i.permiso}" ${marcados.has(i.permiso) ? 'checked' : ''} style="width:auto;margin-top:3px">
      <span>${escAg(i.etiqueta)}${i.critico ? ' <span class="mut" title="Además lo exige el servidor">🔒</span>' : ''}</span></label>`).join('')}</div>`).join('');
  usrMsg('pf_err', ''); $('modalPerfil').classList.add('on');
}
async function perfilGuardar() {
  const nombre = $('pf_nombre').value.trim(); if (!nombre) { usrMsg('pf_err', 'Escribe el nombre del perfil.', false); return; }
  const permisos = [...document.querySelectorAll('.pf_ck')].filter((x) => x.checked).map((x) => x.value);
  const b = $('pf_guardar'); b.disabled = true; usrMsg('pf_err', 'Guardando...', true);
  try {
    const r = await SB.rpc('perfil_guardar', { p_id: perfilEditando ? perfilEditando.id : null, p_clave: null, p_nombre: nombre, p_descripcion: $('pf_desc').value.trim() || null, p_nivel: $('pf_nivel').value, p_permisos: permisos });
    if (r.error) throw new Error(UsuariosLib.mensajeError(r.error.message));
    $('modalPerfil').classList.remove('on'); await usrCargar(true);
    if (perfilEditando && usuario) { await cargarPermisos(); aplicarPermisosUI(); }   // por si edito su propio perfil
  } catch (e) { usrMsg('pf_err', e.message, false); }
  b.disabled = false;
}
async function perfilBorrar(id) {
  const p = USR.perfiles.find((x) => x.id === id); if (!p || !confirm(`¿Borrar el perfil "${p.nombre}"?`)) return;
  const r = await SB.rpc('perfil_eliminar', { p_id: id }); if (r.error) { alert('No se pudo borrar: ' + UsuariosLib.mensajeError(r.error.message)); return; }
  await usrCargar(true);
}

// ---------------- cambio OBLIGATORIO de contrasena (primer ingreso con la temporal) ----------------
function exigirCambioClave() {
  return new Promise((resolver) => {
    usrMsg('cl_err', ''); $('cl_nueva').value = ''; $('cl_repetir').value = ''; $('modalClave').classList.add('on');
    window.__clResolver = resolver;
  });
}
async function cambiarClaveObligatoria() {
  const n = $('cl_nueva').value, r = $('cl_repetir').value, v = UsuariosLib.validarCambioClave(n, r, usuario && usuario.email);
  if (!v.ok) { usrMsg('cl_err', v.error, false); return; }
  const b = $('cl_guardar'); b.disabled = true; usrMsg('cl_err', 'Guardando...', true);
  try {
    const u = await SB.auth.updateUser({ password: n }); if (u.error) throw new Error(u.error.message);
    const f = await SB.rpc('usuario_clave_cambiada'); if (f.error) throw new Error(f.error.message);
    perfil.debe_cambiar_clave = false; $('modalClave').classList.remove('on');
    if (window.__clResolver) window.__clResolver();
  } catch (e) { usrMsg('cl_err', /same|misma|different/i.test(e.message) ? 'La contraseña nueva tiene que ser distinta de la temporal.' : e.message, false); }
  b.disabled = false;
}
