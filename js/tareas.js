// ============================================================
//  tareas.js  -  TAREAS PARA LOS ANALISTAS (16/10/2026, pedido del usuario)
// ============================================================
// El administrador asigna tareas (inventario ciclico, visita, capacitacion u otra) con fecha de cumplimiento; el analista
// cambia el estado y sube evidencias. «A tiempo» = terminada a mas tardar en su fecha (hora de Colombia). Puro (sin red).
// Tablas: tarea / tarea_evento (supabase/tareas.sql).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Tareas = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TIPOS = { inventario: '📦 Inventario cíclico', visita: '🚗 Visita', capacitacion: '🎓 Capacitación', otra: '📝 Otra' };
  const ESTADOS = { pendiente: '⏳ Pendiente', en_proceso: '🔧 En proceso', terminada: '✅ Terminada', cancelada: '✖ Cancelada' };
  const fechaCO = (ts) => { if (!ts) return null; const s = String(ts); if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; const t = Date.parse(s); return isNaN(t) ? null : new Date(t - 5 * 3600000).toISOString().slice(0, 10); };
  const dias = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

  const abierta = (t) => t && t.estado !== 'terminada' && t.estado !== 'cancelada';
  // terminada a tiempo: el dia (Colombia) en que se termino es <= la fecha de cumplimiento
  const aTiempo = (t) => !!t && t.estado === 'terminada' && !!fechaCO(t.terminada_en) && fechaCO(t.terminada_en) <= String(t.fecha_limite).slice(0, 10);
  const vencida = (t, hoy) => abierta(t) && String(t.fecha_limite).slice(0, 10) < hoy;
  // dias que faltan (negativo = dias de atraso); null si ya no esta abierta
  const faltan = (t, hoy) => (abierta(t) ? dias(hoy, String(t.fecha_limite).slice(0, 10)) : null);

  // cuenta para la calificacion: no cancelada, con fecha en el periodo, y (ya vencio su fecha o ya se termino)
  function cuentan(lista, o) {
    return (lista || []).filter((t) => {
      if (!t || t.estado === 'cancelada') return false;
      const f = String(t.fecha_limite).slice(0, 10);
      if (f < o.desde || f > o.hasta) return false;
      return f < o.hoy || t.estado === 'terminada';
    });
  }
  // -> { ok, total, pct (1..100 o null), tarde: [...], vencidas: [...] }
  function cumplimiento(lista, o) {
    const l = cuentan(lista, o);
    const ok = l.filter(aTiempo).length;
    return {
      ok, total: l.length, pct: l.length ? Math.max(0, Math.min(100, Math.round((ok * 100) / l.length))) : null,
      tarde: l.filter((t) => t.estado === 'terminada' && !aTiempo(t)), vencidas: l.filter((t) => abierta(t)),
    };
  }
  // resumen para la lista: cuantas abiertas, vencidas y para hoy
  function resumen(lista, hoy) {
    const ab = (lista || []).filter(abierta);
    return { abiertas: ab.length, vencidas: ab.filter((t) => vencida(t, hoy)).length, hoy: ab.filter((t) => String(t.fecha_limite).slice(0, 10) === hoy).length };
  }
  // orden: abiertas primero (las mas urgentes arriba), luego terminadas/canceladas (las mas recientes arriba)
  function ordenar(lista) {
    return (lista || []).slice().sort((a, b) => (!abierta(a) - !abierta(b)) ||
      (abierta(a) ? String(a.fecha_limite).localeCompare(String(b.fecha_limite)) : String(b.fecha_limite).localeCompare(String(a.fecha_limite))) || (b.id || 0) - (a.id || 0));
  }
  // ruta de una evidencia en el bucket «facturas» (la base solo acepta tareas/<id>/...)
  function rutaEvidencia(id, nombre, ahora) {
    const ext = (String(nombre || '').match(/\.([A-Za-z0-9]{1,5})$/) || [, 'jpg'])[1].toLowerCase();
    const base = String(nombre || 'evidencia').replace(/\.[^.]*$/, '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').slice(0, 40) || 'evidencia';
    return 'tareas/' + id + '/' + (ahora || Date.now()) + '_' + base + '.' + ext;
  }

  return { TIPOS, ESTADOS, fechaCO, abierta, aTiempo, vencida, faltan, cuentan, cumplimiento, resumen, ordenar, rutaEvidencia };
});
