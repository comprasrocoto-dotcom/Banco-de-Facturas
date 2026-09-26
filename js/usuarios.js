// ============================================================
//  usuarios.js  -  USUARIOS, PERFILES Y PERMISOS (Admin -> Usuarios y perfiles)  (25/09/2026)
//  Logica PURA (sin red, sin DOM): permisos efectivos, validacion de formularios, agrupacion del catalogo. La usa index.html (js/usuarios-ui.js) y se prueba con node.
//  Los permisos VERDADEROS viven en la base (perfil_permiso); esto solo decide que ve y que puede tocar la web. Si la base no responde con los permisos, se usan los de
//  origen de cada nivel (los mismos que se sembraron), asi nadie se queda sin acceso por una falla de red.
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.UsuariosLib = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TODOS = ['facturas.ver', 'facturas.subir', 'facturas.sellar', 'facturas.asignar', 'facturas.borrar', 'pedidos.ver', 'pedidos.crear', 'pedidos.amarrar', 'pedidos.enviar_proveedor',
    'pedidos.borrar', 'cruce_dian.ver', 'precios.ver', 'admin.ver', 'admin.agente', 'admin.importar', 'admin.usuarios', 'ingresos.iniciar'];
  // Lo mismo que se sembro en la base para los 3 perfiles de origen (supabase/usuarios_perfiles.sql)
  const DEFECTO = {
    admin: TODOS.slice(),
    pagos: ['facturas.ver', 'facturas.subir', 'facturas.sellar', 'facturas.asignar', 'pedidos.ver', 'pedidos.crear', 'pedidos.amarrar', 'pedidos.enviar_proveedor', 'cruce_dian.ver', 'precios.ver'],
    sede: ['facturas.ver', 'facturas.sellar', 'pedidos.ver', 'pedidos.crear', 'pedidos.amarrar', 'pedidos.enviar_proveedor'],
  };

  // perfil = { rol, perfil_id }, permisosBase = lo que devolvio mis_permisos() (o null si fallo). -> array de permisos
  function permisosEfectivos(perfil, permisosBase) {
    if (Array.isArray(permisosBase) && (permisosBase.length || (perfil && perfil.perfil_id))) return permisosBase.slice();   // un perfil asignado SIN permisos es valido: no tiene nada
    return (DEFECTO[perfil && perfil.rol] || DEFECTO.sede).slice();
  }
  const crearPuede = (permisos) => { const s = new Set(permisos || []); return (p) => s.has(p); };

  // catalogo [{permiso, modulo, etiqueta, orden, critico}] -> [{ modulo, items: [...] }] en orden
  function agruparCatalogo(cat) {
    const mods = [], por = {};
    (cat || []).slice().sort((a, b) => (a.orden || 0) - (b.orden || 0)).forEach((c) => {
      if (!por[c.modulo]) { por[c.modulo] = { modulo: c.modulo, items: [] }; mods.push(por[c.modulo]); }
      por[c.modulo].items.push({ permiso: c.permiso, etiqueta: c.etiqueta, critico: !!c.critico });
    });
    return mods;
  }

  const RX_CORREO = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
  const CLAVE_MIN = 8;
  const t = (x) => String(x == null ? '' : x).trim();

  // Reglas de la contrasena (temporal o nueva): largo minimo, no toda igual, no el correo
  function errorClave(clave, email) {
    const c = String(clave == null ? '' : clave);
    if (c.length < CLAVE_MIN) return `La contraseña debe tener al menos ${CLAVE_MIN} caracteres.`;
    if (/^(.)\1+$/.test(c)) return 'La contraseña no puede ser un solo carácter repetido.';
    if (email && c.toLowerCase() === t(email).toLowerCase()) return 'La contraseña no puede ser igual al correo.';
    return null;
  }

  // d = { nombre, email, clave, perfil: {nivel}, sedeId } -> { ok, errores: [texto] }
  function validarNuevoUsuario(d) {
    const e = [];
    if (!t(d && d.nombre)) e.push('Escribe el nombre.');
    if (!RX_CORREO.test(t(d && d.email))) e.push('El correo no es válido.');
    if (!(d && d.perfil)) e.push('Elige el perfil.');
    else if (d.perfil.nivel === 'sede' && !d.sedeId) e.push('Un usuario de sede necesita su sede.');
    const ec = errorClave(d && d.clave, d && d.email); if (ec) e.push(ec);
    return { ok: !e.length, errores: e };
  }
  function validarEdicion(d) {
    const e = [];
    if (!t(d && d.nombre)) e.push('Escribe el nombre.');
    if (!(d && d.perfil)) e.push('Elige el perfil.');
    else if (d.perfil.nivel === 'sede' && !d.sedeId) e.push('Un usuario de sede necesita su sede.');
    return { ok: !e.length, errores: e };
  }
  // nueva contrasena escrita 2 veces (cambio obligatorio del primer ingreso)
  function validarCambioClave(nueva, repetir, email, temporal) {
    const ec = errorClave(nueva, email); if (ec) return { ok: false, error: ec };
    if (nueva !== repetir) return { ok: false, error: 'Las dos contraseñas no coinciden.' };
    if (temporal && nueva === temporal) return { ok: false, error: 'La contraseña nueva tiene que ser distinta de la temporal.' };
    return { ok: true, error: null };
  }

  // Contrasena temporal legible (sin 0/O/1/l/I). rng: () => [0,1)  (en el navegador: crypto.getRandomValues)
  function generarClave(rng, largo) {
    const A = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = ''; for (let i = 0; i < (largo || 10); i++) s += A[Math.floor(rng() * A.length) % A.length];
    return s;
  }

  // Cuantos usuarios tiene cada perfil (para mostrarlo y saber si se puede borrar)
  function contarPorPerfil(usuarios) { const c = {}; (usuarios || []).forEach((u) => { if (u.perfil_id != null) c[u.perfil_id] = (c[u.perfil_id] || 0) + 1; }); return c; }

  // Traduce el error tecnico de la base o de la funcion a algo que se entienda
  function mensajeError(m) {
    const s = String(m == null ? '' : m);
    if (/at least one|al menos un/i.test(s) && /gestionar/i.test(s)) return 'Debe quedar al menos un administrador activo que pueda gestionar usuarios.';
    if (/desactivarte a ti mismo/i.test(s)) return 'No puedes desactivarte a ti mismo.';
    if (/quitarte a ti mismo/i.test(s)) return 'No puedes quitarte a ti mismo el permiso de gestionar usuarios.';
    if (/duplicate key|perfil_acceso_clave_key/i.test(s)) return 'Ya existe un perfil con ese nombre.';
    if (/tiene usuarios/i.test(s)) return 'Este perfil ya tiene usuarios: no se le puede cambiar el nivel.';
    if (/hay usuarios con este perfil/i.test(s)) return 'Hay usuarios con este perfil: cámbialos de perfil antes de borrarlo.';
    if (/permission denied|sin permiso|No tienes permiso|42501/i.test(s)) return 'No tienes permiso para hacer esto.';
    return s;
  }

  return { TODOS, DEFECTO, CLAVE_MIN, permisosEfectivos, crearPuede, agruparCatalogo, errorClave, validarNuevoUsuario, validarEdicion, validarCambioClave, generarClave, contarPorPerfil, mensajeError };
});
