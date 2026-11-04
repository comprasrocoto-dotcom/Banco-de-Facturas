// ============================================================
//  reporte-ingresos.js  -  ¿QUIÉN INGRESA, EL AGENTE O EL ANALISTA?  (03/11/2026, pedido del usuario)
//  «revisar realmente cuántos ingresos hace el agente y cuántos termina el analista, para hacer seguimiento del rendimiento del
//   agente y evaluar puntos a mejorar». Las filas vienen de la base (reporte_ingresos: una por pedido con factura) y aqui se
//  arman los totales, el cuadro por analista, los motivos de falla, los proveedores donde mas falla y la evolucion por semana.
//  Logica PURA (sin red ni DOM): la usa js/reporte-ingresos-ui.js y se prueba con node.
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ReporteIngresos = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const COMO = {
    AGENTE: 'Agente',
    ANALISTA_TRAS_FALLO: 'Analista (el agente falló)',
    ANALISTA_DIRECTO: 'Analista (sin pasar por el agente)',
    PENDIENTE: 'Pendiente de ingresar',
  };
  const SIN_ANALISTA = 'Sin analista asignado';
  const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

  function vacio() { return { total: 0, agente: 0, tras_fallo: 0, directo: 0, pendiente: 0, reintentos: 0 }; }
  function sumar(c, f) {
    c.total++;
    if (f.como === 'AGENTE') { c.agente++; if (Number(f.intentos) > 1) c.reintentos++; }
    else if (f.como === 'ANALISTA_TRAS_FALLO') c.tras_fallo++;
    else if (f.como === 'ANALISTA_DIRECTO') c.directo++;
    else c.pendiente++;
  }
  // ingresados = agente + analista (tras fallo o directo); % agente = sobre lo ingresado
  function cerrar(c) {
    const ingresados = c.agente + c.tras_fallo + c.directo;
    return Object.assign(c, { ingresados, analista: c.tras_fallo + c.directo, pct_agente: pct(c.agente, ingresados),
      pct_analista: pct(c.tras_fallo + c.directo, ingresados), pct_falla_agente: pct(c.tras_fallo, c.agente + c.tras_fallo) });
  }

  function resumen(filas) { const c = vacio(); (filas || []).forEach((f) => sumar(c, f)); return cerrar(c); }

  // por analista responsable de la sede (si una sede tiene dos analistas, el pedido cuenta para los dos)
  function porAnalista(filas) {
    const m = new Map();
    for (const f of filas || []) {
      const nombres = String(f.analista || '').split(',').map((x) => x.trim()).filter(Boolean);
      for (const n of (nombres.length ? nombres : [SIN_ANALISTA])) { if (!m.has(n)) m.set(n, vacio()); sumar(m.get(n), f); }
    }
    return [...m.entries()].map(([nombre, c]) => Object.assign({ nombre }, cerrar(c))).sort((a, b) => b.total - a.total);   // ojo: «analista» ya es el conteo
  }

  // texto de error parecido -> mismo motivo (sin numeros de pedido, facturas ni cifras)
  function motivoDe(f) {
    const etapa = f.etapa_error || (f.estado_cola ? 'Sin etapa' : 'Nunca pasó por el agente');
    let t = String(f.error || '').toUpperCase()
      .replace(/PED-\d+/g, 'PED-#').replace(/\b[A-Z]{1,6}\d{2,}\b/g, '#').replace(/\$?\d[\d.,]*/g, '#').replace(/\s+/g, ' ').trim();
    if (t.length > 90) t = t.slice(0, 90) + '…';
    return { etapa, detalle: t || '(sin detalle)' };
  }
  // por que no lo termino el agente (lo que tuvo que terminar el analista + lo que sigue pendiente en la cola)
  function motivos(filas) {
    const m = new Map();
    for (const f of filas || []) {
      if (f.como === 'AGENTE' || (f.como === 'PENDIENTE' && !f.estado_cola) || f.como === 'ANALISTA_DIRECTO') continue;
      const { etapa, detalle } = motivoDe(f), k = etapa + '|' + detalle;
      if (!m.has(k)) m.set(k, { etapa, detalle, cantidad: 0, pedidos: [] });
      const x = m.get(k); x.cantidad++; if (x.pedidos.length < 8) x.pedidos.push(f.pedido);
    }
    return [...m.values()].sort((a, b) => b.cantidad - a.cantidad);
  }

  // proveedores donde el agente termina menos (los que mas le toca terminar al analista)
  function porProveedor(filas, minimo) {
    const m = new Map();
    for (const f of filas || []) { const n = f.proveedor || '(sin proveedor)'; if (!m.has(n)) m.set(n, vacio()); sumar(m.get(n), f); }
    return [...m.entries()].map(([proveedor, c]) => Object.assign({ proveedor }, cerrar(c)))
      .filter((x) => x.analista > 0 && x.ingresados >= (minimo || 1)).sort((a, b) => b.analista - a.analista || a.pct_agente - b.pct_agente);
  }

  // lunes de la semana de una fecha AAAA-MM-DD
  function lunes(d) {
    const x = new Date(String(d).slice(0, 10) + 'T12:00:00Z'); if (isNaN(x)) return '';
    const dia = (x.getUTCDay() + 6) % 7; x.setUTCDate(x.getUTCDate() - dia); return x.toISOString().slice(0, 10);
  }
  function porSemana(filas) {
    const m = new Map();
    for (const f of filas || []) { const s = lunes(f.dia); if (!s) continue; if (!m.has(s)) m.set(s, vacio()); sumar(m.get(s), f); }
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([semana, c]) => Object.assign({ semana }, cerrar(c)));
  }

  return { COMO, SIN_ANALISTA, resumen, porAnalista, motivos, motivoDe, porProveedor, porSemana, lunes, pct };
});
