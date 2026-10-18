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

  // ---------- CALENDARIO (18/10/2026) ----------
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const DIAS_CORTO = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const iso = (d) => d.toISOString().slice(0, 10);
  // dia de la semana de una fecha "AAAA-MM-DD": 1=lunes ... 7=domingo
  const diaSemana = (f) => { const d = new Date(String(f).slice(0, 10) + 'T00:00:00Z').getUTCDay(); return d === 0 ? 7 : d; };
  // "AAAA-MM" + n meses
  function mesSumar(mes, n) { const [a, m] = String(mes).split('-').map(Number); const d = new Date(Date.UTC(a, m - 1 + n, 1)); return iso(d).slice(0, 7); }
  function mesNombre(mes) { const [a, m] = String(mes).split('-').map(Number); return MESES[m - 1] + ' ' + a; }
  // cuadricula del mes: semanas de lunes a domingo -> [[{fecha, delMes}], ...] (4 a 6 semanas)
  function mesGrid(mes) {
    const [a, m] = String(mes).split('-').map(Number);
    const primero = new Date(Date.UTC(a, m - 1, 1)), ultimo = new Date(Date.UTC(a, m, 0));
    const inicio = primero.getTime() - (diaSemana(iso(primero)) - 1) * 86400000;   // lunes de la primera semana
    const fin = ultimo.getTime() + (7 - diaSemana(iso(ultimo))) * 86400000;         // domingo de la ultima semana
    const semanas = [];
    for (let t = inicio, i = 0; t <= fin; t += 86400000, i++) {
      if (i % 7 === 0) semanas.push([]);
      const f = iso(new Date(t));
      semanas[semanas.length - 1].push({ fecha: f, delMes: f.slice(0, 7) === String(mes) });
    }
    return semanas;
  }
  // tareas agrupadas por su fecha de cumplimiento -> Map("AAAA-MM-DD" -> [tareas ordenadas])
  function porDia(lista) {
    const m = new Map();
    ordenar(lista).forEach((t) => { const f = String(t.fecha_limite).slice(0, 10); if (!m.has(f)) m.set(f, []); m.get(f).push(t); });
    return m;
  }
  // fechas del mes que caen en ciertos dias de la semana (1=lunes..7=domingo), desde una fecha minima (ej. hoy)
  function fechasPatron(mes, diasSemana, desde) {
    const quiero = new Set((diasSemana || []).map(Number));
    const out = [];
    mesGrid(mes).forEach((s) => s.forEach((c) => { if (c.delMes && quiero.has(diaSemana(c.fecha)) && (!desde || c.fecha >= desde)) out.push(c.fecha); }));
    return out;
  }
  // color del estado en el calendario (vencida pesa mas que pendiente / en proceso)
  function colorEstado(t, hoy) {
    if (t.estado === 'cancelada') return 'cancelada';
    if (t.estado === 'terminada') return aTiempo(t) ? 'terminada' : 'tarde';
    if (vencida(t, hoy)) return 'vencida';
    return t.estado;   // pendiente | en_proceso
  }

  return { TIPOS, ESTADOS, fechaCO, abierta, aTiempo, vencida, faltan, cuentan, cumplimiento, resumen, ordenar, rutaEvidencia,
    MESES, DIAS_CORTO, diaSemana, mesSumar, mesNombre, mesGrid, porDia, fechasPatron, colorEstado };
});
