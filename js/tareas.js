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

  // (18/10/2026) + inventario general y auditoria de punto de venta (supabase/tareas_plantillas.sql amplia la lista en la base)
  const TIPOS = { inventario: '📦 Inventario cíclico', inventario_general: '🗃️ Inventario general', auditoria: '🔍 Auditoría de punto de venta',
    cierre_mes: '🗓️ Token DIAN diario y cierre de mes', capacitacion: '🎓 Capacitación', visita: '🚗 Visita', otra: '📝 Otra' };

  // ---------- PLANTILLAS (18/10/2026, pedido del usuario) ----------
  // Al elegir el tipo se cargan el resumen y las actividades; se pueden editar antes de asignar y despues (solo esa tarea:
  // la plantilla no cambia). Capacitacion, visita y otra van en blanco. Cada actividad queda en la tarea como { t, h }.
  const PLANTILLAS = {
    inventario: {
      resumen: 'Realizar el conteo físico de las familias de productos asignadas al punto de venta, validar las referencias y las cantidades, identificar diferencias frente al sistema, socializar los hallazgos y dejar actualizada la información en el formato de inventarios correspondiente.',
      actividades: ['Contar bebidas.', 'Contar gaseosas.', 'Contar licores.', 'Contar vinos.', 'Contar proteínas.',
        'Revisar las proteínas e ingredientes utilizados en las recetas y preparaciones.',
        'Revisar los productos cocinados y las fabricaciones o transformaciones correspondientes.',
        'Verificar las referencias de los productos.', 'Validar cantidades y unidades de medida.',
        'Comparar el inventario físico con los registros del sistema.', 'Identificar y documentar diferencias.',
        'Revisar el estado, almacenamiento, rotación y vencimiento de las mercancías.',
        'Socializar los hallazgos con el personal del punto de venta.', 'Registrar observaciones y pendientes.',
        'Dejar cargada y actualizada la información en el formato de inventarios.'],
    },
    inventario_general: {
      resumen: 'Realizar acompañamiento al inventario general del punto de venta asignado, verificando que todos los ingresos de compras y las fabricaciones estén registrados al día y que la información de cada punto de venta esté diligenciada y cargada en la base de datos mediante el formato de inventarios antes de iniciar el inventario final.',
      actividades: ['Confirmar el punto de venta asignado.', 'Realizar acompañamiento durante el inventario general.',
        'Verificar que los ingresos de compras estén registrados al día.',
        'Verificar que las fabricaciones y transformaciones estén registradas al día.',
        'Confirmar que los movimientos de inventario estén actualizados.',
        'Verificar que toda la información del punto de venta esté diligenciada.',
        'Confirmar que el formato de inventarios esté cargado en la base de datos antes de iniciar el inventario final.',
        'Verificar referencias, cantidades y unidades de medida.', 'Registrar diferencias y novedades.',
        'Socializar los hallazgos con los responsables del punto de venta.',
        'Confirmar que la información final quede cargada y disponible para revisión.'],
    },
    auditoria: {
      resumen: 'Realizar auditoría operativa y de inventarios en el punto de venta asignado, revisando las familias de productos, las referencias, los registros, las mercancías y el cumplimiento de los procedimientos establecidos. Documentar y socializar los hallazgos.',
      actividades: ['Identificar las familias de productos que se deben auditar.', 'Revisar bebidas y gaseosas.', 'Revisar licores y vinos.',
        'Revisar proteínas y productos utilizados en recetas.', 'Revisar productos cocinados y fabricaciones.',
        'Verificar las referencias y unidades de medida.', 'Comparar cantidades físicas con registros.',
        'Revisar los soportes de compras, ingresos y fabricaciones.',
        'Verificar el almacenamiento, la rotación y el vencimiento de las mercancías.', 'Registrar diferencias e inconsistencias.',
        'Documentar evidencias y observaciones.', 'Socializar los resultados con el responsable del punto de venta.',
        'Registrar acciones correctivas y pendientes.'],
    },
    // (19/10/2026) pedido del usuario: el token de la DIAN se sube TODOS LOS DIAS y a fin de mes todo debe quedar depurado e ingresado
    cierre_mes: {
      resumen: 'El token de la DIAN se debe subir TODOS LOS DÍAS (no solo al cierre), para que las facturas del día lleguen al Banco de Facturas y se trabajen a tiempo. Cada día se valida en la web con «✅ Hoy quedó OK» (o «❌ Hoy NO quedó OK» y qué pasó). Al FIN DEL MES todo debe quedar DEPURADO E INGRESADO: ninguna factura «Sin asignar», todas ingresadas al ERP y selladas, y todo conciliado (DIAN, Banco de Facturas y Hiopos).',
      actividades: ['TODOS LOS DÍAS: pedir el token en la DIAN (llega al correo) y subirlo.',
        'TODOS LOS DÍAS: hacer el Cruce DIAN y bajar los PDF que falten para que suban al banco.',
        'TODOS LOS DÍAS: asignar las facturas nuevas a su sede y responsable (que no se acumulen en «Sin asignar»).',
        'TODOS LOS DÍAS: marcar en la tarea «✅ Hoy quedó OK» (o «❌ Hoy NO quedó OK» y qué pasó).',
        'FIN DE MES: confirmar que se trajeron de la DIAN las facturas del mes completo (del día 1 al último día).',
        'FIN DE MES: «Sin asignar» en CERO.',
        'FIN DE MES: todas las facturas INGRESADAS al ERP (con N° de ingreso) y SELLADAS.',
        'FIN DE MES: cargar en Conciliación el reporte «Documentos» de Hiopos del mes.',
        'FIN DE MES: conciliar: que no quede ninguna factura «PENDIENTE DE INGRESO», «POR REVISAR» ni «ERROR DE CONSULTA».',
        'FIN DE MES: depurar las notas crédito, las facturas anuladas y las duplicadas.',
        'FIN DE MES: enviar a contabilidad todo lo que esté «Por enviar».',
        'Registrar las novedades que no se pudieron cerrar y avisar al administrador.',
        'Subir evidencia: pantallazo del banco con «Sin asignar» en 0 y de la conciliación al día.'],
    },
    capacitacion: { resumen: '', actividades: [] },
  };
  // copia de la plantilla (nunca la original, para que editar una tarea no la cambie)
  const plantilla = (tipo) => { const p = PLANTILLAS[tipo]; return { resumen: p ? p.resumen : '', actividades: p ? p.actividades.slice() : [] }; };
  // (19/10/2026) asunto (titulo) por defecto segun el tipo; tambien es el asunto del correo. Se puede cambiar antes de asignar.
  const TITULOS = { inventario: 'Inventario cíclico', inventario_general: 'Inventario general', auditoria: 'Auditoría de punto de venta',
    cierre_mes: 'Subir token DIAN diario y dejar el mes depurado e ingresado', capacitacion: 'Capacitación', visita: 'Visita a punto de venta' };
  const tituloDe = (tipo) => TITULOS[tipo] || '';
  const MAX_ACTIVIDADES = 60;
  // texto (una actividad por linea; se quitan viñetas «-», «•», «*» o casillas) -> [{ t, h:false }]
  function actividadesDeTexto(texto, previas) {
    const hechas = new Map((previas || []).filter((a) => a && a.h).map((a) => [String(a.t).trim().toLowerCase(), a]));
    return String(texto || '').split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-•*·]|\[[ xX]?\]|☐|☑|✅)\s*/, '').trim()).filter(Boolean)
      .slice(0, MAX_ACTIVIDADES).map((t) => Object.assign({ t: t.slice(0, 300), h: false }, hechas.has(t.toLowerCase()) ? { h: true, por: hechas.get(t.toLowerCase()).por, en: hechas.get(t.toLowerCase()).en } : {}));
  }
  const actividadesTexto = (lista) => (Array.isArray(lista) ? lista : []).map((a) => (a && a.t) || '').filter(Boolean).join('\n');
  const actividades = (t) => (t && Array.isArray(t.actividades) ? t.actividades.filter((a) => a && a.t) : []);
  const avance = (t) => { const l = actividades(t); return { hechas: l.filter((a) => a.h).length, total: l.length }; };
  const ESTADOS = { pendiente: '⏳ Pendiente', en_proceso: '🔧 En proceso', terminada: '✅ Terminada', cancelada: '✖ Cancelada' };
  const fechaCO = (ts) => { if (!ts) return null; const s = String(ts); if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; const t = Date.parse(s); return isNaN(t) ? null : new Date(t - 5 * 3600000).toISOString().slice(0, 10); };
  const dias = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
  // (18/10/2026) fecha de inicio: "AAAA-MM-DD" + n dias, y dias entre dos fechas (b - a)
  const sumarDias = (f, n) => new Date(Date.parse(String(f).slice(0, 10) + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
  const diasEntre = (a, b) => dias(String(a).slice(0, 10), String(b).slice(0, 10));
  // la tarea tiene un rango (inicio antes del fin)? -> "AAAA-MM-DD" del inicio o null
  const inicio = (t) => (t && t.fecha_inicio && String(t.fecha_inicio).slice(0, 10) < String(t.fecha_limite).slice(0, 10) ? String(t.fecha_inicio).slice(0, 10) : null);

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
  // ---------- VALIDACION DIARIA (19/10/2026, pedido del usuario) ----------
  // Las tareas de varios dias (ej. «Token DIAN diario», todo el mes para la misma persona) se validan DIA POR DIA: «✅ OK» o
  // «❌ NO OK» (+ nota). Cada validacion queda en el historial de la tarea (tarea_evento) como un comentario con esta marca;
  // si un dia se valida dos veces, vale la ultima. No necesita nada nuevo en la base.
  const RX_DIA = /^📆 Día (\d{2})\/(\d{2})\/(\d{4}): (✅ OK|❌ NO OK)/;
  const fechaTxt = (f) => String(f).slice(8, 10) + '/' + String(f).slice(5, 7) + '/' + String(f).slice(0, 4);
  // texto del comentario que guarda la validacion de un dia
  const marcaDia = (fecha, ok, nota) => '📆 Día ' + fechaTxt(fecha) + ': ' + (ok ? '✅ OK' : '❌ NO OK') + (nota && String(nota).trim() ? ' — ' + String(nota).trim() : '');
  // eventos de la tarea -> Map("AAAA-MM-DD" -> { ok, nota, en, por }) (la ultima validacion de cada dia)
  function validaciones(eventos) {
    const m = new Map();
    (eventos || []).slice().sort((x, y) => String(x.en || '').localeCompare(String(y.en || ''))).forEach((e) => {
      const r = RX_DIA.exec(String(e.comentario || '')); if (!r) return;
      const resto = String(e.comentario).slice(r[0].length).replace(/^\s*—\s*/, '').trim();
      m.set(r[3] + '-' + r[2] + '-' + r[1], { ok: r[4] === '✅ OK', nota: resto, en: e.en || null, por: e.usuario_nombre || null });
    });
    return m;
  }
  // la tarea se valida dia por dia? (tiene inicio antes del fin)
  const esDiaria = (t) => !!inicio(t);
  // -> { dias: [{ fecha, estado: 'ok'|'no'|'falta'|'hoy'|'futuro', nota, por }], ok, no, falta, hoyHecho }
  //    'falta' = dia que ya paso sin validar; 'hoy' = hoy, aun sin validar; 'futuro' = todavia no llega
  function seguimiento(t, eventos, hoy) {
    const ini = inicio(t); if (!ini) return null;
    const fin = String(t.fecha_limite).slice(0, 10), v = validaciones(eventos), out = { dias: [], ok: 0, no: 0, falta: 0, hoyHecho: false };
    for (let f = ini, i = 0; f <= fin && i < 400; f = sumarDias(f, 1), i++) {
      const x = v.get(f);
      const estado = x ? (x.ok ? 'ok' : 'no') : f < hoy ? 'falta' : f === hoy ? 'hoy' : 'futuro';
      if (estado === 'ok') out.ok++; else if (estado === 'no') out.no++; else if (estado === 'falta') out.falta++;
      if (f === hoy && x) out.hoyHecho = true;
      out.dias.push({ fecha: f, estado, nota: x ? x.nota : '', por: x ? x.por : null });
    }
    return out;
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
    MESES, DIAS_CORTO, diaSemana, mesSumar, mesNombre, mesGrid, porDia, fechasPatron, colorEstado,
    PLANTILLAS, plantilla, MAX_ACTIVIDADES, actividadesDeTexto, actividadesTexto, actividades, avance, sumarDias, diasEntre, inicio,
    marcaDia, validaciones, esDiaria, seguimiento, TITULOS, tituloDe };
});
