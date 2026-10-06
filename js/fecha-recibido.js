// ============================================================
//  fecha-recibido.js  -  FECHA RECIBIDO DE LA FACTURA AL AMARRARLA CON SU PEDIDO  (06/10/2026)
//  Pedido del usuario: la trazabilidad de la recepcion de la mercancia necesita la fecha en que LLEGO (muchas veces no es
//  la del pedido ni la del dia en que se enlaza). Al amarrar, la persona la escribe: obligatoria, IGUAL O POSTERIOR a la
//  fecha del pedido y no futura (dia de Colombia). La base lo vuelve a exigir (supabase/fecha_recibido.sql) y el agente la
//  pone en el ERP (Fecha Doc, Fecha Su Doc y Fecha Contabilizacion). Logica PURA (se prueba con node) + enganche abajo.
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FechaRecibido = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const pad = (n) => String(n).padStart(2, '0');
  // hoy en Colombia (UTC-5, sin horario de verano) como AAAA-MM-DD
  function hoyCO(ahora) {
    const d = new Date((ahora instanceof Date ? ahora.getTime() : (ahora == null ? Date.now() : Number(ahora))) - 5 * 3600 * 1000);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  // "2026-10-05" o "05/10/2026" -> "2026-10-05"; cualquier otra cosa (o una fecha que no existe) -> ''
  function normalizar(t) {
    const s = String(t == null ? '' : t).trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/), y, mo, d;
    if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) { d = +m[1]; mo = +m[2]; y = +m[3]; }
    else return '';
    const f = new Date(Date.UTC(y, mo - 1, d));
    if (f.getUTCFullYear() !== y || f.getUTCMonth() !== mo - 1 || f.getUTCDate() !== d) return '';
    return y + '-' + pad(mo) + '-' + pad(d);
  }
  const mostrar = (iso) => { const n = normalizar(String(iso || '').slice(0, 10)); return n ? n.split('-').reverse().join('/') : ''; };
  // -> { ok, fecha, error }
  function validar(texto, fechaPedido, hoy) {
    if (!String(texto == null ? '' : texto).trim()) return { ok: false, error: 'Escribe la Fecha Recibido de la factura (el día que llegó la mercancía).' };
    const f = normalizar(texto);
    if (!f) return { ok: false, error: 'La Fecha Recibido no es una fecha válida.' };
    const fp = normalizar(String(fechaPedido || '').slice(0, 10)), h = normalizar(hoy) || hoyCO();
    if (fp && f < fp) return { ok: false, error: 'La Fecha Recibido (' + mostrar(f) + ') no puede ser anterior a la fecha del pedido (' + mostrar(fp) + ').' };
    if (f > h) return { ok: false, error: 'La Fecha Recibido (' + mostrar(f) + ') no puede ser futura.' };
    return { ok: true, fecha: f };
  }
  return { hoyCO, normalizar, mostrar, validar };
});

// ---------------------------------------------------------------- en la pagina (ventana "Amarrar")
// Prepara el campo al abrir la ventana: vacio (la persona la escribe), tope hoy y, si ya se sabe el pedido, desde su fecha
function prepararFechaRecibido(p) {
  const el = document.getElementById('amFechaRec'), ay = document.getElementById('amFechaAyuda'); if (!el) return;
  const hoy = FechaRecibido.hoyCO();
  el.value = ''; el.max = hoy; el.min = (p && p.fecha) ? String(p.fecha).slice(0, 10) : '';
  if (ay) ay.textContent = 'El día que llegó la mercancía. ' + (p && p.fecha ? 'Desde ' + FechaRecibido.mostrar(p.fecha) + ' (fecha del pedido) hasta hoy.' : 'Igual o posterior a la fecha del pedido, y no futura.');
}
// Lee y valida la fecha para ESE pedido. -> 'AAAA-MM-DD' o null (y deja el error a la vista)
function fechaRecibidoPara(p) {
  const el = document.getElementById('amFechaRec');
  const v = FechaRecibido.validar(el ? el.value : '', p && p.fecha, FechaRecibido.hoyCO());
  if (!v.ok) {
    const err = document.getElementById('amErr'); if (err) err.textContent = v.error;
    if (el) { el.style.borderColor = '#dc2626'; try { el.focus(); } catch (e) { /* sin foco */ } }
    return null;
  }
  if (el) el.style.borderColor = '';
  return v.fecha;
}
