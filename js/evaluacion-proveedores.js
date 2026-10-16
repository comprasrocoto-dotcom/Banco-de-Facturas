// ============================================================
//  evaluacion-proveedores.js  -  EVALUACION DE PROVEEDORES (16/10/2026, pedido del usuario)
// ============================================================
// Cada proveedor se califica de 1 a 100% en 4 puntos, cada uno por separado; su calificacion es el promedio de los que
// tienen datos («Sin datos» no cuenta):
//   📦 completas    de sus pedidos con factura, cuantos llegaron con todo lo pedido. Incompleto = un producto del pedido no
//                   aparece en la factura, o la sede reporto «No llegó el pedido completo». (Cantidades menores se muestran pero
//                   no se califican: se confunden con cambios de unidad, ej. 8 unidades vs 1 paca.)
//   ↩️ devoluciones de sus facturas, cuantas NO tuvieron nota credito amarrada (+ valor devuelto).
//   📈 precios      de los articulos que se le compraron y tienen compra anterior, cuantos NO subieron mas del X% (5%).
//                   Subidas de mas de 100% = «posible cambio de presentación»: se muestran, no se califican.
//   ⏱️ entrega      de sus pedidos, cuantos llegaron en N dias o menos (2) desde la fecha del pedido hasta la fecha recibido.
// El proveedor se identifica por NIT (9 digitos): el del pedido sale de su ficha (proveedores.nit); el de la factura y el de
// los precios, del documento. Datos: RPC evaluacion_proveedores_datos (supabase/evaluacion_proveedores.sql). Puro (sin red).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EvaluacionProveedores = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PUNTOS = ['completas', 'devoluciones', 'precios', 'entrega'];
  const NOMBRES = { completas: '📦 Entregas completas', devoluciones: '↩️ Sin devoluciones', precios: '📈 Precios estables', entrega: '⏱️ Entrega a tiempo' };
  const METAS = { diasEntrega: 2, alzaPct: 5 };
  const nit9 = (s) => String(s == null ? '' : s).replace(/\D/g, '').slice(0, 9);
  const dia = (s) => (s ? String(s).slice(0, 10) : null);
  const diasEntre = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
  const cod = (x) => String(x == null ? '' : x).trim().toUpperCase();
  const pct = (ok, t) => (t > 0 ? Math.max(0, Math.min(100, Math.round((ok * 100) / t))) : null);
  const docDe = (f) => ((f.prefijo || '') + (f.folio || '')) || String(f.cufe || '').slice(0, 10);

  // datos: { proveedores, pedidos, lineas, lineas_factura, facturas, notas, precios, novedades, config }
  // o: { desde, hasta, metas: { diasEntrega, alzaPct } }
  function calcular(datos, o) {
    const D = datos || {}, cfg = D.config || {};
    const metas = Object.assign({}, METAS, cfg.dias_entrega_prov != null ? { diasEntrega: Number(cfg.dias_entrega_prov) } : {}, cfg.alza_pct != null ? { alzaPct: Number(cfg.alza_pct) } : {}, (o && o.metas) || {});
    const enRango = (d) => !!d && d >= o.desde && d <= o.hasta;
    const provId = new Map((D.proveedores || []).map((p) => [p.id, p]));
    const nombreFicha = (p) => (p && (p.nombre_comercial || p.razon_social)) || '';
    const provPorNit = new Map(); (D.proveedores || []).forEach((p) => { const n = nit9(p.nit); if (n && !provPorNit.has(n)) provPorNit.set(n, p); });
    const grupos = new Map();
    function grupo(clave, nombre, nit) {
      if (!grupos.has(clave)) grupos.set(clave, { clave, nombre: '', nit: nit || '', completas: [0, 0], devoluciones: [0, 0], precios: [0, 0], entrega: [0, 0],
        incompletas: [], menos: [], devueltas: [], valorDevuelto: 0, notas: 0, alzas: [], cambios: [], tarde: [], pedidos: 0, facturas: 0 });
      const g = grupos.get(clave);
      if (!g.nombre && nombre) g.nombre = nombre;
      if (!g.nit && nit) g.nit = nit;
      return g;
    }
    const grupoNit = (nit, nombre) => { const n = nit9(nit); const f = provPorNit.get(n); return grupo(n ? 'nit:' + n : 'nom:' + cod(nombre), nombreFicha(f) || nombre, n); };

    // ---- pedidos: entrega a tiempo y entregas completas
    const lineasPed = new Map(); (D.lineas || []).forEach((l) => { if (!lineasPed.has(l.pedido_id)) lineasPed.set(l.pedido_id, []); lineasPed.get(l.pedido_id).push(l); });
    const lineasFac = new Map(); (D.lineas_factura || []).forEach((l) => { const c = cod(l.codigo); if (!c) return; if (!lineasFac.has(l.factura_cufe)) lineasFac.set(l.factura_cufe, new Map()); const m = lineasFac.get(l.factura_cufe); m.set(c, (m.get(c) || 0) + Number(l.cantidad || 0)); });
    const reportoIncompleto = new Set((D.novedades || []).filter((n) => /complet/i.test(n.motivo || '')).map((n) => n.cufe));
    for (const p of D.pedidos || []) {
      const fp = dia(p.fecha); if (!enRango(fp) || p.estado === 'anulado') continue;
      const ficha = provId.get(p.proveedor_id);
      const n = nit9(ficha && ficha.nit);
      const g = n ? grupo('nit:' + n, nombreFicha(ficha) || p.proveedor_texto, n) : grupo(p.proveedor_id != null ? 'id:' + p.proveedor_id : 'nom:' + cod(p.proveedor_texto), nombreFicha(ficha) || p.proveedor_texto, '');
      g.pedidos++;
      const rec = dia(p.fecha_recibido);
      if (rec) {
        const d = diasEntre(fp, rec);
        g.entrega[1]++;
        if (d <= metas.diasEntrega) g.entrega[0]++; else g.tarde.push({ pedido: p.numero, fecha: fp, recibido: rec, dias: d });
      }
      if (p.factura_cufe) {
        const pl = lineasPed.get(p.id) || [], fl = lineasFac.get(p.factura_cufe), reportada = reportoIncompleto.has(p.factura_cufe);
        const comparable = pl.length > 0 && fl && fl.size > 0;
        if (!comparable && !reportada) continue;
        const faltan = comparable ? pl.filter((l) => cod(l.codigo) && !fl.has(cod(l.codigo))) : [];
        const menos = comparable ? pl.filter((l) => fl.has(cod(l.codigo)) && fl.get(cod(l.codigo)) < Number(l.cantidad || 0) * 0.5) : [];
        g.completas[1]++;
        if (!faltan.length && !reportada) g.completas[0]++;
        else g.incompletas.push({ pedido: p.numero, reportada, faltan: faltan.map((l) => l.insumo || l.codigo) });
        if (menos.length) g.menos.push({ pedido: p.numero, lineas: menos.map((l) => ({ insumo: l.insumo || l.codigo, pedido: Number(l.cantidad || 0), factura: fl.get(cod(l.codigo)) })) });
      }
    }

    // ---- facturas: devoluciones (notas credito amarradas a la factura)
    const notasDe = new Map(); (D.notas || []).forEach((x) => { if (!notasDe.has(x.factura_cufe)) notasDe.set(x.factura_cufe, []); notasDe.get(x.factura_cufe).push(x.nota_cufe); });
    const facPorCufe = new Map((D.facturas || []).map((f) => [f.cufe, f]));
    for (const f of D.facturas || []) {
      if (!enRango(dia(f.fecha_emision))) continue;
      const g = grupoNit(f.nit_emisor, f.emisor);
      if (f.tipo === 'nota_credito') { g.notas++; g.valorDevuelto += Number(f.total || 0); continue; }
      if (f.tipo !== 'factura') continue;
      g.facturas++;
      g.devoluciones[1]++;
      const ns = notasDe.get(f.cufe) || [];
      if (!ns.length) g.devoluciones[0]++;
      else g.devueltas.push({ factura: docDe(f), total: Number(f.total || 0), notas: ns.map((c) => { const nc = facPorCufe.get(c); return nc ? docDe(nc) + ' ($' + Math.round(Number(nc.total || 0)).toLocaleString('es-CO') + ')' : 'nota crédito'; }) });
    }

    // ---- precios: cada compra del periodo frente a la compra anterior del mismo articulo y proveedor
    const series = new Map();
    (D.precios || []).forEach((x) => { const k = nit9(x.nit) + '|' + cod(x.clave || x.articulo); if (!series.has(k)) series.set(k, []); series.get(k).push(x); });
    for (const [, l] of series) {
      l.sort((a, b) => (dia(a.fecha) < dia(b.fecha) ? -1 : dia(a.fecha) > dia(b.fecha) ? 1 : 0));
      let comparado = false, alza = null, cambio = null;
      for (let i = 1; i < l.length; i++) {
        if (!enRango(dia(l[i].fecha))) continue;
        const ant = Number(l[i - 1].precio || 0), act = Number(l[i].precio || 0);
        if (!(ant > 0) || !(act > 0)) continue;
        const inc = ((act - ant) / ant) * 100;
        // cambio de presentacion (ej. de unidad a paca): se muestra, NO se califica
        if (inc > 100 || inc < -60) { if (!cambio || Math.abs(inc) > Math.abs(cambio.pct)) cambio = { articulo: l[i].articulo, antes: ant, despues: act, pct: Math.round(inc), fecha: dia(l[i].fecha) }; continue; }
        comparado = true;
        if (inc > metas.alzaPct && (!alza || inc > alza.pct)) alza = { articulo: l[i].articulo, antes: ant, despues: act, pct: Math.round(inc * 10) / 10, fecha: dia(l[i].fecha), factura: l[i].factura };
      }
      if (!comparado && !cambio) continue;
      const g = grupoNit(l[0].nit, l[0].proveedor);
      if (cambio && !alza) { g.cambios.push(cambio); if (!comparado) continue; }
      g.precios[1]++;
      if (alza) g.alzas.push(alza); else g.precios[0]++;
    }

    // ---- resultado
    const out = [];
    for (const g of grupos.values()) {
      const puntos = {};
      PUNTOS.forEach((k) => { puntos[k] = { ok: g[k][0], total: g[k][1], pct: pct(g[k][0], g[k][1]) }; });
      const con = PUNTOS.filter((k) => puntos[k].pct != null);
      if (!con.length) continue;
      const observaciones = PUNTOS.reduce((a, k) => a + puntos[k].total, 0);
      out.push({
        clave: g.clave, nombre: g.nombre || 'Sin nombre', nit: g.nit,
        puntaje: Math.min(100, Math.max(1, Math.round(con.reduce((a, k) => a + puntos[k].pct, 0) / con.length))),
        puntos, observaciones, pocoMovimiento: observaciones < 5,
        detalle: { pedidos: g.pedidos, facturas: g.facturas, incompletas: g.incompletas, menos: g.menos, devueltas: g.devueltas, notas: g.notas, valorDevuelto: g.valorDevuelto,
          alzas: g.alzas.sort((a, b) => b.pct - a.pct), cambios: g.cambios, tarde: g.tarde.sort((a, b) => b.dias - a.dias) },
      });
    }
    return out.sort((a, b) => (!!a.pocoMovimiento - !!b.pocoMovimiento) || a.puntaje - b.puntaje || String(a.nombre).localeCompare(String(b.nombre)));
  }

  return { PUNTOS, NOMBRES, METAS, nit9, diasEntre, calcular };
});
