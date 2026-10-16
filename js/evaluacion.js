// ============================================================
//  evaluacion.js  -  EVALUACION DE ANALISTAS Y AUXILIARES (16/10/2026, pedido del usuario)
// ============================================================
// Califica de 1 a 100 a cada persona (admin / analista) con 5 cosas, cada una con su peso (se cambian en el modulo):
//   envio       Envio a contabilidad a tiempo: lo terminado de SUS sedes que salio en un envio a mas tardar N dias habiles
//               despues de quedar listo (ingresado + sellado). Lo que sigue sin enviar y ya paso el plazo cuenta como tarde.
//   sinAsignar  «Sin asignar» limpio en SUS marcas: dias sin facturas viejas (mas de N dias habiles) en Sin asignar.
//   ingresos    Ingresos de SUS sedes sin novedad del agente.
//   correcciones Correcciones hechas a mano POR ESA PERSONA (ingreso ERP manual, desamarres, sellos quitados, borrados)
//               frente a los ingresos de sus sedes.
//   proceso     Debido proceso en SUS sedes: pedidos creados por el punto (no por un analista) y amarres hechos por el
//               punto o por la foto de la factura (no a mano por un analista).
// «Sus sedes» = las que el administrador le asigna en el modulo (tabla evaluacion_responsable); no cambia lo que la persona ve.
// Dias habiles: sin sabados, domingos ni festivos de Colombia (Ley Emiliani), calculados aqui mismo para cualquier año.
// Puro (sin red): lo usan la web y las pruebas. Datos: RPC evaluacion_datos (supabase/evaluacion.sql).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Evaluacion = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PESOS = { envio: 30, sinAsignar: 20, ingresos: 20, correcciones: 15, proceso: 15 };
  const NOMBRES = { envio: 'Envío a contabilidad a tiempo', sinAsignar: '«Sin asignar» limpio', ingresos: 'Ingresos sin novedad', correcciones: 'Pocas correcciones a mano', proceso: 'Pedidos y amarres por el punto' };
  const DIAS_ALERTA = 2;
  // acciones del historial que son correcciones a mano
  const MANUALES = ['numero de ingreso ERP (manual)', 'pedido desamarrado', 'sello quitado - devuelta al pool', 'pedido borrado', 'factura borrada'];

  // ---------------------------------------------------------------- fechas
  const DIA = 86400000;
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  const aT = (d) => Date.parse(String(d).slice(0, 10) + 'T00:00:00Z');
  const sumar = (d, n) => iso(aT(d) + n * DIA);
  const dow = (d) => new Date(aT(d)).getUTCDay();          // 0 domingo ... 6 sabado
  // fecha de Colombia (UTC-5, sin horario de verano) de un timestamp, o la misma fecha si ya viene YYYY-MM-DD
  function fechaCO(ts) {
    if (!ts || ts === 'null') return null;
    const s = String(ts);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const t = Date.parse(s);
    return isNaN(t) ? null : iso(t - 5 * 3600000);
  }

  // Domingo de Pascua (algoritmo anonimo gregoriano)
  function pascua(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
    return y + '-' + String(mes).padStart(2, '0') + '-' + String(dia).padStart(2, '0');
  }
  const lunesSiguiente = (d) => { const w = dow(d); return w === 1 ? d : sumar(d, (8 - w) % 7); };
  const fijo = (y, m, d) => y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');

  // festivos de Colombia de un año -> [{ fecha, nombre }] ordenados
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
  // dias habiles DESPUES de d1 hasta d2 inclusive (lo de hoy no cuenta: listo el lunes y enviado el martes = 1)
  function diasHabiles(d1, d2) {
    if (!d1 || !d2 || d2 <= d1) return 0;
    let n = 0;
    for (let d = sumar(d1, 1); d <= d2; d = sumar(d, 1)) if (esHabil(d)) n++;
    return n;
  }
  function habilesEntre(desde, hasta) {   // lista de dias habiles de desde a hasta (inclusive)
    const out = [];
    if (!desde || !hasta) return out;
    for (let d = desde; d <= hasta; d = sumar(d, 1)) if (esHabil(d)) out.push(d);
    return out;
  }

  // ---------------------------------------------------------------- documentos
  const conIngreso = (f) => !!f && !!f.num_ingreso && String(f.num_ingreso).trim() !== '' && String(f.num_ingreso) !== 'null';
  const terminada = (f) => conIngreso(f) && (f.estado === 'sellada' || f.estado === 'pagada' || f.tipo === 'nota_credito');
  // dia en que quedo listo para enviar: el ultimo entre el ingreso al ERP y el sello
  function fechaListo(f) {
    const fi = fechaCO(f && f.fecha_ingreso);
    const fs = f && f.tipo !== 'nota_credito' ? fechaCO(f.sellada_en) : null;
    if (fi && fs) return fi > fs ? fi : fs;
    return fi || fs || null;
  }
  const numPed = (s) => { const m = /PED-\d+/i.exec(String(s || '')); return m ? m[0].toUpperCase() : null; };
  const pts = (peso, ok, total) => (total > 0 ? (peso * ok) / total : peso);
  const redondo = (x) => Math.round(x * 10) / 10;

  // ---------------------------------------------------------------- calificacion
  // datos: { perfiles, sedes, facturas, pedidos, historial, envios, lotes, avisos, ordenes, responsables, fotos }
  // o: { desde, hasta, hoy, pesos, diasAlerta }
  function calcular(datos, o) {
    const D = datos || {};
    const pesos = Object.assign({}, PESOS, (o && o.pesos) || {});
    const dA = Number((o && o.diasAlerta) || DIAS_ALERTA);
    const desde = o.desde, hasta = o.hasta, hoy = o.hoy;
    const enRango = (d) => !!d && d >= desde && d <= hasta;
    const sedeMarca = new Map((D.sedes || []).map((s) => [Number(s.id), Number(s.marca_id)]));
    const rolDe = new Map((D.perfiles || []).map((p) => [p.user_id, p.rol]));
    const lotes = new Map((D.lotes || []).map((l) => [Number(l.id), l]));
    const envio = new Map();
    (D.envios || []).forEach((e) => { const l = lotes.get(Number(e.lote_id)); if (l && l.anulado) return; envio.set(e.factura_cufe, { lote: Number(e.lote_id), en: fechaCO(e.enviada_en), arranque: !!(l && l.creado_por === 'arranque') }); });
    const pedPorNum = new Map((D.pedidos || []).map((p) => [String(p.numero || '').toUpperCase(), p]));
    const pedsDeFactura = new Map();
    (D.pedidos || []).forEach((p) => { if (p.factura_cufe) { if (!pedsDeFactura.has(p.factura_cufe)) pedsDeFactura.set(p.factura_cufe, []); pedsDeFactura.get(p.factura_cufe).push(p); } });
    const sedeDe = (f) => (f.sede_id != null ? Number(f.sede_id) : ((pedsDeFactura.get(f.cufe) || [])[0] || {}).sede_id);
    const avisoCufe = new Map(), avisoPed = new Map();   // -> motivos
    const poner = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
    const motivoCorto = (s) => String(s || 'sin motivo').replace(/\s*\(FASE \d+\)/i, '').replace(/\d+/g, '#').slice(0, 70);
    (D.avisos || []).forEach((a) => { const mo = motivoCorto(a.motivo); if (a.factura_cufe) poner(avisoCufe, a.factura_cufe, mo); if (a.pedido_numero) poner(avisoPed, String(a.pedido_numero).toUpperCase(), mo); });
    const motivosDe = (f) => {
      const s = new Set(avisoCufe.get(f.cufe) || []);
      (pedsDeFactura.get(f.cufe) || []).forEach((x) => (avisoPed.get(String(x.numero || '').toUpperCase()) || []).forEach((mo) => s.add(mo)));
      return [...s];
    };
    const hist = (D.historial || []).map((h) => Object.assign({}, h, { dia: fechaCO(h.created_at) })).filter((h) => enRango(h.dia));
    const respDe = new Map();
    (D.responsables || []).forEach((r) => { if (!respDe.has(r.user_id)) respDe.set(r.user_id, new Set()); respDe.get(r.user_id).add(Number(r.sede_id)); });
    const habiles = habilesEntre(desde, hasta > hoy ? hoy : hasta);
    const personas = (D.perfiles || []).filter((p) => p.activo !== false && (p.rol === 'admin' || p.rol === 'pagos'));

    return personas.map((p) => {
      const S = respDe.get(p.user_id) || new Set();
      const M = new Set([...S].map((s) => sedeMarca.get(s)).filter((x) => x != null));
      const misFact = (D.facturas || []).filter((f) => S.has(Number(sedeDe(f))));

      // 1) envio a contabilidad a tiempo
      let eTot = 0, eOk = 0; const tarde = [], vencidos = [];
      for (const f of misFact) {
        if (!terminada(f)) continue;
        const listo = fechaListo(f); if (!enRango(listo)) continue;
        const e = envio.get(f.cufe);
        if (e && e.arranque) continue;                         // dado por enviado al arrancar el control: no se puede medir
        const dias = diasHabiles(listo, e ? e.en : hoy);
        eTot++;
        if (dias <= dA) eOk++;
        else (e ? tarde : vencidos).push({ cufe: f.cufe, doc: (f.prefijo || '') + (f.folio || ''), emisor: f.emisor, listo, dias });
      }
      const pendientes = misFact.filter((f) => terminada(f) && !envio.has(f.cufe)).map((f) => ({ cufe: f.cufe, doc: (f.prefijo || '') + (f.folio || ''), emisor: f.emisor, listo: fechaListo(f), dias: diasHabiles(fechaListo(f), hoy) }));
      const porDia = {};
      for (const f of misFact) { const e = envio.get(f.cufe); if (e && !e.arranque && enRango(e.en)) porDia[e.en] = (porDia[e.en] || 0) + 1; }
      const diasConEnvio = habiles.filter((d) => porDia[d]).length;

      // 2) Sin asignar limpio (fotos diarias por marca; sin fotos, lo de hoy)
      const fotos = (D.fotos || []).filter((x) => M.has(Number(x.marca_id)) && enRango(fechaCO(x.dia)));
      const porFoto = {};
      fotos.forEach((x) => { const d = fechaCO(x.dia); porFoto[d] = (porFoto[d] || 0) + Number(x.viejas || 0); });
      const diasFoto = Object.keys(porFoto);
      const poolHoy = (D.facturas || []).filter((f) => f.estado === 'pool' && M.has(Number(f.marca_id)));
      const viejasHoy = poolHoy.filter((f) => diasHabiles(fechaCO(f.created_at), hoy) > dA);
      let sA;
      if (diasFoto.length) sA = pts(pesos.sinAsignar, diasFoto.filter((d) => porFoto[d] === 0).length, diasFoto.length);
      else sA = Math.max(0, pesos.sinAsignar - 2 * viejasHoy.length);

      // 3) ingresos sin novedad
      const ingresos = misFact.filter((f) => conIngreso(f) && enRango(fechaCO(f.fecha_ingreso)));
      const conNovedad = ingresos.filter((f) => motivosDe(f).length);
      const motivos = {};
      conNovedad.forEach((f) => motivosDe(f).forEach((mo) => { motivos[mo] = (motivos[mo] || 0) + 1; }));

      // 4) correcciones a mano hechas por la persona
      const manuales = hist.filter((h) => h.usuario === p.user_id && MANUALES.includes(h.accion));
      const sCorr = ingresos.length ? Math.max(0, pesos.correcciones * (1 - manuales.length / ingresos.length)) : (manuales.length ? 0 : pesos.correcciones);

      // 5) debido proceso: pedidos creados y amarres hechos por el punto (o por foto) en sus sedes
      const delPunto = (h) => h.accion === 'pedido amarrado por foto' || rolDe.get(h.usuario) === 'sede';
      const creados = hist.filter((h) => h.accion === 'pedido creado desde la web').map((h) => ({ h, ped: pedPorNum.get(numPed(h.detalle)) })).filter((x) => x.ped && S.has(Number(x.ped.sede_id)));
      const amarres = hist.filter((h) => h.accion === 'pedido amarrado' || h.accion === 'pedido amarrado por foto').map((h) => ({ h, ped: pedPorNum.get(numPed(h.detalle)) })).filter((x) => x.ped && S.has(Number(x.ped.sede_id)));
      const okProc = creados.filter((x) => delPunto(x.h)).length + amarres.filter((x) => delPunto(x.h)).length;
      // lo que ESTA persona hizo a mano (en cualquier sede)
      const yoCreo = hist.filter((h) => h.usuario === p.user_id && h.accion === 'pedido creado desde la web');
      const yoAmarro = hist.filter((h) => h.usuario === p.user_id && h.accion === 'pedido amarrado');
      const sinPedido = ingresos.filter((f) => f.tipo === 'factura' && !(pedsDeFactura.get(f.cufe) || []).length);
      const ordenes = (D.ordenes || []).filter((x) => x.pedida_por === p.user_id && enRango(fechaCO(x.pedida_en)));

      const comp = {
        envio: pts(pesos.envio, eOk, eTot),
        sinAsignar: sA,
        ingresos: pts(pesos.ingresos, ingresos.length - conNovedad.length, ingresos.length),
        correcciones: sCorr,
        proceso: pts(pesos.proceso, okProc, creados.length + amarres.length),
      };
      Object.keys(comp).forEach((k) => { comp[k] = redondo(comp[k]); });
      const total = Object.values(comp).reduce((a, b) => a + b, 0);
      const maximo = Object.values(pesos).reduce((a, b) => a + Number(b || 0), 0) || 100;
      return {
        user_id: p.user_id, nombre: p.nombre, rol: p.rol, sedes: [...S], marcas: [...M],
        puntaje: S.size ? Math.min(100, Math.max(1, Math.round((total * 100) / maximo))) : null,
        comp,
        detalle: {
          envio: { total: eTot, aTiempo: eOk, tarde, vencidos, pendientes, porDia, diasConEnvio, diasHabiles: habiles.length },
          sinAsignar: { diasMedidos: diasFoto.length, diasLimpios: diasFoto.filter((d) => porFoto[d] === 0).length, poolHoy: poolHoy.length, viejasHoy: viejasHoy.length, masVieja: viejasHoy.reduce((m, f) => Math.max(m, diasHabiles(fechaCO(f.created_at), hoy)), 0) },
          ingresos: { total: ingresos.length, conNovedad: conNovedad.length, sinPedido: sinPedido.length, motivos },
          correcciones: { total: manuales.length, porAccion: manuales.reduce((m, h) => { m[h.accion] = (m[h.accion] || 0) + 1; return m; }, {}) },
          proceso: { creados: creados.length, creadosPunto: creados.filter((x) => delPunto(x.h)).length, amarres: amarres.length, amarresPunto: amarres.filter((x) => delPunto(x.h)).length, yoCreo: yoCreo.length, yoAmarro: yoAmarro.length },
          ordenes: ordenes.length,
        },
      };
    }).sort((a, b) => (a.puntaje == null) - (b.puntaje == null) || (b.puntaje || 0) - (a.puntaje || 0) || String(a.nombre).localeCompare(String(b.nombre)));
  }

  // color de la calificacion
  const nivel = (n) => (n == null ? 'sin' : n >= 85 ? 'bien' : n >= 70 ? 'medio' : 'mal');

  // periodos rapidos -> { desde, hasta }
  function periodo(tipo, hoy) {
    if (tipo === 'semana') { const w = dow(hoy); return { desde: sumar(hoy, -((w + 6) % 7)), hasta: hoy }; }
    if (tipo === 'mes') return { desde: hoy.slice(0, 8) + '01', hasta: hoy };
    return { desde: sumar(hoy, -29), hasta: hoy };
  }

  return { PESOS, NOMBRES, DIAS_ALERTA, MANUALES, pascua, festivosColombia, esFestivo, esHabil, diasHabiles, habilesEntre, fechaCO, fechaListo, terminada, numPed, calcular, nivel, periodo, sumar };
});
