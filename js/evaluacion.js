// ============================================================
//  evaluacion.js  -  EVALUACION DE ANALISTAS, AUXILIARES Y SEDES (16/10/2026, pedido del usuario; reglas v2 el mismo dia)
// ============================================================
// ANALISTAS: calificacion de 1 a 100% con 5 puntos (pesos en %, suman 100; se cambian en el modulo):
//   envio        Envio a contabilidad A DIARIO: lo que el agente deja listo (ingresado + sellado) ANTES de la hora de corte
//                (5:00 p. m.) se envia ESE dia; lo que queda listo despues, el siguiente dia habil antes de la hora de la
//                mañana (12:00 m.). Sin sabados, domingos ni festivos de Colombia.
//   sinAsignar   «Sin asignar» de SUS marcas con maximo N facturas (5) cada dia habil, y en 0 el primer dia habil del mes.
//   ingresos     Ingresos de sus sedes sin novedad del agente.
//   correcciones Correcciones hechas a mano por la persona (ingreso ERP escrito a mano, desamarres, sellos quitados, borrados).
//   proceso      El analista NO debe crear pedidos, amarrar facturas ni asignarles sede: eso es del punto. Cada vez que lo
//                hace le resta.
// SEDES (puntos): % de pedidos creados por el punto, amarres hechos por el punto o con la foto, facturas asignadas por el
//                punto («Es mia») y facturas ingresadas con pedido del punto.
// INGRESOS A MANO: % de facturas ingresadas cuyo N° de ingreso lo escribio una persona (el agente no pudo) sobre el total.
// «Sus sedes» = las que el administrador le asigna en el modulo (evaluacion_responsable); no cambia lo que la persona ve.
// Puro (sin red): lo usan la web y las pruebas. Datos: RPC evaluacion_datos (supabase/evaluacion.sql).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Evaluacion = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // (16/10/2026 v3, pedido del usuario: "cada punto deberia calificarse sobre 100, de manera individual") cada punto va de 0 a
  // 100% por separado; la calificacion general es el PROMEDIO de los puntos que tienen datos (sin pesos). Un punto sin datos
  // dice «Sin datos» y no cuenta (antes valia 100% y premiaba a quien tenia poco movimiento).
  const PUNTOS = ['cumplimiento', 'puntualidad', 'sinAsignar', 'ingresos', 'usoWeb', 'proceso', 'correcciones'];
  const NOMBRES = {
    cumplimiento: '📤 Cumplimiento del envío a contabilidad', puntualidad: '⏰ Puntualidad del envío', sinAsignar: '🗂️ «Sin asignar» dentro de la meta',
    ingresos: '🧾 Ingresos sin revisión humana', usoWeb: '🌐 Uso de la web en sus sedes', proceso: '🚫 No hace lo que le toca al punto', correcciones: '✋ Pocas correcciones a mano',
  };
  const PESOS = { envio: 30, sinAsignar: 20, ingresos: 20, correcciones: 15, proceso: 15 };   // (v2; solo para guardar la configuracion)
  const METAS = { horaCorte: 17, horaManana: 12, maxSinAsignar: 5 };
  const DIAS_ALERTA = 2;   // (v1; ya no se usa para calificar)
  // correcciones a mano de la persona. Escribir el N° de ingreso a mano NO resta (es trabajo extra porque el agente no pudo:
  // se mide aparte en «Ingresos hechos a mano» y se muestra como volumen de trabajo)
  const MANUALES = ['pedido desamarrado', 'sello quitado - devuelta al pool', 'pedido borrado', 'factura borrada'];
  const INGRESO_HUMANO = ['numero de ingreso ERP', 'numero de ingreso ERP (manual)'];
  // lo que le toca al punto y no al analista
  const DEL_PUNTO = { creado: 'pedido creado desde la web', amarre: 'pedido amarrado', foto: 'pedido amarrado por foto', asignaPunto: 'asignada', asignaAdmin: 'asignada por admin' };

  // ---------------------------------------------------------------- fechas (Colombia: UTC-5 sin horario de verano)
  const DIA = 86400000, CO = 5 * 3600000;
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  const aT = (d) => Date.parse(String(d).slice(0, 10) + 'T00:00:00Z');
  const sumar = (d, n) => iso(aT(d) + n * DIA);
  const dow = (d) => new Date(aT(d)).getUTCDay();          // 0 domingo ... 6 sabado
  function fechaCO(ts) {
    if (!ts || ts === 'null') return null;
    const s = String(ts);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const t = Date.parse(s);
    return isNaN(t) ? null : iso(t - CO);
  }
  const tiempo = (ts) => { if (!ts) return NaN; const s = String(ts); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? Date.parse(s + 'T00:00:00-05:00') : Date.parse(s); };
  // hora local "dd/mm h:mm" de un timestamp
  function horaCO(t) {
    if (isNaN(t)) return '';
    const d = new Date(t - CO), h = d.getUTCHours(), m = d.getUTCMinutes();
    return String(d.getUTCDate()).padStart(2, '0') + '/' + String(d.getUTCMonth() + 1).padStart(2, '0') + ' ' + (h % 12 || 12) + ':' + String(m).padStart(2, '0') + (h < 12 ? ' a. m.' : ' p. m.');
  }

  function pascua(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
    return y + '-' + String(mes).padStart(2, '0') + '-' + String(dia).padStart(2, '0');
  }
  const lunesSiguiente = (d) => { const w = dow(d); return w === 1 ? d : sumar(d, (8 - w) % 7); };
  const fijo = (y, m, d) => y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  function festivosColombia(y) {
    const p = pascua(y);
    const l = [
      [fijo(y, 1, 1), 'Año Nuevo'], [lunesSiguiente(fijo(y, 1, 6)), 'Reyes Magos'], [lunesSiguiente(fijo(y, 3, 19)), 'San José'],
      [sumar(p, -3), 'Jueves Santo'], [sumar(p, -2), 'Viernes Santo'], [fijo(y, 5, 1), 'Día del Trabajo'],
      [sumar(p, 43), 'Ascensión del Señor'], [sumar(p, 64), 'Corpus Christi'], [sumar(p, 71), 'Sagrado Corazón'],
      [lunesSiguiente(fijo(y, 6, 29)), 'San Pedro y San Pablo'], [fijo(y, 7, 20), 'Independencia'], [fijo(y, 8, 7), 'Batalla de Boyacá'],
      [lunesSiguiente(fijo(y, 8, 15)), 'Asunción de la Virgen'], [lunesSiguiente(fijo(y, 10, 12)), 'Día de la Raza'],
      [lunesSiguiente(fijo(y, 11, 1)), 'Todos los Santos'], [lunesSiguiente(fijo(y, 11, 11)), 'Independencia de Cartagena'],
      [fijo(y, 12, 8), 'Inmaculada Concepción'], [fijo(y, 12, 25), 'Navidad'],
    ];
    return l.map(([fecha, nombre]) => ({ fecha, nombre })).sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
  }
  const cacheFest = new Map();
  function esFestivo(d) {
    const y = Number(String(d).slice(0, 4));
    if (!cacheFest.has(y)) cacheFest.set(y, new Set(festivosColombia(y).map((x) => x.fecha)));
    return cacheFest.get(y).has(String(d).slice(0, 10));
  }
  const esHabil = (d) => { const w = dow(d); return w !== 0 && w !== 6 && !esFestivo(d); };
  function diasHabiles(d1, d2) {
    if (!d1 || !d2 || d2 <= d1) return 0;
    let n = 0;
    for (let d = sumar(d1, 1); d <= d2; d = sumar(d, 1)) if (esHabil(d)) n++;
    return n;
  }
  function habilesEntre(desde, hasta) {
    const out = [];
    if (!desde || !hasta) return out;
    for (let d = desde; d <= hasta; d = sumar(d, 1)) if (esHabil(d)) out.push(d);
    return out;
  }
  function siguienteHabil(d) { let x = sumar(d, 1); while (!esHabil(x)) x = sumar(x, 1); return x; }
  function primerHabilDelMes(d) { let x = String(d).slice(0, 8) + '01'; while (!esHabil(x)) x = sumar(x, 1); return x; }
  const aLas = (d, h) => Date.parse(d + 'T' + String(h).padStart(2, '0') + ':00:00-05:00');
  // hasta cuando hay para enviar algo que quedo listo en el instante t: antes del corte de un dia habil -> ese dia a la hora de
  // corte; si no (despues del corte, fin de semana o festivo) -> el siguiente dia habil a la hora de la mañana
  function limiteEnvio(t, metas) {
    if (isNaN(t)) return NaN;
    const mt = Object.assign({}, METAS, metas || {});
    const d = iso(t - CO), h = new Date(t - CO).getUTCHours() + new Date(t - CO).getUTCMinutes() / 60;
    if (esHabil(d) && h < mt.horaCorte) return aLas(d, mt.horaCorte);
    return aLas(siguienteHabil(d), mt.horaManana);
  }

  // ---------------------------------------------------------------- documentos
  const conIngreso = (f) => !!f && !!f.num_ingreso && String(f.num_ingreso).trim() !== '' && String(f.num_ingreso) !== 'null';
  const terminada = (f) => conIngreso(f) && (f.estado === 'sellada' || f.estado === 'pagada' || f.tipo === 'nota_credito');
  // (v1) dia en que quedo listo: el ultimo entre el ingreso al ERP y el sello
  function fechaListo(f) {
    const fi = fechaCO(f && f.fecha_ingreso);
    const fs = f && f.tipo !== 'nota_credito' ? fechaCO(f.sellada_en) : null;
    if (fi && fs) return fi > fs ? fi : fs;
    return fi || fs || null;
  }
  const numPed = (s) => { const m = /PED-\d+/i.exec(String(s || '')); return m ? m[0].toUpperCase() : null; };
  const pct = (ok, total) => (total > 0 ? ok / total : 1);
  const redondo = (x) => Math.round(x * 10) / 10;

  // mapas comunes a analistas, sedes e ingresos a mano
  function preparar(D, o) {
    const desde = o.desde, hasta = o.hasta;
    const enRango = (d) => !!d && d >= desde && d <= hasta;
    const lotes = new Map((D.lotes || []).map((l) => [Number(l.id), l]));
    const envio = new Map();
    (D.envios || []).forEach((e) => { const l = lotes.get(Number(e.lote_id)); if (l && l.anulado) return; envio.set(e.factura_cufe, { lote: Number(e.lote_id), t: tiempo(e.enviada_en), en: fechaCO(e.enviada_en), arranque: !!(l && l.creado_por === 'arranque') }); });
    const pedPorNum = new Map((D.pedidos || []).map((p) => [String(p.numero || '').toUpperCase(), p]));
    const pedsDeFactura = new Map();
    (D.pedidos || []).forEach((p) => { if (p.factura_cufe) { if (!pedsDeFactura.has(p.factura_cufe)) pedsDeFactura.set(p.factura_cufe, []); pedsDeFactura.get(p.factura_cufe).push(p); } });
    const factPorCufe = new Map((D.facturas || []).map((f) => [f.cufe, f]));
    const sedeDe = (f) => (f.sede_id != null ? Number(f.sede_id) : (((pedsDeFactura.get(f.cufe) || [])[0] || {}).sede_id != null ? Number(pedsDeFactura.get(f.cufe)[0].sede_id) : null));
    const perfil = new Map((D.perfiles || []).map((p) => [p.user_id, p]));
    const rolDe = (u) => (perfil.get(u) || {}).rol;
    // hora del ingreso: el agente (cola de ingresos) o una persona (historial); el ultimo
    const ingAgente = new Map(), ingHumano = new Map();
    (D.docs_ingreso || []).forEach((x) => { const t = tiempo(x.terminado_en); if (!isNaN(t) && (!ingAgente.has(x.factura_cufe) || t > ingAgente.get(x.factura_cufe))) ingAgente.set(x.factura_cufe, t); });
    (D.historial || []).forEach((h) => { if (h.cufe && INGRESO_HUMANO.includes(h.accion)) { const t = tiempo(h.created_at); if (!isNaN(t) && (!ingHumano.has(h.cufe) || t > ingHumano.get(h.cufe).t)) ingHumano.set(h.cufe, { t, usuario: h.usuario }); } });
    // instante en que el documento quedo listo para enviar (si no se sabe la hora del ingreso: a las 5 p. m. de su dia)
    function listoEn(f) {
      const c = [ingAgente.get(f.cufe), (ingHumano.get(f.cufe) || {}).t].filter((x) => x != null && !isNaN(x));
      let ti = c.length ? Math.max(...c) : NaN;
      if (isNaN(ti) && fechaCO(f.fecha_ingreso)) ti = aLas(fechaCO(f.fecha_ingreso), 17);
      const ts = f.tipo !== 'nota_credito' ? tiempo(f.sellada_en) : NaN;
      if (isNaN(ti)) return ts;
      return isNaN(ts) ? ti : Math.max(ti, ts);
    }
    const esManual = (f) => ingHumano.has(f.cufe) && !ingAgente.has(f.cufe);
    const hist = (D.historial || []).map((h) => Object.assign({}, h, { dia: fechaCO(h.created_at) })).filter((h) => enRango(h.dia));
    // sede de cada evento de «lo que le toca al punto»
    function sedeEvento(h) {
      if (h.accion === DEL_PUNTO.creado || h.accion === DEL_PUNTO.amarre || h.accion === DEL_PUNTO.foto) { const p = pedPorNum.get(numPed(h.detalle)); return p && p.sede_id != null ? Number(p.sede_id) : null; }
      if (h.accion === DEL_PUNTO.asignaPunto) { const u = perfil.get(h.usuario); if (u && u.sede_id != null) return Number(u.sede_id); }
      const f = factPorCufe.get(h.cufe); return f && f.sede_id != null ? Number(f.sede_id) : null;
    }
    const delPunto = (h) => h.accion === DEL_PUNTO.foto || h.accion === DEL_PUNTO.asignaPunto || rolDe(h.usuario) === 'sede';
    const eventosPunto = hist.filter((h) => [DEL_PUNTO.creado, DEL_PUNTO.amarre, DEL_PUNTO.foto, DEL_PUNTO.asignaPunto, DEL_PUNTO.asignaAdmin].includes(h.accion)).map((h) => Object.assign(h, { sede: sedeEvento(h), punto: delPunto(h) }));
    const tipoEvento = (h) => (h.accion === DEL_PUNTO.creado ? 'creados' : h.accion === DEL_PUNTO.amarre || h.accion === DEL_PUNTO.foto ? 'amarres' : 'asignaciones');
    // (16/10/2026) ¿el ingreso lo termino el agente? (aunque haya fallado antes y lo lograra en otro intento): tiene su ingreso
    // completado en la cola, o nadie escribio el N° a mano. Si lo termino el agente, sus avisos de intentos anteriores NO son novedad.
    const agenteTermino = (f) => ingAgente.has(f.cufe) || !ingHumano.has(f.cufe);
    return { enRango, envio, pedsDeFactura, sedeDe, rolDe, listoEn, esManual, agenteTermino, ingHumano, hist, eventosPunto, tipoEvento };
  }

  // ---------------------------------------------------------------- analistas
  // datos: { perfiles, sedes, facturas, pedidos, historial, envios, lotes, avisos, ordenes, responsables, fotos, docs_ingreso }
  // o: { desde, hasta, hoy, ahora (ms), pesos, metas }
  function calcular(datos, o) {
    const D = datos || {};
    const pesos = Object.assign({}, PESOS, (o && o.pesos) || {});
    const metas = Object.assign({}, METAS, (o && o.metas) || {});
    const desde = o.desde, hasta = o.hasta, hoy = o.hoy;
    const ahora = o.ahora != null ? o.ahora : aLas(hoy, 23) + 59 * 60000;
    const X = preparar(D, o);
    const sedeMarca = new Map((D.sedes || []).map((s) => [Number(s.id), Number(s.marca_id)]));
    const avisoCufe = new Map(), avisoPed = new Map();
    const poner = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
    const motivoCorto = (s) => String(s || 'sin motivo').replace(/\s*\(FASE \d+\)/i, '').replace(/\d+/g, '#').slice(0, 70);
    (D.avisos || []).forEach((a) => { const mo = motivoCorto(a.motivo); if (a.factura_cufe) poner(avisoCufe, a.factura_cufe, mo); if (a.pedido_numero) poner(avisoPed, String(a.pedido_numero).toUpperCase(), mo); });
    const motivosDe = (f) => {
      const s = new Set(avisoCufe.get(f.cufe) || []);
      (X.pedsDeFactura.get(f.cufe) || []).forEach((x) => (avisoPed.get(String(x.numero || '').toUpperCase()) || []).forEach((mo) => s.add(mo)));
      return [...s];
    };
    const respDe = new Map();
    (D.responsables || []).forEach((r) => { if (!respDe.has(r.user_id)) respDe.set(r.user_id, new Set()); respDe.get(r.user_id).add(Number(r.sede_id)); });
    const habiles = habilesEntre(desde, hasta > hoy ? hoy : hasta);
    const personas = (D.perfiles || []).filter((p) => p.activo !== false && (p.rol === 'admin' || p.rol === 'pagos'));
    // fotos diarias del Sin asignar: dia -> marca -> pool
    const fotos = new Map();
    (D.fotos || []).forEach((x) => { const d = fechaCO(x.dia); if (!X.enRango(d)) return; if (!fotos.has(d)) fotos.set(d, new Map()); fotos.get(d).set(Number(x.marca_id), Number(x.pool || 0)); });
    const poolHoyMarca = new Map();
    (D.facturas || []).forEach((f) => { if (f.estado === 'pool' && f.marca_id != null) poolHoyMarca.set(Number(f.marca_id), (poolHoyMarca.get(Number(f.marca_id)) || 0) + 1); });
    const metaDelDia = (d) => (d === primerHabilDelMes(d) ? 0 : metas.maxSinAsignar);

    return personas.map((p) => {
      const S = respDe.get(p.user_id) || new Set();
      const M = new Set([...S].map((s) => sedeMarca.get(s)).filter((x) => x != null));
      const misFact = (D.facturas || []).filter((f) => S.has(Number(X.sedeDe(f))));

      // 1) envio a contabilidad a diario (antes de la hora de corte, o al dia siguiente en la mañana)
      //    cumplimiento = de lo que YA debia estar enviado (plazo vencido o ya enviado), cuanto se envio
      //    puntualidad  = de lo enviado, cuanto salio dentro del plazo. Lo que aun esta en plazo no cuenta en ninguno.
      let enviados = 0, aTiempo = 0, enPlazo = 0; const tarde = [], vencidos = [];
      const doc = (f, listo, limite, extra) => Object.assign({ cufe: f.cufe, doc: (f.prefijo || '') + (f.folio || ''), emisor: f.emisor, listo: horaCO(listo), limite: horaCO(limite) }, extra || {});
      for (const f of misFact) {
        if (!terminada(f)) continue;
        const listo = X.listoEn(f); if (isNaN(listo) || !X.enRango(fechaCO(new Date(listo).toISOString()))) continue;
        const e = X.envio.get(f.cufe);
        if (e && e.arranque) continue;                         // dado por enviado al arrancar el control: no se puede medir
        const limite = limiteEnvio(listo, metas);
        if (e) { enviados++; if (e.t <= limite) aTiempo++; else tarde.push(doc(f, listo, limite, { enviado: horaCO(e.t) })); }
        else if (ahora <= limite) enPlazo++;
        else vencidos.push(doc(f, listo, limite));
      }
      const eTot = enviados + vencidos.length + enPlazo;
      const pendientes = misFact.filter((f) => terminada(f) && !X.envio.has(f.cufe)).map((f) => { const l = X.listoEn(f), lim = limiteEnvio(l, metas); return doc(f, l, lim, { vencido: ahora > lim, t: l }); }).sort((a, b) => a.t - b.t);
      const porDia = {};
      for (const f of misFact) { const e = X.envio.get(f.cufe); if (e && !e.arranque && X.enRango(e.en)) porDia[e.en] = (porDia[e.en] || 0) + 1; }
      const diasConEnvio = habiles.filter((d) => porDia[d]).length;

      // 2) Sin asignar dentro de la meta (cada marca suya con maximo N; el primer dia habil del mes, 0)
      const diasMed = [], diasMal = [];
      [...fotos.keys()].sort().forEach((d) => {
        const m = fotos.get(d), medidas = [...M].filter((x) => m.has(x));
        if (!medidas.length) return;
        diasMed.push(d);
        const peor = medidas.reduce((a, x) => Math.max(a, m.get(x)), 0);
        if (peor > metaDelDia(d)) diasMal.push({ dia: d, pool: peor, meta: metaDelDia(d) });
      });
      const poolHoy = [...M].reduce((a, x) => a + (poolHoyMarca.get(x) || 0), 0);
      const marcasHoy = [...M].map((x) => ({ marca_id: x, pool: poolHoyMarca.get(x) || 0 }));
      const metaHoy = metaDelDia(hoy);
      const fueraHoy = marcasHoy.filter((x) => x.pool > metaHoy).length;
      // sin fotos: se califica con lo de hoy (1 dia medido)
      const sinAsig = diasMed.length ? [diasMed.length - diasMal.length, diasMed.length] : (M.size ? [fueraHoy ? 0 : 1, 1] : [0, 0]);

      // 3) ingresos sin novedad
      const ingresos = misFact.filter((f) => conIngreso(f) && X.enRango(fechaCO(f.fecha_ingreso)));
      // novedad = el agente avisó Y al final no pudo (lo tuvo que ingresar una persona); si lo logró en otro intento, no cuenta
      const conNovedad = ingresos.filter((f) => motivosDe(f).length && !X.agenteTermino(f));
      const resueltasAgente = ingresos.filter((f) => motivosDe(f).length && X.agenteTermino(f)).length;
      const motivos = {};
      conNovedad.forEach((f) => motivosDe(f).forEach((mo) => { motivos[mo] = (motivos[mo] || 0) + 1; }));
      const manualesIng = ingresos.filter((f) => X.esManual(f)).length;

      // 4) correcciones a mano de la persona
      const manuales = X.hist.filter((h) => h.usuario === p.user_id && MANUALES.includes(h.accion));
      // trabajo extra: N° de ingreso que escribio a mano porque el agente no pudo (no resta; se muestra)
      const yoIngreso = X.hist.filter((h) => h.usuario === p.user_id && INGRESO_HUMANO.includes(h.accion)).length;

      // 5) no hacer lo que le toca al punto (crear pedidos, amarrar, asignar sede)
      const enSusSedes = X.eventosPunto.filter((h) => S.has(h.sede));
      const yo = X.eventosPunto.filter((h) => h.usuario === p.user_id && !h.punto);
      const yoFuera = yo.filter((h) => !S.has(h.sede)).length;
      const den = enSusSedes.length + yoFuera;
      const yoPor = { creados: 0, amarres: 0, asignaciones: 0 };
      yo.forEach((h) => { yoPor[X.tipoEvento(h)]++; });
      const ordenes = (D.ordenes || []).filter((x) => x.pedida_por === p.user_id && X.enRango(fechaCO(x.pedida_en)));

      // 6) uso de la web en sus sedes: facturas ingresadas que llegaron con pedido del punto
      const ingFact = ingresos.filter((f) => f.tipo === 'factura');
      const conPedido = ingFact.filter((f) => (X.pedsDeFactura.get(f.cufe) || []).length).length;

      // cada punto: [bien, de cuantos] -> % de 0 a 100, o null = «Sin datos»
      const base = {
        cumplimiento: [enviados, enviados + vencidos.length],
        puntualidad: [aTiempo, enviados],
        sinAsignar: sinAsig,
        ingresos: [ingresos.length - conNovedad.length, ingresos.length],
        usoWeb: [conPedido, ingFact.length],
        proceso: [Math.max(0, den - yo.length), den],
        correcciones: [Math.max(0, ingresos.length - manuales.length), ingresos.length],
      };
      const puntos = {};
      PUNTOS.forEach((k) => { const [ok, t] = base[k]; puntos[k] = { ok, total: t, pct: t > 0 ? Math.max(0, Math.min(100, Math.round((ok * 100) / t))) : null }; });
      const conDatos = PUNTOS.filter((k) => puntos[k].pct != null);
      // poco movimiento en sus sedes (menos de 20 cosas medidas, sin contar Sin asignar): la nota es poco confiable -> va al final
      const observaciones = PUNTOS.filter((k) => k !== 'sinAsignar').reduce((a, k) => a + puntos[k].total, 0);
      const prom = conDatos.length ? conDatos.reduce((a, k) => a + puntos[k].pct, 0) / conDatos.length : null;
      return {
        user_id: p.user_id, nombre: p.nombre, rol: p.rol, sedes: [...S], marcas: [...M],
        puntaje: S.size && prom != null ? Math.min(100, Math.max(1, Math.round(prom))) : null,
        puntos, observaciones, pocoMovimiento: observaciones < 20,
        volumen: { enviados, ingresos: ingresos.length, ingresosAMano: yoIngreso, ordenes: ordenes.length, pendientes: pendientes.length },
        detalle: {
          envio: { total: eTot, enviados, aTiempo, enPlazo, tarde, vencidos, pendientes, porDia, diasConEnvio, diasHabiles: habiles.length },
          sinAsignar: { diasMedidos: diasMed.length, diasEnMeta: diasMed.length - diasMal.length, diasMal, poolHoy, marcasHoy, metaHoy },
          ingresos: { total: ingresos.length, conNovedad: conNovedad.length, resueltasAgente, sinPedido: ingFact.length - conPedido, conPedido, facturas: ingFact.length, motivos, aMano: manualesIng },
          correcciones: { total: manuales.length, porAccion: manuales.reduce((m, h) => { m[h.accion] = (m[h.accion] || 0) + 1; return m; }, {}) },
          proceso: { eventos: enSusSedes.length, delPunto: enSusSedes.filter((h) => h.punto).length, yo: yo.length, yoPor },
          ordenes: ordenes.length,
        },
      };
    }).sort((a, b) => (a.puntaje == null) - (b.puntaje == null) || (!!a.pocoMovimiento - !!b.pocoMovimiento) || (b.puntaje || 0) - (a.puntaje || 0) || String(a.nombre).localeCompare(String(b.nombre)));
  }

  // ---------------------------------------------------------------- sedes (puntos)
  // por sede: pedidos creados por el punto, amarres por el punto o con foto, facturas asignadas por el punto, facturas
  // ingresadas con pedido. Calificacion = promedio de los puntos que tuvieron movimiento (1 a 100%).
  function calcularSedes(datos, o) {
    const D = datos || {};
    const X = preparar(D, o);
    const out = [];
    for (const s of D.sedes || []) {
      const id = Number(s.id);
      const ev = X.eventosPunto.filter((h) => h.sede === id);
      const g = { creados: [0, 0], amarres: [0, 0], asignaciones: [0, 0] };
      const porAnalista = {};
      ev.forEach((h) => { const k = X.tipoEvento(h); g[k][1]++; if (h.punto) g[k][0]++; else { const n = h.usuario || 'sin usuario'; porAnalista[n] = (porAnalista[n] || 0) + 1; } });
      const ing = (D.facturas || []).filter((f) => f.tipo === 'factura' && Number(X.sedeDe(f)) === id && conIngreso(f) && X.enRango(fechaCO(f.fecha_ingreso)));
      const conPed = ing.filter((f) => (X.pedsDeFactura.get(f.cufe) || []).length).length;
      const partes = { creados: g.creados, amarres: g.amarres, asignaciones: g.asignaciones, conPedido: [conPed, ing.length] };
      const medidas = Object.values(partes).filter((x) => x[1] > 0);
      if (!medidas.length) continue;
      const prom = medidas.reduce((a, x) => a + x[0] / x[1], 0) / medidas.length;
      out.push({ sede_id: id, nombre: s.nombre, marca_id: s.marca_id, puntaje: Math.min(100, Math.max(1, Math.round(prom * 100))), partes, porAnalista });
    }
    return out.sort((a, b) => a.puntaje - b.puntaje || String(a.nombre).localeCompare(String(b.nombre)));
  }

  // ---------------------------------------------------------------- ingresos a mano (el agente no pudo)
  function ingresosAMano(datos, o) {
    const D = datos || {};
    const X = preparar(D, o);
    const ing = (D.facturas || []).filter((f) => conIngreso(f) && X.enRango(fechaCO(f.fecha_ingreso)));
    const porSede = new Map();
    ing.forEach((f) => { const k = X.sedeDe(f); if (!porSede.has(k)) porSede.set(k, { sede_id: k, total: 0, aMano: 0 }); const r = porSede.get(k); r.total++; if (X.esManual(f)) r.aMano++; });
    const aMano = ing.filter((f) => X.esManual(f)).length;
    return { total: ing.length, aMano, pct: ing.length ? Math.round((aMano * 1000) / ing.length) / 10 : 0, porSede: [...porSede.values()].map((r) => Object.assign(r, { pct: r.total ? Math.round((r.aMano * 1000) / r.total) / 10 : 0 })).sort((a, b) => b.pct - a.pct) };
  }

  // color de la calificacion
  const nivel = (n) => (n == null ? 'sin' : n >= 85 ? 'bien' : n >= 70 ? 'medio' : 'mal');

  function periodo(tipo, hoy) {
    if (tipo === 'semana') { const w = dow(hoy); return { desde: sumar(hoy, -((w + 6) % 7)), hasta: hoy }; }
    if (tipo === 'mes') return { desde: hoy.slice(0, 8) + '01', hasta: hoy };
    return { desde: sumar(hoy, -29), hasta: hoy };
  }

  return { PUNTOS, PESOS, NOMBRES, METAS, DIAS_ALERTA, MANUALES, pascua, festivosColombia, esFestivo, esHabil, diasHabiles, habilesEntre, siguienteHabil, primerHabilDelMes, limiteEnvio, horaCO, fechaCO, fechaListo, terminada, numPed, calcular, calcularSedes, ingresosAMano, nivel, periodo, sumar };
});
