// ============================================================
//  agente-avisos.js  -  "Avisos del agente" en Admin > Agente (28/09/2026)
//  Antes, lo que le pasaba al agente durante un ingreso y NO era "unidad sin decidir" ni "nombre sin decidir" (que ya tienen su propia
//  cola) solo llegaba por correo: si a alguien se le pasaba el correo, se perdia. Ahora queda tambien aqui (tabla agente_aviso) para
//  poder ir ajustando (ensenarle algo al agente, corregir un dato, o simplemente marcarlo visto).
//  Logica PURA (sin red, sin DOM): que se muestra y en que orden. Lo usa index.html; se prueba con node.
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AgenteAvisos = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const t = (d) => { const n = Date.parse(d); return isFinite(n) ? n : 0; };

  // avisos: filas de agente_aviso -> las pendientes, mas recientes primero
  function pendientes(avisos) {
    return (avisos || []).filter((a) => a && a.estado !== 'resuelta').slice().sort((a, b) => t(b.creado_en) - t(a.creado_en));
  }

  // texto corto para el badge del boton/pestaña: "3 avisos" / "sin avisos"
  function resumenTexto(avisos) {
    const n = pendientes(avisos).length;
    return n ? `${n} aviso${n === 1 ? '' : 's'}` : 'sin avisos';
  }

  return { pendientes, resumenTexto };
});
